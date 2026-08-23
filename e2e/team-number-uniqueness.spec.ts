import { test, expect } from '@playwright/test';
import {
    createTeam,
    guardLocalBackend,
    registerAccount,
    unique,
    uniqueEmail,
    uniqueTeamNumber,
} from './helpers';

/**
 * D3, end to end — two coaches from the same team, both registering.
 *
 * Kevin's decision calls this the case that is CERTAIN rather than defensive: *"it fixes two
 * coaches from the same team both registering, and typo'd numbers"*. Everything else in D3 is
 * about abuse; this is about a coach who has done nothing wrong.
 *
 * WHY THIS IS AN e2e SPEC AND NOT ONLY UNIT + db TESTS. The unit test mocks the RPC and asserts
 * the screen; the db test calls the RPC and asserts the refusal. Neither can see what this
 * one sees — that the wizard's own submit path carries `error_code` through to the branch, on a
 * real build, against a real database. That gap is `docs/failure-modes.md` §3: the thing being
 * verified is not the thing that ships. It cost this sprint four e2e failures whose messages
 * said nothing about team numbers at all, and both layers were green throughout.
 *
 * It also means the taken-number screen is exercised deliberately rather than only when
 * `createTeam`'s random number happens to collide.
 */
test.describe('two teams cannot hold one number (D3)', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('the second coach is told which team has it, and sent to join', async ({ page }) => {
        const number = uniqueTeamNumber();
        const teamName = unique('Iron Falcons');

        // The first coach registers the team.
        await registerAccount(page, { fullName: 'First Coach', email: uniqueEmail('first') });
        await createTeam(page, { teamName, teamNumber: number });
        await expect(page.getByTestId('team-display-name')).toContainText(teamName);

        /*
         * A SECOND ACCOUNT, in a clean context. Signing out would do, but a fresh context is
         * what actually proves the refusal is about the TEAM NUMBER rather than about anything
         * left in this browser — and D3's own rule is one team per account, so reusing the
         * first coach's account would be refused for a different reason and this spec would
         * pass while asserting nothing about numbers.
         */
        const second = await page.context().browser()!.newContext();
        await guardLocalBackend(second);
        const secondPage = await second.newPage();

        await registerAccount(secondPage, {
            fullName: 'Second Coach',
            email: uniqueEmail('second'),
        });

        await secondPage.goto('/#/create-team');
        const next = secondPage.getByRole('button', { name: /^(Next|Create Team)$/ });

        await secondPage.getByRole('checkbox').first().check();
        await next.click();

        await secondPage.getByPlaceholder('e.g., Falcon Force').fill(unique('Also Iron Falcons'));
        await secondPage.getByPlaceholder('e.g., 12345').fill(number);
        await secondPage.getByRole('button', { name: /create team/i }).click();

        // The screen names the team that has it. "#12345 is taken" reads like a bug in
        // FalconForge; the NAME is what lets a coach recognise their own team.
        const taken = secondPage.getByTestId('team-number-taken');
        await expect(taken).toBeVisible({ timeout: 30_000 });
        await expect(taken).toContainText(teamName);
        await expect(taken).toContainText(number);

        // And the way onto that roster is offered, which per D3 is "request to join" through
        // the existing invite path rather than a second join mechanism.
        await secondPage.getByTestId('taken-go-join').click();
        await expect(secondPage).toHaveURL(/#\/join/);

        await second.close();
    });

    test('a typo has a way back, not just a dead end', async ({ page }) => {
        const number = uniqueTeamNumber();
        await registerAccount(page, { fullName: 'Typo Coach', email: uniqueEmail('typo') });
        await createTeam(page, { teamName: unique('Typo Falcons'), teamNumber: number });

        const second = await page.context().browser()!.newContext();
        await guardLocalBackend(second);
        const secondPage = await second.newPage();
        await registerAccount(secondPage, { fullName: 'Other', email: uniqueEmail('other') });

        await secondPage.goto('/#/create-team');
        await secondPage.getByRole('checkbox').first().check();
        await secondPage.getByRole('button', { name: /^(Next|Create Team)$/ }).click();
        await secondPage.getByPlaceholder('e.g., Falcon Force').fill(unique('Real Team'));
        await secondPage.getByPlaceholder('e.g., 12345').fill(number);
        await secondPage.getByRole('button', { name: /create team/i }).click();

        await expect(secondPage.getByTestId('team-number-taken')).toBeVisible({ timeout: 30_000 });

        /*
         * The other real cause of a collision is a typo, and a screen with one exit is a trap
         * for the coach who typed 1234 instead of 12345. Back, correct it, and the
         * registration completes — which is the assertion that makes this more than a
         * screenshot of an error page.
         */
        await secondPage.getByTestId('taken-back').click();
        await secondPage.getByPlaceholder('e.g., 12345').fill(uniqueTeamNumber());
        await secondPage.getByRole('button', { name: /create team/i }).click();

        await expect(secondPage.getByRole('button', { name: 'Go to Dashboard' })).toBeVisible({
            timeout: 45_000,
        });

        await second.close();
    });
});
