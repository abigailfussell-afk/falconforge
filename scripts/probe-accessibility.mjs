/**
 * WALK-A-09 and WALK-A-10, measured rather than argued.
 *
 * The whole reason these two findings exist is that no test in this repo can see them. jsdom
 * applies no stylesheet, so it computes no colour and no box: the broken and the fixed version
 * of a 13x13 checkbox render identically there, and a 2.52:1 label and a 7:1 one are the same
 * string. `docs/failure-modes.md` §5 is this exact class — CSS with no error channel — and the
 * only channel is a real browser with real styles.
 *
 * So this probe is the verification for both IDs, and the numbers it prints are the ones quoted
 * in the sprint report.
 *
 *   1. axe-core (wcag2a + wcag2aa) on every route the walkthrough scanned, in DARK MODE, which
 *      is the app's default and the mode every reported contrast failure was measured in.
 *   2. The task modal OPEN, which the walkthrough explicitly could not scan ("axe did not run
 *      with the modal open") and where the five unlabelled selects live.
 *   3. Geometry at 375 px: every interactive element's rendered box, listing anything whose
 *      smaller dimension is under 32 px.
 *   4. Horizontal overflow at 375 px, kept from the walkthrough as a regression guard — it
 *      passed there and the tap-target fixes are exactly the kind of change that breaks it.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-accessibility.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-19';
const PASSWORD = 'ForgeReview!2026-local';
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

/** The rules this sprint is answerable for. Everything else is reported but not counted. */
const OWNED = new Set(['select-name', 'button-name', 'color-contrast', 'label', 'aria-input-field-name']);

/**
 * PARKED, and named rather than filtered.
 *
 * White on `forge-600` (#ea580c) measures 3.55:1 at 13 px, which fails AA — and it is the
 * PRIMARY action button on every screen, so it is the single most-repeated contrast failure in
 * the app. It is also the brand orange (CLAUDE.md principle 8), and WALK-A-09's evidence names
 * three ratios of which this is not one: it is a new discovery, so under the sprint rules it
 * goes to the plan's §8 parking lot with its numbers rather than into this diff.
 *
 * Listed here BY ITS MEASURED COLOUR PAIR rather than by rule id, so that parking the button
 * cannot also park the secondary-text failures this sprint does own — they share the rule id
 * `color-contrast` and nothing else. The probe still prints it every run; what it does not do
 * is fail on it.
 */
const PARKED_CONTRAST = /foreground color: #ffffff, background color: #ea580c/;

/**
 * 32 px, not 44. `touch-target` promises 44 and is opt-in for PRIMARY actions; the walkthrough
 * measured against 32 and that is the bar being raised to, so the number here is the one the
 * finding was written against rather than a stricter one invented now.
 */
const MIN_TAP = 32;

const ROUTES = [
    '/app/dashboard', '/app/board', '/app/admin', '/app/meetings',
    '/app/scouting', '/app/planner', '/app/checklist', '/app/events',
];

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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill('reviewer@falconforge.test');
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    /*
     * ASSERT the mode rather than assume it. The store defaults to dark, but a persisted
     * preference from a previous probe run would silently move every measurement below into
     * light mode, where slate-500 on white passes and the whole scan would report clean for
     * the wrong reason.
     */
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    check('measuring in dark mode, which is the default and where the failures were reported', isDark);

    const runAxe = async (label) => {
        await page.evaluate(AXE);
        const result = await page.evaluate(async () => {
            const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
            return r.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                nodes: v.nodes.map((n) => ({
                    target: n.target.join(' '),
                    summary: (n.failureSummary ?? '').split('\n').slice(0, 3).join(' | ').slice(0, 260),
                    html: n.html.slice(0, 160),
                })),
            }));
        });
        // Split the parked colour pair off BEFORE counting, and keep it so it still prints.
        const parked = [];
        const owned = result
            .filter((v) => OWNED.has(v.id))
            .map((v) => {
                const keep = v.nodes.filter((n) => !PARKED_CONTRAST.test(n.summary));
                parked.push(...v.nodes.filter((n) => PARKED_CONTRAST.test(n.summary)));
                return { ...v, nodes: keep };
            })
            .filter((v) => v.nodes.length > 0);
        const other = result.filter((v) => !OWNED.has(v.id));
        const count = owned.reduce((n, v) => n + v.nodes.length, 0);
        if (parked.length) log(`\n[axe] ${label}: ${parked.length} PARKED (white on forge-600, §8)`);
        log(`\n[axe] ${label}: ${count} node(s) across ${owned.length} owned rule(s)` +
            (other.length ? `; ${other.length} other rule(s): ${other.map((v) => `${v.id}x${v.nodes.length}`).join(', ')}` : ''));
        for (const v of owned) {
            log(`   ${v.id} (${v.impact}) x${v.nodes.length}`);
            for (const n of v.nodes.slice(0, 8)) log(`      ${n.target}\n         ${n.summary}`);
            if (v.nodes.length > 8) log(`      ...and ${v.nodes.length - 8} more`);
        }
        return { label, owned, other, count, parked: parked.length };
    };

    // ============================================================ 1. routes, dark, desktop
    log('\n--- axe: wcag2a + wcag2aa, dark mode ---');
    const axeReports = [];
    for (const route of ROUTES) {
        await page.goto(`${APP}/#${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        axeReports.push(await runAxe(route));
    }

    // ============================================================ 2. the task modal, open
    log('\n--- axe: the task modal, which the walkthrough could not reach ---');
    await page.goto(`${APP}/#/app/board`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    /*
     * The board is EMPTY in the review seed (0 tasks across all five teams — checked), so the
     * first version of this probe reported "no task cards" and skipped the scan. Skipping is the
     * failure mode `docs/failure-modes.md` §7 describes: a gate with no door. Create the task
     * instead, which also puts the NEW-task path under the scan.
     */
    await page.getByTestId('new-task-button').click();
    await page.getByTestId('task-title-input').waitFor({ state: 'visible', timeout: 20_000 });
    const modalReport = await runAxe('/app/board (task modal open)');
    axeReports.push(modalReport);
    check('the task modal was scanned with axe (the walkthrough could not)', true);

    /*
     * WALK-A-08 IN A REAL BROWSER.
     *
     * The 13 unit tests are real DOM behaviour and jsdom runs them honestly — but jsdom does not
     * lay anything out, so `offsetParent` had to be polyfilled there, and the focusable filter
     * depends on it. That polyfill is a stand-in for the browser, and a stand-in is exactly the
     * thing this repo has been caught trusting (§2: the test asserts the harness). Here the
     * layout is real, so the filter is exercised for real.
     */
    const focusInside = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return !!dialog && dialog.contains(document.activeElement) && document.activeElement !== document.body;
    });
    check('WALK-A-08: focus is inside the dialog in a real browser, not on <body>', focusInside);

    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(() =>
        !!document.querySelector('[role="dialog"]')?.contains(document.activeElement));
    check('WALK-A-08: Tab keeps focus inside the dialog', stillInside);

    await page.keyboard.press('Escape');
    const closed = !(await page.getByTestId('task-title-input').isVisible().catch(() => false));
    check('WALK-A-08: Escape closes the task modal', closed);

    const ownedTotal = axeReports.reduce((n, r) => n + r.count, 0);
    const byRule = {};
    for (const r of axeReports) for (const v of r.owned) byRule[v.id] = (byRule[v.id] ?? 0) + v.nodes.length;
    check(
        `zero owned axe violations across ${axeReports.length} scans`,
        ownedTotal === 0,
        ownedTotal === 0 ? '' : JSON.stringify(byRule),
    );

    // ============================================================ 3. geometry at 375 px
    /*
     * A SEPARATE TOUCH CONTEXT, and this is the whole reason the geometry numbers can be
     * trusted.
     *
     * `.touch-target` — the app's existing 44 px promise — is gated on `@media (pointer:
     * coarse)`, deliberately: a mouse does not need a 44 px button, and forcing one is the
     * "blown up" density Sprint 5 spent itself removing. A desktop Chromium resized to 375 px
     * does NOT match `pointer: coarse`. It matches `fine`.
     *
     * So measuring in a resized desktop context is measuring a media query that is switched off.
     * The fix would be applied, the probe would report no change, and the obvious next move
     * would be to reach for an ungated rule that wrecks the desktop. `hasTouch` + `isMobile`
     * makes `pointer: coarse` true, which is the state a phone is actually in.
     *
     * The first run of this probe DID measure the desktop context, and its 123 boxes are
     * therefore a number about the wrong device. This is `docs/failure-modes.md` §11 — a check
     * bound to the wrong event — and it would have been invisible: both runs produce a
     * plausible list of small boxes.
     */
    log('\n--- geometry: interactive boxes under 32 px at 375 px, POINTER: COARSE ---');
    const touch = await browser.newContext({
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
    });
    await touch.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const mob = await touch.newPage();
    await mob.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await mob.getByTestId('email-input').fill('reviewer@falconforge.test');
    await mob.getByTestId('password-input').fill(PASSWORD);
    await mob.getByTestId('sign-in-button').click();
    await mob.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await mob.getByTestId('team-option').first().click();
    await mob.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    // ASSERT the emulation took, rather than trusting the context options. If this is `fine`,
    // every measurement below is about a device nobody is holding.
    const coarse = await mob.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    check('the geometry pass runs where `pointer: coarse` matches, so touch-target is live', coarse);

    const small = [];
    const overflow = [];
    for (const route of ROUTES) {
        await mob.goto(`${APP}/#${route}`, { waitUntil: 'domcontentloaded' });
        await mob.waitForTimeout(1200);
        const found = await mob.evaluate((min) => {
            const sel = 'button, a[href], input, select, textarea, [role="switch"], [role="button"], [tabindex]:not([tabindex="-1"])';
            const out = [];
            for (const el of document.querySelectorAll(sel)) {
                /*
                 * A checkbox WRAPPED IN ITS LABEL is not a 13x13 tap target — the whole label is
                 * clickable and is the control. The first version of this probe measured the
                 * input alone, reported the planner's capability boxes as failures, and the
                 * "fix" for that was a 32px native checkbox that looked broken in a screenshot.
                 * Measuring the wrong box produced a real regression, which is `docs/
                 * failure-modes.md` §9 — the wrong record identity — with a bounding box for a
                 * record. `htmlFor` counts too: a label pointing at an id toggles it just the
                 * same.
                 */
                const label = el.closest('label')
                    ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
                const r = label && (el.type === 'checkbox' || el.type === 'radio')
                    ? label.getBoundingClientRect()
                    : el.getBoundingClientRect();
                // Zero-size elements are not rendered at all (a collapsed panel, an sr-only
                // input). They are not a tap target and counting them would drown the signal.
                if (r.width === 0 || r.height === 0) continue;
                if (el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') continue;
                if (Math.min(r.width, r.height) >= min) continue;
                out.push({
                    tag: el.tagName.toLowerCase(),
                    testid: el.getAttribute('data-testid') ?? '',
                    text: (el.textContent ?? '').trim().slice(0, 40),
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                });
            }
            return out;
        }, MIN_TAP);
        const ov = await mob.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
        }));
        if (ov.scrollWidth > ov.innerWidth) overflow.push({ route, ...ov });
        log(`  ${route}: ${found.length} under ${MIN_TAP} px` +
            (found.length ? ` — ${found.slice(0, 6).map((f) => `${f.testid || f.text || f.tag} ${f.w}x${f.h}`).join('; ')}` : ''));
        if (found.length > 6) log(`      ...and ${found.length - 6} more`);
        small.push(...found.map((f) => ({ route, ...f })));
    }
    check(`no interactive element under ${MIN_TAP} px at 375 px`, small.length === 0, `${small.length} found`);
    check('no horizontal overflow at 375 px', overflow.length === 0, JSON.stringify(overflow));

    /*
     * THE SWITCH DID NOT JUST GET BIGGER, it got a bigger HIT AREA.
     *
     * A 32 px floor applied naively stretches the track and leaves the knob adrift in it, which
     * is what the first version of this fix did — visible in a screenshot, invisible to every
     * test in the repo. So measure both boxes and require them to disagree: the button at least
     * 32 px for the thumb, the track still exactly 36x20 for the eye.
     */
    await mob.goto(`${APP}/#/app/meetings`, { waitUntil: 'domcontentloaded' });
    await mob.getByTestId('show-past-toggle').waitFor({ state: 'visible', timeout: 20_000 });
    const sw = await mob.evaluate(() => {
        const btn = document.querySelector('[data-testid="show-past-toggle"]');
        const track = btn?.querySelector('span');
        const b = btn.getBoundingClientRect();
        const t = track.getBoundingClientRect();
        return { hit: [Math.round(b.width), Math.round(b.height)], track: [Math.round(t.width), Math.round(t.height)] };
    });
    check(
        'the switch hit area reaches 32 px while its track stays 36x20',
        sw.hit[1] >= MIN_TAP && sw.track[0] === 36 && sw.track[1] === 20,
        `hit ${sw.hit.join('x')}, track ${sw.track.join('x')}`,
    );

    /*
     * THE OTHER HALF OF WALK-A-10, and the half that has no advocate.
     *
     * The 32 px floor is gated on `pointer: coarse` precisely so the desktop keeps the compact
     * density Sprint 5 spent itself tuning — and "it is gated" is a claim about a media query,
     * which is exactly the kind of claim this repo has been wrong about before (the `tall:`
     * breakpoint that compiled to no rule at all, index.css). A gate nobody tests is
     * `docs/failure-modes.md` §7.
     *
     * So: go back to the DESKTOP context, which is `pointer: fine`, and require that the small
     * controls are still small there. If this ever passes with zero, the floor has leaked off
     * touch devices and every row action in the app just grew — which would look like a
     * successful accessibility fix and be a density regression.
     */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${APP}/#/app/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const fine = await page.evaluate(() => window.matchMedia('(pointer: fine)').matches);
    const stillCompact = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href], input, select')]
            .map((el) => el.getBoundingClientRect())
            .filter((r) => r.width > 0 && r.height > 0 && r.height < 32).length);
    check('the desktop is still `pointer: fine`, so the floor does not apply there', fine);
    check(
        'the desktop keeps its compact controls — the touch floor did not leak',
        stillCompact > 0,
        `${stillCompact} controls still under 32 px on desktop`,
    );

    for (const [route, name] of [['/app/admin', 'admin'], ['/app/meetings', 'meetings'], ['/app/planner', 'planner']]) {
        await mob.goto(`${APP}/#${route}`, { waitUntil: 'domcontentloaded' });
        await mob.waitForTimeout(1200);
        await mob.screenshot({ path: `${OUT}/walkA10-${name}-375.png`, fullPage: true });
    }

    await touch.close();
    writeFileSync(`${OUT}/accessibility.json`, JSON.stringify({ axeReports, small, overflow }, null, 2));
    log(`\nfull detail: ${OUT}/accessibility.json`);
} finally {
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
