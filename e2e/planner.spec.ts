import { test, expect } from '@playwright/test';
import { createTeam, goToView, guardLocalBackend, registerAccount, unique, uniqueEmail, waitForSync } from './helpers';

/**
 * The match planner, in a browser (OPS-13).
 *
 * It had no browser-level coverage, and it is the screen with the most that a unit test cannot
 * reach: d3, pointer events, SVG geometry, and a `<canvas>`-adjacent drawing surface that jsdom
 * has no implementation for. Its component suite mocks d3 wholesale and skips the drawing block
 * entirely — the repo's one recorded skip — so what happens when a person actually drags a
 * finger across the field has never been asserted anywhere.
 *
 * FEAT-05 is the reason it is worth adding now: Load → edit → Save used to create a duplicate
 * plan, and the fix (`loadedPlanId`) is exactly the kind of state that survives a unit test and
 * dies in a real navigation.
 */
test.describe('the match planner', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('a drawn plan saves, reloads, and updates in place rather than duplicating @mobile', async ({ page }) => {
        await registerAccount(page, { fullName: 'Planner Coach', email: uniqueEmail('planner') });
        await createTeam(page, { teamName: unique('Planner Falcons') });
        await goToView(page, 'planner', 'planner');

        // Draw one stroke on the field. Pointer events rather than mouse: the surface listens
        // for `pointerdown`/`move`/`up`, which is what a phone actually sends.
        const field = page.getByTestId('planner-field');
        await expect(field).toBeVisible();
        const box = await field.boundingBox();
        if (!box) throw new Error('the field surface has no box — the planner did not render');

        await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
        await page.mouse.up();

        // Save it against a match number — the field that had no input at all before FEAT-05.
        await page.getByTestId('save-plan').click();
        await page.getByTestId('plan-title-input').fill('Match 3');
        await page.getByTestId('plan-match-number-input').fill('3');
        await page.getByTestId('save-plan-confirm').click();
        await expect(page.getByText('Plan Saved!')).toBeVisible();
        await waitForSync(page);

        // A reload throws away the canvas and everything in memory.
        await page.reload();
        await goToView(page, 'planner', 'planner');

        await page.getByTitle('Load Plans').click();
        await expect(
            page.getByText('Match 3'),
            'the saved plan did not survive a reload',
        ).toHaveCount(1);

        await page.getByText('Match 3').click();

        /*
         * FEAT-05: saving a LOADED plan must update it. Before the fix this produced a second
         * "Match 3" — the drive team's normal act between matches, and the count is the whole
         * assertion.
         */
        await page.getByTestId('save-plan').click();
        await expect(page.getByTestId('save-target')).toContainText('Match 3');
        await expect(page.getByTestId('plan-match-number-input')).toHaveValue('3');
        await page.getByTestId('save-plan-confirm').click();
        await expect(page.getByText('Plan Saved!')).toBeVisible();
        await waitForSync(page);

        await page.reload();
        await goToView(page, 'planner', 'planner');
        await page.getByTitle('Load Plans').click();
        await expect(
            page.getByText('Match 3'),
            'saving a loaded plan created a duplicate (FEAT-05)',
        ).toHaveCount(1);
    });

    test('"Save as copy" is the way to get a second plan', async ({ page }) => {
        // The control for the case above: if Update were simply broken in the other direction
        // — never creating anything — the count assertion would still pass.
        await registerAccount(page, { fullName: 'Copy Coach', email: uniqueEmail('copy') });
        await createTeam(page, { teamName: unique('Copy Falcons') });
        await goToView(page, 'planner', 'planner');

        await page.getByTestId('save-plan').click();
        await page.getByTestId('plan-title-input').fill('Match 7');
        await page.getByTestId('save-plan-confirm').click();
        await expect(page.getByText('Plan Saved!')).toBeVisible();
        await waitForSync(page);

        await page.getByTitle('Load Plans').click();
        await page.getByText('Match 7').click();

        await page.getByTestId('save-plan').click();
        await page.getByTestId('save-as-copy').click();
        await expect(page.getByText('Plan Saved!')).toBeVisible();
        await waitForSync(page);

        await page.getByTitle('Load Plans').click();
        await expect(
            page.getByText('Match 7'),
            '"Save as copy" did not create a second plan',
        ).toHaveCount(2);
    });
});
