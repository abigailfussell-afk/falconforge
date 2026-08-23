import { test, expect } from '@playwright/test';
import {
    PASSWORD,
    createConfirmedAccount,
    guardLocalBackend,
    recoveryLinkFor,
    uniqueEmail,
} from './helpers';

/**
 * Password reset, end to end (OPS-13).
 *
 * This flow was **dead in production** until Sprint 9 — a non-hash `redirectTo` on a HashRouter
 * app served by gh-pages with no `404.html`, so the catch-all silently discarded the recovery
 * token. `docs/failure-modes.md` §14 lists it among "redirects that discard the user's intent",
 * three of which are on paths a user takes exactly once, "where nobody is around to notice".
 *
 * It was fixed and has had no browser-level test since. A flow taken once per user, that failed
 * silently for months, with nothing exercising it, is the highest-value spec missing from this
 * pack — and it is the one place where "the email arrived and the link worked" is the entire
 * behaviour.
 */
test.describe('password reset', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('a forgotten password can be set again through the emailed link @mobile', async ({ page }) => {
        const email = uniqueEmail('reset');
        await createConfirmedAccount({ fullName: 'Forgetful Coach', email });

        // Ask for the email.
        await page.goto('/#/login');
        await page.getByRole('button', { name: /Forgot password/i }).click();
        await page.getByTestId('email-input').fill(email);
        await page.getByRole('button', { name: /Send|Reset/i }).first().click();

        await expect(
            page.getByText(/Password reset email sent/i),
            'the app did not say it had sent anything',
        ).toBeVisible();

        // Follow it. This is the step that used to drop the token on the floor.
        const link = await recoveryLinkFor(email);
        await page.goto(link);

        const newPassword = `${PASSWORD}-changed`;
        const field = page.locator('#new-password');
        await expect(
            field,
            'the recovery link did not land on a screen that can set a password',
        ).toBeVisible({ timeout: 30_000 });

        await field.fill(newPassword);
        await page.locator('#confirm-password').fill(newPassword);

        // The button is `disabled` until both fields agree and are long enough, and it carries
        // its reason in `title` — so asserting it is enabled first turns "the click did
        // nothing" into a failure that names itself rather than a mysterious one later.
        const submit = page.getByRole('button', { name: /Set new password/i });
        await expect(submit, 'the Set-new-password button never became enabled').toBeEnabled();
        await submit.click();

        await expect(
            page.getByText(/Password updated/i),
            'the reset screen never confirmed the change',
        ).toBeVisible({ timeout: 30_000 });

        /*
         * The assertion that matters is not "a success message appeared" — it is that the NEW
         * password works. A reset that reports success and changes nothing is the same silent
         * failure in a new costume.
         *
         * Signing out first is not incidental: GoTrue signs you in as part of the recovery
         * exchange, so the app is already authenticated at this point and `/#/login` would
         * redirect straight past the form. Clearing the stored session is the deterministic
         * way to get back to it — the sidebar's sign-out now asks about unsynced work
         * (SYNC-05), which is correct for a person and noise for this assertion.
         */
        await page.evaluate(() => {
            // Every Supabase key, not only the auth token: the app also caches a display
            // profile, and a half-cleared session is a state neither branch expects.
            Object.keys(localStorage)
                .filter((key) => key.startsWith('sb-') || key.startsWith('ftc-'))
                .forEach((key) => localStorage.removeItem(key));
        });
        // A full navigation rather than a hash change: the app is a SPA and the router does not
        // reload on a hash it is already on, which is `docs/failure-modes.md` section 2's
        // capture-script defect in miniature.
        await page.goto('/', { waitUntil: 'load' });

        /*
         * Load `/` first, THEN move the hash — rather than going straight to `#/login`.
         *
         * Navigating to the hash directly from the reset screen races the app's own redirect:
         * it decides where a signed-out visitor belongs while the recovery session is still
         * being torn down, and lands on `/`. Booting signed-out first removes the race.
         *
         * The hash rather than the landing page's "Log In" button, because that button lives
         * in the desktop nav — on the `mobile` project it is behind the menu, and a locator
         * that only works at one viewport is how a spec quietly stops covering the other.
         */
        await page.evaluate(() => {
            window.location.hash = '#/login';
        });

        await expect(
            page.getByTestId('email-input'),
            'clearing the session did not return the app to the login form',
        ).toBeVisible({ timeout: 30_000 });

        await page.getByTestId('email-input').fill(email);
        await page.getByTestId('password-input').fill(newPassword);
        await page.locator('form').first().evaluate((form: HTMLFormElement) => form.requestSubmit());

        await expect(
            page,
            'the new password does not work — the reset reported success and changed nothing',
        ).toHaveURL(/#\/(onboarding|app|create-team)/, { timeout: 45_000 });
    });
});
