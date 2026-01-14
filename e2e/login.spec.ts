import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
    test('should display login page', async ({ page }) => {
        await page.goto('/');

        // Should see the FalconForge title or logo
        await expect(page.locator('text=FALCONFORGE')).toBeVisible();
    });

    test('should show login form elements', async ({ page }) => {
        await page.goto('/');

        // Check for email input
        const emailInput = page.locator('input[type="email"]');
        await expect(emailInput).toBeVisible();

        // Check for password input
        const passwordInput = page.locator('input[type="password"]');
        await expect(passwordInput).toBeVisible();

        // Check for sign in button
        const signInButton = page.locator('button:has-text("Sign In")');
        await expect(signInButton).toBeVisible();
    });

    test('should login successfully with valid credentials', async ({ page }) => {
        await page.goto('/');

        // Fill in credentials
        await page.fill('input[type="email"]', 'jkfussell@gmail.com');
        await page.fill('input[type="password"]', 'scooby');

        // Click sign in
        await page.click('button:has-text("Sign In")');

        // Wait for navigation away from login page
        // Should either go to team picker or dashboard
        await expect(page).not.toHaveURL('/');

        // Give time for auth to complete
        await page.waitForTimeout(2000);

        // Should see some authenticated content (navbar, team name, etc.)
        const authenticatedContent = page.locator('nav, [data-testid="dashboard"], text=Dashboard');
        await expect(authenticatedContent.first()).toBeVisible({ timeout: 10000 });
    });
});
