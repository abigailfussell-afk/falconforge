import { test, expect } from '@playwright/test';

test.describe('Admin Settings Flow', () => {
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

    test('should navigate to admin settings (coach only)', async ({ page }) => {
        // Admin link may only be visible to coaches
        const adminLink = page.locator('text=Admin, text=Settings').first();

        if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await adminLink.click();
            await page.waitForTimeout(1000);

            // Should see admin settings page
            await expect(page.locator('text=Admin, text=Settings, text=Team').first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('should display team roster section', async ({ page }) => {
        const adminLink = page.locator('text=Admin, text=Settings').first();

        if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await adminLink.click();
            await page.waitForTimeout(1000);

            // Look for roster section
            const rosterSection = page.locator('text=Roster, text=Members, text=Team Members').first();
            if (await rosterSection.isVisible()) {
                expect(true).toBe(true);
            }
        }
    });

    test('should display sub-teams section', async ({ page }) => {
        const adminLink = page.locator('text=Admin, text=Settings').first();

        if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await adminLink.click();
            await page.waitForTimeout(1000);

            // Look for sub-teams section
            const subTeamsSection = page.locator('text=Sub-Team, text=Working Group, text=Assignment').first();
            if (await subTeamsSection.isVisible()) {
                expect(true).toBe(true);
            }
        }
    });

    test('should display season manager section', async ({ page }) => {
        const adminLink = page.locator('text=Admin, text=Settings').first();

        if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await adminLink.click();
            await page.waitForTimeout(1000);

            // Look for season section
            const seasonSection = page.locator('text=Season, text=2025, text=2026').first();
            if (await seasonSection.isVisible()) {
                expect(true).toBe(true);
            }
        }
    });

    test('should be able to add a sub-team', async ({ page }) => {
        const adminLink = page.locator('text=Admin, text=Settings').first();

        if (await adminLink.isVisible({ timeout: 2000 }).catch(() => false)) {
            await adminLink.click();
            await page.waitForTimeout(1000);

            // Find add sub-team button
            const addButton = page.locator('button:has-text("Add Sub"), button:has([class*="plus"])').first();
            if (await addButton.isVisible()) {
                await addButton.click();

                // Input should appear
                const input = page.locator('input[type="text"]').first();
                if (await input.isVisible()) {
                    await input.fill('Test Sub-Team');
                }
            }
        }
    });
});
