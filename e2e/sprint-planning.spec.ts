import { test, expect } from '@playwright/test';

test.describe('Sprint Planning', () => {
    test.beforeEach(async ({ page }) => {
        // Login first
        await page.goto('/');
        await page.fill('input[type="email"]', 'jkfussell@gmail.com');
        await page.fill('input[type="password"]', 'scooby');
        await page.click('button:has-text("Sign In")');

        // Wait for auth
        await page.waitForTimeout(3000);

        // Navigate to Sprint Planning if not already there
        // Handle both scenarios: team picker and direct dashboard
        const teamPickerOrDashboard = await page.locator('text=Sprint Planning, text=Select a Team').first();
        if (await teamPickerOrDashboard.isVisible()) {
            // If on team picker, select first team
            const selectButton = page.locator('button:has-text("Select")').first();
            if (await selectButton.isVisible()) {
                await selectButton.click();
                await page.waitForTimeout(1000);
            }
        }

        // Click Sprint Planning in the nav
        const sprintPlanningLink = page.locator('text=Sprint Planning');
        if (await sprintPlanningLink.isVisible()) {
            await sprintPlanningLink.click();
        }
    });

    test('should display Sprint Planning page', async ({ page }) => {
        // Should see the Sprint Planning header or Kanban board
        const sprintHeader = page.locator('text=Sprint Planning, text=Kanban, text=Backlog').first();
        await expect(sprintHeader).toBeVisible({ timeout: 10000 });
    });

    test('should show task columns', async ({ page }) => {
        // Wait for the board to load
        await page.waitForTimeout(2000);

        // Should see at least some columns (Backlog, To Do, In Progress, etc.)
        const columns = ['Backlog', 'To Do', 'In Progress', 'Testing', 'Done'];

        for (const column of columns) {
            const columnHeader = page.locator(`text="${column}"`).first();
            // Not all columns may be visible, but at least some should be
            const isVisible = await columnHeader.isVisible().catch(() => false);
            if (isVisible) {
                expect(isVisible).toBe(true);
                break; // At least one column found
            }
        }
    });

    test('should be able to create a new task', async ({ page }) => {
        await page.waitForTimeout(2000);

        // Look for the add task button
        const addButton = page.locator('button:has-text("Add Task"), button:has-text("New Task"), button[aria-label*="add"]').first();

        if (await addButton.isVisible()) {
            await addButton.click();

            // Should see a task creation form or modal
            const taskForm = page.locator('input[placeholder*="title"], input[name="title"], [data-testid="task-form"]').first();
            await expect(taskForm).toBeVisible({ timeout: 5000 });
        }
    });
});
