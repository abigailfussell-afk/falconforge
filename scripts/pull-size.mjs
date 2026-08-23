/**
 * How many bytes an app open costs, before and after the SYNC-01/SYNC-03 read-path change.
 *
 * WHY THIS EXISTS
 *
 * `docs/assessment-2026-08/sync-offline-scale.md` (SYNC-03) put a mid-season team's full pull
 * at ~0.7 MB and the traffic at ~1.9 GB/month per team, against a 5 GB free-tier egress
 * allowance shared by every team on the platform — the first limit a modest user base hits.
 * That number was an estimate built from measured per-row sizes. This measures it.
 *
 * WHAT IT MEASURES
 *
 * Three shapes of the same app open, as an authenticated user over PostgREST:
 *
 *   baseline — what the code did before: `select('*')` filtered by `team_id`, no season
 *              filter, no paging, `seasons` carrying `field_image_data`.
 *   cold     — what it does now on a device that has never seen this team: the same tables,
 *              scoped to the current season, `seasons` without the image column,
 *              `meeting_attendance` reaching its season through `meetings!inner()`.
 *   warm     — what it does on every open after that: the same requests with the delta
 *              cursor each table ended on. This is the shape that dominates the monthly bill,
 *              because a device opens the app many times and installs it once.
 *
 * The `after` shapes are written out here rather than imported, because `server-pull.ts` is
 * browser TypeScript. They are not asserted by faith: `pull-guards.test.ts` pins the two
 * distinguishing features against the real code (`meetings!inner()` on attendance, and no
 * `field_image_data` in the season select), and the row COUNTS printed below come from the
 * same requests, so a shape that asked for the wrong thing shows up as the wrong count.
 *
 * USAGE (local stack only — it refuses anything else)
 *
 *   node scripts/pull-size.mjs                 # measure whatever is seeded
 *   node scripts/pull-size.mjs --seed          # seed a mid-season team's volume first
 *   node scripts/pull-size.mjs --seed --clean  # ...and delete it again afterwards
 *
 * `--seed` writes the assessment's stated mid-season profile into the reviewer's team: 300
 * tasks, 60 meetings, 900 attendance rows, 60 scouting reports, plus the same again in a
 * PRIOR ARCHIVED SEASON, because a team in its second year is the case SYNC-01 says crosses
 * the row cap and SYNC-03 says doubles the bill.
 */
import { createClient } from '@supabase/supabase-js';
import { gzipSync } from 'node:zlib';

const API = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY =
    process.env.SUPABASE_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const REVIEWER = 'reviewer@falconforge.test';
const PASSWORD = process.env.REVIEW_PASSWORD ?? 'ForgeReview!2026-local';

/**
 * Never against production. `docs/environment-divergences.md` §2: a script that inherits its
 * environment writes to the real database, and this one seeds a thousand rows.
 */
if (!/127\.0\.0\.1|localhost/.test(API)) {
    console.error(`Refusing to run against ${API}. This is a local-stack tool.`);
    process.exit(1);
}

const seed = process.argv.includes('--seed');
const clean = process.argv.includes('--clean');

const svc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });

/** Sign in as the reviewer and keep the raw JWT: the measurement is of an ordinary member. */
async function reviewerToken() {
    const anon = createClient(API, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email: REVIEWER, password: PASSWORD });
    if (error) throw new Error(`Could not sign in as ${REVIEWER}: ${error.message}. Run npm run seed:review.`);
    return data.session.access_token;
}

/** One REST request, returning its byte size uncompressed and gzipped, plus the row count. */
async function measure(token, path) {
    const res = await fetch(`${API}/rest/v1/${path}`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`);
    let rows = 0;
    let newest = null;
    try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed)) {
            rows = parsed.length;
            for (const r of parsed) {
                const stamp = r?.updated_at ?? r?.created_at;
                if (stamp && (newest === null || stamp > newest)) newest = stamp;
            }
        }
    } catch { /* not JSON; size is still the answer */ }
    return { bytes: Buffer.byteLength(body), gzip: gzipSync(body).length, rows, newest };
}

const q = (params) => new URLSearchParams(params).toString();

/**
 * The requests one app open makes, in each of the three shapes.
 *
 * Keyed by table so the printout can be read table by table — which is where the story is:
 * `meeting_attendance` and `tasks` are the two that grow without bound.
 */
function requestsFor(shape, { teamId, seasonId, cursors }) {
    const seasonCols = 'id,name,team_id,game_title,is_archived,created_at,updated_at';
    const page = shape === 'baseline' ? {} : { order: 'updated_at.asc,id.asc', limit: '1000' };
    const delta = (table) =>
        shape === 'warm' && cursors[table] ? { updated_at: `gte.${cursors[table]}` } : {};
    const season = (table) =>
        shape === 'baseline' ? {} : { season_id: `eq.${seasonId}`, ...delta(table) };

    return [
        // Not season-scoped in any shape: the tenant, its roster, its season list.
        ['teams', `teams?${q({ select: '*', ...page, ...delta('teams') })}`],
        ['team_members', `team_members?${q({ select: '*', team_id: `eq.${teamId}`, status: 'eq.approved', ...page, ...delta('team_members') })}`],
        ['seasons', `seasons?${q({ select: shape === 'baseline' ? '*' : seasonCols, team_id: `eq.${teamId}`, ...page, ...delta('seasons') })}`],

        // Season-scoped: everything a fresh start empties.
        ['sub_teams', `sub_teams?${q({ select: '*', team_id: `eq.${teamId}`, ...season('sub_teams'), ...page })}`],
        ['tasks', `tasks?${q({ select: '*', team_id: `eq.${teamId}`, ...season('tasks'), ...page })}`],
        ['scouting_reports', `scouting_reports?${q({ select: '*', team_id: `eq.${teamId}`, ...season('scouting_reports'), ...page })}`],
        ['match_plans', `match_plans?${q({ select: '*', team_id: `eq.${teamId}`, ...season('match_plans'), ...page })}`],
        ['meetings', `meetings?${q({ select: '*', team_id: `eq.${teamId}`, ...season('meetings'), ...page })}`],
        // No `season_id` of its own — it reaches the season through its meeting.
        ['meeting_attendance', shape === 'baseline'
            ? `meeting_attendance?${q({ select: '*', team_id: `eq.${teamId}` })}`
            : `meeting_attendance?${q({ select: '*,meetings!inner()', team_id: `eq.${teamId}`, 'meetings.season_id': `eq.${seasonId}`, ...delta('meeting_attendance'), ...page })}`],
        ['checklists', `checklists?${q({ select: '*', team_id: `eq.${teamId}`, is_template: 'eq.false', ...(shape === 'baseline' ? {} : { season_id: `eq.${seasonId}` }), ...page })}`],
        ['team_entitlement', `team_entitlement?${q({ select: '*', team_id: `eq.${teamId}` })}`],
        ['checklist_templates', `checklists?${q({ select: '*', team_id: `eq.${teamId}`, is_template: 'eq.true' })}`],
    ];
}

/**
 * Every page of one table, the way `pullFromServer` walks them.
 *
 * The BASELINE shape deliberately does not page — that is the defect. It sends one request,
 * gets at most `max_rows` back, and believes it. So its byte total is what the old code
 * actually transferred, which is LESS than the truth it was supposed to fetch; the rows it
 * silently dropped are reported separately rather than hidden inside a flattering number.
 */
async function measurePaged(token, shape, table, path) {
    if (shape === 'baseline') {
        const one = await measure(token, path);
        return { ...one, requests: 1, truncated: one.rows >= 1000 };
    }

    let bytes = 0;
    let gzip = 0;
    let rows = 0;
    let requests = 0;
    let newest = null;
    let after = null;

    for (;;) {
        const keyset = after
            ? `&or=${encodeURIComponent(`(updated_at.gt.${after.updated_at},and(updated_at.eq.${after.updated_at},id.gt.${after.id}))`)}`
            : '';
        const res = await fetch(`${API}/rest/v1/${path}${keyset}`, {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        });
        const body = await res.text();
        if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.slice(0, 200)}`);
        bytes += Buffer.byteLength(body);
        gzip += gzipSync(body).length;
        requests += 1;

        let batch = [];
        try { batch = JSON.parse(body); } catch { /* not an array */ }
        if (!Array.isArray(batch)) break;
        rows += batch.length;
        for (const r of batch) {
            const stamp = r?.updated_at ?? r?.created_at;
            if (stamp && (newest === null || stamp > newest)) newest = stamp;
        }
        if (batch.length < 1000) break;
        const last = batch[batch.length - 1];
        if (!last?.updated_at || !last?.id) break;
        after = last;
    }

    return { bytes, gzip, rows, newest, requests, truncated: false };
}

async function runShape(token, shape, context) {
    const rows = [];
    let bytes = 0;
    let gzip = 0;
    let requests = 0;
    const cursors = {};
    for (const [table, path] of requestsFor(shape, context)) {
        const m = await measurePaged(token, shape, table, path);
        rows.push({ table, ...m });
        bytes += m.bytes;
        gzip += m.gzip;
        requests += m.requests;
        if (m.newest) cursors[table] = m.newest;
    }
    return { shape, rows, bytes, gzip, requests, cursors };
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function print(result) {
    console.log(`\n--- ${result.shape} ---`);
    for (const r of result.rows) {
        const flag = r.truncated ? '  <- TRUNCATED at max_rows; the rest was deleted from the device' : '';
        console.log(`  ${r.table.padEnd(20)} ${String(r.rows).padStart(6)} rows  ${kb(r.bytes).padStart(10)}  (gzip ${kb(r.gzip)})${flag}`);
    }
    console.log(`  ${'TOTAL'.padEnd(20)} ${''.padStart(6)}        ${kb(result.bytes).padStart(10)}  (gzip ${kb(result.gzip)})  in ${result.requests} requests`);
}

/** The assessment's stated mid-season profile, in the current season and in a prior one. */
async function seedMidSeason(teamId, seasonId, archivedSeasonId, memberIds) {
    const bulk = async (table, rows) => {
        for (let i = 0; i < rows.length; i += 500) {
            const { error } = await svc.from(table).insert(rows.slice(i, i + 500));
            if (error) throw new Error(`${table}: ${error.message}`);
        }
    };
    const description = 'x'.repeat(200); // the assessment's ~200-char description

    /*
     * SPREAD THE TIMESTAMPS, or the delta measurement is a measurement of the seed.
     *
     * `updated_at` has a BEFORE UPDATE trigger and no INSERT one, so an explicit value on
     * insert survives. Without this every seeded row shares one timestamp to the microsecond,
     * a `gte(cursor)` delta returns all of them, and the "warm open" number would say the
     * change bought nothing — because a bulk insert is not what a season of work looks like.
     */
    const SEASON_START = Date.parse('2026-01-05T18:00:00Z');
    const spread = (i, n) => new Date(SEASON_START + Math.floor((i / n) * 180) * 86_400_000).toISOString();

    for (const [label, sId] of [['current', seasonId], ['prior', archivedSeasonId]]) {
        await bulk('tasks', Array.from({ length: 300 }, (_, i) => ({
            team_id: teamId, season_id: sId, title: `${label} task ${i}`, description,
            created_at: spread(i, 300), updated_at: spread(i, 300),
        })));
        await bulk('scouting_reports', Array.from({ length: 60 }, (_, i) => ({
            team_id: teamId, season_id: sId, opponent_team_number: `${1000 + i}`,
            match_number: i + 1, data: { rating: 3, endGameNotes: 'notes' },
            created_at: spread(i, 60), updated_at: spread(i, 60),
        })));

        const base = Date.parse('2026-01-05T23:00:00Z');
        const meetings = Array.from({ length: 60 }, (_, i) => ({
            team_id: teamId, season_id: sId, title: `${label} practice ${i}`,
            event_type: 'practice',
            starts_at: new Date(base + i * 86_400_000).toISOString(),
            ends_at: new Date(base + i * 86_400_000 + 7_200_000).toISOString(),
            created_at: spread(i, 60), updated_at: spread(i, 60),
        }));
        const { data: inserted, error } = await svc.from('meetings').insert(meetings).select('id');
        if (error) throw new Error(`meetings: ${error.message}`);

        const attendance = [];
        inserted.forEach((m, i) => {
            for (const memberId of memberIds.slice(0, 15)) {
                attendance.push({
                    team_id: teamId, meeting_id: m.id, team_member_id: memberId,
                    status: 'present', method: 'coach',
                    created_at: spread(i, 60), updated_at: spread(i, 60),
                });
            }
        });
        await bulk('meeting_attendance', attendance);
        console.log(`  seeded ${label} season: 300 tasks, 60 scouting, 60 meetings, ${attendance.length} attendance`);
    }
}

async function main() {
    const token = await reviewerToken();

    const { data: teams } = await svc.from('teams').select('id,name').eq('name', 'Iron Falcons').limit(1);
    if (!teams?.length) throw new Error('Iron Falcons not found. Run npm run seed:review.');
    const teamId = teams[0].id;

    const { data: seasons } = await svc
        .from('seasons').select('id,name,is_archived').eq('team_id', teamId).order('created_at');
    const current = seasons.find((s) => !s.is_archived) ?? seasons[0];

    let archived = seasons.find((s) => s.is_archived);
    const seededSeason = !archived && seed;
    if (seededSeason) {
        const { data } = await svc
            .from('seasons')
            .insert({ team_id: teamId, name: 'pull-size prior season', is_archived: true })
            .select('id').single();
        archived = data;
    }

    const { data: members } = await svc
        .from('team_members').select('id').eq('team_id', teamId).eq('status', 'approved');

    if (seed) {
        console.log('Seeding the assessment’s mid-season profile...');
        await seedMidSeason(teamId, current.id, archived.id, members.map((m) => m.id));
    }

    const context = { teamId, seasonId: current.id, cursors: {} };
    console.log(`\nTeam ${teamId}  current season ${current.id} (${current.name})`);
    console.log(`Seasons on this team: ${seasons.length + (seededSeason ? 1 : 0)}`);

    const baseline = await runShape(token, 'baseline', context);
    print(baseline);

    const cold = await runShape(token, 'cold', context);
    print(cold);

    const warm = await runShape(token, 'warm', { ...context, cursors: cold.cursors });
    print(warm);

    const pct = (after) => `${(100 * (1 - after / baseline.bytes)).toFixed(1)}%`;
    const truncated = baseline.rows.filter((r) => r.truncated).map((r) => r.table);
    console.log('\n=== bytes per app open ===');
    console.log(`  baseline (pre-fix, every season, select *) : ${kb(baseline.bytes)}  (gzip ${kb(baseline.gzip)})`);
    if (truncated.length) {
        console.log(`             ...and it was WRONG: ${truncated.join(', ')} truncated at max_rows,`);
        console.log('             so the pre-fix number is smaller than the data it was meant to fetch.');
    }
    console.log(`  cold open  (post-fix, first ever open)     : ${kb(cold.bytes)}  (gzip ${kb(cold.gzip)})  -${pct(cold.bytes)}`);
    console.log(`  warm open  (post-fix, every open after)    : ${kb(warm.bytes)}  (gzip ${kb(warm.gzip)})  -${pct(warm.bytes)}`);
    console.log('\n  A device opens the app many times and installs it once, so the WARM number is');
    console.log('  the one the monthly egress bill is made of.');

    if (seed && clean) {
        console.log('\nRemoving what this run seeded...');
        await svc.from('meeting_attendance').delete().eq('team_id', teamId).eq('method', 'coach').like('notes', 'x%');
        for (const table of ['meeting_attendance', 'meetings', 'scouting_reports', 'tasks']) {
            const { error } = await svc.from(table).delete().eq('team_id', teamId);
            if (error) console.warn(`  could not clear ${table}: ${error.message}`);
        }
        if (seededSeason) await svc.from('seasons').delete().eq('id', archived.id);
        console.log('  done — re-run npm run seed:review to restore the review data.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
