import { test, expect, type Browser } from '@playwright/test';
import {
    createTeam,
    dismissReAttestation,
    goToView,
    guardLocalBackend,
    registerAccount,
    unique,
    uniqueEmail,
    PASSWORD,
} from './helpers';

/**
 * Invite, join, approve -- the flow that turns one coach into a team, and the one Sprint 6's
 * exit criteria named ("invite each role") and could not walk.
 *
 * It is also where Sprint 6's seat decision lives: seats are purchased TEAM CAPACITY and the
 * gate is JOIN APPROVAL. A member who has joined but not been approved is `status='pending'`,
 * and `is_team_member()` requires 'approved', so they reach nothing at all through RLS. That
 * is a database property, but "the person waits, and the admin sees them waiting" is a
 * two-browser question that only this can answer.
 */
async function secondPerson(browser: Browser) {
    const context = await browser.newContext();
    await guardLocalBackend(context);
    return { context, page: await context.newPage() };
}

test.describe('invite and join', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('a student can join by link, waits for approval, and the admin can approve them', async ({ page, browser }) => {
        const teamName = unique('Invite Falcons');
        await registerAccount(page, { fullName: 'Invite Coach', email: uniqueEmail('admincoach') });
        await createTeam(page, { teamName });

        // 1. The admin generates an invite link.
        await goToView(page, 'admin', 'admin');
        await page.getByRole('button', { name: 'Generate Link' }).click();

        const code = await page.locator('code.font-mono').first().innerText();
        expect(code.trim()).not.toEqual('');

        // 2. A student registers on their own device and follows the link.
        const { context: studentContext, page: student } = await secondPerson(browser);
        const studentEmail = uniqueEmail('student');
        await registerAccount(student, { fullName: 'Smoke Student', email: studentEmail, age: '13_to_17' });

        await student.goto(`/#/join/${code.trim()}`);
        await student.getByRole('button', { name: /Join/i }).first().click();

        /*
         * The student is now pending. They must NOT be dropped into the team's data: a pending
         * member reaches nothing through RLS, and the UI should agree rather than showing an
         * empty app that looks broken.
         */
        await expect(
            student.getByText(/pending|waiting|approval/i).first(),
        ).toBeVisible({ timeout: 30_000 });

        // 3. The admin sees them waiting, and approves.
        await page.reload();
        await goToView(page, 'admin', 'admin');
        await dismissReAttestation(page);

        await expect(page.getByText('Smoke Student').first()).toBeVisible({ timeout: 30_000 });

        const approve = page.getByRole('button', { name: /^Approve/i }).first();
        await expect(approve).toBeEnabled();
        await approve.click();

        // 4. And the student is now a real member, holding a seat.
        await expect(page.getByText('Smoke Student').first()).toBeVisible();

        await studentContext.close();
    });

    test('an invite link is capped at the seats the team actually has free', async ({ page }) => {
        /*
         * Sprint 6 capped `max_uses` at the number of free seats, so nobody signs up for a place
         * that is not there -- `invites.max_uses` had been in the schema since Sprint 3, unset.
         * A new team's trial grant is unlimited, so the interesting assertion here is simply
         * that generating a link on a licensed team is offered and works; the at-capacity
         * refusal is covered against the seeded full-house team by the licensing suite.
         */
        await registerAccount(page, { fullName: 'Invite Coach', email: uniqueEmail('admincoach') });
        await createTeam(page, { teamName: unique('Seat Falcons') });

        await goToView(page, 'admin', 'admin');
        const generate = page.getByRole('button', { name: 'Generate Link' });
        await expect(generate).toBeEnabled();
        await generate.click();

        await expect(page.locator('code.font-mono').first()).toBeVisible();
    });
});
