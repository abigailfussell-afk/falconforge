/**
 * P-02 — the summary table, measured at 375 px.
 *
 * The unit tests assert what the table CONTAINS and how it sorts. They cannot assert that it
 * fits: jsdom applies no stylesheet, so it renders a table that scrolls inside itself and one
 * that drags the whole page sideways identically (`docs/environment-divergences.md` §3).
 *
 * That gap matters here more than usual. A scouting lead uses this at a venue, on a phone, and a
 * game with eight metrics is wider than any phone — so the table HAS to scroll horizontally
 * inside its own box while the page does not. Getting that wrong is the difference between a
 * usable table and an app that shudders sideways every time somebody scrolls.
 *
 * And the CSV, which is the other thing no unit test proves: that the click produces a file. The
 * spec intercepts the download rather than trusting the handler ran.
 */
import { test, expect } from '@playwright/test';
import { createTeam, goToView, guardLocalBackend, registerAccount, unique, uniqueEmail } from './helpers';

test.describe('the scouting summary (P-02)', () => {
    test('scrolls inside itself at 375px, and the page does not @mobile', async ({ page, context }) => {
        await guardLocalBackend(context);
        await page.setViewportSize({ width: 375, height: 812 });

        await registerAccount(page, { fullName: 'Scout Lead', email: uniqueEmail('scout') });
        await createTeam(page, { teamName: unique('Scouts') });
        await goToView(page, 'scouting', 'scouting');

        // Two reports for one team, so the summary has a mean AND a spread to render.
        for (const [match, score] of [[1, 40], [2, 20]] as const) {
            await page.getByTestId('scout-match').click();
            await page.getByTestId('scout-team-number').fill('30727');
            await page.getByTestId('scout-match-number').fill(String(match));
            await page.getByTestId('scout-alliance').selectOption('red');
            await page.getByTestId('scout-station').selectOption('1');
            await page.getByTestId('scout-event-name').fill('League Meet 1');
            await page.getByTestId('field-autoScore').fill(String(score));
            await page.getByTestId('save-scouting-report').click();
        }

        const table = page.getByTestId('team-summary-table');
        await expect(table).toBeVisible();

        // The mean of 40 and 20, with the population spread beside it.
        await expect(page.getByTestId('cell-30727-autoScore')).toHaveText('30±10.0');

        const geometry = await page.evaluate(() => {
            const t = document.querySelector('[data-testid="team-summary-table"]') as HTMLElement;
            const wrap = t.parentElement as HTMLElement;
            return {
                tableWidth: t.getBoundingClientRect().width,
                wrapClient: wrap.clientWidth,
                wrapScroll: wrap.scrollWidth,
                overflowX: getComputedStyle(wrap).overflowX,
                docScroll: document.documentElement.scrollWidth,
                docClient: document.documentElement.clientWidth,
            };
        });

        // The table is wider than its box — which is the case being tested, not a problem.
        expect(geometry.wrapScroll, 'the table is not wide enough to test the overflow').toBeGreaterThan(
            geometry.wrapClient,
        );
        expect(geometry.overflowX, 'the table cannot scroll inside its own box').toBe('auto');
        // ...and the PAGE does not move. This is the assertion the whole spec exists for.
        expect(geometry.docScroll, 'the page scrolls sideways at 375px').toBeLessThanOrEqual(
            geometry.docClient,
        );

        /*
         * Every sortable header is a real tap target — ON A TOUCH DEVICE.
         *
         * `touch-target`'s 32px floor is gated on `@media (pointer: coarse)`, deliberately: the
         * desktop stays compact, and WALK-A-10's own finding was that 64 of its 123 "too small"
         * controls were a measurement artefact from resizing a FINE-pointer browser to 375px.
         * This pack runs the `@mobile` tag under both projects, so the assertion asks the page
         * which kind of pointer it has rather than assuming the width implies one.
         */
        const tap = await page.evaluate(() => ({
            coarse: matchMedia('(pointer: coarse)').matches,
            heights: [...document.querySelectorAll('[data-testid^="sort-"]')].map(
                (e) => e.getBoundingClientRect().height,
            ),
        }));
        expect(tap.heights.length, 'no sortable headers were found at all').toBeGreaterThan(0);
        if (tap.coarse) {
            expect(Math.min(...tap.heights)).toBeGreaterThanOrEqual(32);
        }
    });

    test('exports a CSV with one row per report @mobile', async ({ page, context }) => {
        await guardLocalBackend(context);
        await page.setViewportSize({ width: 375, height: 812 });

        await registerAccount(page, { fullName: 'Export Lead', email: uniqueEmail('export') });
        await createTeam(page, { teamName: unique('Exporters') });
        await goToView(page, 'scouting', 'scouting');

        await page.getByTestId('scout-match').click();
        await page.getByTestId('scout-team-number').fill('8412');
        await page.getByTestId('scout-match-number').fill('1');
        await page.getByTestId('scout-alliance').selectOption('blue');
        await page.getByTestId('scout-event-name').fill('League Meet 1');
        await page.getByTestId('save-scouting-report').click();

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByTestId('scout-export-csv').click(),
        ]);

        expect(download.suggestedFilename()).toMatch(/^scouting-.*\.csv$/);

        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const csv = Buffer.concat(chunks).toString('utf8');

        const lines = csv.split('\r\n');
        expect(lines, 'header plus one row').toHaveLength(2);
        expect(lines[0]).toContain('"Team","Match","Alliance","Station","Event"');
        expect(lines[1]).toContain('"8412","1","blue"');
    });
});
