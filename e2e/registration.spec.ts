import { test, expect } from '@playwright/test';
import {
    confirmationLinkFor,
    createTeam,
    guardLocalBackend,
    registerAccount,
    signUpThroughEmail,
    submitSignUpForm,
    unique,
    uniqueEmail,
} from './helpers';

/**
 * The flow Sprint 6 could not close.
 *
 * Its exit criteria asked for "register team -> gift licence -> invite each role -> verify
 * capabilities" and its report says plainly that the registration half was never walked: every
 * licensing screen was exercised against states constructed directly in the database. The
 * hand-off blames email confirmation on the local stack, and until 2026-08-22 this file said the
 * opposite was true: `supabase/config.toml` had `enable_confirmations = false`, so a fresh
 * sign-up needed no mailbox. It also meant this spec was green over a flow that does not exist
 * in production, where confirmations have always been on. The config now matches production and
 * this is the ONE place in the pack that walks the whole round trip -- form, message, link --
 * because it is the one flow every single beta team runs exactly once, on their first evening,
 * with nobody to help them.
 */
test.describe('registration', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('submitting the form does not sign anybody in — the emailed link does', async ({ page }) => {
        /*
         * The divergence itself, asserted rather than assumed.
         *
         * On a developer machine `signUp` used to return a live session, so every client-side
         * "do this right after signing up" path fired immediately; in production there is no
         * session until this link is followed, and anything that must survive the gap has to
         * run server-side or on the first real sign-in. This test fails the moment the local
         * stack drifts back to auto-confirming, which is what made the whole pack unable to
         * see the difference for eight sprints.
         */
        const email = uniqueEmail('gap');
        await submitSignUpForm(page, { fullName: 'Gap Coach', email });

        await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 30_000 });

        /*
         * Asserted on the STORED SESSION, not on where the router ends up.
         *
         * The first draft navigated to `/#/app/board` and expected to be bounced to `#/login`
         * or `#/`. It passed with auto-confirm still on, for the wrong reason: a signed-in
         * account with no team also lands on `#/`, which the pattern accepted. Whether a
         * session exists is the actual property, and supabase-js keeps its answer under
         * `sb-<ref>-auth-token`.
         */
        const sessionKeys = await page.evaluate(() =>
            Object.keys(localStorage).filter((key) => /^sb-.*-auth-token$/.test(key)),
        );
        expect(sessionKeys).toEqual([]);

        await page.goto(await confirmationLinkFor(email));
        await page.waitForURL(/#\/(onboarding|app|create-team)/, { timeout: 45_000 });
    });

    test('a new coach can sign up, create a team, and land in a working app', async ({ page }) => {
        const email = uniqueEmail('coach');
        const teamName = unique('Smoke Falcons');

        await signUpThroughEmail(page, { fullName: 'Smoke Coach', email });
        await createTeam(page, { teamName });

        // Inside the app, on a real team, with the shell rendered.
        await expect(page).toHaveURL(/#\/app\//);
        await expect(page.getByTestId('app-nav')).toBeVisible();
        await expect(page.getByTestId('team-display-name')).toContainText(teamName);
    });

    test('a brand-new team gets a season and a licence, so the app is not read-only on arrival', async ({ page }) => {
        /*
         * `create_team_as_admin` seeds a 90-day trial grant, because a team with no licence is
         * read-only in the DATABASE and registration would otherwise be dead on arrival. That
         * trial is slated for deletion when Stripe lands (Sprint 10), and this test is what
         * will notice if it is removed without a replacement: the symptom would not be an
         * error, it would be a new team that silently cannot write anything.
         */
        const email = uniqueEmail('coach');
        await registerAccount(page, { fullName: 'Smoke Coach', email });
        await createTeam(page, { teamName: unique('Licensed Falcons') });

        // A season exists (the picker is the only season control in the app).
        await expect(page.getByTestId('season-selector')).toBeVisible();

        // And the team is NOT in the lapsed/read-only state.
        await expect(page.getByTestId('licence-lapsed-banner')).toHaveCount(0);
    });

    test('a brand-new account is not asked to re-accept the documents it accepted a minute ago', async ({ page }) => {
        /*
         * `SIGNUP_REQUIRED_ATTESTATIONS` had exactly one consumer -- ReAttestationPrompt, which
         * CHECKS it. Nothing ever WROTE it: the sign-up form's privacy acceptance arrived as a
         * parameter named `_isPrivacyAccepted` and was discarded. So the record was missing
         * rather than merely out of date, and every new account met "We've updated our legal
         * documents ... since you last accepted them" on its first screen, about documents it
         * had accepted seconds earlier.
         *
         * The re-attestation prompt for genuinely OLD acceptances is intended and stays. This
         * asserts only that a fresh account is not caught by it.
         */
        await signUpThroughEmail(page, { fullName: 'Smoke Coach', email: uniqueEmail('coach') });
        await createTeam(page, { teamName: unique('Fresh Falcons') });

        await expect(page.getByRole('dialog', { name: 'Updated legal documents' })).toHaveCount(0);
        await expect(page.getByText(/updated our legal documents/i)).toHaveCount(0);
    });
});
