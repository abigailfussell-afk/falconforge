/**
 * Capture every main view at 375 / 768 / 1280, headless, against the seeded LOCAL stack.
 *
 * WHY THIS EXISTS
 *
 * Sprint 5 and Sprint 6 both carry "screenshots at 375 / 768 / 1280" in their exit criteria.
 * Sprint 5 satisfied it by hand. Sprint 6 could not satisfy it AT ALL, at any width, for two
 * distinct reasons — and the one that actually cost the sprint its captures was not the
 * documented limitation:
 *
 *   - The Browser pane cannot capture while it is hidden. No pane displayed means no
 *     compositing, which means no frames: `screenshot failed: the Browser pane is not
 *     displayed`. Knowing about the width ceiling does not help with this at all.
 *   - Above ~1024px it composites an emulated viewport into its own surface without scaling
 *     up, so a 1280-wide page lands in about a fifth of the image. Correct, and unreadable.
 *
 * Playwright is headless, so the first stops applying entirely, and it takes an arbitrary
 * viewport plus `fullPage: true`, so the second does too. That turns a per-sprint manual
 * ritual into something a script can re-run.
 *
 * WHAT IT IS NOT
 *
 * It is not a substitute for opening the app and looking at it. All three defects Sprint 6
 * found in a browser — a successor dropdown offering eleven under-18s, a lapsed team's panel
 * reading "4 of 0", clumsy copy at capacity — came from poking around, not from assertions.
 * A script only checks what somebody already thought to check. Rule 10 stands.
 *
 * And Playwright's Chromium is not Safari: it emulates iOS rather than being it. Sprint 6's
 * 16px zoom floor was caught by measuring computed styles, which this does equally well, but
 * genuine Safari zoom-on-focus behaviour wants a real device before teams get a URL.
 *
 * USAGE
 *
 *   npx supabase start
 *   node scripts/seed-review-states.mjs      # Sprint 6's seeder — do not write a second one
 *   npm run dev -- --port 5188               # must be pointed at the LOCAL stack
 *   npm run capture
 *
 * Output lands in screenshots/<width>w/<view>.png (gitignored; CI uploads it as an artifact).
 */
import { chromium } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const APP = process.env.CAPTURE_BASE_URL ?? 'http://localhost:5188';
const OUT = process.env.CAPTURE_OUT_DIR ?? 'screenshots';

/** Iron Falcons' admin: 12 of 15 seats, and the platform operator. See the seeder. */
const EMAIL = process.env.CAPTURE_EMAIL ?? 'reviewer@falconforge.test';
const PASSWORD = process.env.CAPTURE_PASSWORD ?? 'ForgeReview!2026-local';

const WIDTHS = [375, 768, 1280];

/**
 * `nav` is the navigation id from `src/lib/navigation.ts`, which is not always the path
 * segment — the sprint board is `kanban` at `board`. `null` means the view has no rail entry
 * (Edit Profile is reached from the user card), so there is no aria-current to wait on.
 */
const VIEWS = [
    { file: 'dashboard', hash: '#/app/dashboard', nav: 'dashboard' },
    { file: 'sprint-board', hash: '#/app/board', nav: 'kanban' },
    { file: 'checklist', hash: '#/app/checklist', nav: 'checklist' },
    { file: 'scouting', hash: '#/app/scouting', nav: 'scouting' },
    { file: 'match-planner', hash: '#/app/planner', nav: 'planner' },
    { file: 'admin-console', hash: '#/app/admin', nav: 'admin' },
    // Optional: the operator view is only in the nav for a platform operator, and the capture
    // account is not always one (the demo team's coach is not). Skipped rather than failed.
    { file: 'operator-console', hash: '#/app/operator', nav: 'operator', optional: true },
    { file: 'edit-profile', hash: '#/app/profile', nav: null },
];

/**
 * The backend guard.
 *
 * `.env.local` points at the HOSTED project, and `.env.development.local` — which points dev
 * at the local stack — is gitignored. Delete it, or restart the server without it, and
 * localhost silently starts talking to production. The Sprint 7 hand-off calls checking this
 * "the two-second check" and it is right, but a two-second check that depends on somebody
 * remembering is not a check.
 *
 * So this refuses at the network layer rather than trusting configuration: any request to a
 * hosted Supabase host is aborted and the run fails naming it, and the run also fails if it
 * never saw a request to the local stack at all — because "no requests to production" is also
 * true of an app that is talking to nothing.
 */
const LOCAL_SUPABASE = /^(127\.0\.0\.1|localhost)$/;
const HOSTED_SUPABASE = /supabase\.(co|in)$/;

async function dismissReAttestation(page) {
    /*
     * Sprint 6 rewrote all three legal documents and raised ATTESTATION_VERSIONS to 2.0, so
     * every existing account is asked to re-accept on first load. That is intended, not a bug:
     * it is dismissible, it never blocks the app, and the previous acceptance is kept. For a
     * screenshot run it is a modal sitting on top of the view being captured, so take the
     * documented "Later" out of the way.
     */
    const later = page.getByRole('button', { name: 'Later' });
    if (await later.isVisible().catch(() => false)) {
        await later.click();
        await later.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    }
}

async function settle(page, view) {
    if (view.nav) {
        // The shell agreeing about which view is on screen is the same property the routing
        // tests assert. `attached` rather than `visible`: below lg the rail is a closed drawer.
        await page.waitForSelector(`[data-testid="nav-${view.nav}"][aria-current="page"]`, {
            state: 'attached',
            timeout: 20_000,
        });
    }
    // Every feature is behind React.lazy; RouteFallback is the Suspense spinner.
    await page
        .waitForSelector('[aria-label="Loading view"]', { state: 'detached', timeout: 20_000 })
        .catch(() => {});
    // Let the store's first paint land rather than catching a half-rendered list.
    await page.waitForLoadState('networkidle').catch(() => {});
}

async function main() {
    await rm(OUT, { recursive: true, force: true });

    const browser = await chromium.launch();
    const context = await browser.newContext();

    let sawLocal = false;
    let sawHosted = null;
    await context.route('**/*', (route) => {
        let host;
        try {
            host = new URL(route.request().url()).hostname;
        } catch {
            return route.continue();
        }
        if (HOSTED_SUPABASE.test(host)) {
            sawHosted = host;
            return route.abort();
        }
        if (LOCAL_SUPABASE.test(host) && route.request().url().includes(':54321')) sawLocal = true;
        return route.continue();
    });

    const page = await context.newPage();
    page.on('console', (m) => {
        if (m.type() === 'error') console.warn(`  [console.error] ${m.text().slice(0, 200)}`);
    });

    console.log(`Signing in to ${APP} as ${EMAIL}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });

    await page.getByTestId('email-input').fill(EMAIL);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();

    /*
     * Sign-in lands on #/onboarding, which is the TEAM PICKER, not the age-profile screen the
     * Sprint 5 parking-lot item describes. It requires an explicit choice even when the account
     * has exactly one team, because an account can belong to several. Deliberate, so the script
     * makes the choice rather than the app being changed to guess.
     */
    await page.waitForURL(/#\/(app|onboarding)\b/, { timeout: 30_000 });
    if (page.url().includes('/onboarding')) {
        // Wait for the picker itself, not just the URL: probing visibility the instant the
        // route changes finds nothing rendered yet and silently skips the click.
        await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 30_000 });
        await page.getByTestId('team-option').first().click();
    }
    await page.waitForURL(/#\/app\//, { timeout: 30_000 });

    if (sawHosted) {
        throw new Error(
            `Refusing to capture: the app under test called the HOSTED backend (${sawHosted}). ` +
                'Check .env.development.local exists and points at 127.0.0.1:54321, and restart ' +
                'the dev server after touching env files.',
        );
    }
    if (!sawLocal) {
        throw new Error(
            'Refusing to capture: no request to the local stack on :54321 was observed, so the ' +
                'app is not talking to the seeded database. Is `supabase start` running?',
        );
    }
    console.log('Backend verified: local stack on :54321, no hosted traffic.\n');

    await dismissReAttestation(page);

    for (const width of WIDTHS) {
        const dir = path.join(OUT, `${width}w`);
        await mkdir(dir, { recursive: true });
        // 812 is the iPhone X viewport height the 375 column is standing in for; fullPage
        // captures past it anyway, but a realistic fold decides what lazy content mounts.
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });

        for (const view of VIEWS) {
            if (view.optional && !(await page.locator(`[data-testid="nav-${view.nav}"]`).count())) {
                console.log(`  ${width}w  ${view.file} — skipped (not available to this account)`);
                continue;
            }
            await page.goto(`${APP}/${view.hash}`, { waitUntil: 'domcontentloaded' });
            await settle(page, view);
            await dismissReAttestation(page);
            const file = path.join(dir, `${view.file}.png`);
            await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
            console.log(`  ${width}w  ${view.file}`);
        }
    }

    // The signed-out view a beta coach meets first, and the only one the widths above skip.
    await context.clearCookies();
    for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.goto(`${APP}/#/`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.screenshot({
            path: path.join(OUT, `${width}w`, 'landing.png'),
            fullPage: true,
            animations: 'disabled',
        });
        console.log(`  ${width}w  landing`);
    }

    await browser.close();
    console.log(`\nCaptured ${(VIEWS.length + 1) * WIDTHS.length} screenshots into ${OUT}/`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
