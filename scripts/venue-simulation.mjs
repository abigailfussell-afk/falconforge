/**
 * The venue simulation, run against a real build with a real service worker.
 *
 * Rule 10 says verification is adversarial and that UI work must be RUN, not just tested. For a
 * hardening sprint the equivalent of "go and look" is the venue: a team arrives, the wifi is
 * hostile, they work for an hour anyway, and then it comes back. Sprint 5's suite was green over
 * five defects that only appeared when the app was run; Sprint 6's was green over three more.
 *
 * This is deliberately NOT part of the smoke pack, and it is not run in CI. The smoke pack
 * answers "does the flow still work"; this answers "what does an hour at a competition look
 * like", captures every stage as an image, and expects a person to look at them. A script only
 * checks what somebody already thought to check — the images are how the things nobody thought
 * of get noticed.
 *
 * Stages, in order:
 *   1. sign in on a good connection, so the worker installs and the precache lands
 *   2. cut the network entirely
 *   3. do a session's worth of work — several tasks, a scouting report, checklist ticks
 *   4. reload while still offline: the cold-boot case, which is how a phone behaves when it
 *      has been in a pocket and the tab was evicted
 *   5. reconnect on a THROTTLED link and watch the queue drain
 *   6. reload once more and confirm the work is really on the server
 *
 * Usage: npm run venue   (needs the local stack up and a build served by playwright's config)
 */
import { chromium } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const APP = process.env.VENUE_BASE_URL ?? 'http://127.0.0.1:5199';
const OUT = 'screenshots/venue';
const PASSWORD = 'ForgeSmoke!2026-local';

const email = `venue-${Math.random().toString(36).slice(2, 10)}@falconforge.test`;
let step = 0;

async function shot(page, name) {
    step += 1;
    const file = path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    console.log(`  captured ${file}`);
}

async function pendingCount(page) {
    // What the sidebar's sync indicator is telling the user right now.
    return (await page.getByTestId('sync-status').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

async function main() {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });

    const browser = await chromium.launch();
    const context = await browser.newContext();

    /*
     * The backend guard, and it is not theoretical here.
     *
     * This script REGISTERS AN ACCOUNT and creates a team. `npm run build` reads `.env.local`,
     * which points at the HOSTED project -- so a preview built the ordinary way and pointed at
     * by this script would put test accounts and a "Venue Falcons" team into production. That
     * happened on the first run of this script and was caught before it did any harm, which is
     * the argument for refusing at the network layer rather than trusting a build to have been
     * made correctly. Build with the local stack pinned (see playwright.config.ts).
     */
    let sawLocal = false;
    await context.route('**/*', (route) => {
        let url;
        try {
            url = new URL(route.request().url());
        } catch {
            return route.continue();
        }
        if (/supabase\.(co|in)$/.test(url.hostname)) {
            throw new Error(
                `Refusing to run: the app under test called the HOSTED backend (${url.hostname}). ` +
                    'This script registers accounts -- build with VITE_SUPABASE_URL=http://127.0.0.1:54321.',
            );
        }
        if (url.port === '54321') sawLocal = true;
        return route.continue();
    });

    const page = await context.newPage();

    const consoleErrors = [];
    page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message}`));

    console.log('\n1. Registering on a good connection, so the worker installs.');
    await page.goto(`${APP}/#/login`);
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.locator('input[type="text"]').first().fill('Venue Coach');
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('continue-button').click();
    await page.locator('input[value="18_plus"]').check();
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: 'Create Account' }).click();

    await page.waitForURL(/#\/(onboarding|app|create-team)/, { timeout: 45_000 });
    if (!sawLocal) {
        throw new Error(
            'Refusing to continue: no request to the local stack on :54321 was seen, so this is ' +
                'not the seeded local database. Check how the preview build was made.',
        );
    }
    await page.goto(`${APP}/#/create-team`);
    for (let i = 0; i < 8; i++) {
        const done = page.getByRole('button', { name: 'Go to Dashboard' });
        const next = page.getByRole('button', { name: /^(Next|Create Team)$/ });
        const which = await Promise.race([
            done.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'done'),
            next.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'next'),
        ]);
        if (which === 'done') {
            await done.click();
            break;
        }
        const box = page.locator('input[type="checkbox"]').first();
        if (await box.isVisible().catch(() => false)) await box.check().catch(() => {});
        const nameField = page.getByPlaceholder('e.g., Falcon Force');
        if (await nameField.isVisible().catch(() => false)) await nameField.fill('Venue Falcons');
        const numberField = page.getByPlaceholder('e.g., 12345');
        if (await numberField.isVisible().catch(() => false)) await numberField.fill('9912');
        await next.click();
    }
    await page.waitForURL(/#\/app\//, { timeout: 45_000 });

    // Give the service worker a moment to install and precache before the network goes away.
    await page.waitForTimeout(3_000);
    const swReady = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        return Boolean(reg && (reg.active || reg.installing || reg.waiting));
    });
    console.log(`   service worker registered: ${swReady}`);
    await shot(page, 'online-dashboard');

    console.log('\n2. Cutting the network.');
    await context.setOffline(true);
    await page.goto(`${APP}/#/app/dashboard`);
    await page.waitForSelector('[data-testid="app-nav"]', { timeout: 30_000 });
    await shot(page, 'offline-dashboard');
    console.log(`   sync indicator: "${await pendingCount(page)}"`);

    console.log('\n3. A session of work, entirely offline.');
    await page.goto(`${APP}/#/app/board`);
    await page.waitForSelector('[data-testid="new-task-button"]', { timeout: 30_000 });
    for (const title of ['Replace intake belt', 'Tune auto path', 'Charge spare batteries']) {
        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(title);
        await page.getByTestId('save-task').click();
        await page.waitForTimeout(300);
    }
    await shot(page, 'offline-three-tasks');

    await page.goto(`${APP}/#/app/scouting`);
    await page.waitForSelector('[data-testid="scout-match"]', { timeout: 30_000 });
    await page.getByTestId('scout-match').click();
    await page.getByRole('textbox').first().fill('7331');
    await page.getByTestId('save-scouting-report').click();
    await page.waitForTimeout(500);
    await shot(page, 'offline-scouting');

    await page.goto(`${APP}/#/app/checklist`);
    await page.waitForTimeout(1_500);
    /*
     * The checklist item toggle is a real <button>, not an `input[type=checkbox]`. The first
     * version of this script used `.check()` on a checkbox locator with `.catch(() => {})`, so
     * it matched nothing and swallowed the failure -- the whole checklist stage silently did
     * nothing while reporting success. The screenshot is what gave it away: eight untouched
     * circles. A simulation that quietly skips a step is worse than one that omits it.
     */
    const items = page.getByTestId('checklist-item-toggle');
    const count = Math.min(await items.count(), 3);
    if (count === 0) throw new Error('no checklist items to tick — the seeded checklist is missing');
    for (let i = 0; i < count; i++) {
        await items.nth(i).click();
        await page.waitForTimeout(200);
    }
    await shot(page, 'offline-checklist');
    console.log(`   sync indicator after a session's work: "${await pendingCount(page)}"`);

    console.log('\n4. Reloading while STILL offline — the pocket/eviction case.');
    await page.reload();
    await page.waitForSelector('[data-testid="app-nav"]', { timeout: 45_000 });
    await page.goto(`${APP}/#/app/board`);
    await page.waitForTimeout(2_000);
    await shot(page, 'offline-after-reload');
    const survived = await page.getByText('Replace intake belt').isVisible().catch(() => false);
    console.log(`   work still on screen after an offline reload: ${survived}`);

    console.log('\n5. Reconnecting on a throttled link, and watching the drain.');
    await context.setOffline(false);
    /*
     * Throttling matters here. An instant local reconnect drains before anything can be
     * observed, and hides the class of bug where the UI reports "synced" while items are still
     * in flight -- which is exactly what a venue's returning wifi looks like.
     */
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 300,
        downloadThroughput: (200 * 1024) / 8,
        uploadThroughput: (100 * 1024) / 8,
    });
    await page.waitForTimeout(1_000);
    await shot(page, 'reconnected-draining');
    console.log(`   sync indicator immediately after reconnect: "${await pendingCount(page)}"`);

    for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(5_000);
        const status = await pendingCount(page);
        console.log(`   +${(i + 1) * 5}s: "${status}"`);
        if (/Synced|Live/.test(status)) break;
    }
    await shot(page, 'drained');

    console.log('\n6. Reloading to prove the work is on the SERVER, not just in the store.');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
    });
    // A fresh context: no IndexedDB, no store, nothing but the session. Anything visible here
    // came back from Postgres.
    const second = await browser.newContext();
    const fresh = await second.newPage();
    await fresh.goto(`${APP}/#/login`);
    await fresh.getByTestId('email-input').fill(email);
    await fresh.getByTestId('password-input').fill(PASSWORD);
    await fresh.getByTestId('sign-in-button').click();
    await fresh.waitForURL(/#\/(app|onboarding)/, { timeout: 45_000 });
    if (fresh.url().includes('/onboarding')) {
        await fresh.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 30_000 });
        await fresh.getByTestId('team-option').first().click();
    }
    await fresh.waitForURL(/#\/app\//, { timeout: 45_000 });
    await fresh.goto(`${APP}/#/app/board`);
    await fresh.waitForTimeout(3_000);
    await shot(fresh, 'second-device-board');

    const onServer = [];
    for (const title of ['Replace intake belt', 'Tune auto path', 'Charge spare batteries']) {
        onServer.push([title, await fresh.getByText(title).isVisible().catch(() => false)]);
    }
    console.log('\n   Work visible on a SECOND DEVICE (i.e. it reached Postgres):');
    for (const [title, ok] of onServer) console.log(`     ${ok ? 'YES' : 'NO '}  ${title}`);

    await fresh.goto(`${APP}/#/app/scouting`);
    await fresh.waitForTimeout(2_000);
    await shot(fresh, 'second-device-scouting');
    console.log(`     ${(await fresh.getByText('#7331').isVisible().catch(() => false)) ? 'YES' : 'NO '}  scouting report #7331`);

    if (consoleErrors.length) {
        console.log(`\n   Console errors seen during the run (${consoleErrors.length}):`);
        for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`     ${e}`);
    } else {
        console.log('\n   No console errors during the run.');
    }

    await browser.close();
    console.log(`\nVenue simulation complete. Images in ${OUT}/ — go and look at them.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
