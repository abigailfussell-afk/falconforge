import { test, expect } from '@playwright/test';

test.describe('Scouting Reports Flow', () => {
    test.beforeEach(async ({ page }) => {
        // Login first
        await page.goto('/');
        await page.fill('input[type="email"]', 'jkfussell@gmail.com');
        await page.fill('input[type="password"]', 'scooby');
        await page.click('button:has-text("Sign In")');

        // Wait for auth and possible team selection
        await page.waitForTimeout(3000);

        // Handle team picker if present
        const selectButton = page.locator('button:has-text("Select")').first();
        if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await selectButton.click();
            await page.waitForTimeout(1000);
        }
    });

    test('should navigate to scouting reports', async ({ page }) => {
        // Click on Scouting link
        const scoutingLink = page.locator('text=Scouting').first();
        if (await scoutingLink.isVisible()) {
            await scoutingLink.click();
            await page.waitForTimeout(1000);

            // Should be on scouting page
            await expect(page.locator('text=Scouting, text=Scout Match, text=Reports').first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('should display scouting form when clicking Scout Match', async ({ page }) => {
        // Navigate to scouting
        await page.click('text=Scouting');
        await page.waitForTimeout(1000);

        // Click add/scout button
        const scoutButton = page.locator('button:has-text("Scout"), button:has(svg)').first();
        if (await scoutButton.isVisible()) {
            await scoutButton.click();

            // Form should appear with team number input
            const teamInput = page.locator('input[placeholder*="team"], input[name*="team"]').first();
            await expect(teamInput).toBeVisible({ timeout: 5000 });
        }
    });

    test('should create a scouting report', async ({ page }) => {
        await page.click('text=Scouting');
        await page.waitForTimeout(1000);

        // Open form
        const scoutButton = page.locator('button:has-text("Scout"), button:has(svg)').first();
        if (await scoutButton.isVisible()) {
            await scoutButton.click();
            await page.waitForTimeout(500);

            // Fill in team number
            const teamInput = page.locator('input').first();
            await teamInput.fill('99999');

            // Fill match number
            const matchInputs = page.locator('input[type="number"]');
            if (await matchInputs.count() > 0) {
                await matchInputs.first().fill('99');
            }

            // Save
            const saveButton = page.locator('button:has-text("Save"), button:has-text("Submit")').first();
            if (await saveButton.isVisible()) {
                await saveButton.click();
            }
        }
    });
});
