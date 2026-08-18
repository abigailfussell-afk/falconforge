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
 *   npm run capture                          # builds and serves the app itself
 *
 * NO DEV SERVER. This used to say `npm run dev -- --port 5188` and capture whatever that was
 * serving, which is how it came to produce images of a layout the build did not have — twice in
 * one day in Sprint 8, because a dev server keeps serving the stylesheet it generated at
 * startup. It builds and serves its own bundle now, on port 5197, and shuts it down afterwards.
 *
 * Output lands in screenshots/<width>w/<view>.png (gitignored). This is a LOCAL command: no
 * workflow runs it and nothing uploads the images. The line here used to claim CI uploaded them
 * as an artifact, which was never true — a note about a fix for a stale-verification bug, which
 * had itself gone stale. Only `test:e2e` uploads anything, and only its own report on failure.
 */
import { chromium } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

/*
 * THIS SCRIPT BUILDS AND SERVES ITS OWN BUNDLE. It used to point at whatever dev server the
 * developer had running, and that is how it lied.
 *
 * A dev server started before a `tailwind.config.js` change keeps serving the stylesheet it
 * generated at startup. The class is in the JSX and missing from the CSS, so the capture comes
 * out as a set of images in which the layout has silently collapsed -- which looks exactly like
 * a responsive bug, and sends you to read layout code that is fine. It cost twenty minutes in
 * Sprint 8, then did it again the same day over a `translate-x-0` that had never been emitted.
 *
 * The smoke pack has never had this problem because it builds. So does this now: a fresh
 * `npm run build`, served by `vite preview` on its own port, torn down at the end. The captures
 * are then evidence about a BUILD, which is the only thing they were ever supposed to be
 * evidence about.
 *
 * `CAPTURE_BASE_URL` still overrides, for pointing at something already running -- but it opts
 * out of the guarantee, so it says so.
 */
const OWN_SERVER_PORT = Number(process.env.CAPTURE_PORT ?? 5197);
const EXTERNAL_APP = process.env.CAPTURE_BASE_URL ?? null;
const APP = EXTERNAL_APP ?? `http://127.0.0.1:${OWN_SERVER_PORT}`;
const OUT = process.env.CAPTURE_OUT_DIR ?? 'screenshots';

/*
 * The local stack, pinned here rather than read from an env file.
 *
 * `.env.local` points at the HOSTED project and `.env.development.local` is gitignored, so a
 * build that inherits the ambient environment can silently capture production. These are
 * Supabase's published local-development demo keys: identical on every machine, worthless
 * anywhere else. The network guard below is the second line of defence, not the first.
 */
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

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
    /*
     * Sprint 8. The three meetings views that need no meeting id; the four that DO are
     * captured after this loop, because the id has to be read out of the running app.
     *
     * `checkin` carries `nav: null`: it lives at `#/app/checkin`, outside `#/app/meetings`,
     * so the Meetings rail item is not `aria-current` there and waiting for it would hang.
     */
    { file: 'meetings', hash: '#/app/meetings', nav: 'meetings' },
    {
        file: 'meetings-calendar',
        hash: '#/app/meetings',
        nav: 'meetings',
        click: 'Calendar',
        marker: '[data-testid="upcoming-events"], [data-testid="student-schedule"]',
    },
    {
        file: 'attendance-summary',
        hash: '#/app/meetings/summary',
        nav: 'meetings',
        marker: 'text=Attendance summary',
    },
    { file: 'check-in-code', hash: '#/app/checkin', nav: null, marker: '[data-testid="code-display"]' },
    { file: 'admin-console', hash: '#/app/admin', nav: 'admin' },
    /*
     * Sprint 9. The capture account is a coach who is ALSO a parent — the seeder gives
     * `guardian@falconforge.test` the children, and Iron Falcons' admin sees the managed
     * request in the console above. `optional` because the rail entry only appears for an
     * account holding a child profile, and the demo team's coach does not.
     */
    { file: 'guardian-children', hash: '#/app/guardian', nav: 'guardian', optional: true },
    // Optional: the operator view is only in the nav for a platform operator, and the capture
    // account is not always one (the demo team's coach is not). Skipped rather than failed.
    { file: 'operator-console', hash: '#/app/operator', nav: 'operator', optional: true },
    // The one view with no `requiresTeam`, so it is in the rail for every account -- including
    // the guardian, for whom it is one of only two entries.
    { file: 'getting-started', hash: '#/app/help', nav: 'help' },
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
    /*
     * A view that names a marker waits for THAT, because `nav` is not always enough.
     *
     * `page.goto` between two URLs differing only in their hash does NOT reload the document
     * and does not even re-run the router synchronously, so the next screenshot can catch the
     * PREVIOUS view still on screen. The first run of this script proved it: `event-detail`
     * came out as a picture of the attendance summary. The event routes all sit under the same
     * `nav: meetings` rail item, so `aria-current` cannot tell them apart either.
     */
    if (view.marker) {
        await page.waitForSelector(view.marker, { state: 'attached', timeout: 20_000 });
    }
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

/** Run a command to completion, inheriting stdio, and reject on a non-zero exit. */
function run(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
        child.on('error', reject);
        child.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)),
        );
    });
}

/**
 * Build the app and serve it, returning a teardown.
 *
 * Waits for the server to actually answer rather than sleeping: `vite preview` prints its
 * banner before it is listening, and a fixed delay is the thing that turns a slow machine into
 * a mysterious failure.
 */
async function startOwnServer() {
    console.log('Building the app (captures are evidence about a build, not about a dev server)');
    await run('npm', ['run', 'build'], {
        VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
        VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    });

    console.log(`Serving the build on ${APP}`);
    const server = spawn(
        'npm',
        ['run', 'preview', '--', '--port', String(OWN_SERVER_PORT), '--strictPort'],
        { stdio: 'ignore', shell: true, detached: process.platform !== 'win32', env: { ...process.env } },
    );

    const deadline = Date.now() + 120_000;
    for (;;) {
        if (Date.now() > deadline) {
            server.kill();
            throw new Error(`preview server did not answer on ${APP} within 120s`);
        }
        try {
            const res = await fetch(APP, { method: 'HEAD' });
            if (res.ok || res.status === 404) break;
        } catch {
            // Not listening yet.
        }
        await new Promise((r) => setTimeout(r, 500));
    }

    /*
     * Kill the TREE, not the process we spawned.
     *
     * `shell: true` means the child is a shell, which spawns npm, which spawns vite. Killing
     * the top of that leaves the actual server listening -- verified: after the first version
     * of this teardown, port 5197 still answered 200. The next run then dies on `--strictPort`,
     * which is the kind of papercut that makes people stop running a script.
     */
    return () => {
        if (server.exitCode !== null) return;
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            try {
                process.kill(-server.pid, 'SIGTERM');
            } catch {
                server.kill('SIGTERM');
            }
        }
    };
}

async function main() {
    await rm(OUT, { recursive: true, force: true });

    let stopServer = () => {};
    if (EXTERNAL_APP) {
        console.warn(
            [
                `CAPTURE_BASE_URL is set (${EXTERNAL_APP}), so this run captures whatever that`,
                '  server is serving. A dev server started before a tailwind.config change keeps',
                '  serving the stylesheet it generated at startup, and the images then show a',
                '  layout the build does not have. Unset it to capture a fresh build.',
            ].join('\n'),
        );
    } else {
        stopServer = await startOwnServer();
    }
    try {

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
            // A view that is a TAB of another route rather than a route of its own -- the
            // calendar is the meetings page with its toggle flipped, and there is no URL for
            // it to have. One click is cheaper than inventing one.
            if (view.click) {
                await page.getByRole('button', { name: view.click, exact: true }).click();
                await page.waitForSelector('[data-testid="calendar-grid"]', { timeout: 15_000 });
            }
            const file = path.join(dir, `${view.file}.png`);
            await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
            console.log(`  ${width}w  ${view.file}`);
        }
    }

    /*
     * The meetings views that hang off a specific event.
     *
     * Their URLs contain a uuid, so they cannot be listed as constants -- the id is read out
     * of the running app, from the first row of the schedule. A team with no meetings simply
     * skips them rather than failing: the demo seed has them, a freshly registered team does
     * not, and both are legitimate accounts to capture from.
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${APP}/#/app/meetings`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="app-nav"]', { timeout: 45_000 }).catch(() => {});
    /*
     * Scoped to the LIST, not to the page.
     *
     * A bare `a[href*="#/app/meetings/"]` also matches the "Attendance" link in the header,
     * which precedes the list in the DOM -- so the first run of this took `summary` as a
     * meeting id and then spent twenty seconds waiting for a roster link on the summary page.
     */
    const firstEvent = await page
        .locator('[data-testid="upcoming-events"] a[href*="#/app/meetings/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);
    const meetingId = firstEvent?.split('#/app/meetings/')[1]?.split('/')[0] ?? null;

    if (!meetingId) {
        console.log('  (no meetings on this account -- event detail, roster and poster skipped)');
    } else {
        const eventViews = [
            { file: 'event-detail', hash: `#/app/meetings/${meetingId}`, marker: '[data-testid="event-detail"]' },
            {
                file: 'attendance-roster',
                hash: `#/app/meetings/${meetingId}/roster`,
                marker: '[data-testid="attendance-roster"]',
            },
            { file: 'checkin-poster', hash: `#/app/meetings/${meetingId}/poster`, marker: '.print-surface' },
        ];
        for (const width of WIDTHS) {
            await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
            for (const view of eventViews) {
                /*
                 * A full reload rather than a hash change, so each of these is captured the way
                 * a BOOKMARK reaches it -- cold, with the store rehydrating from IndexedDB.
                 * That is what surfaced the pre-hydration "That event is not on this device"
                 * flash these routes now guard against; capturing them warm would have hidden
                 * it again.
                 */
                await page.goto(`${APP}/${view.hash}`, { waitUntil: 'domcontentloaded' });
                await page.reload({ waitUntil: 'domcontentloaded' });
                await settle(page, view);
                await dismissReAttestation(page);
                // The QR is generated asynchronously from a lazily-imported module, so a
                // screenshot taken too early catches a spinner where the code should be.
                await page
                    .waitForSelector('img[alt*="QR code"]', { timeout: 15_000 })
                    .catch(() => {});
                await page.screenshot({
                    path: path.join(OUT, `${width}w`, `${view.file}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
                console.log(`  ${width}w  ${view.file}`);
            }
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
    console.log(`\nCaptured into ${OUT}/ at ${WIDTHS.join(' / ')}`);
    } finally {
        stopServer();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
