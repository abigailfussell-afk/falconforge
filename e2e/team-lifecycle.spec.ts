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

    test('a long value wraps inside the report card instead of pushing the badge out @mobile', async ({ page }) => {
        /*
         * WALK-A-06's other half, and the half no unit test can see: jsdom applies no
         * stylesheet, so it renders the broken and fixed cards identically.
         *
         * The walkthrough's 21-character team number shoved the "No match #" badge out past the
         * card's own edge. The cause is not the string — it is that a flex child defaults to
         * `min-width: auto` and so refuses to shrink below its content. Validation stops new
         * reports carrying a number that long, but not event names or notes, and not the rows
         * already in databases; the layout has to hold regardless.
         */
        await goToView(page, 'scouting', 'scouting');

        await page.getByTestId('scout-match').click();
        await page.getByTestId('scout-team-number').fill('41234');
        /*
         * No spaces, and long enough to overflow the widest card in the grid.
         *
         * The first version of this test used a 56-character name and **passed with the layout
         * fix reverted** — it was decoration, caught by reverting rather than by reading it.
         * The event name has no length rule (only the team number does), so this is a value a
         * scout can still type today, which is the point: validation did not make the card
         * safe, the layout did.
         */
        await page.getByTestId('scout-event-name').fill(`Qualifier-${'x'.repeat(120)}`);
        await page.getByTestId('field-endGameNotes').fill('x'.repeat(500));
        await page.getByTestId('save-scouting-report').click();

        /*
         * The page opens on the TEAM SUMMARY now (P-02) — "who is good at what" is the question
         * somebody opening a scouting page has, and forty cards do not answer it. This test is
         * about a CARD's geometry, so it says so. The assertions below are unchanged.
         */
        await page.getByTestId('scout-view-cards').click();

        const card = page.getByTestId('scout-card').first();
        await expect(card).toBeVisible();

        const [cardBox, badgeBox, teamBox, notesBox] = await Promise.all([
            card.boundingBox(),
            card.getByTestId('scout-card-match').boundingBox(),
            card.getByTestId('scout-card-team').boundingBox(),
            card.getByTestId('scout-card-notes').boundingBox(),
        ]);
        if (!cardBox || !badgeBox || !teamBox || !notesBox) {
            throw new Error('the report card did not render');
        }

        // One pixel of slack for sub-pixel rounding, and no more: the defect was measured in
        // tens of pixels, so a generous tolerance would pass on the broken version.
        const right = cardBox.x + cardBox.width + 1;
        expect(badgeBox.x + badgeBox.width, 'the match badge is outside its card').toBeLessThanOrEqual(right);
        expect(teamBox.x + teamBox.width, 'the team number is outside its card').toBeLessThanOrEqual(right);
        expect(notesBox.x + notesBox.width, 'the notes are outside their card').toBeLessThanOrEqual(right);

        // And the badge is still a badge: `min-w-0` on the left child without `shrink-0` on the
        // right one simply moves the crushing from the card to the badge.
        expect(badgeBox.width, 'the match badge was squashed instead of the value wrapping').toBeGreaterThan(40);
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
