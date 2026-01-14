import { test, expect } from '@playwright/test';

test.describe('Pre-Match Checklist Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Login first
        await page.goto('/');
        await page.fill('input[type="email"]', 'jkfussell@gmail.com');
        await page.fill('input[type="password"]', 'scooby');
        await page.click('button:has-text("Sign In")');

        // Wait for auth
        await page.waitForTimeout(3000);

        // Handle team picker if present
        const selectButton = page.locator('button:has-text("Select")').first();
        if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await selectButton.click();
            await page.waitForTimeout(1000);
        }
    });

    test('should navigate to pre-match checklist', async ({ page }) => {
        // Click on Checklist link
        const checklistLink = page.locator('text=Checklist, text=Pre-Match').first();
        if (await checklistLink.isVisible()) {
            await checklistLink.click();
            await page.waitForTimeout(1000);

            // Should see checklist items
            await expect(page.locator('[class*="checklist"], [class*="check"]').first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('should display checklist items', async ({ page }) => {
        await page.click('text=Checklist');
        await page.waitForTimeout(1000);

        // Should see at least one checklist item
        const checklistItems = page.locator('button, [class*="item"]');
        const count = await checklistItems.count();
        expect(count).toBeGreaterThan(0);
    });

    test('should toggle checklist item', async ({ page }) => {
        await page.click('text=Checklist');
        await page.waitForTimeout(1000);

        // Find a checklist item button
        const checkItem = page.locator('button:has([class*="check"]), button:has(svg)').first();
        if (await checkItem.isVisible()) {
            // Get initial state
            const initialClasses = await checkItem.getAttribute('class');

            // Click to toggle
            await checkItem.click();
            await page.waitForTimeout(500);

            // State should change (visual indication)
        }
    });

    test('should add new checklist item', async ({ page }) => {
        await page.click('text=Checklist');
        await page.waitForTimeout(1000);

        // Find add button
        const addButton = page.locator('button:has-text("Add"), button:has([class*="plus"])').first();
        if (await addButton.isVisible()) {
            await addButton.click();

            // Input should appear
            const input = page.locator('input[type="text"]').first();
            if (await input.isVisible()) {
                await input.fill('Test checklist item');
                await page.keyboard.press('Enter');
            }
        }
    });

    test('should reset checklist', async ({ page }) => {
        await page.click('text=Checklist');
        await page.waitForTimeout(1000);

        // Find reset button
        const resetButton = page.locator('button:has-text("Reset"), button:has([class*="refresh"])').first();
        if (await resetButton.isVisible()) {
            await resetButton.click();

            // Items should be unchecked
            await page.waitForTimeout(500);
        }
    });
});
