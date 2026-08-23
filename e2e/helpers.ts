import { expect, type Page, type BrowserContext } from '@playwright/test';
// The version number has exactly one home (`attestation-versions.ts`); a copy here would be the
// second source of truth that the signup-attestation migration exists because of.
import { ATTESTATION_VERSIONS } from '../src/lib/attestation-versions';

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

/**
 * The local stack's admin API, and the mailbox in front of it.
 *
 * The service-role key is Supabase's published local-development demo key — identical on every
 * machine and worthless anywhere else — pinned here for the same reason the anon key is pinned
 * in `playwright.config.ts`: an env file this pack does not control is how a smoke run ends up
 * against production. `assertLocalStack` below is the guard that makes the pinning safe rather
 * than merely convenient.
 */
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SERVICE_ROLE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const MAILPIT_URL = 'http://127.0.0.1:54324';

/** A service-role key is destructive by definition; it never leaves 127.0.0.1. */
function assertLocalStack(url: string): void {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(`Refusing to use the admin API against "${host}".`);
    }
}

/**
 * Create an account that is already confirmed, and sign it in.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `signUp`. `enable_confirmations` is now `true` locally
 * because production has always had it on (see the note in `supabase/config.toml`), so walking
 * the sign-up form no longer produces a session — it produces an email. Fifteen of this pack's
 * flows do not care how the account came to exist; they care about invites, meetings, sync and
 * seasons. Making each of them collect a message would cost every spec a mailbox round trip to
 * prove the same thing once, on a pack Sprint 7 already had to cap at four workers.
 *
 * `email_confirm: true` is what a confirmed account looks like to GoTrue, and the metadata is
 * exactly what the real form sends — `handle_new_user` reads it to build the `users` row, so an
 * account created here reaches the app with the same `full_name`, the same `age_classification`
 * and the same signup attestation as one created through the UI.
 *
 * `registration.spec.ts` is the one place that still walks the form and the mailbox, because
 * that is the flow every beta team runs exactly once with nobody to help them.
 */
export async function createConfirmedAccount(
    { fullName, email, age = '18_plus' }: { fullName: string; email: string; age?: '18_plus' | '13_to_17' },
): Promise<void> {
    assertLocalStack(SUPABASE_URL);

    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            password: PASSWORD,
            email_confirm: true,
            /*
             * EXACTLY what the real form sends, `privacy_version` included.
             *
             * `handle_new_user` records the signup consent at the version the metadata names
             * (migration 20260821000000), falling back to '1.0' for a client that did not say —
             * and '1.0' is out of date, so an account created without it meets "We've updated our
             * legal documents" on its first screen. The first draft of this helper omitted the
             * field and eleven specs timed out behind that modal, which is the same symptom the
             * migration was written for, arriving from a third direction.
             */
            user_metadata: {
                full_name: fullName,
                age_classification: age,
                privacy_accepted: true,
                privacy_version: ATTESTATION_VERSIONS.privacy_and_guidelines,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`Could not create ${email}: ${response.status} ${await response.text()}`);
    }
}

/**
 * Register through the real two-step form and come back with a session.
 *
 * With confirmations on there is no session at the end of the form, so this is now the whole
 * production round trip: submit, land on "check your email", read the message Mailpit actually
 * received, and follow the link in it. Used by `registration.spec.ts`; everything else uses
 * {@link createConfirmedAccount} and {@link signIn}.
 */
export async function signUpThroughEmail(
    page: Page,
    account: { fullName: string; email: string; age?: '18_plus' | '13_to_17' },
): Promise<void> {
    await submitSignUpForm(page, account);
    await page.goto(await confirmationLinkFor(account.email));
    await page.waitForURL(/#\/(onboarding|app|create-team)/, { timeout: 45_000 });
}

/**
 * The form half of the round trip, on its own.
 *
 * Separate from the link half so a test can assert what sits BETWEEN them — which is the whole
 * production behaviour this pack was blind to until 2026-08-22.
 */
export async function submitSignUpForm(
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
}

/**
 * The confirmation link the stack actually sent, out of the mailbox it actually sent it to.
 *
 * Polled rather than slept on: GoTrue sends after the insert commits, so the message appears a
 * beat after the form does. Read as raw source and matched on the href, because the templated
 * HTML is a repo file that can change without this needing to.
 */
export async function confirmationLinkFor(email: string, timeoutMs = 30_000): Promise<string> {
    assertLocalStack(MAILPIT_URL);

    /*
     * `expect.poll` rather than a deadline this function measures for itself.
     *
     * The first version measured its own timeout and the harness ratchet refused it: e2e specs
     * have had two timezone defects from Node's clock, so the count only goes down. Polling is
     * Playwright's own job anyway, and it reports the last value it saw when it gives up.
     */
    let messageId: string | undefined;
    await expect
        .poll(
            async () => {
                const search = await fetch(
                    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
                );
                const { messages = [] } = (await search.json()) as { messages?: { ID: string }[] };
                messageId = messages[0]?.ID;
                return messages.length;
            },
            { timeout: timeoutMs, message: `No confirmation email for ${email}` },
        )
        .toBeGreaterThan(0);

    const source = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`)).json()) as {
        HTML?: string;
        Text?: string;
    };
    const body = `${source.HTML ?? ''}
${source.Text ?? ''}`;

    /*
     * Both shapes, because the link's form is a live decision rather than a constant: today it is
     * GoTrue's own `/auth/v1/verify?...`, and the deferred auth-email work would replace it with a
     * `{{ .TokenHash }}` link to our own route. A matcher that knew only one would fail as "no
     * confirmation email" on a change that sent a perfectly good one.
     */
    const match = body.match(/https?:\/\/[^\s"'<>]*(?:auth\/v1\/verify|token_hash=)[^\s"'<>]*/);
    if (!match) throw new Error(`Message for ${email} carried no confirmation link:
${body.slice(0, 500)}`);

    return match[0].replace(/&amp;/g, '&');
}

/**
 * The RECOVERY link out of Mailpit, as distinct from the confirmation one.
 *
 * A separate function rather than a parameter on {@link confirmationLinkFor}, because the two
 * are looking for different things and a shared matcher would find whichever email happened to
 * arrive first. An account that has just been created has BOTH in its mailbox.
 *
 * The recovery link is `type=recovery` in GoTrue's verify URL; the confirmation is `type=signup`.
 */
export async function recoveryLinkFor(email: string, timeoutMs = 30_000): Promise<string> {
    assertLocalStack(MAILPIT_URL);

    let link: string | undefined;
    await expect
        .poll(
            async () => {
                const search = await fetch(
                    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
                );
                const { messages = [] } = (await search.json()) as { messages?: { ID: string }[] };

                for (const message of messages) {
                    const source = (await (
                        await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
                    ).json()) as { HTML?: string; Text?: string };
                    const body = `${source.HTML ?? ''}
${source.Text ?? ''}`;
                    const match = body.match(
                        /https?:\/\/[^\s"'<>]*(?:type=recovery|token_hash=)[^\s"'<>]*/,
                    );
                    if (match) {
                        link = match[0].replace(/&amp;/g, '&');
                        return 1;
                    }
                }
                return 0;
            },
            { timeout: timeoutMs, message: `No password-recovery email for ${email}` },
        )
        .toBeGreaterThan(0);

    return link!;
}

/**
 * A confirmed account, signed in, sitting wherever a fresh account lands.
 *
 * The workhorse for every spec whose subject is not registration. It stops short of
 * {@link enterApp} on purpose: a brand-new account has no team, so the picker has nothing to
 * pick and these specs go on to `createTeam` or to a join code.
 */
export async function registerAccount(
    page: Page,
    { fullName, email, age = '18_plus' }: { fullName: string; email: string; age?: '18_plus' | '13_to_17' },
): Promise<void> {
    await createConfirmedAccount({ fullName, email, age });

    await page.goto('/#/login');
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
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
/**
 * A five-digit team number for a test team.
 *
 * WHY RANDOM, AFTER TWO DETERMINISTIC SCHEMES FAILED. D3 added
 * `UNIQUE (program, team_number)`, and the default used to be `'9911'` for every spec — which
 * fails as the WRONG error, because `create_team_as_admin` answers a taken number with "ask
 * their admin for an invite code" rather than an error, so the wizard sits on step 2 and the
 * report says `locator.waitFor: Timeout 45000ms exceeded` with nothing about numbers in it.
 *
 *   1. `TEST_PARALLEL_INDEX` + counter. Wrong: the parallel index is a SLOT between 0 and
 *      workers-1 and is REUSED, so chromium's worker 0 and the mobile project's worker 0
 *      produced the same numbers over the same specs. Four mobile failures.
 *   2. `TEST_WORKER_INDEX` + counter. Unique within a run, and still wrong ACROSS runs: the
 *      pack never deletes its teams (no globalSetup, no reset), so every run starts its
 *      counter at 1 again and collides with what the last run left behind. That is a suite
 *      that passes once on a clean database and fails on the second attempt, which is
 *      precisely the shape `onboarding-gate.db.test.ts` hit on the same afternoon.
 *
 * So the number is random and the COLLISION IS HANDLED rather than avoided — see `createTeam`,
 * which recognises the taken-number screen and tries another. That is what makes randomness
 * acceptable here: this repo's rule against `Math.random()` in fixtures is about collisions
 * that surface as an unreproducible red, and a collision this one causes surfaces as one extra
 * click.
 *
 * 50000-94999 keeps it clear of `seed-review-states.mjs` (12345 and below) and of the db
 * fixtures (30001+), and stays inside five digits — FTC numbers are 1-5 digits and WALK-A-06
 * caps the scouting form there.
 */
export function uniqueTeamNumber(): string {
    return String(50_000 + Math.floor(Math.random() * 45_000));
}

export async function createTeam(
    page: Page,
    { teamName, teamNumber }: { teamName: string; teamNumber?: string },
): Promise<void> {
    await page.goto('/#/create-team');

    const done = page.getByRole('button', { name: 'Go to Dashboard' });
    const next = page.getByRole('button', { name: /^(Next|Create Team)$/ });
    const taken = page.getByTestId('team-number-taken');

    /*
     * Mutable, because a collision means trying a different one (D3). A caller who passed an
     * explicit number gets exactly that number and no retry — a spec that asserts on a
     * specific team number is asserting on it deliberately.
     */
    let number = teamNumber ?? uniqueTeamNumber();
    const fixedNumber = teamNumber !== undefined;
    let collisions = 0;

    for (let step = 0; step < 12; step++) {
        /*
         * Wait for the step to SETTLE before touching it, rather than sleeping a fixed 400ms.
         *
         * While `create_team_as_admin` is in flight the primary button renders a spinner and
         * no label, so it matches neither locator -- there is a real window in which the
         * wizard shows nothing this helper can act on. A fixed sleep lost that race as soon as
         * the pack ran its specs in parallel and the machine got busy, and it failed as
         * "element(s) not found" on a button that was simply still loading.
         */
        const state = await Promise.race([
            done.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'done' as const),
            next.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'next' as const),
            taken.waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'taken' as const),
        ]);

        if (state === 'done') {
            await done.click();
            break;
        }

        /*
         * The number was already registered (D3). Go back and pick another — which also means
         * every full run of this pack exercises that screen, rather than it being covered only
         * by a unit test.
         */
        if (state === 'taken') {
            if (fixedNumber || ++collisions > 3) {
                throw new Error(
                    `createTeam: team number ${number} is already registered` +
                        (fixedNumber ? ' (passed explicitly by the spec)' : ' after 3 retries'),
                );
            }
            number = uniqueTeamNumber();
            await page.getByTestId('taken-back').click();
            continue;
        }

        // Every step's acceptance checkbox, if this step has one.
        const box = page.locator('input[type="checkbox"]').first();
        if (await box.isVisible().catch(() => false)) await box.check().catch(() => {});

        const name = page.getByPlaceholder('e.g., Falcon Force');
        if (await name.isVisible().catch(() => false)) await name.fill(teamName);

        const numberField = page.getByPlaceholder('e.g., 12345');
        if (await numberField.isVisible().catch(() => false)) await numberField.fill(number);

        await expect(next).toBeEnabled({ timeout: 20_000 });
        await next.click();
    }

    await page.waitForURL(/#\/(app|onboarding|\/?$)/, { timeout: 45_000 });
    await enterApp(page);
}

/** Navigate to a view by its rail id and wait for the shell to agree it is on screen. */
export async function goToView(page: Page, navId: string, path: string): Promise<void> {
    await page.goto(`/#/app/${path}`);
    // The shell first. `page.goto` is a full document load, so the app boots from scratch --
    // restoring the session, hydrating the store -- and asserting on a nav item before the
    // shell exists asks a question the app has not finished answering.
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });
    await page.waitForSelector(`[data-testid="nav-${navId}"][aria-current="page"]`, {
        state: 'attached',
        timeout: 30_000,
    });
    await page.waitForSelector('[aria-label="Loading view"]', { state: 'detached', timeout: 30_000 }).catch(() => {});
}

/**
 * Wait until the offline queue has drained.
 *
 * Every write in this app is queued and pushed in the background, so "I pressed Save" and
 * "the server has it" are different moments. Most flows do not care. Check-in does: the code
 * only resolves once the meeting that owns it has actually landed, and a test that checks in
 * the instant after creating an event is racing the drain — which is how the smoke pack found
 * that the client blamed the CODE for the server simply being behind.
 *
 * Asserted on the sync indicator rather than on a sleep, because the indicator is the thing a
 * coach reads for the same answer.
 */
export async function waitForSync(page: Page): Promise<void> {
    const status = page.getByTestId('sync-status');

    /*
     * WAIT FOR "pending" TO APPEAR BEFORE WAITING FOR IT TO GO.
     *
     * `queueForSync` is fire-and-forget — the store action returns before the IndexedDB write
     * lands and before `pendingChanges` updates — so for a tick or two after Save the
     * indicator still reads "Live". The first draft of this helper asserted only that it read
     * "Live", which is true in that gap and therefore asserted nothing at all: the check-in
     * that followed raced the drain and lost, and the test failed on the symptom (`unknown
     * code`) rather than on the wait.
     *
     * Tolerating a miss on the first wait is deliberate. If the drain is quick enough that
     * "pending" never renders, the work is already done and there is nothing to wait for.
     */
    await status
        .filter({ hasText: /pending/i })
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});

    await expect(status).not.toContainText(/pending/i, { timeout: 45_000 });
    await expect(status).toContainText(/Live|Synced/i, { timeout: 45_000 });
}
