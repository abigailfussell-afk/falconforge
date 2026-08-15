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
}
