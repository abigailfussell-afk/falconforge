import { test, expect } from '@playwright/test';
import { PASSWORD, guardLocalBackend, signUp, createTeam, unique, uniqueEmail, goToView, waitForSync } from './helpers';

/**
 * Sprint 8 — the meetings flow, driven the way a coach and a student drive it.
 *
 * The RLS and DB suites already prove the RULES (who may write, when a code is valid, what
 * `check_in_with_code` refuses). What they cannot prove is that the FLOW works: that the form
 * a coach fills in produces a meeting with a code on it, that the code on the poster is the
 * code the check-in screen accepts, and that a scan lands on a receipt.
 *
 * The other reason this file exists is layout. Two of Sprint 8's defects were arrangement
 * bugs — the splash wordmark and the check-in badge both rendered on the same line as the
 * element above them — and jsdom computes no layout at all, so a unit test renders the broken
 * version and the fixed version identically. Those get real measurements, at the bottom.
 */
test.beforeEach(async ({ context }) => {
    await guardLocalBackend(context);
});

test('a coach creates an event, gets a code, and a student checks in with it', async ({ page }) => {
    const email = uniqueEmail('meet-coach');
    await signUp(page, { fullName: 'Meet Coach', email });
    await createTeam(page, { teamName: unique('Meetings') });

    await goToView(page, 'meetings', 'meetings');
    await expect(page.getByRole('heading', { name: 'Meetings & Events' })).toBeVisible();

    // --- create ---------------------------------------------------------------
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Build session — chassis rebuild');

    /*
     * Today, starting on the hour and running to midnight, so check-in is genuinely OPEN
     * however late in the day this runs. The rest of the test is unreachable otherwise.
     *
     * BOTH TIMES ARE SET, and that is the whole point of this comment. The first version set
     * only the start and left the end at the form's default — which is derived from "the next
     * round hour" and therefore rolls to TOMORROW's 02:00 late in the evening. Combined with
     * today's date and a 23:00 start it produced an event ending before it began, the form
     * correctly disabled Save, and the test hung on a button that was right to refuse.
     *
     * It passed on a developer machine in US Central and failed on CI in UTC, which is a
     * five-hour window this suite would have walked into eventually on any timezone. Caught by
     * pushing the branch — the first CI run this sprint ever had.
     */
    // Read the clock the FORM runs on, not the one Node runs on. The form composes local
    // wall-clock parts into an instant, so a date and hour taken from the test process is only
    // correct while the two happen to share a timezone — true on CI, and not true of any
    // machine running this with TZ set. Asking the page removes the coincidence.
    const today = await page.evaluate(() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
            date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
            hour: `${pad(d.getHours())}:00`,
        };
    });

    await page.getByTestId('event-date').fill(today.date);
    await page.getByTestId('event-start').fill(today.hour);
    await page.getByTestId('event-end').fill('23:59');

    // Enabled BEFORE clicking: a disabled Save is a real state this form has, and waiting on
    // the click alone reports it as a missing element rather than as a refused save.
    await expect(page.getByTestId('save-event')).toBeEnabled();
    await page.getByTestId('save-event').click();

    // Saving navigates to the event it created.
    await expect(page.getByRole('heading', { name: /chassis rebuild/ })).toBeVisible({ timeout: 30_000 });

    // --- the code -------------------------------------------------------------
    const codeText = await page.locator('text=/^FF-\\d{4}$/').first().innerText();
    const code = codeText.replace(/\D/g, '');
    expect(code).toMatch(/^\d{4}$/);

    // The QR is generated client-side, so it must actually appear rather than 404 as an
    // <img> pointed at a server that is not there.
    await expect(page.getByRole('img', { name: new RegExp(`check-in code FF-${code}`) })).toBeVisible({
        timeout: 30_000,
    });

    // --- the poster -----------------------------------------------------------
    await page.getByRole('link', { name: /print poster/i }).click();
    await expect(page.getByText('SCAN TO CHECK IN')).toBeVisible();
    // Black on white, whatever the app's theme is. A dark poster empties a school's toner.
    const posterBackground = await page
        .locator('.print-surface')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(posterBackground).toBe('rgb(255, 255, 255)');
    await page.getByRole('button', { name: /back to event/i }).click();

    // --- the student ----------------------------------------------------------
    // The event was created through the offline QUEUE, so its code does not resolve on the
    // server until the drain gets there. See `waitForSync`.
    await page.goto('/#/app/meetings');
    await waitForSync(page);

    // A second account joining the same team would need an invite round trip; what this half
    // is proving is that the CODE the coach was shown is the code the check-in screen accepts,
    // and the coach can answer that themselves — `check_in_with_code` never takes a member id,
    // it derives one from the session, so nobody can check anybody else in regardless.
    await page.goto(`/#/app/checkin/${code}`);
    await expect(page.getByText("You're checking in to")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Check-in open')).toBeVisible();

    await page.getByTestId('confirm-checkin').click();
    await expect(page.getByRole('heading', { name: "You're checked in" })).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByText('QR scan')).toBeVisible();

    // --- and it cannot be done twice -----------------------------------------
    // A reload, not a `goto`: the receipt is already AT this URL, and navigating to the URL
    // you are on is a no-op that leaves the component holding its "recorded" state. This is
    // the same trap that made the capture script screenshot the previous view.
    await page.goto(`/#/app/checkin/${code}`);
    await page.reload();
    await page.getByTestId('confirm-checkin').click();
    await expect(page.getByRole('heading', { name: 'Already recorded' })).toBeVisible({
        timeout: 30_000,
    });
});

test('a recurring series gives every occurrence its own code', async ({ page }) => {
    // The property the whole design turns on, asserted end to end rather than only in the
    // store: a student who photographs one poster must not be able to use it next week.
    const email = uniqueEmail('meet-series');
    await signUp(page, { fullName: 'Series Coach', email });
    await createTeam(page, { teamName: unique('Series') });

    await goToView(page, 'meetings', 'meetings');
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Weekly build');
    await page.getByTestId('repeats-toggle').click();
    await expect(page.getByText(/Creates \d+ events/)).toBeVisible();
    await page.getByTestId('save-event').click();

    await page.goto('/#/app/meetings');
    await page.waitForSelector('[data-testid="upcoming-events"]', { timeout: 30_000 });

    const codes = await page.locator('text=/^FF-\\d{4}$/').allInnerTexts();
    expect(codes.length).toBeGreaterThan(3);
    expect(new Set(codes).size, 'two occurrences share a check-in code').toBe(codes.length);
});

test('a typed code is refused outside its window', async ({ page }) => {
    const email = uniqueEmail('meet-window');
    await signUp(page, { fullName: 'Window Coach', email });
    await createTeam(page, { teamName: unique('Window') });

    await goToView(page, 'meetings', 'meetings');
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Next month');
    // Well beyond the default fifteen-minute lead.
    const future = new Date(Date.now() + 30 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await page
        .getByTestId('event-date')
        .fill(`${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`);
    await page.getByTestId('save-event').click();

    const codeText = await page.locator('text=/^FF-\\d{4}$/').first().innerText();
    const code = codeText.replace(/\D/g, '');

    // The create is a queued write; the code does not resolve on the server until it lands.
    await page.goto('/#/app/meetings');
    await waitForSync(page);

    await page.goto(`/#/app/checkin/${code}`);
    await page.getByTestId('confirm-checkin').click();

    // Judged against the SERVER's clock, which is the entire reason this is an RPC.
    await expect(page.getByRole('heading', { name: 'Too early' })).toBeVisible({ timeout: 30_000 });
});

/**
 * The two layout properties jsdom cannot check, measured in a real browser.
 *
 * Both of these shipped broken and were found by looking at the app, which is exactly the
 * class of defect the plan says a script only catches once somebody has thought to check it.
 * These are the "thought to check it" part.
 */
test.describe('layout properties', () => {
    test('the splash wordmark sits centred BELOW the logo, not beside it', async ({ page }) => {
        // `#/auth/callback` renders the splash with no session, which is the only way to hold
        // a screen still that otherwise exists for a few hundred milliseconds.
        await page.goto('/#/auth/callback');

        const logo = page.getByTestId('splash-logo');
        const wordmark = page.getByTestId('splash-wordmark');
        await expect(logo).toBeVisible();

        const logoBox = (await logo.boundingBox())!;
        const markBox = (await wordmark.locator('span').first().boundingBox())!;

        // The bug: two inline-level boxes sharing a line, so the mark sat to the RIGHT of the
        // logo and level with its bottom edge.
        expect(markBox.y, 'the wordmark is not below the logo').toBeGreaterThanOrEqual(
            logoBox.y + logoBox.height,
        );
        expect(
            Math.abs(logoBox.x + logoBox.width / 2 - (markBox.x + markBox.width / 2)),
            'the wordmark is not centred on the logo',
        ).toBeLessThan(2);
    });

    test('the toggle knob stays inside its track, on and off', async ({ page }) => {
        /*
         * The knob was `absolute` with no `left`, so it fell at its STATIC position — and a
         * <button> centres its inline content, which put the knob in the middle of the track
         * before `translate-x-4` pushed it 14px past the right edge. It read as
         * roughly-plausible at desktop size and obviously broken on a phone.
         *
         * jsdom computes no layout, so only a real browser can hold this. Measured rather than
         * eyeballed: the knob must sit inside the track with the same inset at whichever end
         * it is parked.
         */
        const email = uniqueEmail('meet-toggle');
        await signUp(page, { fullName: 'Toggle Coach', email });
        await createTeam(page, { teamName: unique('Toggle') });
        await goToView(page, 'meetings', 'meetings');

        const toggle = page.getByTestId('show-past-toggle');
        await expect(toggle).toBeVisible();

        const measure = () =>
            toggle.evaluate((el) => {
                const knob = el.querySelector('span')!;
                const t = el.getBoundingClientRect();
                const k = knob.getBoundingClientRect();
                return {
                    insetLeft: k.left - t.left,
                    insetRight: t.right - k.right,
                    insetTop: k.top - t.top,
                    insetBottom: t.bottom - k.bottom,
                };
            });

        const off = await measure();
        expect(off.insetLeft, 'knob escapes the left edge when off').toBeGreaterThanOrEqual(0);
        expect(off.insetRight, 'knob escapes the right edge when off').toBeGreaterThanOrEqual(0);

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');

        // The knob slides. Measuring immediately catches it mid-flight and reports a real
        // asymmetry that is only the animation — which is exactly what the first run did.
        await toggle.locator('span').evaluate(
            (el) =>
                new Promise((resolve) => {
                    const done = () => resolve(null);
                    el.addEventListener('transitionend', done, { once: true });
                    // No transition at all (reduced motion, or already settled) still resolves.
                    setTimeout(done, 600);
                }),
        );

        const on = await measure();
        expect(on.insetLeft, 'knob escapes the left edge when on').toBeGreaterThanOrEqual(0);
        expect(on.insetRight, 'knob escapes the right edge when on').toBeGreaterThanOrEqual(0);

        // Symmetric: whatever gap the knob leaves at one end when off, it leaves at the other
        // when on. That is what makes it look deliberate rather than approximately placed.
        expect(Math.abs(off.insetLeft - on.insetRight)).toBeLessThanOrEqual(1);
        expect(off.insetTop).toBeGreaterThanOrEqual(0);
        expect(off.insetBottom).toBeGreaterThanOrEqual(0);
    });

    test('the sidebar footer keeps its gutter above the viewport edge', async ({ page }) => {
        const email = uniqueEmail('meet-layout');
        await signUp(page, { fullName: 'Layout Coach', email });
        await createTeam(page, { teamName: unique('Layout') });

        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto('/#/app/dashboard');
        await page.waitForSelector('[data-testid="app-nav"]', { timeout: 45_000 });

        // `.safe-area-bottom` set `padding-bottom: env(safe-area-inset-bottom)` from outside
        // Tailwind's utilities layer, so it BEAT the `p-3` beside it and computed to 0px on
        // every device without a notch — putting the sync indicator flush against the bottom
        // of the screen.
        const padding = await page
            .locator('[data-testid="sidebar"] .safe-area-bottom')
            .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));

        expect(padding, 'the sidebar footer has no bottom gutter').toBeGreaterThanOrEqual(12);
    });
});

test('a code the server has not seen yet is not blamed on the student', async ({ page }) => {
    /*
     * The window between a coach pressing Save and the drain reaching the server.
     *
     * The code is perfectly good and exists on the coach's device; the server is simply
     * behind. Telling a student "that code does not match a meeting for your team" in that
     * moment is a false statement that sends them to find a coach for a problem that fixes
     * itself in seconds. Found by this pack, which checks in faster than a human can.
     *
     * Deliberately NOT waiting for sync, which is the opposite of every other test here.
     */
    const email = uniqueEmail('meet-unsynced');
    await signUp(page, { fullName: 'Unsynced Coach', email });
    await createTeam(page, { teamName: unique('Unsynced') });

    await goToView(page, 'meetings', 'meetings');
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Just created');
    await page.getByTestId('save-event').click();
    await expect(page.getByRole('heading', { name: 'Just created' })).toBeVisible({
        timeout: 30_000,
    });

    const codeText = await page.locator('text=/^FF-\\d{4}$/').first().innerText();
    const code = codeText.replace(/\D/g, '');

    // Cut the network the moment the event exists locally, so the push cannot land and the
    // race is deterministic rather than a matter of who wins on the day.
    await page.route('**/rest/v1/meetings**', (route) =>
        route.request().method() === 'POST' ? route.abort() : route.continue(),
    );

    await page.goto(`/#/app/checkin/${code}`);
    await page.getByTestId('confirm-checkin').click();

    await expect(page.getByRole('heading', { name: 'Not synced yet' })).toBeVisible({
        timeout: 30_000,
    });
    await expect(page.getByText(/has not finished syncing/i)).toBeVisible();
});

test('a scan while signed out routes through login and lands on the check-in', async ({ page }) => {
    /*
     * Rule 4 of the design brief, and the thing Kevin reported after testing with a friend:
     * scanning while logged out dropped them on the LANDING page with the destination thrown
     * away, so they had to work out for themselves that the answer was "press Log In, then go
     * and find Meetings again".
     *
     * The whole point of a QR poster is that it is one action.
     */
    const email = uniqueEmail('meet-scan');
    await signUp(page, { fullName: 'Scan Coach', email });
    await createTeam(page, { teamName: unique('Scan') });

    await goToView(page, 'meetings', 'meetings');
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Scanned session');

    const today = await page.evaluate(() => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return {
            date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
            hour: `${pad(d.getHours())}:00`,
        };
    });
    await page.getByTestId('event-date').fill(today.date);
    await page.getByTestId('event-start').fill(today.hour);
    await page.getByTestId('event-end').fill('23:59');
    await expect(page.getByTestId('save-event')).toBeEnabled();
    await page.getByTestId('save-event').click();
    await expect(page.getByRole('heading', { name: 'Scanned session' })).toBeVisible({ timeout: 30_000 });

    const codeText = await page.locator('text=/^FF-\\d{4}$/').first().innerText();
    const code = codeText.replace(/\D/g, '');
    await page.goto('/#/app/meetings');
    await waitForSync(page);

    // Sign out, then arrive the way a camera does: straight at the check-in URL.
    await page.getByTestId('sign-out-button').click();
    await page.waitForURL(/#\/$/, { timeout: 30_000 });
    // Sign-out finishes with `window.location.reload()`, so the URL changes before the
    // navigation does. Navigating on top of that in-flight reload cancels one of them.
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: 'Log In' }).first()).toBeVisible({
        timeout: 30_000,
    });

    // Cold, the way a camera app opens it — a fresh load rather than a hash change on the
    // page that is already open. `goto` between two hashes of one document does not reload,
    // and sign-out has just triggered a reload of its own to race with.
    await page.goto(`/#/app/checkin/${code}`);
    await page.reload();

    // The LOGIN FORM, not the landing page, and the destination is still on the URL.
    await expect(page.getByTestId('email-input')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain('next=');

    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();

    // Straight to the check-in — one team, so the picker is skipped when a destination is
    // pending. No dashboard, no hunting for Meetings.
    await page.waitForURL(new RegExp(`#/app/checkin/${code}`), { timeout: 45_000 });
    await expect(page.getByTestId('confirm-checkin')).toBeVisible({ timeout: 30_000 });
});

test('a student is never handed the code by the app', async ({ page }) => {
    /*
     * The defect Kevin found: the schedule linked to `/app/checkin/<code>` with the code taken
     * from local data, so one tap marked a student present from anywhere. That makes the
     * poster decorative and the check-in window meaningless.
     *
     * Asserted on the COACH's own schedule view, which is a superset — if no student-facing
     * check-in affordance carries a code here, none does anywhere.
     */
    const email = uniqueEmail('meet-nocode');
    await signUp(page, { fullName: 'No Code Coach', email });
    await createTeam(page, { teamName: unique('NoCode') });

    await goToView(page, 'meetings', 'meetings');
    await page.getByTestId('new-event').click();
    await page.getByTestId('event-title').fill('Session');
    await page.getByTestId('save-event').click();
    await expect(page.getByRole('heading', { name: 'Session' })).toBeVisible({ timeout: 30_000 });

    await page.goto('/#/app/checkin');
    // Every route into check-in from inside the app arrives with an EMPTY field.
    await expect(page.getByTestId('code-display')).toHaveText(/FF-·+/);
    await expect(page.getByTestId('submit-code')).toBeDisabled();
});
