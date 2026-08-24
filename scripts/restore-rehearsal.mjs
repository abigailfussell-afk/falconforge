#!/usr/bin/env node
/**
 * Rehearse the restore, and CHECK it — the whole path, ending in numbers that are compared.
 *
 * WHY THIS IS A SCRIPT AND NOT A PARAGRAPH
 *
 * `docs/beta-ops.md` has carried a restore procedure since Sprint 7. It was written down, read
 * several times, and wrong in two ways that only running it could reveal: `supabase db dump`
 * with no flag dumps the schema and nothing else, and `SET session_replication_role = replica`
 * is DENIED to Supabase's `postgres` role, so the data half loads with every application trigger
 * live and the membership trigger rejects rows — while psql prints one denied line among several
 * hundred and exits 0. The measured result of that was 32 teams and 32 seasons restored, and
 * ZERO members, tasks, meetings, attendance or scouting reports. A restore that hands back the
 * tenancies and none of the people, reporting success.
 *
 * That is the reason this ends by COUNTING BOTH DATABASES AND COMPARING THEM. "psql exited 0" is
 * exactly what the broken restore said. `docs/failure-modes.md` asks of every verification step:
 * what would make this fail? This one fails when any table has fewer rows after the restore than
 * before it, which is the only question a restore is actually being asked.
 *
 * WHAT IT DOES, in the order `.github/workflows/backup.yml` does it:
 *
 *   1. `supabase db dump` twice — schema, then `--data-only` — and concatenate. Not once.
 *   2. Assert the data half has INSERTs, including `auth.users` and `public.teams`.
 *   3. `gpg --symmetric --cipher-algo AES256`, then shred the plaintext. This is the artifact
 *      shape the nightly uploads; a rehearsal that skips it is not rehearsing the artifact.
 *   4. `gpg --decrypt`.
 *   5. Restore into the TARGET database, with the trigger-disable blocks around the load that
 *      `beta-ops.md` prescribes, because the `replica` setting will be refused.
 *   6. Count every table in `public` on both sides and diff.
 *
 * USAGE
 *
 *   node scripts/restore-rehearsal.mjs --source <url> --target <url> [--keep]
 *   node scripts/restore-rehearsal.mjs --source-file backups/....sql --target <url>
 *
 * `--source-file` takes an existing combined dump (schema+data) rather than dumping — which is
 * how a REAL nightly artifact is rehearsed, since the artifact is a file and not a database.
 * With it, the source-side counts are read from the file's own INSERT statements rather than
 * from a live database, and that is stated in the output so the two are never confused.
 *
 * THE TARGET IS EMPTIED FIRST, and it must never be production. The script refuses any target
 * that is not localhost — `docs/environment-divergences.md` §2 is three near-misses from scripts
 * that inherited their environment, and this one drops a schema.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const LOCAL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const source = flag('source');
const sourceFile = flag('source-file');
const target = flag('target') ?? LOCAL_DEFAULT;

/**
 * psql runs INSIDE the database container, and that is not a convenience.
 *
 * There is no `psql` on PATH on this machine — the Supabase CLI ships none and Postgres is not
 * installed — so a script that shells out to `psql` is a script that has never run here. Piping
 * the SQL on stdin to `docker exec -i` also sidesteps two documented Windows traps at once: no
 * `docker cp` (which needs a `C:/...` source path under `MSYS_NO_PATHCONV=1`) and no missing
 * `-i` (without which a heredoc silently reaches nothing and the next command fails confusingly).
 */
const container = flag('container') ?? 'supabase_db_falconforge';
/** The same database, addressed from inside the container: 5432, not the host's mapped port. */
const targetInContainer = target.replace(/@[^/]+\//, '@127.0.0.1:5432/');

if (!source && !sourceFile) {
    console.error('Give either --source <db-url> (dump it) or --source-file <path> (use a dump).');
    process.exit(2);
}

/**
 * The target is emptied. Refuse anything that is not on this machine.
 *
 * Not a courtesy check. This script drops and recreates `public`, and `.env.local` in this repo
 * points at PRODUCTION — three separate scripts have been caught inheriting it (env-divergences
 * §2), which is three warnings rather than three successes.
 */
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(target)) {
    console.error(`Refusing to restore into a non-local target: ${target.replace(/:[^:@]*@/, ':***@')}`);
    console.error('This script empties the target. It is for a scratch or local database only.');
    process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'ff-restore-'));
const PASSPHRASE = `rehearsal-${process.pid}-${work.slice(-6)}`;

const run = (cmd, cmdArgs, opts = {}) => {
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: false, ...opts });
    if (r.error) throw r.error;
    return r;
};

const mustRun = (label, cmd, cmdArgs, opts = {}) => {
    const r = run(cmd, cmdArgs, opts);
    if (r.status !== 0) {
        console.error(`\n${label} failed (exit ${r.status})`);
        console.error(r.stdout?.slice(-2000) ?? '');
        console.error(r.stderr?.slice(-2000) ?? '');
        process.exit(1);
    }
    return r;
};

/** Feed SQL to psql inside the container on stdin. Never uses ON_ERROR_STOP; see the restore. */
const psqlFile = (sql) =>
    run('docker', ['exec', '-i', container, 'psql', '-X', '-q', targetInContainer, '-f', '-'], {
        input: sql,
        maxBuffer: 64 * 1024 * 1024,
    });

/** One `pg` connection, used for counting. Structured results beat parsing psql output. */
const query = async (url, sql) => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        return await client.query(sql);
    } finally {
        await client.end();
    }
};

// ---------------------------------------------------------------------------------------------
// Step 1-2 — the dump, and whether it is a real one
// ---------------------------------------------------------------------------------------------

const combined = join(work, 'backup.sql');

if (sourceFile) {
    if (!existsSync(sourceFile)) {
        console.error(`No such dump: ${sourceFile}`);
        process.exit(2);
    }
    writeFileSync(combined, readFileSync(sourceFile));
    console.log(`Using existing dump: ${sourceFile}`);
} else {
    const schema = join(work, 'schema.sql');
    const data = join(work, 'data.sql');
    console.log('Dumping schema...');
    mustRun('db dump (schema)', 'npx', ['supabase', 'db', 'dump', '--db-url', source, '-f', schema], { shell: true });
    console.log('Dumping data...');
    mustRun('db dump (data)', 'npx', ['supabase', 'db', 'dump', '--db-url', source, '--data-only', '-f', data], { shell: true });
    writeFileSync(combined, readFileSync(schema) + '\n' + readFileSync(data));
}

const dumpText = readFileSync(combined, 'utf8');
const insertLines = dumpText.split('\n').filter((l) => l.startsWith('INSERT INTO '));
console.log(`Dump: ${dumpText.length.toLocaleString()} bytes, ${insertLines.length} INSERT statement(s).`);

// The workflow's own two required tables. A dump without them has lost the irreplaceable part.
for (const required of ['"auth"."users"', '"public"."teams"']) {
    if (!insertLines.some((l) => l.startsWith(`INSERT INTO ${required}`))) {
        console.error(`The dump has no rows for ${required}. Not worth restoring.`);
        process.exit(1);
    }
}
if (!dumpText.includes('CREATE TABLE')) {
    console.error('The dump contains no CREATE TABLE — this is a data-only file and cannot rebuild a database.');
    process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Step 3-4 — encrypt exactly as the runner does, shred, decrypt
// ---------------------------------------------------------------------------------------------

const encrypted = join(work, 'backup.sql.gpg');
const decrypted = join(work, 'restored.sql');

console.log('Encrypting (gpg symmetric, AES256)...');
mustRun('gpg --symmetric', 'gpg', [
    '--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256',
    '--passphrase', PASSPHRASE, '--output', encrypted, combined,
]);
// The plaintext must not survive the encrypt step, on a runner or here.
rmSync(combined, { force: true });

console.log('Decrypting...');
mustRun('gpg --decrypt', 'gpg', [
    '--batch', '--yes', '--passphrase', PASSPHRASE, '--output', decrypted, '--decrypt', encrypted,
]);
const roundTripped = readFileSync(decrypted, 'utf8');
if (roundTripped.length !== dumpText.length) {
    console.error(`Decrypted file is ${roundTripped.length} bytes, dump was ${dumpText.length}.`);
    process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Source-side counts, taken BEFORE the target is touched
// ---------------------------------------------------------------------------------------------

/**
 * Row counts for every base table in `public`, as a Map.
 *
 * `query_to_xml` because the table list is not known ahead of time — the whole point is to count
 * what is THERE rather than a list somebody maintained by hand, which is failure-modes §12 and
 * exactly how B22's replica-identity assertion came to be built from a stale list.
 */
const countPublic = async (url) => {
    const { rows } = await query(url, `
        SELECT c.relname AS t,
               (xpath('/row/c/text()',
                      query_to_xml(format('select count(*) as c from public.%I', c.relname),
                                   false, true, '')))[1]::text::bigint AS n
          FROM pg_class c
          JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public' AND c.relkind = 'r'
         ORDER BY 1`);
    return new Map(rows.map((r) => [r.t, Number(r.n)]));
};

/**
 * Row counts as the DUMP claims them: tuples inside each `INSERT INTO public.<t> ... VALUES`.
 *
 * NOT a line-oriented regex, and the first version of this WAS one — it matched
 * `... VALUES (...);` on a single line, the CLI puts `VALUES` at the end of the line and the
 * tuples on the lines after it, and so it reported 0 for every table. The comparison at the end
 * then said "0 rows expected, 65 restored: OK". That is `docs/failure-modes.md` §2 exactly —
 * comparing zero to zero — inside the script whose entire purpose is not to do that. It was
 * caught because the output prints both columns; the guard below is so the next one is caught
 * without anybody reading.
 *
 * Walks the text: on each INSERT, count `(` at depth 0 until the `;` that ends the statement,
 * skipping anything inside a single-quoted literal (doubled quotes escape).
 */
const countFromDump = (text) => {
    const map = new Map();
    const re = /INSERT INTO "public"\."([a-z_]+)" \([^)]*\) VALUES/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        const table = m[1];
        let depth = 0, inStr = false, tuples = 0, i = re.lastIndex;
        for (; i < text.length; i++) {
            const ch = text[i];
            if (inStr) {
                if (ch === "'") {
                    if (text[i + 1] === "'") i++;
                    else inStr = false;
                }
                continue;
            }
            if (ch === "'") inStr = true;
            else if (ch === '(') { if (depth === 0) tuples++; depth++; }
            else if (ch === ')') depth--;
            else if (ch === ';' && depth === 0) break;
        }
        re.lastIndex = i;
        map.set(table, (map.get(table) ?? 0) + tuples);
    }
    return map;
};

const before = sourceFile ? countFromDump(roundTripped) : await countPublic(source);
const beforeLabel = sourceFile ? 'in the dump' : 'in the source database';

/*
 * A comparison against zero is not a comparison.
 *
 * If the dump plainly contains `INSERT INTO public.*` statements and the parse above found no
 * rows in them, every later "restored >= expected" check passes vacuously and this script
 * reports OK over a restore that lost everything. That happened on the first run.
 */
const publicInserts = (roundTripped.match(/INSERT INTO "public"\./g) ?? []).length;
const expectedTotal = [...before.values()].reduce((a, b) => a + b, 0);
if (publicInserts > 0 && expectedTotal === 0) {
    console.error(`The dump has ${publicInserts} public INSERT statement(s) and the parser found 0 rows in them.`);
    console.error('That would make every check below pass against zero. Fix countFromDump.');
    process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Step 5 — restore, with the triggers held off the way beta-ops.md prescribes
// ---------------------------------------------------------------------------------------------

const DISABLE = `DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables WHERE schemaname = 'public'
  LOOP EXECUTE 'ALTER TABLE ' || r.t || ' DISABLE TRIGGER USER'; END LOOP;
END $$;`;
const ENABLE = DISABLE.replace(/DISABLE TRIGGER/, 'ENABLE TRIGGER');

console.log('Emptying the target...');
// `public` and the auth tables the dump carries. auth/extensions/vault themselves are left
// alone: that is what a fresh Supabase project supplies, and the point of the rehearsal is what
// the DUMP has to bring rather than what the platform does.
await query(target, `
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
    TRUNCATE auth.users CASCADE;`);

console.log('Restoring...');
// Two passes: the schema half creates the tables, so the triggers cannot be disabled until it
// has run. Splitting on the data half's own opening line is how the dump marks the boundary.
const marker = 'SET session_replication_role = replica;';
const markerAt = roundTripped.indexOf(marker, 200);
const schemaHalf = markerAt === -1 ? roundTripped : roundTripped.slice(0, markerAt);
const dataHalf = markerAt === -1 ? '' : roundTripped.slice(markerAt);

const schemaPath = join(work, 'p1-schema.sql');
const dataPath = join(work, 'p2-data.sql');
writeFileSync(schemaPath, schemaHalf);
writeFileSync(dataPath, `${DISABLE}\n${dataHalf}\n${ENABLE}\n`);

/*
 * NOT `ON_ERROR_STOP=1` for the restore itself, and that is deliberate rather than lax.
 *
 * A dump taken from a hosted project references roles and extensions a scratch database may not
 * have, and stopping at the first `role "supabase_admin" does not exist` would abandon a restore
 * that is otherwise fine. The errors are counted and reported instead — and the row comparison
 * below is what decides whether the restore worked, which is the whole argument of this script.
 */
const restoreSchema = psqlFile(readFileSync(schemaPath, 'utf8'));
const restoreData = psqlFile(readFileSync(dataPath, 'utf8'));
const errorLines = [
    ...(restoreSchema.stderr ?? '').split('\n'),
    ...(restoreData.stderr ?? '').split('\n'),
].filter((l) => /^psql:.*ERROR/.test(l));

console.log(`psql reported ${errorLines.length} error line(s).`);
for (const line of errorLines.slice(0, 25)) console.log(`  ${line.trim()}`);
if (errorLines.length > 25) console.log(`  ...and ${errorLines.length - 25} more`);

// ---------------------------------------------------------------------------------------------
// Step 6 — count both sides and compare. This is the part that makes the rehearsal mean anything.
// ---------------------------------------------------------------------------------------------

const after = await countPublic(target);

const tables = [...new Set([...before.keys(), ...after.keys()])].sort();
const rows = [];
let missing = 0;
let sourceTotal = 0;
let restoredTotal = 0;

for (const t of tables) {
    const b = before.get(t) ?? 0;
    const a = after.get(t) ?? 0;
    sourceTotal += b;
    restoredTotal += a;
    if (a < b) missing += b - a;
    if (b > 0 || a > 0) rows.push({ table: t, before: b, after: a, ok: a >= b });
}

console.log(`\n  ${'table'.padEnd(28)} ${beforeLabel.padStart(22)}   restored`);
for (const r of rows) {
    console.log(
        `  ${r.ok ? ' ' : '!'} ${r.table.padEnd(26)} ${String(r.before).padStart(22)}   ${String(r.after).padStart(8)}`,
    );
}
console.log(`\n  ${'TOTAL'.padEnd(28)} ${String(sourceTotal).padStart(22)}   ${String(restoredTotal).padStart(8)}`);

if (!has('keep')) rmSync(work, { recursive: true, force: true });
else console.log(`\nWorking files kept in ${work}`);

if (missing > 0) {
    console.error(`\nFAILED: ${missing} row(s) did not survive the restore.`);
    console.error('This is the failure that exits 0 when nobody counts. See docs/beta-ops.md.');
    process.exit(1);
}
console.log('\nOK: every row in the dump is in the restored database.');
