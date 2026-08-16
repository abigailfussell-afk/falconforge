import { expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * Shared moves for the smoke pack.
 *
 * These drive the app the way a coach does -- through the forms, not through the API -- which
 * is the entire point. Sprint 6's exit criteria included "register team -> gift licence ->
 * invite each role -> verify capabilities" and the report is honest that the registration half
 * was never walked: the licensing screens were exercised against states built directly in the
 * database. The RLS suite's 265 assertions are stronger evidence for CAPABILITIES than any
 * browser test, but they are no evidence at all for the FLOW.
 */

export const PASSWORD = 'ForgeSmoke!2026-local';

/** A fresh identity per test, so specs can run in parallel without contending for a team. */
export function unique(prefix: string): string {
    // No Date.now() collisions across parallel workers: the random suffix does the work.
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function uniqueEmail(prefix: string): string {
    return `${unique(prefix)}@falconforge.test`;
}

/**
 * Fail the run if the app under test ever talks to a hosted Supabase project.
 *
 * `.env.local` points at production and `.env.development.local` is gitignored, so a laptop is
 * one deleted file away from a smoke pack that registers teams in the real database. The
 * Playwright config pins the dev server's env explicitly; this is the belt to that braces,
 * enforced at the network layer where configuration cannot lie about it.
 */
export async function guardLocalBackend(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route) => {
        let host: string;
        try {
            host = new URL(route.request().url()).hostname;
        } catch {
            return route.continue();
        }
        if (/supabase\.(co|in)$/.test(host)) {
            throw new Error(`Smoke pack tried to reach the HOSTED backend (${host}). Refusing.`);
        }
        return route.continue();
    });
}

/**
 * Sprint 6 raised ATTESTATION_VERSIONS to 2.0, so an account whose acceptance predates that is
 * asked to re-accept on first load. Intended, dismissible, never blocking -- but it is a modal
 * over whatever a test is trying to click.
 */
export async function dismissReAttestation(page: Page): Promise<void> {
    const later = page.getByRole('button', { name: 'Later' });
    if (await later.isVisible().catch(() => false)) await later.click();
}

/** Register a brand-new account through the real two-step sign-up form. */
export async function signUp(
    page: Page,
    { fullName, email, age = '18_plus' }: { fullName: string; email: string; age?: '18_plus' | '13_to_17' },
): Promise<void> {
    await page.goto('/#/login');
    await page.getByRole('button', { name: 'Sign up' }).click();

    await page.getByRole('textbox', { name: /Full Name/i }).or(page.locator('input[type="text"]').first()).fill(fullName);
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('continue-button').click();

    // Step 2: age band, then the privacy acceptance the Create Account button is gated on.
    await page.locator(`input[value="${age}"]`).check();
    await page.locator('input[type="checkbox"]').first().check();
    await page.getByRole('button', { name: 'Create Account' }).click();

    await page.waitForURL(/#\/(onboarding|app|create-team)/, { timeout: 45_000 });
}

/** Sign in an existing account and land inside the app. */
export async function signIn(page: Page, email: string): Promise<void> {
    await page.goto('/#/login');
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.waitForURL(/#\/(app|onboarding)/, { timeout: 45_000 });
    await enterApp(page);
}

/**
 * `#/onboarding` is the TEAM PICKER, not the Sprint 5 age-profile bug. It asks for an explicit
 * choice even when the account holds exactly one team, because an account can hold several.
 */
export async function enterApp(page: Page): Promise<void> {
    if (page.url().includes('/onboarding')) {
        await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 30_000 });
        await page.getByTestId('team-option').first().click();
    }
    await page.waitForURL(/#\/app\//, { timeout: 45_000 });
    await dismissReAttestation(page);
}

/**
 * Walk the create-team wizard.
 *
 * The wizard's step count is not hardcoded here on purpose: it advances by clicking the
 * primary button until the terminal "Go to Dashboard" appears, filling whatever inputs are
 * visible at each step. A test that hardcodes "click Next twice" starts lying the first time
 * a step is added, and fails somewhere unrelated.
 */
export async function createTeam(
    page: Page,
    { teamName, teamNumber = '9911' }: { teamName: string; teamNumber?: string },
): Promise<void> {
    await page.goto('/#/create-team');

    for (let step = 0; step < 8; step++) {
        // Every step's acceptance checkbox, if this step has one.
        const box = page.locator('input[type="checkbox"]').first();
        if (await box.isVisible().catch(() => false)) await box.check().catch(() => {});

        const name = page.getByPlaceholder('e.g., Falcon Force');
        if (await name.isVisible().catch(() => false)) await name.fill(teamName);

        const number = page.getByPlaceholder('e.g., 12345');
        if (await number.isVisible().catch(() => false)) await number.fill(teamNumber);

        const done = page.getByRole('button', { name: 'Go to Dashboard' });
        if (await done.isVisible().catch(() => false)) {
            await done.click();
            break;
        }

        const next = page.getByRole('button', { name: /^(Next|Create Team)$/ });
        await expect(next).toBeEnabled({ timeout: 20_000 });
        await next.click();
        await page.waitForTimeout(400); // let the step transition settle before re-probing
    }

    await page.waitForURL(/#\/(app|onboarding|\/?$)/, { timeout: 45_000 });
    await enterApp(page);
}

/** Navigate to a view by its rail id and wait for the shell to agree it is on screen. */
export async function goToView(page: Page, navId: string, path: string): Promise<void> {
    await page.goto(`/#/app/${path}`);
    await page.waitForSelector(`[data-testid="nav-${navId}"][aria-current="page"]`, {
        state: 'attached',
        timeout: 30_000,
    });
    await page.waitForSelector('[aria-label="Loading view"]', { state: 'detached', timeout: 30_000 }).catch(() => {});
}
