/**
 * Which backend is the bundle in `dist/` wired to?
 *
 * THE PROBLEM THIS EXISTS FOR. `npm run gate` ends in `npm run build`, which is `vite build`
 * with no `--mode`, so it loads `.env.local` — and `.env.local` points at the HOSTED project,
 * deliberately, because that is what deploys. The Gate therefore leaves a production-wired
 * bundle in `dist/`, and `vite preview` afterwards serves it on localhost with nothing saying
 * so. It looks exactly like a local review build.
 *
 * That is not hypothetical. On 2026-08-24 it cost a UI investigation that was about to be run
 * against production's data, and the only reason it was caught is that a seeded LOCAL account
 * failed to log in — the build had reached production's GoTrue, which correctly reported that
 * the account did not exist. A login attempt reached production before the cause was found. It
 * then recurred twice more in the same session, each time after a Gate run.
 *
 * `docs/environment-divergences.md` §8 already describes this outcome and blames a `test:e2e`
 * run. The Gate does it far more often, and every sprint runs the Gate.
 *
 * WHY A POSITIVE ASSERTION, NOT "no production references". A bundle that references neither
 * backend — a broken build, an empty `dist/`, a stale directory — satisfies "no production
 * references" perfectly. `docs/failure-modes.md` §4: the zero case is the first case. So this
 * requires the local stack to be present AND production to be absent, and says which it found.
 *
 * Usage:
 *   node scripts/assert-local-bundle.mjs        # exits non-zero if dist/ is not local-wired
 *   npm run check:bundle                        # the same, named
 *
 * It is a static check on files, so it needs no browser, no server and no Docker — which is the
 * point: it can run before anything expensive, and before anything irreversible.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST_ASSETS = 'dist/assets';

/* The same two shapes `capture-screens.mjs` guards on, kept identical on purpose. */
const LOCAL = /(127\.0\.0\.1|localhost):54321/;
const HOSTED = /https:\/\/([a-z0-9]+)\.supabase\.co/g;

const fail = (msg) => {
    console.error(`\nassert-local-bundle: ${msg}\n`);
    process.exit(1);
};

if (!existsSync(DIST_ASSETS)) {
    fail(
        'there is no dist/assets — nothing has been built.\n' +
        '  Build one wired to the local stack with:  npm run build:local',
    );
}

const entries = readdirSync(DIST_ASSETS).filter((f) => /^index-.*\.js$/.test(f));
if (entries.length === 0) {
    fail(`no index-*.js in ${DIST_ASSETS} — the build did not produce an entry bundle.`);
}

let sawLocal = false;
const hosted = new Set();
for (const file of entries) {
    const js = readFileSync(join(DIST_ASSETS, file), 'utf8');
    if (LOCAL.test(js)) sawLocal = true;
    for (const m of js.matchAll(HOSTED)) hosted.add(m[1]);
}

if (hosted.size > 0) {
    fail(
        `dist/ is wired to a HOSTED Supabase project (${[...hosted].join(', ')}).\n` +
        '  This is what `npm run gate` leaves behind: its final `vite build` has no `--mode`,\n' +
        '  so it reads `.env.local`, which points at production.\n\n' +
        '  Rebuild for local review with:  npm run build:local\n' +
        '  (or `npm run preview:local`, which builds, checks, and serves in one step)',
    );
}

if (!sawLocal) {
    fail(
        'dist/ references NEITHER the local stack nor a hosted project.\n' +
        '  That is not a pass — it usually means a stale or broken build. A bundle that talks\n' +
        '  to nothing satisfies "no production references" just as well as a correct one.\n\n' +
        '  Rebuild with:  npm run build:local',
    );
}

console.log(`assert-local-bundle: dist/ targets the LOCAL stack (127.0.0.1:54321) — ${entries.length} entry bundle(s) checked.`);
