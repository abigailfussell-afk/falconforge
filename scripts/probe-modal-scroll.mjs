/**
 * Can you actually reach the bottom of a tall modal? (Reported 2026-08-25.)
 *
 * THE PROPERTY THIS CHECKS IS `scrollTop MOVES`, NOT `scrollHeight > clientHeight`, and the
 * difference is the entire reason this file exists.
 *
 * The task modal's scroll container was a `<fieldset>`. A fieldset is NOT a scroll container in
 * Chromium — it lays its children out in an anonymous box and refuses to scroll — but it still
 * REPORTS an overflowing `scrollHeight`. So the obvious check,
 * `scrollHeight > clientHeight`, was **true of the broken version**, and the first pass at
 * verifying this defect reported "canScroll: true" over a modal whose Description field could
 * not be reached at all. `docs/failure-modes.md` §2: a test satisfied by a state the defect also
 * produces.
 *
 * Measured before the fix, on a Pixel 5 profile: clientHeight 480, scrollHeight 765, and
 * `scrollTop = 99999` left `scrollTop` at **0**. The textarea sat at y 546-674 inside a container
 * ending at 605.
 *
 * So this probe sets `scrollTop` and asserts it MOVED, then asserts the last field is inside the
 * container's box. Both are things the broken version fails.
 *
 * TOUCH EMULATION IS DELIBERATE. The 32px touch floor and `pointer: coarse` rules only apply on a
 * coarse pointer, and a modal on a phone is the case being protected — a desktop context would
 * measure a different layout (`docs/failure-modes.md` §11).
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-modal-scroll.mjs
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-31';
const PASSWORD = 'ForgeReview!2026-local';
const ADMIN_EMAIL = 'full@falconforge.test';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ ...devices['Pixel 5'], colorScheme: 'dark' });
    // Same guard as every other probe: measuring PRODUCTION would look just as plausible.
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(ADMIN_EMAIL);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    await page.goto(`${APP}/#/app/board`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const newButton = page.locator('button:has-text("New")').first();
    check('the board offers a New button, so there is a modal to open', await newButton.count() > 0);
    await newButton.click();
    await page.waitForTimeout(2000);

    const geo = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return null;
        const scroller = dialog.querySelector('.overflow-y-auto');
        if (!scroller) return { noScroller: true };
        const last = scroller.querySelector('textarea');

        const before = scroller.scrollTop;
        scroller.scrollTop = 99_999;                 // ask for the very bottom
        const after = scroller.scrollTop;

        const sr = scroller.getBoundingClientRect();
        const lr = last ? last.getBoundingClientRect() : null;
        return {
            tag: scroller.tagName,
            clientH: scroller.clientHeight,
            scrollH: scroller.scrollHeight,
            overflows: scroller.scrollHeight > scroller.clientHeight + 1,
            scrolled: after > before,
            scrollTopAtBottom: after,
            lastFieldInsideBox: lr ? lr.bottom <= sr.bottom + 1 : null,
            hasTextarea: !!last,
        };
    });

    check('the modal rendered with a scroll container', geo !== null && !geo.noScroller);

    /*
     * A fieldset is not a scroll container, so the container must not BE one. Named as its own
     * check because it is the specific regression, and because the failure text should say what
     * to look for rather than just "false".
     */
    check('the scroll container is not a <fieldset>', geo.tag !== 'FIELDSET',
        `it is a <${(geo.tag || '?').toLowerCase()}>`);

    check('the content is tall enough for this test to mean anything', geo.overflows,
        `scrollHeight ${geo.scrollH} vs clientHeight ${geo.clientH}`);

    /*
     * THE CHECK THE DEFECT FAILS. Everything above was true of the broken version.
     */
    check('scrollTop actually MOVES when asked to scroll to the bottom', geo.scrolled,
        `scrollTop reached ${geo.scrollTopAtBottom}`);

    check('the last field is reachable inside the container', geo.lastFieldInsideBox === true,
        geo.hasTextarea ? '' : 'no textarea found — the modal shape changed');

    await page.screenshot({ path: `${OUT}/task-modal-scrolled.png` });
    log(`\nscreenshot: ${OUT}/task-modal-scrolled.png`);
} finally {
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
