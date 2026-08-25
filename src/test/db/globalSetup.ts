/**
 * Reads the local stack's credentials once and puts them in the environment.
 *
 * `supabase status -o env` is the authoritative source — hardcoding the CLI's demo keys
 * works until the day it doesn't, and the failure would look like a broken RLS policy
 * rather than a bad key.
 *
 * If the stack is not running this fails loudly and the whole suite errors out. That is
 * deliberate: a DB-backed suite that quietly skips itself when Docker is down is a suite
 * that reports green while testing nothing, which is the failure mode this sprint exists
 * to remove.
 */
import { execFileSync } from 'node:child_process';

/**
 * Ask the Supabase CLI where the stack is.
 *
 * Tries a `supabase` already on PATH before falling back to `npx supabase`. In CI the
 * stack is started by `supabase/setup-cli@v1`, which installs a different (newer) CLI than
 * the one pinned in devDependencies — and `npx` would resolve to the pinned one, so the
 * version reading the stack's status would not be the version that created it. Preferring
 * PATH means the same binary does both.
 */
function runStatus(): string {
    const attempts: [string, string[]][] = [
        ['supabase', ['status', '-o', 'env']],
        ['npx', ['supabase', 'status', '-o', 'env']],
    ];

    let lastError: unknown;
    for (const [command, args] of attempts) {
        try {
            return execFileSync(command, args, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
            });
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}

function readStackEnv(): Record<string, string> {
    let raw: string;
    try {
        raw = runStatus();
    } catch (err) {
        throw new Error(
            'Could not read the local Supabase stack status. These tests run against a real ' +
            'Postgres; start it with `npm run db:start` (Docker required).\n' +
            (err instanceof Error ? err.message : String(err)),
        );
    }

    const env: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim());
        if (match) env[match[1]] = match[2];
    }
    return env;
}

/**
 * The team-number range `fixtures.ts` allocates from, and nothing else does.
 *
 * `nextFixtureTeamNumber()` counts up from 30000, so every db-fixture team is 30001-39999.
 * Verified disjoint from every other producer before this sweep was written, because a sweep
 * that took out a developer's own data would be far worse than the problem it solves:
 * `seed-review-states.mjs` uses four-digit numbers (9000, 4321, 7777, 2468, 9099) plus 12345,
 * `seed-demo-team.mjs` uses 14822, and the e2e pack's `uniqueTeamNumber()` draws from
 * 50000-95000.
 */
const FIXTURE_TEAM_NUMBER_PATTERN = '^3[0-9]{4}$';

/**
 * Delete fixture teams a previous run did not live long enough to clean up.
 *
 * `Fixtures.cleanup()` only runs if the process REACHES it. Kill a run part-way — Ctrl-C, a CI
 * timeout, an OOM, or the exit-127 death this repo has been chasing — and its teams survive at
 * 30001, 30002… The next run's very first `createTeam` then fails
 * `duplicate key value violates unique constraint "teams_program_number_unique"` and takes
 * TWENTY SUITES down with an error about the fixture rather than about the test. Observed twice
 * while closing Sprint 19.
 *
 * And it is self-sustaining: the collided run also dies before its own cleanup, so the state
 * persists until someone runs `db:verify` or deletes the rows by hand. Sweeping here breaks that
 * cycle, which is the half the alternative fix (a random per-run base) does not do.
 *
 * The fixture comment says the numbering exists so a shared number cannot "take the whole of
 * `tenant-isolation` down with an error about the fixture". Leftovers are how it did anyway.
 *
 * FAILS LOUDLY. A sweep that swallowed its own error would hand the run right back to the
 * duplicate-key cascade, with one more layer of indirection between the symptom and the cause.
 */
function sweepOrphanedFixtureTeams(): void {
    /*
     * `psql` through the running container, rather than adding a Postgres client to this file:
     * `db:assert` already reaches the database exactly this way, so there is one mechanism here
     * and not two. The container name is fixed by `supabase/config.toml`'s `project_id`.
     *
     * THE SQL GOES ON STDIN, NOT IN AN ARGUMENT, and the first version of this got it wrong in
     * the way `docs/environment-divergences.md` warns about. With `shell: true` on Windows the
     * pattern `^3[0-9]{4}$` is handed to cmd, which treats `^` as its escape character and `$`
     * as its own — psql then received a mangled statement and answered
     * `syntax error at or near "DELETE"`. `-f -` with the statement piped in never touches a
     * shell parser, which is exactly why `db:assert` is written that way.
     *
     * `shell` is therefore false as well. `docker` is a real .exe on PATH, so `execFileSync`
     * finds it without one.
     */
    const sql = `DELETE FROM teams WHERE team_number ~ '${FIXTURE_TEAM_NUMBER_PATTERN}';`;
    try {
        const out = execFileSync(
            'docker',
            ['exec', '-i', 'supabase_db_falconforge', 'psql', '-U', 'postgres', '-d', 'postgres',
                '-v', 'ON_ERROR_STOP=1', '-tA', '-f', '-'],
            { encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'pipe'] },
        );
        const removed = Number((/DELETE (\d+)/.exec(out) ?? [])[1] ?? 0);
        if (removed > 0) {
            console.warn(
                `[globalSetup] swept ${removed} orphaned fixture team(s) left by an interrupted run. ` +
                'If this number is never zero, something is killing the db suite before cleanup.',
            );
        }
    } catch (err) {
        throw new Error(
            'Could not sweep orphaned fixture teams. The db suite will fail on a duplicate team ' +
            'number if any are left over; clear them with `npm run db:reset`.\n' +
            (err instanceof Error ? err.message : String(err)),
        );
    }
}

export default function setup() {
    const env = readStackEnv();

    const missing = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL', 'JWT_SECRET']
        .filter((k) => !env[k]);
    if (missing.length > 0) {
        throw new Error(
            `Local Supabase stack is not running (missing ${missing.join(', ')}). ` +
            'Start it with `npm run db:start`.',
        );
    }

    process.env.SUPABASE_API_URL = env.API_URL;
    process.env.SUPABASE_ANON_KEY = env.ANON_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SERVICE_ROLE_KEY;
    process.env.SUPABASE_DB_URL = env.DB_URL;
    process.env.SUPABASE_JWT_SECRET = env.JWT_SECRET;

    sweepOrphanedFixtureTeams();
}
