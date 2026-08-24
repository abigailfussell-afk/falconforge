/**
 * WALK-B-07 — the team badge holds a five-digit number, measured in a real browser.
 *
 * The unit tests assert the STRING the badge renders. They cannot assert that the string fits:
 * jsdom applies no stylesheet, so it renders the overflowing and the fitting versions of this
 * badge identically (`docs/environment-divergences.md` §3). That gap is not theoretical here —
 * the two truncations this replaced (`slice(0, 2)` in the rail, `slice(-3)` in the picker) were
 * *there because of the layout*: "#30727" does not fit in a 28px circle at a legible size, so
 * somebody made it fit by throwing away digits.
 *
 * The badge is therefore a pill — `h-7 min-w-7 px-1.5` — that grows with its text, and the
 * assertions below are the ones that would have caught the fix being made the other way:
 *
 *   1. the rendered text is the whole team number;
 *   2. the text box sits INSIDE the pill (`min-w-*` on the spacing scale really emits a rule —
 *      `screens: { tall: { raw: ... } }` parsed, built, and emitted nothing at all, and
 *      `hidden tall:block` was plain `hidden` at every height for two sprints);
 *   3. nothing beside it is pushed out of the row, and the page does not scroll sideways at
 *      375px.
 *
 * `docs/failure-modes.md` §5: asserting the class is present is exactly what all nine CSS
 * defects in this repo's history would have passed.
 */
import { test, expect } from '@playwright/test';
import {
    createTeam,
    enterApp,
    guardLocalBackend,
    registerAccount,
    unique,
    uniqueEmail,
    uniqueTeamNumber,
} from './helpers';

test.describe('the team-number badge (WALK-B-07)', () => {
    test('shows the whole five-digit number and fits inside its pill at 375px', async ({
        page,
        context,
    }) => {
        await guardLocalBackend(context);
        await page.setViewportSize({ width: 375, height: 812 });

        // `registerAccount`, not `signIn`: the latter walks into the app through the team
        // picker, and this account has no team yet.
        await registerAccount(page, { fullName: 'Badge Coach', email: uniqueEmail('badge') });

        /*
         * Five digits, which is the longest FIRST issues and the case both old badges got wrong.
         *
         * Passed explicitly rather than left to `createTeam`: that helper retries a collision
         * with a different number, and this spec asserts on the digits it rendered, so a silent
         * retry would have it checking a number the app never showed.
         *
         * `uniqueTeamNumber()` and not a timestamp — Node's clock and Chromium's clock are two
         * processes that share a timezone by coincidence, and `harness-invariants` ratchets
         * against it (failure-modes §10). Its range is 50,000–94,999, so it is always 5 digits.
         */
        const teamNumber = uniqueTeamNumber();
        expect(teamNumber, 'the number under test must be five digits').toHaveLength(5);
        await createTeam(page, { teamName: unique('Badge'), teamNumber });

        await enterApp(page);

        // The rail is a drawer below `lg`; open it so the badge is laid out on screen.
        await page.getByTestId('mobile-menu-button').click();
        const badge = page.getByTestId('team-badge');
        await expect(badge).toBeVisible();

        // 1 — the whole number, not two digits of it and not three.
        await expect(badge).toHaveText(`#${teamNumber}`);

        // 2 — the text is inside the pill, and the pill really is a pill.
        const box = await badge.evaluate((el) => {
            const pill = el.getBoundingClientRect();
            const inner = el.firstElementChild as HTMLElement;
            const text = inner.getBoundingClientRect();
            return {
                pill: { left: pill.left, right: pill.right, width: pill.width, height: pill.height },
                text: { left: text.left, right: text.right },
                minWidth: parseFloat(getComputedStyle(el).minWidth),
                whiteSpace: getComputedStyle(inner).whiteSpace,
            };
        });

        expect(box.text.left, 'the number starts before the pill does').toBeGreaterThanOrEqual(
            box.pill.left - 0.5,
        );
        expect(box.text.right, 'the number runs past the end of the pill').toBeLessThanOrEqual(
            box.pill.right + 0.5,
        );
        // The pill grew for five digits rather than clipping them: wider than its own floor.
        expect(box.minWidth, '`min-w-7` emitted no rule').toBeGreaterThan(0);
        expect(box.pill.width, 'the pill did not grow to fit five digits').toBeGreaterThan(
            box.minWidth,
        );
        // A five-digit number wrapping to two lines inside a 28px box is how the truncated
        // version would have failed anyway.
        expect(box.whiteSpace).toBe('nowrap');
        expect(box.pill.height, 'the badge grew a second line').toBeLessThan(34);

        // 3 — the row still holds the team name and the switch-team button, and the page does
        // not scroll sideways.
        const row = await page.evaluate(() => {
            const el = document.querySelector('[data-testid="team-badge"]')!;
            const pill = el.getBoundingClientRect();
            const name = document.querySelector('[data-testid="team-display-name"]')!;
            const sw = document
                .querySelector('[data-testid="switch-team-button"]')!
                .getBoundingClientRect();
            const container = el.parentElement!.getBoundingClientRect();
            return {
                pillLeft: pill.left,
                switchRight: sw.right,
                containerLeft: container.left,
                containerRight: container.right,
                nameClipped: name.scrollWidth > name.clientWidth,
                docScroll: document.documentElement.scrollWidth,
                docClient: document.documentElement.clientWidth,
            };
        });

        expect(row.pillLeft).toBeGreaterThanOrEqual(row.containerLeft - 0.5);
        expect(
            row.switchRight,
            'the badge pushed the switch-team button out of the row',
        ).toBeLessThanOrEqual(row.containerRight + 0.5);
        expect(row.nameClipped, 'the team name is clipped beside the badge').toBe(false);
        expect(row.docScroll, 'the page scrolls sideways at 375px').toBeLessThanOrEqual(
            row.docClient,
        );
    });
});
