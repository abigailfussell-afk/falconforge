/**
 * The admin panel's "Generate Link", clicked, in the built app — the check that would have found
 * the SEC-17 regression on 2026-08-28 instead of a coach finding it on 2026-09-14.
 *
 * Every db test of invite codes inserted as `service_role`, so none of them was the role the
 * panel uses. This is: the seeded Iron Falcons admin, their own session, the real button.
 *
 *   npm run build:local && npx vite preview --port 4188 --strictPort
 *   node scripts/probe-invite-panel.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://localhost:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/invite-panel';
const PASSWORD = 'ForgeReview!2026-local';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

mkdirSync(OUT, { recursive: true });
const admin = createClient('http://127.0.0.1:54321', SERVICE_KEY, { auth: { persistSession: false } });
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

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
    await page.waitForSelector('[data-testid="team-picker"], [data-testid="app-nav"]', { timeout: 45_000 });
    if (await page.getByTestId('team-picker').isVisible()) await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    const { data: team, error: teamError } = await admin.from('teams').select('id').eq('name', 'Iron Falcons').single();
    if (teamError) throw new Error(`teams query: ${teamError.message}`);
    const countInvites = async () => {
        const { count, error } = await admin
            .from('invites').select('id', { count: 'exact', head: true }).eq('team_id', team.id);
        if (error) throw new Error(`invites query: ${error.message}`);
        return count ?? 0;
    };
    const before = await countInvites();

    await page.goto(`${APP}/#/app/admin`, { waitUntil: 'domcontentloaded' });
    const button = page.getByRole('button', { name: /Generate Link/ });
    await button.waitFor({ timeout: 45_000 });
    check('Generate Link is enabled for the admin', await button.isEnabled());

    const response = page.waitForResponse(
        (r) => r.url().includes('/rest/v1/invites') && r.request().method() === 'POST',
        { timeout: 15_000 },
    );
    await button.click();
    const res = await response;
    const body = await res.text();
    check('the insert is accepted', res.status() === 201, `${res.status()} ${body.slice(0, 160)}`);

    const code = JSON.parse(body || '{}')?.code;
    if (code) await page.getByText(code, { exact: true }).waitFor({ timeout: 10_000 }).catch(() => {});
    check('the new code is on screen', !!code && (await page.getByText(code, { exact: true }).count()) > 0, code);
    check('no "Failed to create invite"', (await page.getByText('Failed to create invite').count()) === 0);
    check('one more invite row in the database', (await countInvites()) === before + 1);
    await page.screenshot({ path: `${OUT}/after-generate-375.png`, fullPage: true });

    // Tidy: the code just made, not the seeded one.
    if (code) await admin.from('invites').delete().eq('code', code);
} finally {
    if (browser) await browser.close();
    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length) process.exitCode = 1;
}
