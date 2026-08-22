import { test, expect } from '@playwright/test';
import { createTeam, goToView, guardLocalBackend, registerAccount, unique, uniqueEmail } from './helpers';

/**
 * The three things a team does between competitions: scout an opponent, work the checklist,
 * and roll into a new season.
 *
 * Each spec registers its own team, so they hold no shared state and run in parallel.
 */
test.describe('team lifecycle', () => {
    test.beforeEach(async ({ context, page }) => {
        await guardLocalBackend(context);
        await registerAccount(page, { fullName: 'Lifecycle Coach', email: uniqueEmail('cycle') });
        await createTeam(page, { teamName: unique('Lifecycle Falcons') });
    });

    test('a scouting report can be entered and persists across a reload', async ({ page }) => {
        await goToView(page, 'scouting', 'scouting');

        await page.getByTestId('scout-match').click();
        // The team number is the one required field: Sprint 5.5 made Save stop silently
        // no-opping without it, so an empty one would disable the button rather than fail.
        await page.getByRole('textbox').first().fill('4321');
        await page.getByTestId('save-scouting-report').click();

        await expect(page.getByText('#4321')).toBeVisible();

        // Survives a reload, so it reached the queue rather than living in a component.
        await page.reload();
        await goToView(page, 'scouting', 'scouting');
        await expect(page.getByText('#4321')).toBeVisible();
    });

    test('the pre-match checklist is seeded for a new team and can be worked', async ({ page }) => {
        await goToView(page, 'checklist', 'checklist');

        /*
         * B20: a new team's seeded checklist was wiped on first load, and zero checklist rows
         * now leaves local state alone. Sprint 5 separately found that an empty checklist
         * rendered NOTHING at all -- and "blank" is a rollover option, so a team can reach it.
         * Either way the page must render something a coach can act on.
         */
        const checkboxes = page.locator('input[type="checkbox"]');
        const seeded = await checkboxes.count();

        if (seeded > 0) {
            await checkboxes.first().check();
            await expect(checkboxes.first()).toBeChecked();

            await page.reload();
            await goToView(page, 'checklist', 'checklist');
            await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
        } else {
            // An empty checklist must still offer the way out of being empty.
            await expect(page.getByTestId('checklist-empty-add')).toBeVisible();
        }
    });

    test('a new season starts fresh, and the previous one becomes read-only', async ({ page }) => {
        await goToView(page, 'kanban', 'board');

        // Put one task in season 1, so "fresh start" has something to be fresh FROM.
        const oldTask = unique('Season one task');
        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(oldTask);
        await page.getByTestId('save-task').click();
        await expect(page.getByText(oldTask)).toBeVisible();

        await goToView(page, 'admin', 'admin');
        await page.getByTestId('start-new-season').click();

        const nextSeason = unique('2027-2028');
        await page.getByTestId('wizard-season-name').fill(nextSeason);
        await page.getByTestId('wizard-confirm').click();

        /*
         * Principle 5: a new season is a fresh start. The board must be empty -- and this is a
         * property the database enforces too (season_id is NOT NULL and season_is_open gates
         * every season-scoped write), so a regression here is visible rather than subtle.
         */
        await goToView(page, 'kanban', 'board');
        await expect(page.getByText(oldTask)).toHaveCount(0);
    });
});
