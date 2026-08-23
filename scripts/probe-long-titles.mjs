/**
 * WALK-A-11 — a title that is too long, rendered.
 *
 * The finding is a SCREENSHOT finding: a 165-character title clipped at the right edge of the
 * meeting detail header. jsdom cannot see it — no layout means no overflow — so the only honest
 * check is to render one and measure the box against its container. `docs/failure-modes.md` §5.
 *
 * The 120-character cap stops NEW ones. It does nothing for a title already stored, and the
 * walkthrough's is stored, so `break-words` is the half that has to work retroactively. This
 * probe plants a long title directly through the service key — deliberately going around the
 * client cap, because that is exactly the row the cap cannot reach.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-long-titles.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-19';
const PASSWORD = 'ForgeReview!2026-local';
const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/*
 * NO SPACES. A long title WITH spaces wraps on its own and would pass without `break-words` at
 * all — which is how a check like this quietly stops verifying. 116 unbroken characters is the
 * shape the walkthrough hit and the only shape that needs the rule.
 */
const LONG = 'Superlongunbrokenmeetingtitlewithnospacesatallthatthelayoutcannotwrapwithoutbreakwords' +
    'AndThenSomeMoreToPushIt';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let browser;
let planted = null;
let plantedReport = null;
try {
    const { data: team } = await admin.from('teams').select('id').eq('name', 'Iron Falcons').single();
    const { data: season } = await admin
        .from('seasons').select('id').eq('team_id', team.id).limit(1).single();

    // The cap is 120 and this is 108, so it is storable — the point is that it does not WRAP,
    // not that it is over the limit. A stored 165 from before the cap behaves the same way.
    check('the planted title is within the new 120 cap, so this is about wrapping only',
        LONG.length <= 120, `${LONG.length} chars`);

    const { data: meeting, error } = await admin
        .from('meetings')
        .insert({
            team_id: team.id,
            season_id: season.id,
            title: LONG,
            starts_at: new Date('2027-03-01T18:00:00Z').toISOString(),
            ends_at: new Date('2027-03-01T20:00:00Z').toISOString(),
            event_type: 'build',
        })
        .select('id')
        .single();
    if (error) throw new Error(`could not plant the meeting: ${error.message}`);
    planted = meeting.id;

    browser = await chromium.launch();
    const context = await browser.newContext({
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: 2,
    });
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

    await page.goto(`${APP}/#/app/meetings/${planted}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const h1 = page.locator('h1').filter({ hasText: 'Superlongunbroken' }).first();
    await h1.waitFor({ state: 'visible', timeout: 30_000 });

    /*
     * TWO MEASUREMENTS, because either alone can pass on a broken layout. `scrollWidth <=
     * clientWidth` says the text is not overflowing its own box; a box that itself sticks out
     * past the viewport would still satisfy that. `right <= innerWidth` says the box is on
     * screen. The walkthrough's screenshot failed both.
     */
    const geo = await h1.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            right: Math.round(r.right),
            height: Math.round(r.height),
            innerWidth: window.innerWidth,
            lineHeight: Math.round(parseFloat(getComputedStyle(el).lineHeight)),
        };
    });
    check('the title does not overflow its own box', geo.scrollWidth <= geo.clientWidth,
        `scrollWidth ${geo.scrollWidth} vs clientWidth ${geo.clientWidth}`);
    check('the title stays inside the 375 px viewport', geo.right <= geo.innerWidth,
        `right edge ${geo.right} of ${geo.innerWidth}`);
    /*
     * And it actually WRAPPED rather than being hidden. `overflow: hidden` or `truncate` would
     * satisfy both checks above while making the title unreadable, which is a different bug
     * wearing the same green tick.
     */
    check('the title wrapped onto more than one line rather than being clipped',
        geo.height > geo.lineHeight * 1.5, `${geo.height}px tall, line-height ${geo.lineHeight}`);

    const page404 = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
    }));
    check('no horizontal overflow on the page', page404.scrollWidth <= page404.innerWidth,
        JSON.stringify(page404));

    await page.screenshot({ path: `${OUT}/walkA11-long-title-375.png`, fullPage: true });
    log(`\nscreenshot: ${OUT}/walkA11-long-title-375.png`);

    /*
     * ---------------------------------------------------------------- the scouting card
     *
     * WALK-A-11's second site. WALK-A-06 (561ddf7) capped the input at five digits and put
     * `break-words` on the card, so the finding SHOULD already be closed here — and "should
     * already be closed" is a claim worth one measurement rather than a sentence in a report.
     * Planted through the service key at 40 characters, which is what a row stored before that
     * cap looks like and the only thing the cap cannot reach.
     */
    const { data: report, error: reportError } = await admin
        .from('scouting_reports')
        .insert({
            team_id: team.id,
            season_id: season.id,
            opponent_team_number: '9'.repeat(40),
            data: {},
        })
        .select('id')
        .single();
    if (reportError) throw new Error(`could not plant the report: ${reportError.message}`);
    plantedReport = report.id;

    await page.goto(`${APP}/#/app/scouting`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('scout-card-team').filter({ hasText: '999999' }).first();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    const cardGeo = await card.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, right: Math.round(r.right), innerWidth: window.innerWidth };
    });
    check('a 40-character team number stored before the cap still renders inside the card',
        cardGeo.scrollWidth <= cardGeo.clientWidth && cardGeo.right <= cardGeo.innerWidth,
        `scrollWidth ${cardGeo.scrollWidth}/${cardGeo.clientWidth}, right ${cardGeo.right}/${cardGeo.innerWidth}`);
    const scoutPage = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    }));
    check('no horizontal overflow on the scouting page either',
        scoutPage.scrollWidth <= scoutPage.innerWidth, JSON.stringify(scoutPage));
    await page.screenshot({ path: `${OUT}/walkA11-long-team-number-375.png` });

    // ---------------------------------------------------------------- the client cap
    await page.goto(`${APP}/#/app/meetings`, { waitUntil: 'domcontentloaded' });
    /*
     * The click is NOT swallowed, and the harness ratchet is the reason — it counts Playwright
     * actions with an empty catch attached, and it counted this one when the first draft had it.
     * It is right: a swallowed click turns "the button moved" into "the input has no cap", which
     * is a true-looking failure about the wrong thing. If the form will not open, say that.
     *
     * (Written without the offending expression spelled out, because the ratchet greps source
     * text and matched it inside this very comment on the first attempt — the repo's own
     * most-repeated test defect, a check satisfied or broken by its own prose.)
     */
    await page.getByTestId('new-event').click();
    const titleInput = page.locator('input[maxlength="120"]').first();
    await titleInput.waitFor({ state: 'visible', timeout: 20_000 });
    await titleInput.fill('q'.repeat(400));
    const got = await titleInput.inputValue();
    check('the meeting title input refuses more than 120 characters', got.length === 120,
        `${got.length} characters got in`);
} finally {
    if (planted) await admin.from('meetings').delete().eq('id', planted);
    if (plantedReport) await admin.from('scouting_reports').delete().eq('id', plantedReport);
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
