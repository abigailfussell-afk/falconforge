/**
 * Playwright Auth Setup
 * 
 * This file runs before other tests to create an authenticated session.
 * The auth state is saved and reused by other tests.
 */
import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

setup('authenticate', async ({ page }) => {
    // Navigate to login page
    await page.goto('/');

    // Wait for login form to be ready
    await expect(page.getByTestId('email-input')).toBeVisible({ timeout: 10000 });

    // Fill in credentials
    await page.getByTestId('email-input').fill('jkfussell@gmail.com');
    await page.getByTestId('password-input').fill('scooby');

    // Click sign in
    await page.getByTestId('sign-in-button').click();

    // Wait for successful authentication
    // Should redirect away from login page
    await page.waitForURL(/(?!.*login).*/);

    // Wait for app to load and stabilize
    await page.waitForTimeout(2000);

    // After login, user may be redirected to Team Picker if they have multiple teams
    // or directly to the dashboard if they have only one team
    const teamPickerVisible = await page.locator('text=Select a team to continue').isVisible().catch(() => false);

    if (teamPickerVisible) {
        // Click on the first available team to complete authentication
        await page.locator('[data-testid="team-option"]').first().click({ timeout: 10000 }).catch(async () => {
            // Fallback: try clicking on any team link if data-testid not found
            await page.locator('text=Team #').first().click({ timeout: 5000 });
        });

        // Wait for navigation to dashboard
        await page.waitForTimeout(2000);
    }

    // Verify we're authenticated by checking for dashboard elements
    // The sidebar or main content should be visible
    await expect(page.locator('nav, [data-testid="dashboard"], main, [data-testid="team-picker"]').first()).toBeVisible({ timeout: 15000 });

    // Save signed-in state to file
    await page.context().storageState({ path: authFile });
});
