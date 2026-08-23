/**
 * SEC-07's third exit criterion — a write queued BEFORE the lapse, drained after.
 *
 * This is the case the disabled controls cannot cover and the one a team actually meets: the
 * licence is fine when the student presses Save at 10:14, the queue has not drained because
 * the venue WiFi is the venue WiFi, and by the time it does the cover has ended. The client is
 * supposed to notice, stop retrying, and say something a coach can act on — not retry five
 * times and drop the work (B2).
 *
 * The sequence, which cannot be produced by clicking:
 *
 *   1. Sign in as an ACTIVE team's admin (`expiring@`, nine days of cover left).
 *   2. Go offline. Create a task. It queues; nothing is refused, because nothing is sent.
 *   3. Revoke the licence server-side with the service key, so the team is now read-only.
 *   4. Go back online. The push gets a 42501 from `team_can_write`, and once the device's own
 *      copy of the entitlement says `read_only`, `sync-failure-classification.ts` must call it
 *      TERMINAL with the renew-and-retry reason, and `SyncStatusIndicator` must show it.
 *
 * Step 4's "once the device's copy says read_only" is the interesting part and is deliberate
 * in the design: until the device has re-read the entitlement view the refusal is retryable,
 * because guessing "terminal" is the one mistake that loses work. So this probe waits for the
 * pull rather than asserting immediately — and reports how long it took, because a coach
 * staring at "1 change didn't save" with no reason for two minutes is a different product
 * from one that explains itself in five seconds.
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

/*
 * Supabase's published local-development demo keys, pinned here rather than read from an env
 * file: `.env.local` points at the HOSTED project, and a probe that revokes a licence must
 * never be one inherited variable away from revoking a real one.
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
log(`team: ${teams[0].name} (${TEAM})`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
await context.route('**://*.supabase.co/**', (route) => {
    throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
});
const page = await context.newPage();

// ---------------------------------------------------------------- 1. sign in, licence active
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
 * probe read the button inside that window and reported the licensed team as unable to write
 * — `docs/failure-modes.md` §4, loading read as absent, measured at 69 ms on this machine and
 * parked in the plan's §8. Too short to matter to a person; long enough to make a probe lie.
 */
await newTask.waitFor({ state: 'visible' });
await page.waitForFunction(
    () => document.querySelector('[data-testid="new-task-button"]')?.disabled === false,
    undefined,
    { timeout: 20_000 },
).catch(() => {});
log(`before lapse: New Item disabled=${await newTask.isDisabled()} (expected false)`);
if (await newTask.isDisabled()) throw new Error('the licensed team cannot write — seed is wrong');

// ---------------------------------------------------------------- 2. offline, queue a write
await context.setOffline(true);
await page.waitForTimeout(500);

await newTask.click();
await page.getByTestId('task-title-input').fill('Queued before the licence lapsed');
await page.getByTestId('save-task').click();
await page.waitForTimeout(1500);

const queued = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name);
});
log(`offline write queued; idb: ${queued.join(', ')}`);
await page.screenshot({ path: `${OUT}/queued-01-offline-queued-375.png` });

// ---------------------------------------------------------------- 3. revoke underneath it
const { error: revokeErr } = await admin
    .from('license_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('team_id', TEAM)
    .is('revoked_at', null);
if (revokeErr) throw revokeErr;

const { data: ent } = await admin
    .from('team_entitlement')
    .select('status, valid_until')
    .eq('team_id', TEAM)
    .maybeSingle();
log(`licence revoked server-side; team_entitlement.status = ${ent?.status}`);

// ---------------------------------------------------------------- 4. back online, drain
await context.setOffline(false);
const startedAt = Date.now();

const indicator = page.getByTestId('sync-status');
let seen = '';
let terminalAt = null;
for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(2000);
    seen = (await indicator.innerText().catch(() => '')) ?? '';
    const body = await page.evaluate(() => document.body.innerText);
    /*
     * WAITS FOR THE REASON, not for the badge. The first version broke on "didn't save",
     * which is true the instant the change is parked and says nothing about whether the panel
     * can explain itself — and that is exactly the state the sync.ts defect produced. The
     * criterion is "lands in the terminal state WITH THE REASON SHOWN", so this waits for the
     * sentence.
     */
    if (/renew the licence/i.test(body)) {
        terminalAt = Date.now() - startedAt;
        break;
    }
    // Nudge the app the way a user would: a reload re-reads the entitlement view.
    if (i === 20 || i === 45) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });
        log(`  (reloaded at ${Math.round((Date.now() - startedAt) / 1000)}s)`);
    }
}

log(`\nsync indicator: ${JSON.stringify(seen)}`);
log(terminalAt === null
    ? 'NO terminal message within 180s'
    : `terminal message reached after ${Math.round(terminalAt / 1000)}s`);

await page.screenshot({ path: `${OUT}/queued-02-after-lapse-375.png` });

// The dead-letter store is the ground truth; the indicator is what the coach reads.
const dead = await page.evaluate(async () => {
    const open = indexedDB.open('FalconForgeDB');
    const db = await new Promise((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
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
        lastError: d.lastError,
        terminalReason: d.terminalReason ?? null,
    }));
});
log(`dead letters: ${JSON.stringify(dead, null, 1)}`);

// ---------------------------------------------------------------- put the seed back
await admin.from('license_grants').update({ revoked_at: null }).eq('team_id', TEAM);
log('\nseed restored: the grant is un-revoked');

await browser.close();
log(`images -> ${OUT}`);
