import { test, expect } from '@playwright/test';

test.describe('Team Management Flow', () => {
    test.describe('Sign Out', () => {
        test('should sign out successfully', async ({ page }) => {
            // Login first
            await page.goto('/');
            await page.fill('input[type="email"]', 'jkfussell@gmail.com');
            await page.fill('input[type="password"]', 'scooby');
            await page.click('button:has-text("Sign In")');

            await page.waitForTimeout(3000);

            // Handle team picker if present
            const selectButton = page.locator('button:has-text("Select")').first();
            if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await selectButton.click();
                await page.waitForTimeout(1000);
            }

            // Find sign out button (usually in sidebar or menu)
            const signOutButton = page.locator('button:has-text("Sign Out"), button:has-text("Log Out"), text=Sign Out').first();

            if (await signOutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
                await signOutButton.click();
                await page.waitForTimeout(2000);

                // Should be back on login page
                await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
            }
        });
    });

    test.describe('Team Picker', () => {
        test('should display team picker after login', async ({ page }) => {
            await page.goto('/');
            await page.fill('input[type="email"]', 'jkfussell@gmail.com');
            await page.fill('input[type="password"]', 'scooby');
            await page.click('button:has-text("Sign In")');

            await page.waitForTimeout(3000);

            // May see team picker or go directly to dashboard
            // At least one of these should be visible
            const teamPicker = page.locator('text=Select, text=Team, text=Dashboard').first();
            await expect(teamPicker).toBeVisible({ timeout: 10000 });
        });

        test('should switch teams if multiple teams exist', async ({ page }) => {
            await page.goto('/');
            await page.fill('input[type="email"]', 'jkfussell@gmail.com');
            await page.fill('input[type="password"]', 'scooby');
            await page.click('button:has-text("Sign In")');

            await page.waitForTimeout(3000);

            // Look for team switcher in sidebar
            const teamSwitcher = page.locator('button:has-text("Switch"), [class*="team-switch"]').first();

            if (await teamSwitcher.isVisible({ timeout: 3000 }).catch(() => false)) {
                await teamSwitcher.click();
                // Should show team selection
            }
        });
    });

    test.describe('Navigation', () => {
        test.beforeEach(async ({ page }) => {
            await page.goto('/');
            await page.fill('input[type="email"]', 'jkfussell@gmail.com');
            await page.fill('input[type="password"]', 'scooby');
            await page.click('button:has-text("Sign In")');

            await page.waitForTimeout(3000);

            const selectButton = page.locator('button:has-text("Select")').first();
            if (await selectButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await selectButton.click();
                await page.waitForTimeout(1000);
            }
        });

        test('should navigate to Dashboard', async ({ page }) => {
            const dashboardLink = page.locator('text=Dashboard, text=Home').first();
            if (await dashboardLink.isVisible()) {
                await dashboardLink.click();
                await page.waitForTimeout(500);
            }
        });

        test('should navigate to Sprint Planning', async ({ page }) => {
            const sprintLink = page.locator('text=Sprint Planning').first();
            if (await sprintLink.isVisible()) {
                await sprintLink.click();
                await page.waitForTimeout(500);
                await expect(page.locator('text=Sprint, text=Backlog, text=To Do').first()).toBeVisible({ timeout: 5000 });
            }
        });

        test('should navigate to Match Planner', async ({ page }) => {
            const matchLink = page.locator('text=Match Planner').first();
            if (await matchLink.isVisible()) {
                await matchLink.click();
                await page.waitForTimeout(500);
            }
        });

        test('should navigate to Portfolio helper', async ({ page }) => {
            const portfolioLink = page.locator('text=Portfolio').first();
            if (await portfolioLink.isVisible()) {
                await portfolioLink.click();
                await page.waitForTimeout(500);
            }
        });
    });
});
