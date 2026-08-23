import { test, expect } from '@playwright/test';
import { createTeam, goToView, guardLocalBackend, registerAccount, unique, uniqueEmail } from './helpers';

/**
 * The venue flow, and the reason this project exists.
 *
 * Principle 1 says every feature must work offline and sync on reconnect, and the sync engine
 * carries regression tests for eighteen documented bugs. What none of those can prove is the
 * whole path at once: a real service worker, a real IndexedDB queue, a real drain against real
 * PostgREST and real RLS, driven through the UI the way a student does it between matches.
 *
 * `context.setOffline(true)` cuts the network at the browser rather than stubbing a flag, so
 * the app finds out the way it would at a venue.
 */
test.describe('offline and sync', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('work created offline survives and reaches the server on reconnect', async ({ page, context }) => {
        await registerAccount(page, { fullName: 'Venue Coach', email: uniqueEmail('venue') });
        await createTeam(page, { teamName: unique('Venue Falcons') });

        await goToView(page, 'kanban', 'board');

        const offlineTitle = unique('Repair the intake');

        /*
         * Be genuinely loaded before pulling the plug.
         *
         * The board's New button is disabled with "Select a season first" until the season pull
         * lands, and `goToView` waits for the VIEW rather than for that. Under four workers this
         * test began losing the race — a fresh team is seconds old and the pull is still in
         * flight — and failed on a disabled button, which reads exactly like an offline defect
         * and is not one. The scenario under test is "work created offline survives", not "the
         * app is switched off mid-boot"; that second one is real, and it is in the parking lot.
         */
        await expect(page.getByTestId('season-selector')).not.toHaveValue('', { timeout: 30_000 });

        await context.setOffline(true);

        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(offlineTitle);
        await page.getByTestId('save-task').click();

        // The card is on the board immediately: an offline write is not a pending request, it
        // is local truth that happens to owe the server an update.
        await expect(page.getByText(offlineTitle)).toBeVisible();

        // And the app says so, rather than pretending the write landed.
        await expect(page.getByTestId('sync-status')).toBeVisible();

        await context.setOffline(false);

        /*
         * Reload once the network is back. This is the honest test: it throws away every scrap
         * of in-memory state, so anything that survives came out of the queue and the database
         * rather than out of React. A card that only exists in a Zustand store would vanish
         * here, which is exactly the failure mode worth catching.
         */
        await expect
            .poll(
                async () => {
                    await page.reload();
                    await goToView(page, 'kanban', 'board');
                    return page.getByText(offlineTitle).isVisible().catch(() => false);
                },
                {
                    message: 'the task queued offline never appeared after a reconnect and reload',
                    timeout: 60_000,
                    intervals: [3_000, 5_000, 5_000, 10_000],
                },
            )
            .toBe(true);
    });

    /**
     * SYNC-07 / SYNC-16 — the offline COLD boot, and what the indicator says during one.
     *
     * Neither of the two specs above reloads while offline: the first goes back online first,
     * and the second navigates between hash routes without a reload. So `index.html`, session
     * restore and store hydration with the network down had never been exercised — the thing
     * this product is FOR — and neither had the status label, which is the reason this spec is
     * SYNC-07's red test rather than a new file.
     *
     * The label is the assertion that fails today. Chromium reports `navigator.onLine === true`
     * after an offline reload, so the app cold-booted with the network cut and printed "Synced"
     * over 37 failed requests.
     */
    test('an offline cold boot renders from the device and does not claim to be synced', async ({ page, context }) => {
        await registerAccount(page, { fullName: 'Coldboot Coach', email: uniqueEmail('coldboot') });
        await createTeam(page, { teamName: unique('Coldboot Falcons') });
        await goToView(page, 'kanban', 'board');
        await waitForSync(page);

        await context.setOffline(true);
        await page.reload();

        // The shell came out of the precache and the store out of IndexedDB.
        await expect(page.getByTestId('app-nav').or(page.getByTestId('mobile-menu-button')).first())
            .toBeVisible({ timeout: 30_000 });

        /*
         * The label. `navigator.onLine` is the reason this is worth asserting: read it here
         * and record what it said, so a future failure can tell "the emulation changed" from
         * "the fix regressed".
         */
        const onLine = await page.evaluate(() => navigator.onLine);
        const status = page.getByTestId('sync-status-text');
        await expect(status).toBeVisible({ timeout: 15_000 });

        const label = (await status.textContent())?.trim() ?? '';
        expect(
            label,
            `the indicator claimed to be synced after an offline cold boot (navigator.onLine=${onLine})`,
        ).not.toBe('Synced');
        expect(label, `unexpected status after an offline cold boot: "${label}"`).toMatch(
            /Offline|Can't reach server|Last synced|Not synced yet/,
        );
    });

    test('the app keeps working while offline rather than blocking on the network', async ({ page, context }) => {
        await registerAccount(page, { fullName: 'Venue Coach', email: uniqueEmail('venue') });
        await createTeam(page, { teamName: unique('Venue Falcons') });

        await context.setOffline(true);

        // Navigation between lazily-loaded routes must not need the network. The chunks are
        // precached by Workbox; if that regresses, an offline team gets a blank view at the
        // moment they are furthest from wifi.
        await goToView(page, 'scouting', 'scouting');
        await expect(page.getByTestId('nav-scouting')).toHaveAttribute('aria-current', 'page');

        await goToView(page, 'checklist', 'checklist');
        await expect(page.getByTestId('nav-checklist')).toHaveAttribute('aria-current', 'page');

        await goToView(page, 'kanban', 'board');
        await expect(page.getByTestId('new-task-button')).toBeVisible();
    });
});
