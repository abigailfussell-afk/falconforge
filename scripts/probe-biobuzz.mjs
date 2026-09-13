/**
 * BIOBUZZ, in the built app, at 375 px — the R-02 dry run the plan asked for.
 *
 * Replacing the placeholder definition is a JSON edit and a PNG, and the Gate is structurally
 * blind to both halves of what matters: that a scout can actually fill the form on a phone, and
 * that the Match Planner draws THIS year's field — offline, since that is where it is used. The
 * placeholder drew DECODE's field under every 2026-27 plan and nothing failed.
 *
 * What it walks, as the seeded Iron Falcons coach (whose 2026-27 season plays BIOBUZZ):
 *
 *   1. The scouting form renders the definition's sections and fields, with no page overflow.
 *   2. A report scouted through the real controls stores the definition's keys, and the card and
 *      the summary table read them back.
 *   3. The Match Planner's field image is BiobuzzField.webp and actually decoded (naturalWidth),
 *      with BIOBUZZ's partner-capability labels.
 *   4. The same image still loads with the network OFF, from the service worker's precache.
 *
 *   npm run build:local && npx vite preview --port 4188 --strictPort
 *   node scripts/probe-biobuzz.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';
import GAME from '../src/games/ftc-2026-biobuzz.json' with { type: 'json' };

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-37';
const PASSWORD = 'ForgeReview!2026-local';
const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });
const fields = GAME.scouting.match.sections.flatMap((s) => s.fields);

const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const pageOverflows = (page) =>
    page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

const TEAM_NUMBER = String(20000 + Math.floor(Math.random() * 9000));

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill('reviewer@falconforge.test');
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    // A one-team account goes straight in; a multi-team one meets the picker first.
    await page.waitForSelector('[data-testid="team-picker"], [data-testid="app-nav"]', { timeout: 45_000 });
    if (await page.getByTestId('team-picker').isVisible()) {
        await page.getByTestId('team-option').first().click();
    }
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });
    await page.screenshot({ path: `${OUT}/after-sign-in-375.png` });

    const { data: team } = await admin.from('teams').select('id').eq('name', 'Iron Falcons').single();
    const { data: season } = await admin
        .from('seasons').select('id, game_definition_id').eq('team_id', team.id).single();
    check('the seeded season records BIOBUZZ by id', season?.game_definition_id === GAME.id, season?.game_definition_id);

    // ============================================================ 1. the form
    log('\n--- Scouting form ---');
    await page.goto(`${APP}/#/app/scouting`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="scout-match"]', { timeout: 45_000 });
    await page.getByTestId('scout-match').click();
    await page.waitForSelector('[data-testid="schema-form"]', { timeout: 15_000 });

    for (const section of GAME.scouting.match.sections) {
        check(
            `section "${section.label}" renders`,
            (await page.getByTestId(`schema-section-${section.key}`).count()) === 1,
        );
    }
    const missing = [];
    for (const f of fields) if ((await page.getByTestId(`field-${f.key}`).count()) !== 1) missing.push(f.key);
    check(`all ${fields.length} fields have a control`, missing.length === 0, missing.join(', '));
    check('no DECODE field leaked into the form', (await page.getByTestId('field-shotsTaken').count()) === 0);
    check('the scouting modal does not overflow at 375px', (await pageOverflows(page)) === false);
    await page.screenshot({ path: `${OUT}/scouting-form-top-375.png` });

    // ============================================================ 2. scout a match
    await page.getByTestId('scout-team-number').fill(TEAM_NUMBER);
    await page.getByTestId('scout-match-number').fill('4');
    await page.getByTestId('scout-alliance').selectOption('blue');
    await page.getByTestId('field-leave').check();
    for (let i = 0; i < 3; i++) await page.getByTestId('field-autoCell-plus').click();
    await page.getByTestId('field-autoTips-plus').click();
    await page.getByTestId('field-teleopCell').fill('12');
    await page.getByTestId('field-teleopTips-plus').click();
    await page.getByTestId('field-teleopTips-plus').click();
    await page.getByTestId('field-flowerNectar').fill('2');
    await page.getByTestId('field-endPark').check();
    await page.getByTestId('field-notes').fill('Fast launcher, tipped twice');
    await page.getByTestId('field-notes').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/scouting-form-bottom-375.png` });
    await page.getByTestId('save-scouting-report').click();

    let row;
    for (let i = 0; i < 25 && !row; i++) {
        /*
         * The column is `opponent_team_number`. The first version of this probe asked for
         * `team_number`, got a 400, read `data: null` as "not synced yet" and reported the report
         * missing — a query error mistaken for an absence (`docs/failure-modes.md` §4). It throws.
         */
        const { data, error } = await admin
            .from('scouting_reports').select('data').eq('team_id', team.id).eq('opponent_team_number', TEAM_NUMBER).maybeSingle();
        if (error) throw new Error(`scouting_reports query: ${error.message}`);
        row = data;
        if (!row) await page.waitForTimeout(1000);
    }
    log(`\n  data as stored: ${JSON.stringify(row?.data)}`);
    check('the report reached the database', !!row);
    check(
        'it stores every BIOBUZZ key and nothing else',
        !!row && JSON.stringify(Object.keys(row.data).sort()) === JSON.stringify(fields.map((f) => f.key).sort()),
    );
    check(
        'the values are the ones scouted',
        row?.data?.leave === true && row?.data?.autoCell === 3 && row?.data?.autoTips === 1 &&
            row?.data?.teleopCell === 12 && row?.data?.teleopTips === 2 && row?.data?.flowerNectar === 2 &&
            row?.data?.endPark === true && row?.data?.autoPark === false && row?.data?.rating === 3,
    );

    // The summary table: one column per metric, and this team's numbers in them.
    await page.getByTestId('scout-view-summary').click();
    await page.waitForSelector('[data-testid="team-summary-table"]', { timeout: 15_000 });
    const headers = await page.locator('[data-testid="team-summary-table"] thead th').allInnerTexts();
    log(`  summary headers: ${JSON.stringify(headers)}`);
    check(
        'the summary table has a column per BIOBUZZ metric',
        GAME.scoring.metrics.every((m) => headers.some((h) => h.toUpperCase().includes(m.label.toUpperCase()))),
    );
    check('Tele tips reads 2', (await page.getByTestId(`cell-${TEAM_NUMBER}-teleopTips`).innerText()).trim() === '2');
    check('the page does not scroll sideways with the table', (await pageOverflows(page)) === false);
    await page.screenshot({ path: `${OUT}/summary-375.png` });

    await page.getByTestId('scout-view-cards').click();
    const card = page.getByTestId('scout-card').filter({ hasText: `#${TEAM_NUMBER}` });
    await card.waitFor({ timeout: 15_000 });
    const cardText = await card.innerText();
    const summaryLabels = fields.filter((f) => f.summary && f.type !== 'rating').map((f) => f.label);
    check('the card shows every summary field', summaryLabels.every((l) => cardText.includes(l)), summaryLabels.join(' | '));
    check('the card quotes the notes', cardText.includes('Fast launcher, tipped twice'));
    await card.screenshot({ path: `${OUT}/card-375.png` });

    // ============================================================ 3. the planner
    log('\n--- Match Planner ---');
    await page.goto(`${APP}/#/app/planner`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="planner-field"]', { timeout: 45_000 });
    const fieldImage = async () =>
        page.evaluate(async () => {
            const img = document.querySelector('img[alt="Field"]');
            if (!img) return null;
            if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; });
            const box = img.getBoundingClientRect();
            return { src: img.getAttribute('src'), natural: img.naturalWidth, w: box.width, h: box.height };
        });
    const online = await fieldImage();
    log(`  image: ${JSON.stringify(online)}`);
    check('the planner draws BiobuzzField.webp', !!online?.src?.endsWith(GAME.field.image));
    check('and the image actually decoded', online?.natural === GAME.field.width, `naturalWidth ${online?.natural}`);
    check('the image has a real box on screen', (online?.w ?? 0) > 200 && (online?.h ?? 0) > 200, `${online?.w}x${online?.h}`);
    const plannerText = await page.locator('body').innerText();
    check(
        'partner capabilities use BIOBUZZ words',
        GAME.planner.partnerCapabilities.every((c) => plannerText.includes(c.label)) && !plannerText.includes('Lifted Park'),
    );
    check('the planner does not overflow at 375px', (await pageOverflows(page)) === false);
    await page.screenshot({ path: `${OUT}/planner-375.png`, fullPage: true });

    // ============================================================ 4. offline
    log('\n--- Offline ---');
    const controlled = await page.evaluate(async () => {
        await navigator.serviceWorker?.ready;
        return !!navigator.serviceWorker?.controller;
    });
    if (!controlled) {
        // The first visit installs the worker; a reload puts the page under its control.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="planner-field"]', { timeout: 45_000 });
    }
    check('a service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker?.controller));
    await context.setOffline(true);
    // A cache-busting query would bypass the precache; fetch the exact URL the planner uses.
    const offline = await page.evaluate(async (src) => {
        try {
            const res = await fetch(src);
            const blob = await res.blob();
            const bmp = await createImageBitmap(blob);
            return { ok: res.ok, type: blob.type, width: bmp.width };
        } catch (e) {
            return { error: String(e) };
        }
    }, online?.src);
    log(`  offline fetch: ${JSON.stringify(offline)}`);
    check('the field image loads with the network off', offline?.ok === true && offline?.width === GAME.field.width);
    await context.setOffline(false);

    // --------------------------------------------------------------- tidy up
    await admin.from('scouting_reports').delete().eq('team_id', team.id).eq('opponent_team_number', TEAM_NUMBER);
} finally {
    if (browser) await browser.close();
    const failed = checks.filter((c) => !c.ok);
    log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    log(`images -> ${OUT}`);
    if (failed.length) process.exitCode = 1;
}
