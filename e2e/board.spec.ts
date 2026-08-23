import { test, expect } from '@playwright/test';
import { createTeam, goToView, guardLocalBackend, registerAccount, unique, uniqueEmail, waitForSync } from './helpers';

/**
 * The sprint board, in a browser (OPS-13).
 *
 * It is the daily-use screen and it had **no browser-level coverage at all** — 21 tests across
 * registration, invites, offline sync, meetings and the team lifecycle, and none of them opened
 * a task. Its component suite was also the weakest in the repo until this sprint: four of
 * OPS-02's seven assertion-free tests were in it.
 *
 * What this adds that the unit suite structurally cannot: the round trip. A task created here
 * goes through the store, the sync queue, real PostgREST, real RLS and back through the read
 * path — and then survives a reload, which throws away every scrap of in-memory state. A card
 * that only ever existed in Zustand disappears at that point, and that is the failure worth
 * catching.
 */
test.describe('the sprint board', () => {
    test.beforeEach(async ({ context }) => {
        await guardLocalBackend(context);
    });

    test('a task survives the round trip to the database and back @mobile', async ({ page }) => {
        await registerAccount(page, { fullName: 'Board Coach', email: uniqueEmail('board') });
        await createTeam(page, { teamName: unique('Board Falcons') });
        await goToView(page, 'kanban', 'board');

        const title = unique('Rebuild the intake');

        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(title);
        await page.getByTestId('save-task').click();

        await expect(page.getByText(title)).toBeVisible();
        await waitForSync(page);

        /*
         * The reload is the assertion. Everything above could be satisfied by React state; only
         * a row that reached Postgres and came back through `pullFromServer` survives this.
         */
        await page.reload();
        await goToView(page, 'kanban', 'board');
        await expect(
            page.getByText(title),
            'the task did not survive a reload — it never reached the database',
        ).toBeVisible();
    });

    test('a task opens, edits and keeps the edit @mobile', async ({ page }) => {
        await registerAccount(page, { fullName: 'Edit Coach', email: uniqueEmail('edit') });
        await createTeam(page, { teamName: unique('Edit Falcons') });
        await goToView(page, 'kanban', 'board');

        const title = unique('Wire the arm');
        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(title);
        await page.getByTestId('save-task').click();
        await expect(page.getByText(title)).toBeVisible();
        await waitForSync(page);

        // Reopen it and move it across the board.
        await page.getByText(title).click();
        await expect(page.getByTestId('task-title-input')).toHaveValue(title);
        await page.getByTestId('task-status-select').selectOption('In Progress');
        await page.getByTestId('save-task').click();
        await waitForSync(page);

        await page.reload();
        await goToView(page, 'kanban', 'board');
        await page.getByText(title).click();
        await expect(
            page.getByTestId('task-status-select'),
            'the status change did not persist',
        ).toHaveValue('In Progress');
    });

    test('a comment is attributed to its author, not to "Guest" (FEAT-01)', async ({ page }) => {
        /*
         * FEAT-01 in a real browser, against real RLS. The unit round-trip proves the writer and
         * the reader agree about the id; this proves the id that reaches Postgres is one the
         * roster can resolve — which a mocked store cannot say anything about.
         *
         * Read back as the SAME user here (a second signed-in account at a venue is a fixture
         * this pack has no helper for), so what it pins is the weaker half: that the author
         * renders as a person at all after a reload, rather than "Guest".
         */
        await registerAccount(page, { fullName: 'Ada Lovelace', email: uniqueEmail('author') });
        await createTeam(page, { teamName: unique('Comment Falcons') });
        await goToView(page, 'kanban', 'board');

        const title = unique('Intake jams');
        await page.getByTestId('new-task-button').click();
        await page.getByTestId('task-title-input').fill(title);
        await page.getByTestId('save-task').click();
        await expect(page.getByText(title)).toBeVisible();

        await page.getByText(title).click();
        await page.getByTestId('comment-input').fill('Jams on the third cone');
        await page.getByTestId('comment-send').click();
        await expect(page.getByText('Jams on the third cone')).toBeVisible();
        await waitForSync(page);

        await page.reload();
        await goToView(page, 'kanban', 'board');
        await page.getByText(title).click();

        await expect(page.getByText('Jams on the third cone')).toBeVisible();
        await expect(
            page.getByText('Guest', { exact: true }),
            'the comment author rendered as "Guest" (FEAT-01)',
        ).toHaveCount(0);
        await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
    });
});
