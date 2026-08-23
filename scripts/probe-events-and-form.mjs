/**
 * Sprint 18's two new screens, in the built app, at 375 px (D2, D4(b)).
 *
 * The unit suite renders both against mocks and the db suite proves the policies. Neither can
 * see what this sees — that the whole thing works end to end on a real build against real
 * Postgres, which is where thirteen of this repo's thirty-four fixes came from and where none
 * came from the suite.
 *
 * What it walks:
 *
 *   1. Competitions — create an event by hand, paste the REAL row from the FIRST page, read
 *      the preview, confirm, and check the rows landed with the right alliances and stations.
 *   2. The preview is load-bearing (D2): the scores must not appear as teams, and the warning
 *      must say so in words a coach can check against the page.
 *   3. Your scouting form — hide a field, rename a field, add one, save, then open the scouting
 *      modal and see the result. That last step is the one nothing else covers: it is the join
 *      between `team_game_overrides` and what a scout actually types into.
 *   4. 375 px, with no horizontal overflow, because a coach does this in a pit.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-events-and-form.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-18';
const PASSWORD = 'ForgeReview!2026-local';

const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** The row this whole feature was designed against, verified 2026-08-23 on the real page. */
const REAL_ROW =
    'Qualification 1 Sat 2/21 - 11:42 AM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas 108 11';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });

const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    // Console errors, kept for the diagnostics below. A push that fails silently is the exact
    // class this repo has fixed most often; the browser usually said something.
    const consoleErrors = [];
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text().slice(0, 300));
    });
    /*
     * The RESPONSE BODY of any refused write. "409 Conflict" in the console names the status and
     * not the constraint, and the constraint is the whole answer — PostgREST maps both a unique
     * violation and a FOREIGN KEY violation to 409, which are opposite problems.
     */
    page.on('response', async (res) => {
        if (res.status() < 400) return;
        const body = await res.text().catch(() => '');
        const sent = res.request().postData()?.slice(0, 200) ?? '';
        consoleErrors.push(
            `${res.status()} ${res.url().split('/rest/v1/')[1] ?? res.url()}
      sent: ${sent}
      got : ${body.slice(0, 200)}`,
        );
    });

    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill('reviewer@falconforge.test');
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    const { data: team } = await admin
        .from('teams').select('id, team_number').eq('name', 'Iron Falcons').single();

    // ============================================================ 1. competitions
    log('\n--- Competitions (D2) ---');
    await page.goto(`${APP}/#/app/events`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="competition-events"]', { timeout: 45_000 });

    const eventName = `Probe Qualifier ${Date.now()}`;
    await page.getByTestId('new-event-name').fill(eventName);
    await page.getByTestId('new-event-date').fill('2027-02-21');
    await page.getByTestId('add-event').click();
    /*
     * WAIT FOR THE DRAIN, not for a guess. The first version waited 800 ms and reported the
     * event missing; the diagnostic showed it sitting in the queue at retry=0, because the
     * push is a background drain on a 3s-first backoff and "I pressed Save" and "the server
     * has it" are different moments (`e2e/helpers.ts`'s `waitForSync` exists for exactly this).
     * Polling the DATABASE rather than the indicator: this probe is asking whether the row
     * landed, so the row is what it should watch.
     */
    for (let i = 0; i < 20; i++) {
        const { count } = await admin
            .from('competition_events')
            .select('id', { count: 'exact', head: true })
            .eq('name', eventName);
        if (count) break;
        await page.waitForTimeout(1000);
    }

    const { data: events } = await admin
        .from('competition_events').select('id, name, starts_on').eq('name', eventName);

    if (!events?.length) {
        // Where did it stop? Local store, queue, or refused by the server.
        const diag = await page.evaluate(async () => {
            const req = indexedDB.open('FalconForgeDB');
            const db = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            const read = async (store) => {
                if (!db.objectStoreNames.contains(store)) return [];
                const tx = db.transaction(store, 'readonly');
                return new Promise((res, rej) => {
                    const r = tx.objectStore(store).getAll();
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
            };
            const queue = await read('syncQueue');
            const failures = await read('syncFailures');
            return {
                queued: queue.map((q) => `${q.tableName}/${q.operation} retry=${q.retryCount}`),
                failed: failures.map((f) => `${f.tableName}: ${f.terminalReason ?? f.lastError}`),
            };
        });
        console.log('  DIAG queue :', JSON.stringify(diag.queued));
        console.log('  DIAG failed:', JSON.stringify(diag.failed));
    }
    check('an event created by hand reaches the database', events?.length === 1);
    /*
     * THE DATE, UNSHIFTED. A `YYYY-MM-DD` round-tripped through a Date renders one day early at
     * negative UTC offsets — `docs/failure-modes.md` §10, which this project has shipped twice
     * and which for "which day is the competition" is the whole value of the field. This
     * machine is US Central, so it is the failing case.
     */
    check(
        'the date is stored as typed, not shifted a day',
        events?.[0]?.starts_on === '2027-02-21',
        `stored ${events?.[0]?.starts_on}`,
    );

    // ------------------------------------------------------- 2. paste, preview, confirm
    await page.getByTestId('import-schedule').click();
    await page.waitForSelector('[data-testid="schedule-paste"]', { timeout: 15_000 });
    await page.getByTestId('schedule-paste').fill(REAL_ROW);
    await page.waitForTimeout(400);

    const previewText = await page.getByTestId('paste-preview').innerText();
    log(`\n  the preview a coach reads:\n    ${previewText.replace(/\n/g, '\n    ')}`);

    check('the preview lists the four teams', /22857[\s\S]*8424[\s\S]*15654[\s\S]*25756/.test(previewText));
    /*
     * D2's load-bearing step. 108 and 11 are the SCORES and both are valid FTC team numbers;
     * putting them in an alliance would give this match six robots. The warning must name them,
     * because "3 warnings" is not checkable against the page and this is.
     */
    const warnText = await page.getByTestId('paste-preview-warnings').innerText();
    check('the scores are called out rather than imported', /108/.test(warnText) && /scores/i.test(warnText));

    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check('no horizontal overflow at 375px', overflow === false);
    await page.screenshot({ path: `${OUT}/paste-preview-375.png` });

    await page.getByTestId('paste-confirm').click();
    /*
     * SCOPED TO THIS EVENT'S MATCHES, not to the team.
     *
     * The first version counted every participant the team had, so a leftover row from an
     * earlier run of this probe satisfied it instantly and the probe then reported the new
     * rows missing — a wait condition that was already true before the thing it waits for
     * happened. `docs/failure-modes.md` §2's third variant: a precondition that short-circuits
     * before the assertion is reached.
     */
    for (let i = 0; i < 25; i++) {
        const { data: mine } = await admin
            .from('event_matches').select('id').eq('event_id', events[0].id);
        if (mine?.length) {
            const { count } = await admin
                .from('match_participants')
                .select('id', { count: 'exact', head: true })
                .in('match_id', mine.map((m) => m.id));
            if ((count ?? 0) >= 4) break;
        }
        await page.waitForTimeout(1000);
    }

    const { data: matches } = await admin
        .from('event_matches').select('id, match_number, phase').eq('event_id', events[0].id);

    if (!matches?.length) {
        const diag = await page.evaluate(async () => {
            const req = indexedDB.open('FalconForgeDB');
            const db = await new Promise((res, rej) => {
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
            });
            const read = async (store) => {
                if (!db.objectStoreNames.contains(store)) return [];
                const tx = db.transaction(store, 'readonly');
                return new Promise((res, rej) => {
                    const r = tx.objectStore(store).getAll();
                    r.onsuccess = () => res(r.result);
                    r.onerror = () => rej(r.error);
                });
            };
            return {
                queued: (await read('syncQueue')).map((q) => `${q.tableName}/${q.operation} retry=${q.retryCount}`),
                failed: (await read('syncFailures')).map((f) => `${f.tableName}: ${f.terminalReason ?? JSON.stringify(f.lastError)}`),
            };
        });
        console.log('  DIAG queue :', JSON.stringify(diag.queued));
        console.log('  DIAG failed:', JSON.stringify(diag.failed));
        console.log('  DIAG note  :', await page.getByTestId('import-note').innerText().catch(() => '(none)'));
        console.log('  DIAG console:', JSON.stringify(consoleErrors.slice(-8), null, 1));
    }
    check('the match landed', matches?.length === 1 && matches[0].match_number === 1);

    const { data: people } = await admin
        .from('match_participants')
        .select('alliance, station, team_number, team_name')
        .eq('match_id', matches?.[0]?.id ?? '00000000-0000-0000-0000-000000000000')
        .order('alliance')
        .order('station');

    log(`\n  participants as stored:\n    ${(people ?? []).map((p) => `${p.alliance}${p.station} ${p.team_number} ${p.team_name}`).join('\n    ')}`);
    check('four participants, as ROWS', people?.length === 4);
    check(
        'red 1 and 2, blue 1 and 2, in schedule order',
        JSON.stringify((people ?? []).map((p) => `${p.alliance}${p.station}:${p.team_number}`)) ===
            JSON.stringify(['blue1:15654', 'blue2:25756', 'red1:22857', 'red2:8424']),
    );
    check(
        'the last team name is not the scores',
        people?.some((p) => p.team_number === '25756' && p.team_name === 'Nano Ninjas'),
        people?.find((p) => p.team_number === '25756')?.team_name ?? '',
    );

    await page.screenshot({ path: `${OUT}/schedule-375.png` });

    // ============================================================ 3. your scouting form
    log('\n--- Your scouting form (D4(b)) ---');
    await page.goto(`${APP}/#/app/admin`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="form-field-list"]', { timeout: 45_000 });

    await page.getByTestId('toggle-farShooting').click();
    await page.getByTestId('label-shotsTaken').fill('Attempts');
    await page.getByTestId('new-field-label').fill('Climbed');
    await page.getByTestId('new-field-type').selectOption('bool');
    await page.getByTestId('add-field').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/form-settings-375.png` });
    await page.getByTestId('save-form-overrides').click();
    for (let i = 0; i < 20; i++) {
        const { count } = await admin
            .from('team_game_overrides')
            .select('id', { count: 'exact', head: true })
            .eq('team_id', team.id);
        if (count) break;
        await page.waitForTimeout(1000);
    }

    const { data: override } = await admin
        .from('team_game_overrides').select('patch, base_definition_id').eq('team_id', team.id).maybeSingle();
    log(`\n  patch as stored: ${JSON.stringify(override?.patch)}`);
    check('the patch reached the database', !!override);
    check('it records which template it was written against', override?.base_definition_id === 'ftc-2025-decode');
    check('it hides the field that was hidden', (override?.patch?.hide ?? []).includes('farShooting'));
    check('it relabels the field that was relabelled', override?.patch?.relabel?.shotsTaken === 'Attempts');
    check('it adds the field that was added', (override?.patch?.add ?? []).length === 1);

    /*
     * THE JOIN NOTHING ELSE COVERS: does the SCOUT see it? A patch that reaches the database and
     * not the form is a gate with no door in the other direction.
     */
    await page.goto(`${APP}/#/app/scouting`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="scout-match"]', { timeout: 45_000 });
    await page.getByTestId('scout-match').click();
    await page.waitForSelector('[data-testid="schema-form"]', { timeout: 15_000 });

    const formText = await page.getByTestId('schema-form').innerText();
    check('the hidden field is gone from the scouting form', !/Far Shooting/i.test(formText));
    check('the relabelled field shows the team’s own word', /Attempts/.test(formText));
    check('the added field is on the form', /Climbed/.test(formText));
    check(
        'the fields the team did not touch are untouched',
        /Has Autonomous/i.test(formText) && /Intake Type/i.test(formText),
    );

    const modalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    check('the scouting modal does not overflow at 375px', modalOverflow === false);
    await page.screenshot({ path: `${OUT}/scouting-form-375.png` });

    // --------------------------------------------------------------- tidy up
    await admin.from('competition_events').delete().eq('id', events[0].id);
    await admin.from('team_game_overrides').delete().eq('team_id', team.id);
} finally {
    if (browser) await browser.close();
    const failed = checks.filter((c) => !c.ok);
    log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    log(`images -> ${OUT}`);
    if (failed.length) process.exitCode = 1;
}
