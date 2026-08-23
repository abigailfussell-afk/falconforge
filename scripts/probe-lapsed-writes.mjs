/**
 * WALK-B-12 / SEC-07 — the probe the walkthrough got wrong, run properly.
 *
 * The walkthrough recorded `[lapsed] New Item enabled=true` and then failed to verify what
 * happened when the write went through: its script clicked "Add Checklist Item" instead of the
 * task dialog's Save, so no 403 was ever recorded and the report says so — *"whether the user
 * sees the terminal message is unverified"*.
 *
 * This does the two halves properly:
 *
 *   1. Walks every content screen as the lapsed admin and records, for each New/Edit/Save
 *      control, whether it is disabled and what its `title` says. A disabled control with no
 *      reason is `docs/failure-modes.md` §8 and is counted separately from a live one.
 *   2. Captures 375 px and 1280 px images of each screen.
 *
 * The other half of the exit criterion — a write QUEUED BEFORE the lapse and drained after —
 * cannot be produced by clicking at all now that the controls are disabled, which is the whole
 * point of the fix. It is `probe-queued-before-lapse.mjs`, which revokes the licence underneath
 * a queued write.
 *
 * ENVIRONMENT IS PASSED EXPLICITLY, NEVER INHERITED. `.env.local` points at the hosted
 * project. This talks only to whatever is already being served on PROBE_URL, and asserts below
 * that the app it loaded is pointed at the local stack before it signs anybody in.
 *
 *   npx vite build --mode development && npx vite preview --port 4188
 *   node scripts/probe-lapsed-writes.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const APP = process.env.PROBE_URL ?? 'http://127.0.0.1:4188';
const OUT = process.env.PROBE_OUT ?? 'screenshots/walkb12';
const PASSWORD = 'ForgeReview!2026-local';

mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

const VIEWS = [
    { file: 'board', nav: 'kanban', path: 'board', controls: ['new-task-button'] },
    { file: 'checklist', nav: 'checklist', path: 'checklist', controls: ['edit-checklist', 'reset-checklist'] },
    { file: 'scouting', nav: 'scouting', path: 'scouting', controls: ['scout-match'] },
    { file: 'planner', nav: 'planner', path: 'planner', controls: ['save-plan'] },
    { file: 'meetings', nav: 'meetings', path: 'meetings', controls: ['new-event'] },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 375, height: 812 } });

/*
 * THE NETWORK GUARD, and it is the first line rather than the second. Every sprint report that
 * leaned on "the build points at the local stack" was reading a file; this reads the requests.
 */
await context.route('**://*.supabase.co/**', (route) => {
    throw new Error(`probe tried to reach PRODUCTION: ${route.request().url()}`);
});

const page = await context.newPage();

await page.goto(`${APP}/#/login`, { waitUntil: 'domcontentloaded' });
await page.getByTestId('email-input').fill('lapsed@falconforge.test');
await page.getByTestId('password-input').fill(PASSWORD);
await page.getByTestId('sign-in-button').click();

await page.getByTestId('team-picker').waitFor({ state: 'visible', timeout: 45_000 });
await page.getByTestId('team-option').first().click();
await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });
await page.waitForSelector('[data-testid="licence-lapsed-banner"]', { timeout: 45_000 });
log('signed in as lapsed@ — the lapsed banner is on screen\n');

const findings = {};
for (const view of VIEWS) {
    /*
     * `page.goto`, which is a FULL DOCUMENT LOAD, and not a rail click.
     *
     * Two hash URLs do not reload, so `goto` between them screenshots the previous view --
     * Sprint 8's defect. But at 375 px the rail is a drawer and its links sit outside the
     * viewport, so a click times out. `goto` avoids both: it boots the app from scratch, which
     * is slower and is what `e2e/helpers.ts` does for the same reason. The `aria-current` wait
     * below is what makes it a real navigation rather than a hopeful one.
     */
    await page.goto(`${APP}/#/app/${view.path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="app-nav"]', { state: 'attached', timeout: 45_000 });
    await page.waitForSelector(`[data-testid="nav-${view.nav}"][aria-current="page"]`, {
        state: 'attached',
        timeout: 30_000,
    });
    await page.waitForSelector('[aria-label="Loading view"]', { state: 'detached', timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(600);

    findings[view.file] = {};
    for (const id of view.controls) {
        const el = page.getByTestId(id).first();
        findings[view.file][id] =
            (await el.count()) === 0
                ? 'ABSENT'
                : { disabled: await el.isDisabled(), title: await el.getAttribute('title') };
    }

    await page.screenshot({ path: `${OUT}/${view.file}-375.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${view.file}-1280.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(400);
}

log(JSON.stringify(findings, null, 2));

const all = Object.values(findings).flatMap((v) => Object.values(v));
const absent = all.filter((c) => c === 'ABSENT');
const live = all.filter((c) => c !== 'ABSENT' && !c.disabled);
const mute = all.filter((c) => c !== 'ABSENT' && c.disabled && !c.title);
log(
    `\n${all.length} write controls · ${absent.length} not rendered · ` +
        `${live.length} STILL LIVE · ${mute.length} disabled with NO REASON`,
);

await browser.close();
log(`images -> ${OUT}`);

if (live.length > 0 || mute.length > 0) process.exitCode = 1;
