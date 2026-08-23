/**
 * WALK-A-12 — what is still on the laptop after somebody signs out.
 *
 * The walkthrough recorded that `indexedDB.databases()` still lists `FalconForgeDB` after
 * sign-out and said plainly: "I did NOT inspect whether its stores were emptied." So this is a
 * VERIFICATION finding, not a fix, and the answer is worth measuring rather than reasoning about
 * — the reasoning is easy and wrong in both directions. Reading the code says `clearAppState()`
 * empties the one store that holds team data, and reading the same code also shows
 * `clearLocalDatabase()` clearing only the sync queue and the dead-letter store, which is exactly
 * the shape that makes a person confident about the wrong thing.
 *
 * The scenario is a shared pit laptop: a coach signs in at a competition, a student signs in
 * after them. Dexie keeps the database and its schema on purpose, so the database EXISTING is
 * not the question. Whether the previous team's roster, tasks and meetings are still readable
 * in it is.
 *
 * THE CONTROL IS THE POINT. Counting rows after sign-out and finding zero proves nothing unless
 * there were rows before — a database that was never populated passes that check perfectly, and
 * this is `docs/failure-modes.md` §7, a gate with no door. So the probe requires a non-zero
 * count BEFORE, refuses to continue without it, and prints both numbers.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-signout-residue.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-20';
const PASSWORD = 'ForgeReview!2026-local';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Every object store in every FalconForge database, with a row count and a sample.
 *
 * Enumerated from `objectStoreNames` rather than from a list written here: a store added by a
 * future Dexie version would otherwise be invisible to this probe, which is the hand-maintained
 * list of `docs/failure-modes.md` §12 in the one place it would be least noticed.
 */
const DUMP = `(async () => {
    const dbs = await indexedDB.databases();
    const out = { databases: dbs.map((d) => d.name), stores: {}, marker: false };
    for (const info of dbs) {
        if (!info.name) continue;
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open(info.name);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        for (const store of Array.from(db.objectStoreNames)) {
            const tx = db.transaction(store, 'readonly');
            const os = tx.objectStore(store);
            const count = await new Promise((res) => {
                const c = os.count();
                c.onsuccess = () => res(c.result);
                c.onerror = () => res(-1);
            });
            const sample = await new Promise((res) => {
                const g = os.getAll(undefined, 3);
                g.onsuccess = () => res(JSON.stringify(g.result).slice(0, 400));
                g.onerror = () => res('');
            });
            out.stores[info.name + '.' + store] = { count, sample };
            /*
             * The full text, searched in the page rather than shipped out and searched here.
             * appState is a single Zustand blob, so "1 row" is its normal state whether it
             * holds a whole team or an empty object -- a COUNT cannot tell those apart, and the
             * question WALK-A-12 asks is about content.
             *
             * No backticks in this comment on purpose: the whole block is a template literal,
             * and one backtick here ends it. Cost a syntax error to learn.
             */
            const whole = await new Promise((res) => {
                const g = os.getAll();
                g.onsuccess = () => res(JSON.stringify(g.result));
                g.onerror = () => res('');
            });
            if (whole.toLowerCase().includes('falconforge.test')) out.marker = true;
        }
        db.close();
    }
    out.localStorage = Object.keys(localStorage);
    return out;
})()`;

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill('reviewer@falconforge.test');
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    /*
     * Visit the screens that pull the data a next user must not find: the roster (names and
     * email addresses), the board, and meetings (attendance). Zustand persists to `appState`
     * on change, so the store has to be exercised, not merely mounted.
     */
    for (const route of ['/app/admin', '/app/board', '/app/meetings']) {
        await page.goto(`${APP}/#${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);
    }

    const before = await page.evaluate(DUMP);
    const beforeRows = Object.values(before.stores).reduce((n, s) => n + Math.max(0, s.count), 0);
    log('\n--- while signed in ---');
    for (const [k, v] of Object.entries(before.stores)) log(`  ${k}: ${v.count}`);
    log(`  localStorage keys: ${before.localStorage.join(', ') || '(none)'}`);

    // THE CONTROL. Without rows now, "no rows later" is not evidence of anything.
    check(
        'there is something to clear in the first place',
        beforeRows > 0,
        `${beforeRows} rows across ${Object.keys(before.stores).length} stores`,
    );
    if (beforeRows === 0) throw new Error('nothing was stored while signed in — the after-check would be vacuous');

    /*
     * And the roster is genuinely in there, by content rather than by row count. `appState` is a
     * single Zustand blob, so "1 row" is its normal state whether it holds a whole team or an
     * empty object — a count alone cannot tell those apart.
     */
    check('a teammate email address is readable in the local database while signed in', before.marker);

    // ---------------------------------------------------------------- sign out
    log('\n--- signing out ---');
    await page.getByTestId('sign-out-button').click();
    /*
     * The dialog only appears when there is unsynced work. Handle it if it is there, and do not
     * swallow the click that dismisses it — the harness ratchet is right that a swallowed
     * Playwright action turns "the button moved" into a false result about something else.
     */
    const confirm = page.getByTestId('confirm-sign-out');
    if (await confirm.isVisible().catch(() => false)) await confirm.click();

    await page.waitForURL(/#\/$|#\/login/, { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const after = await page.evaluate(DUMP);
    const afterRows = Object.values(after.stores).reduce((n, s) => n + Math.max(0, s.count), 0);
    log('\n--- after sign-out ---');
    for (const [k, v] of Object.entries(after.stores)) {
        log(`  ${k}: ${v.count}${v.count > 0 ? `  sample: ${v.sample.slice(0, 200)}` : ''}`);
    }
    log(`  localStorage keys: ${after.localStorage.join(', ') || '(none)'}`);

    check(
        'every IndexedDB object store is empty after sign-out',
        afterRows === 0,
        `${afterRows} rows remain (was ${beforeRows})`,
    );

    /*
     * The database itself is EXPECTED to survive — Dexie keeps the schema, and the walkthrough's
     * observation that `FalconForgeDB` is still listed is correct and not a defect. Asserted so
     * the next reader does not "fix" it.
     */
    check(
        'the database itself still exists, which is Dexie keeping its schema and is fine',
        after.databases.includes('FalconForgeDB'),
        after.databases.join(', '),
    );

    check('no teammate email address is readable in the local database after sign-out', !after.marker);

    const authKeys = after.localStorage.filter((k) => /sb-.*-auth-token|profile/i.test(k));
    check('no auth token or cached profile left in localStorage', authKeys.length === 0, authKeys.join(', '));
} finally {
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
