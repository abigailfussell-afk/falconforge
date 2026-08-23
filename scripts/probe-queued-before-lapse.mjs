/**
 * SEC-07's third exit criterion — a write queued BEFORE the lapse, drained after.
 *
 * This is the case the disabled controls cannot cover and the one a team actually meets: the
 * licence is fine when the student presses Save at 10:14, the queue has not drained because
 * the venue WiFi is the venue WiFi, and by the time it does the cover has ended. The client is
 * supposed to notice, stop retrying, and say something a coach can act on — not retry five
 * times and drop the work (B2).
 *
 * THE LAPSE IS A DATE PASSING, NOT AN OPERATOR CLICKING. That distinction is the probe's whole
 * design and it took two wrong versions to find. Revoking a grant with the service key does
 * produce a read-only team, but it is not D3's case: under a 30-day probation the ordinary way
 * cover ends is that `valid_until` arrives, with nobody doing anything. So this sets the grant
 * to expire a few seconds after the app has read it, and then does nothing at all — which is
 * exactly what a coach at a venue does.
 *
 * AND IT DOES NOT RELOAD. An earlier version reloaded the page "to nudge the app the way a
 * user would", which was the probe covering for the defect it was meant to find: nobody
 * reloads a tab at a competition.
 *
 * The sequence:
 *
 *   1. Give the team cover ending LAPSE_IN_S seconds from now.
 *   2. Sign in. The client reads `team_entitlement`: active, ending shortly.
 *   3. Go offline, create a task. It queues; nothing is refused, because nothing is sent.
 *   4. Go back online and wait. Cover ends on its own. The sync loop re-asks the server,
 *      learns the team is read-only, and from there:
 *        a. the lapsed banner appears and every write control disables — with NO reload;
 *        b. the queued write's next attempt is classified TERMINAL rather than retryable, and
 *           the panel shows the renew-and-retry reason rather than "retry when you have a
 *           connection".
 *
 * All three timings are reported rather than merely asserted, because "the app eventually
 * tells you" and "the app tells you before you have given up" are different products.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-queued-before-lapse.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/walkb12';
const PASSWORD = 'ForgeReview!2026-local';
/** Long enough for the app to read the licence as active; short enough to watch. */
const LAPSE_IN_S = Number(process.env.PROBE_LAPSE_IN_S ?? 30);
const BUDGET_S = Number(process.env.PROBE_BUDGET_S ?? 480);

/*
 * Supabase's published local-development demo keys, pinned here rather than read from an env
 * file: `.env.local` points at the HOSTED project, and a probe that rewrites a licence's end
 * date must never be one inherited variable away from rewriting a real one.
 */
const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data: teams, error: teamErr } = await admin
    .from('teams')
    .select('id, name')
    .eq('name', 'Nearly Out Engineering');
if (teamErr) throw teamErr;
if (!teams?.length) throw new Error('seed missing: run `npm run seed:review`');
const TEAM = teams[0].id;

const { data: grants } = await admin
    .from('license_grants')
    .select('id, valid_until')
    .eq('team_id', TEAM)
    .is('revoked_at', null);
if (!grants?.length) throw new Error('no in-force grant on the seeded team');
const ORIGINAL = grants.map((g) => ({ id: g.id, valid_until: g.valid_until }));
log(`team: ${teams[0].name} (${TEAM}), ${grants.length} grant(s)`);

const restoreSeed = async () => {
    for (const g of ORIGINAL) {
        await admin.from('license_grants').update({ valid_until: g.valid_until }).eq('id', g.id);
    }
};

let browser;
try {
    // ------------------------------------------------------- 1. cover ends shortly from now
    const lapseAt = new Date(Date.now() + LAPSE_IN_S * 1000);
    for (const g of ORIGINAL) {
        const { error } = await admin
            .from('license_grants')
            .update({ valid_until: lapseAt.toISOString() })
            .eq('id', g.id);
        if (error) throw error;
    }
    log(`cover now ends at ${lapseAt.toISOString()} (${LAPSE_IN_S}s from now)\n`);

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    // ------------------------------------------------------------ 2. sign in, licence active
    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill('expiring@falconforge.test');
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.goto(`${APP}/#/app/board`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="nav-kanban"][aria-current="page"]', {
        state: 'attached',
        timeout: 45_000,
    });
    await page.waitForSelector('[aria-label="Loading view"]', { state: 'detached', timeout: 30_000 }).catch(() => {});

    const newTask = page.getByTestId('new-task-button');
    await newTask.waitFor({ timeout: 20_000 });
    /*
     * WAIT FOR ENABLED, DO NOT ASSERT IT IMMEDIATELY. There is a ~70-120 ms window after first
     * paint where the button is disabled saying "No season is selected yet", because the store
     * has not finished hydrating and `currentSeasonId` is still null. The first version of this
     * probe read the button inside that window and reported the licensed team as unable to
     * write — `docs/failure-modes.md` §4, loading read as absent. Too short to matter to a
     * person; long enough to make a probe lie.
     */
    await page
        .waitForFunction(
            () => document.querySelector('[data-testid="new-task-button"]')?.disabled === false,
            undefined,
            { timeout: 20_000 },
        )
        .catch(() => {});
    log(`before lapse: New Item disabled=${await newTask.isDisabled()} (expected false)`);
    if (await newTask.isDisabled()) throw new Error('the licensed team cannot write — seed is wrong');

    // ------------------------------------------------------------ 3. offline, queue a write
    await context.setOffline(true);
    await page.waitForTimeout(500);
    await newTask.click();
    await page.getByTestId('task-title-input').fill('Queued before the licence lapsed');
    await page.getByTestId('save-task').click();
    await page.waitForTimeout(1500);
    log('offline write queued');
    await page.screenshot({ path: `${OUT}/queued-01-offline-queued-375.png` });

    /*
     * STAY OFFLINE THROUGH THE LAPSE. This is the criterion's own wording — a write queued
     * BEFORE the lapse and drained AFTER — and it is also the only way to get there: an
     * earlier version came back online immediately, the write landed in three seconds while
     * the team was still licensed, and forty-five seconds later there was nothing left queued
     * for the lapse to happen to. The venue version of this is a student saving at 10:14 in a
     * hall with no signal.
     */
    const waitFor = Math.max(0, lapseAt.getTime() - Date.now()) + 5_000;
    log(`staying offline for ${Math.round(waitFor / 1000)}s, until after cover ends`);
    await page.waitForTimeout(waitFor);

    // ------------------------------------------------- 4. back online; do nothing; watch
    await context.setOffline(false);
    const t0 = Date.now();
    const at = () => Math.round((Date.now() - t0) / 1000);

    let bannerAt = null;
    let disabledAt = null;
    let reasonAt = null;

    for (let i = 0; i < BUDGET_S / 2; i++) {
        await page.waitForTimeout(2000);

        if (bannerAt === null && (await page.getByTestId('licence-lapsed-banner').count()) > 0) {
            bannerAt = at();
            log(`  ${bannerAt}s — the lapsed banner appeared, with no reload`);
            await page.screenshot({ path: `${OUT}/queued-02-banner-375.png` });
        }
        if (disabledAt === null && (await newTask.count()) > 0 && (await newTask.isDisabled())) {
            disabledAt = at();
            log(`  ${disabledAt}s — New Item disabled: ${JSON.stringify(await newTask.getAttribute('title'))}`);
        }
        const body = await page.evaluate(() => document.body.innerText);
        if (reasonAt === null && /renew the licence/i.test(body)) {
            reasonAt = at();
            log(`  ${reasonAt}s — the panel shows the renew-and-retry reason`);
            break;
        }
    }

    const indicator = await page.getByTestId('sync-status').innerText().catch(() => '');
    log(`\nsync indicator: ${JSON.stringify(indicator)}`);
    await page.screenshot({ path: `${OUT}/queued-03-after-lapse-375.png` });

    const parked = await page.evaluate(async () => {
        const req = indexedDB.open('FalconForgeDB');
        const db = await new Promise((res, rej) => {
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
        if (!db.objectStoreNames.contains('syncFailures')) return 'no syncFailures store';
        const tx = db.transaction('syncFailures', 'readonly');
        const all = await new Promise((res, rej) => {
            const r = tx.objectStore('syncFailures').getAll();
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        return all.map((d) => ({
            tableName: d.tableName,
            operation: d.operation,
            retryCount: d.retryCount,
            terminalReason: d.terminalReason ?? null,
        }));
    });

    log('\n--- result ---');
    log(`lapsed banner shown at   : ${bannerAt === null ? 'NEVER' : bannerAt + 's'}`);
    log(`write controls disabled  : ${disabledAt === null ? 'NEVER' : disabledAt + 's'}`);
    log(`renew-and-retry reason   : ${reasonAt === null ? 'NEVER' : reasonAt + 's'}`);
    log(`parked changes           : ${JSON.stringify(parked, null, 1)}`);

    if (bannerAt === null || disabledAt === null || reasonAt === null) process.exitCode = 1;
} finally {
    await restoreSeed();
    log('\nseed restored: the grant carries its original valid_until again');
    if (browser) await browser.close();
    log(`images -> ${OUT}`);
}
