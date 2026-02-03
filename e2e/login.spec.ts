import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
    test('should display login page', async ({ page }) => {
        await page.goto('/');

        // Should see the FalconForge title or logo
        await expect(page.locator('text=FALCONFORGE')).toBeVisible();
    });

    test('should show login form elements', async ({ page }) => {
        await page.goto('/');

        // Check for email input using data-testid
        await expect(page.getByTestId('email-input')).toBeVisible();

        // Check for password input using data-testid
        await expect(page.getByTestId('password-input')).toBeVisible();

        // Check for sign in button using data-testid
        await expect(page.getByTestId('sign-in-button')).toBeVisible();
    });

    test('should login successfully with valid credentials', async ({ page }) => {
        await page.goto('/');

        // Fill in credentials using data-testid
        await page.getByTestId('email-input').fill('jkfussell@gmail.com');
        await page.getByTestId('password-input').fill('scooby');

        // Click sign in
        await page.getByTestId('sign-in-button').click();

        // Wait for navigation away from login page
        // Should either go to team picker or dashboard
        await page.waitForURL(/(?!.*login).*/, { timeout: 15000 });

        // After login, user may be redirected to Team Picker if they have multiple teams
        // The test passes if we see either the team picker or authenticated content
        await expect(
            page.locator('nav, main, [data-testid="team-picker"]').first()
        ).toBeVisible({ timeout: 15000 });
    });
});
