import { test, expect } from '@playwright/test';

test.describe('Sync Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to dashboard where sync button is available
        // Auth is already handled by auth.setup.ts and stored state
        await page.goto('/');
        await page.waitForTimeout(2000); // Give the app a moment to initialize
    });

    test('sync button appears in sidebar', async ({ page }) => {
        // Look for sync status indicator
        const syncButton = page.locator('button:has-text("Synced"), button:has-text("Syncing"), button:has-text("pending")');

        // Should be visible within the sidebar
        await expect(syncButton.first()).toBeVisible({ timeout: 10000 });
    });

    test('sync button does not hang indefinitely', async ({ page }) => {
        // Find and click the sync button
        const syncButton = page.locator('button:has-text("Synced"), button:has-text("Syncing"), button:has-text("pending")').first();

        // Wait for it to be visible
        await expect(syncButton).toBeVisible({ timeout: 10000 });

        // Click sync
        await syncButton.click();

        // The button should either:
        // 1. Stay as "Synced" (if nothing to sync)
        // 2. Change to "Syncing..." briefly then back to "Synced"
        // 3. Show an error state
        // But it should NOT just spin forever

        // Wait up to 15 seconds for sync to complete
        await expect(async () => {
            const buttonText = await syncButton.textContent();
            // Should not be stuck in syncing state
            expect(buttonText).not.toContain('Syncing');
        }).toPass({ timeout: 15000 });
    });

    test('sync shows correct status after completion', async ({ page }) => {
        const syncButton = page.locator('button:has-text("Synced"), button:has-text("Syncing"), button:has-text("pending"), button:has-text("Error")').first();

        await expect(syncButton).toBeVisible({ timeout: 10000 });

        // After page load and initial sync, should show "Synced" or an error
        // (both are acceptable end states, but not perpetual "Syncing")
        await page.waitForTimeout(5000);

        const buttonText = await syncButton.textContent();
        const validEndStates = ['Synced', 'Error', 'Offline', 'pending'];
        const isValidState = validEndStates.some(state =>
            buttonText?.toLowerCase().includes(state.toLowerCase())
        ) || !buttonText?.includes('Syncing');

        expect(isValidState).toBe(true);
    });
});
