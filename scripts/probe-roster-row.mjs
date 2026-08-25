/**
 * The Admin Settings roster row at 375px — "a lot of text chopped off" (Kevin, 2026-08-24).
 *
 * jsdom cannot see this and neither can any assertion about class names. The row's markup
 * already SAID it handled narrow screens: the container is `flex-wrap`, the text column is
 * `min-w-0`, and both of those are the right instincts. It still rendered one character of a
 * 25-character name. `docs/failure-modes.md` §5 — the broken and fixed versions of a layout are
 * identical to a test that applies no stylesheet.
 *
 * WHAT THE DEFECT ACTUALLY WAS, because the numbers are the only convincing part. Measured at
 * 375px on the seeded `full@falconforge.test` team before the fix:
 *
 *   - the row                            293px
 *   - the controls beside the name       249px   (role <select> + Seated toggle)
 *   - the name column                     32px   <- `flex-1 min-w-0`
 *   - the member's name                   18px clientWidth, 204px scrollWidth
 *   - the 32px avatar                      3px
 *
 * The controls are a flex container with the default `min-width: auto`, which resolves to their
 * max-content width, so they cannot shrink. The name column was `flex-1` — `flex: 1 1 0%` — so
 * its hypothetical size is ZERO, the two children therefore always "fit" on one line, the
 * `flex-wrap` never triggers, and the name column absorbs the whole deficit by itself.
 *
 * That is why this probe measures BOTH widths and BOTH viewports. A check that only asserted
 * "no horizontal overflow" would have passed against the defect: nothing overflowed, because the
 * name column obligingly collapsed instead. The zero-overflow state and the broken state are the
 * same state.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-roster-row.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-29';
const PASSWORD = 'ForgeReview!2026-local';

/*
 * The FULL team, not the reviewer's. It is the one seeded with several members, and a roster
 * with one row in it cannot exhibit this defect at all — every member row is an independent
 * instance of it, and the admin's own row (the longest name, and the only one whose control
 * column carries "Team Admin") is the worst case.
 */
const ADMIN_EMAIL = 'full@falconforge.test';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/* Read every roster row's geometry in one pass, so the numbers all describe one layout. */
const measure = () => {
    const rows = [...document.querySelectorAll('div.justify-between.flex-wrap')]
        .filter((r) => r.querySelector('p.truncate'));
    return {
        viewport: window.innerWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        rows: rows.map((r) => {
            const nameCol = r.firstElementChild;
            const ctrls = r.lastElementChild;
            const a = nameCol.getBoundingClientRect();
            const b = ctrls.getBoundingClientRect();
            const avatar = nameCol.querySelector('div.rounded-full');
            const texts = [...r.querySelectorAll('p.truncate')].map((p) => ({
                clientWidth: p.clientWidth,
                scrollWidth: p.scrollWidth,
                text: (p.textContent || '').trim().slice(0, 40),
            }));
            return {
                rowWidth: Math.round(r.getBoundingClientRect().width),
                nameColWidth: Math.round(a.width),
                controlsWidth: Math.round(b.width),
                avatarWidth: avatar ? Math.round(avatar.getBoundingClientRect().width) : null,
                sideBySide: b.left >= a.right - 1,
                texts,
            };
        }),
    };
};

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        deviceScaleFactor: 2,
    });
    // Same guard as the other probes: a probe that silently measured PRODUCTION would be worse
    // than no probe, because its numbers would look exactly as plausible.
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

    await page.goto(`${APP}/#/app/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const mobile = await page.evaluate(measure);
    log(`\n375px — ${mobile.rows.length} roster rows`);

    check('the roster rendered at all, so the rest of these numbers mean something',
        mobile.rows.length > 0, `${mobile.rows.length} rows`);

    /*
     * THE CHECK THE DEFECT FAILS. Every truncating line must fit its own box. `truncate` exists
     * for the genuinely-too-long name and would legitimately clip a 200-character one — but the
     * seeded names are short, so on a correct layout NOTHING here is clipped, and any clipping
     * at all means the column was crushed rather than the text being long.
     */
    const clipped = mobile.rows.flatMap((r) => r.texts.filter((t) => t.scrollWidth > t.clientWidth + 1));
    check('no roster text is clipped at 375px', clipped.length === 0,
        clipped.length
            ? clipped.map((c) => `"${c.text}" ${c.clientWidth}px box / ${c.scrollWidth}px text`).join('; ')
            : 'every name and address fits its box');

    /*
     * The name column must hold a MAJORITY of the row. Stated as a proportion rather than a
     * pixel count so it does not have to be re-tuned when a control is added — and it is the
     * clause that fails loudest against the defect, where the column held 32 of 293 px (11%).
     */
    const starved = mobile.rows.filter((r) => r.nameColWidth < r.rowWidth * 0.5);
    check('the name column is not starved by the controls beside it', starved.length === 0,
        starved.length
            ? starved.map((r) => `${r.nameColWidth}px of ${r.rowWidth}px`).join('; ')
            : `narrowest ${Math.min(...mobile.rows.map((r) => r.nameColWidth))}px`);

    /*
     * The avatar is a fixed 32px circle. It was measured at 3px — a flex item with no `shrink-0`
     * is compressible however explicit its `w-8` looks, and an icon inside a 3px box does not
     * announce itself as a layout bug; it looks like a rendering glitch.
     */
    const squashed = mobile.rows.filter((r) => r.avatarWidth !== null && r.avatarWidth < 32);
    check('every avatar is its full 32px', squashed.length === 0,
        squashed.length ? squashed.map((r) => `${r.avatarWidth}px`).join('; ') : 'all 32px');

    /*
     * And the fix did not simply push the problem sideways. This is the clause that would catch
     * "solving" the crush by letting the row overflow the screen instead.
     */
    check('no horizontal overflow at 375px', mobile.pageScrollWidth <= 375,
        `document ${mobile.pageScrollWidth}px in a 375px viewport`);

    await page.screenshot({ path: `${OUT}/roster-row-375.png`, fullPage: true });

    /*
     * DESKTOP, because a mobile fix that leaks is the Sprint 19 lesson: the touch-target floor
     * stretched a toggle's track and nothing noticed until somebody looked at a wide screen. At
     * 1280 the name and controls must still share ONE line — the compact density CLAUDE.md
     * principle 8 asks for, and the layout this page had before the fix.
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(1200);
    const desktop = await page.evaluate(measure);
    log(`\n1280px — ${desktop.rows.length} roster rows`);

    const stacked = desktop.rows.filter((r) => !r.sideBySide);
    check('at 1280px the name and its controls are still on one line', stacked.length === 0,
        stacked.length ? `${stacked.length} row(s) wrapped` : `${desktop.rows.length} rows inline`);
    check('no roster text is clipped at 1280px either',
        desktop.rows.flatMap((r) => r.texts.filter((t) => t.scrollWidth > t.clientWidth + 1)).length === 0);

    await page.screenshot({ path: `${OUT}/roster-row-1280.png`, fullPage: true });
    log(`\nscreenshots: ${OUT}/roster-row-375.png, ${OUT}/roster-row-1280.png`);
} finally {
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
