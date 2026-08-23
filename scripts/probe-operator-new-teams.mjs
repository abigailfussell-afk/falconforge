/**
 * D3's operator console, in the built app — the one surface in this sprint the e2e pack does
 * not reach.
 *
 * The console lives behind `is_platform_operator()`, which the seeded reviewer account holds,
 * and it is the screen Kevin will use every week under D3: registrations arrive on a 30-day
 * probation and the operator extends them to season length once the number has been eyeballed.
 * `docs/v2-schema.md` currently documents that extension as SQL to paste into psql.
 *
 * What this checks, in a real build against the local stack:
 *
 *   1. A newly registered team appears in the new-team panel, with its age and — the field
 *      that carries the decision — whether anybody has used it.
 *   2. "Extend to the season" works from the row, and the team's cover afterwards is the end
 *      of the season rather than 30 days out.
 *   3. The probation grant is still there afterwards, so the audit trail keeps the fact that
 *      one happened.
 *   4. It renders at 375 px without horizontal overflow, because Kevin will do this on a phone
 *      at some point and every other operator screen in this repo was built desktop-first.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-operator-new-teams.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/d3-operator';
const PASSWORD = 'ForgeReview!2026-local';

const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });

/*
 * A brand-new team, created the way a coach creates one — through the RPC, so it carries the
 * real probation grant rather than a row this script invented. Inserting the grant by hand
 * would make every assertion below a statement about the fixture.
 */
const number = String(70_000 + Math.floor(Math.random() * 20_000));
const email = `d3-probe-${Date.now()}@falconforge.test`;
const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'Probe Coach', age_classification: '18_plus' },
});
if (userErr) throw userErr;
await admin.from('user_attestations').insert({
    user_id: created.user.id,
    attestation_type: 'coach_terms',
    version: '1.0',
});

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    // ---------------------------------------------------- the coach registers
    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
    await page.waitForURL(/#\/(onboarding|app)/, { timeout: 45_000 });

    await page.goto(`${APP}/#/create-team`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('checkbox').first().check();
    await page.getByRole('button', { name: /^Next$/ }).click();
    await page.getByPlaceholder('e.g., Falcon Force').fill('D3 Probe Robotics');
    await page.getByPlaceholder('e.g., 12345').fill(number);
    await page.getByRole('button', { name: /create team/i }).click();
    await page.getByRole('button', { name: 'Go to Dashboard' }).waitFor({ timeout: 45_000 });
    log(`registered #${number} D3 Probe Robotics`);

    const { data: before } = await admin
        .from('team_entitlement')
        .select('valid_until, is_probation, status')
        .eq('team_id', (await admin.from('teams').select('id').eq('team_number', number).single()).data.id)
        .single();
    const daysBefore = Math.round(
        (new Date(before.valid_until).getTime() - Date.now()) / 86_400_000,
    );
    log(`cover before: ${daysBefore} days, is_probation=${before.is_probation}`);

    /*
     * ---------------------------------------------------- the operator looks
     *
     * A FRESH CONTEXT, not `clearCookies()` on the old one. The session lives in
     * `localStorage`, and clearing cookies leaves it — the first version of this probe then
     * navigated to `/#/login`, was silently redirected back into the app as the coach, and
     * timed out waiting for an email field that was never going to render. A second context
     * has no shared state to get wrong.
     */
    const opCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await opCtx.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const opPage = await opCtx.newPage();
    await opPage.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await opPage.getByTestId('email-input').fill('reviewer@falconforge.test');
    await opPage.getByTestId('password-input').fill(PASSWORD);
    await opPage.getByTestId('sign-in-button').click();
    await opPage.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await opPage.getByTestId('team-option').first().click();
    await opPage.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    // The operator console is its own route (`App.tsx`), not a panel on Admin Settings.
    await opPage.goto(`${APP}/#/app/operator`, { waitUntil: 'domcontentloaded' });
    await opPage.waitForSelector('[data-testid="operator-new-teams"]', { timeout: 45_000 });
    await opPage.waitForTimeout(600);

    const row = opPage.locator('[data-testid="operator-new-teams"] li', {
        hasText: 'D3 Probe Robotics',
    });
    const rowText = await row.innerText();
    log(`\nthe row the operator reads:\n  ${rowText.replace(/\n/g, '\n  ')}`);

    const overflow = await opPage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    log(`horizontal overflow at 375px: ${overflow}`);
    await opPage.screenshot({ path: `${OUT}/new-teams-375.png` });
    await opPage.setViewportSize({ width: 1280, height: 900 });
    await opPage.waitForTimeout(400);
    await opPage.screenshot({ path: `${OUT}/new-teams-1280.png` });
    await opPage.setViewportSize({ width: 375, height: 812 });

    // ---------------------------------------------------- one click
    await row.getByTestId('extend-to-season').click();
    await opPage.waitForSelector('[role="status"]', { timeout: 30_000 });
    const banner = await opPage.locator('[role="status"]').first().innerText();
    log(`\nafter the click: ${JSON.stringify(banner)}`);
    await opPage.screenshot({ path: `${OUT}/extended-375.png` });

    const teamId = (await admin.from('teams').select('id').eq('team_number', number).single()).data.id;
    const { data: after } = await admin
        .from('team_entitlement')
        .select('valid_until, is_probation, status')
        .eq('team_id', teamId)
        .single();
    const { data: grants } = await admin
        .from('license_grants')
        .select('valid_until, revoked_at, notes')
        .eq('team_id', teamId)
        .order('valid_until');

    log(`\ncover after : ${after.valid_until} (is_probation=${after.is_probation})`);
    log(`grants      : ${grants.length}, revoked: ${grants.filter((g) => g.revoked_at).length}`);
    for (const g of grants) log(`  - ${g.valid_until} :: ${g.notes}`);

    const until = new Date(after.valid_until);
    const ok =
        rowText.includes(number) &&
        /Nobody has used it yet/.test(rowText) &&
        /Registered today/.test(rowText) &&
        daysBefore >= 29 && daysBefore <= 30 &&
        before.is_probation === true &&
        after.is_probation === false &&
        until.getUTCMonth() === 3 &&
        until.getUTCDate() === 30 &&
        grants.length === 2 &&
        grants.every((g) => g.revoked_at === null) &&
        overflow === false;

    log(`\n${ok ? 'PASS' : 'FAIL'} — all of: row shows number + unused + age, 30 days before, `
        + 'season end after, probation row kept, no 375px overflow');
    if (!ok) process.exitCode = 1;
} finally {
    await admin.from('teams').delete().eq('team_number', number);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    if (browser) await browser.close();
    log(`\nimages -> ${OUT}`);
}
