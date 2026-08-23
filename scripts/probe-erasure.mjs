/**
 * SEC-11 in the built app — the two destructive tools, actually clicked.
 *
 * The db suite proves what the RPCs do and the unit tests prove what the console sends. Neither
 * has ever pressed the button, and the whole of this project's history says that is where the
 * defect is: of 34 fix commits, 13 were found by running the app and approximately zero by the
 * suite. A destructive control that has never been clicked is the worst kind to ship.
 *
 * What this walks:
 *
 *   1. Erase a real person from the console, and check the DATABASE afterwards rather than the
 *      success banner — the banner is the component's own opinion of what happened.
 *   2. The child guard, in the rendered DOM: no Erase on a managed profile, whose account is
 *      their parent's.
 *   3. Delete a team, with the name typed, and confirm the audit row outlived it.
 *   4. A guardian removing one child from their own screen, and their sibling surviving.
 *
 *   npm run seed:review
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-erasure.mjs
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/sprint-21';
const PASSWORD = 'ForgeReview!2026-local';
const LOCAL_URL = 'http://127.0.0.1:54321';
const SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const admin = createClient(LOCAL_URL, SERVICE_KEY, { auth: { persistSession: false } });
const checks = [];
const check = (label, ok, detail = '') => {
    checks.push({ label, ok });
    log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const signIn = async (page, email) => {
    await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('password-input').fill(PASSWORD);
    await page.getByTestId('sign-in-button').click();
};

let browser;
try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const page = await context.newPage();

    // ============================================================ 1 & 2. the console
    log('\n--- the operator console ---');
    await signIn(page, 'reviewer@falconforge.test');
    await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
    await page.getByTestId('team-option').first().click();
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });

    await page.goto(`${APP}/#/app/operator`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('operator-console').waitFor({ timeout: 45_000 });
    /*
     * SELECT BY NAME, AND THEN PROVE IT.
     *
     * The first version filled the search box and clicked the first row — and the search box is
     * inside a <form onSubmit>, so filling it without submitting leaves the DEFAULT listing on
     * screen. The probe selected "Lapsed Legends", then looked for an Iron Falcons member on it,
     * failed to find them, and reported the child-guard check as a PASS: absence of a button on
     * the wrong team's panel. A vacuous pass on the one assertion that protects a parent's
     * account is exactly `docs/failure-modes.md` §7, and it is why `openTeam` asserts the heading
     * rather than waiting for any heading that mentions a roster.
     */
    const openTeam = async (name) => {
        await page.getByTestId('operator-search').fill(name);
        await page.keyboard.press('Enter');
        await page.getByTestId('operator-directory').waitFor({ timeout: 30_000 });
        await page.locator('[data-testid="operator-directory"] li').filter({ hasText: name }).first().click();
        await page.getByRole('heading', { name: new RegExp(`${name} — roster`, 'i') }).waitFor({ timeout: 30_000 });
    };

    await openTeam('Iron Falcons');

    /*
     * Pick a victim from the DATABASE, not from the screen: the probe needs their user id to check
     * afterwards, and a mentor is chosen because they are neither the sole admin (refused, by
     * design) nor a managed child (no Erase button, by design).
     */
    const { data: team } = await admin.from('teams').select('id, name').eq('name', 'Iron Falcons').single();
    const { data: victim } = await admin
        .from('team_members')
        .select('id, user_id, full_name')
        .eq('team_id', team.id)
        .eq('role', 'mentor')
        .not('user_id', 'is', null)
        .limit(1)
        .single();

    const { data: beforeUser } = await admin
        .from('users').select('email, full_name').eq('id', victim.user_id).single();
    check('the person exists with a real address before anything is clicked',
        beforeUser.email.includes('@falconforge.test'), `${beforeUser.full_name} / ${beforeUser.email}`);

    // --- the child guard, in the rendered DOM -------------------------------------------------
    const { data: childRow } = await admin
        .from('team_members')
        .select('id')
        .eq('team_id', team.id)
        .not('managed_profile_id', 'is', null)
        .limit(1)
        .maybeSingle();
    if (childRow) {
        /*
         * Anchored to a member who IS on the panel: the child's absence only means something if
         * the panel is showing the team the child is on. Checked by requiring a sibling row to be
         * present in the same DOM.
         */
        const anchorPresent = (await page.getByTestId(`erase-user-${victim.id}`).count()) === 1;
        const childButton = page.getByTestId(`erase-user-${childRow.id}`);
        check(
            'no Erase button on a child profile, whose account is their parent’s',
            anchorPresent && (await childButton.count()) === 0,
            anchorPresent ? '' : 'the panel is not showing this team — the check would be vacuous',
        );
    } else {
        check('no Erase button on a child profile, whose account is their parent’s', false,
            'the seed has no managed child on this team — the guard was NOT exercised');
    }

    // --- erase, for real ----------------------------------------------------------------------
    const eraseButton = page.getByTestId(`erase-user-${victim.id}`);
    await eraseButton.waitFor({ timeout: 20_000 });
    await eraseButton.click();
    await page.getByTestId('confirm-erase-user').waitFor({ timeout: 20_000 });
    await page.screenshot({ path: `${OUT}/erase-confirm.png` });
    await page.getByTestId('confirm-erase-user').click();
    await page.waitForTimeout(3000);

    /*
     * THE DATABASE, not the banner. A component that sets a success message without the write
     * landing is exactly the defect class this repo keeps finding, and the banner cannot tell the
     * difference.
     */
    const { data: afterUser } = await admin
        .from('users').select('email, full_name').eq('id', victim.user_id).single();
    check('their address is a tombstone in the database',
        afterUser.email.endsWith('@erased.invalid'), afterUser.email);
    check('their name is gone', afterUser.full_name === 'Erased user', afterUser.full_name);

    const { count: memberships } = await admin
        .from('team_members').select('id', { count: 'exact', head: true }).eq('user_id', victim.user_id);
    check('their memberships are gone', memberships === 0, `${memberships} left`);

    const { data: authUser } = await admin.auth.admin.getUserById(victim.user_id);
    const banned = authUser.user?.banned_until ?? null;
    check('their login no longer works', Boolean(banned) && new Date(banned).getTime() > Date.now(),
        `banned_until ${banned}`);

    /*
     * The team is still a team, which is the point of the whole design — and asserted on MEETINGS
     * rather than tasks. The first version counted tasks and reported "PASS — 0 tasks": the review
     * seed creates none, so it was checking that zero equalled zero. The seed does create 17
     * meetings, so a non-zero requirement here is a requirement rather than a formality.
     */
    const { count: teamMeetings } = await admin
        .from('meetings').select('id', { count: 'exact', head: true }).eq('team_id', team.id);
    check('the team still has its work', (teamMeetings ?? 0) > 0, `${teamMeetings} meetings`);

    // ============================================================ 3. delete a team
    log('\n--- deleting a team ---');
    const { data: doomed } = await admin.from('teams').select('id, name').eq('name', 'Lapsed Legends').single();
    // Counted BEFORE, so "its content went with it" is a requirement rather than 0 === 0.
    const { count: doomedMeetings } = await admin
        .from('meetings').select('id', { count: 'exact', head: true }).eq('team_id', doomed.id);
    const { count: doomedMembers } = await admin
        .from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', doomed.id);
    check('the doomed team has content to lose', (doomedMembers ?? 0) > 0,
        `${doomedMembers} members, ${doomedMeetings} meetings`);

    await openTeam('Lapsed Legends');

    const deleteButton = page.getByTestId('delete-team');
    check('the delete button is inert until the name is typed', await deleteButton.isDisabled());

    await page.getByTestId('delete-team-confirm').fill('lapsed legends');
    check('a lower-case near-miss does not arm it', await page.getByTestId('delete-team').isDisabled());

    await page.getByTestId('delete-team-confirm').fill(doomed.name);
    await page.getByTestId('delete-team-notes').fill('probe: closing the team');
    await page.screenshot({ path: `${OUT}/delete-team-armed.png` });
    await page.getByTestId('delete-team').click();
    await page.waitForTimeout(3000);

    const { data: goneTeam } = await admin.from('teams').select('id').eq('id', doomed.id).maybeSingle();
    check('the team is gone', goneTeam === null);

    const { count: orphanMembers } = await admin
        .from('team_members').select('id', { count: 'exact', head: true }).eq('team_id', doomed.id);
    const { count: orphanMeetings } = await admin
        .from('meetings').select('id', { count: 'exact', head: true }).eq('team_id', doomed.id);
    check('its content went with it', orphanMembers === 0 && orphanMeetings === 0,
        `${orphanMembers} members and ${orphanMeetings} meetings left, from ${doomedMembers}/${doomedMeetings}`);

    /*
     * THE AUDIT ROW OUTLIVED IT, which it could not before this sprint: `operator_actions.team_id`
     * was NOT NULL with ON DELETE CASCADE, so a deletion erased the record of itself.
     */
    const { data: audit } = await admin
        .from('operator_actions').select('team_id, detail, notes')
        .eq('action', 'team_delete').order('created_at', { ascending: false }).limit(1).maybeSingle();
    check('the deletion is recorded, and the record survived the team',
        Boolean(audit) && audit.team_id === null && audit.detail?.team_name === doomed.name,
        audit ? `team_id=${audit.team_id}, name in detail=${audit.detail?.team_name}` : 'no row');

    // ============================================================ 4. a guardian removes a child
    log('\n--- a guardian removing one child ---');
    /*
     * A SEPARATE CONTEXT. A new page in the same context shares storage, so it is already signed
     * in as the operator and `/#/login` redirects straight past the form — which is what the first
     * run hit. Two people is two browsers.
     */
    const guardianContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await guardianContext.route('**://*.supabase.co/**', (route) => {
        throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
    });
    const guardianPage = await guardianContext.newPage();
    await signIn(guardianPage, 'guardian@falconforge.test');
    await guardianPage.waitForTimeout(4000);
    await guardianPage.goto(`${APP}/#/app/guardian`, { waitUntil: 'domcontentloaded' });
    await guardianPage.getByTestId('guardian-children').waitFor({ timeout: 45_000 });

    const cards = guardianPage.locator('[data-testid="guardian-children"] > li');
    const before = await cards.count();
    check('the guardian has more than one child, so the sibling case is real', before > 1, `${before} children`);

    const removeButton = guardianPage.locator('[data-testid^="remove-child-"]').first();
    await removeButton.waitFor({ timeout: 20_000 });
    const removedId = (await removeButton.getAttribute('data-testid')).replace('remove-child-', '');
    await removeButton.click();
    await guardianPage.getByTestId('confirm-remove-child').waitFor({ timeout: 20_000 });
    await guardianPage.screenshot({ path: `${OUT}/remove-child-confirm.png` });
    await guardianPage.getByTestId('confirm-remove-child').click();

    // Wait for the QUEUE to drain, not for a guess: the delete is a background push.
    let profileGone = false;
    for (let i = 0; i < 25; i++) {
        await guardianPage.waitForTimeout(1000);
        const { data } = await admin.from('managed_profiles').select('id').eq('id', removedId).maybeSingle();
        if (data === null) { profileGone = true; break; }
    }
    check('the child is gone from the database, not just the screen', profileGone);

    /*
     * THE SIBLING BY NAME, not a global count. "some managed profiles remain" is satisfied by a
     * removal that took this guardian's other child and left a stranger's — which is the exact
     * failure the store test's sibling control exists for, and it deserves the same treatment
     * here where the cascade is real.
     */
    const { data: guardianUser } = await admin
        .from('users').select('id').eq('email', 'guardian@falconforge.test').single();
    const { count: siblingsLeft } = await admin
        .from('managed_profiles').select('id', { count: 'exact', head: true })
        .eq('guardian_user_id', guardianUser.id);
    check('their sibling is untouched', siblingsLeft === before - 1,
        `${siblingsLeft} of this guardian's children remain, from ${before}`);

    const { count: orphanConsents } = await admin
        .from('guardian_consents').select('id', { count: 'exact', head: true })
        .eq('managed_profile_id', removedId);
    check('their consents cascaded', orphanConsents === 0, `${orphanConsents} left`);

    const { count: orphanMembership } = await admin
        .from('team_members').select('id', { count: 'exact', head: true })
        .eq('managed_profile_id', removedId);
    check('their team membership cascaded', orphanMembership === 0, `${orphanMembership} left`);

    await guardianPage.screenshot({ path: `${OUT}/guardian-after.png`, fullPage: true });
    log(`\nscreenshots: ${OUT}/`);
} finally {
    await browser?.close();
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
    for (const f of failed) log(`  FAILED: ${f.label}`);
    process.exitCode = 1;
}
