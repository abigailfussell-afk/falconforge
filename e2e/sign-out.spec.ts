import { test, expect } from '@playwright/test';

test.describe('Sign Out Functionality', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to dashboard where sign out button is available
        // Auth is already handled by auth.setup.ts and stored state
        await page.goto('/');
        await page.waitForTimeout(2000); // Give the app a moment to initialize
    });

    test('sign out button is visible on desktop', async ({ page }) => {
        // Set desktop viewport
        await page.setViewportSize({ width: 1280, height: 800 });

        // Look for sign out button or icon in sidebar
        const signOutButton = page.locator('button[title="Sign out"], button:has-text("Sign Out")');

        await expect(signOutButton.first()).toBeVisible({ timeout: 10000 });
    });

    test('sign out button works on mobile menu', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });

        // Open mobile menu
        const menuButton = page.locator('button').filter({ has: page.locator('svg') }).first();
        await menuButton.click();

        // Wait for menu to open
        await page.waitForTimeout(500);

        // Find sign out button in mobile menu
        const signOutButton = page.locator('button:has-text("Sign Out")');
        await expect(signOutButton).toBeVisible({ timeout: 5000 });
    });

    test('clicking sign out clears auth and redirects to login', async ({ page }) => {
        // Set desktop viewport for easier testing
        await page.setViewportSize({ width: 1280, height: 800 });

        // Find and click sign out
        const signOutButton = page.locator('button[title="Sign out"], button:has-text("Sign Out")').first();
        await expect(signOutButton).toBeVisible({ timeout: 10000 });

        await signOutButton.click();

        // Should redirect to login page
        await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });

        // Login form should be visible again
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
    });

    test('after sign out, protected routes redirect to login', async ({ page }) => {
        // Set desktop viewport
        await page.setViewportSize({ width: 1280, height: 800 });

        // Sign out first
        const signOutButton = page.locator('button[title="Sign out"], button:has-text("Sign Out")').first();
        await expect(signOutButton).toBeVisible({ timeout: 10000 });
        await signOutButton.click();

        // Wait for redirect to login
        await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });

        // Try to navigate to a protected route
        await page.goto('/dashboard');

        // Should redirect back to login
        await expect(page).toHaveURL(/.*login.*/, { timeout: 5000 });
    });

    test('sign out clears local storage', async ({ page }) => {
        // Set desktop viewport
        await page.setViewportSize({ width: 1280, height: 800 });

        // First verify we have stored state
        const storageBefore = await page.evaluate(() => {
            return localStorage.getItem('falconforge-storage');
        });

        // Sign out
        const signOutButton = page.locator('button[title="Sign out"], button:has-text("Sign Out")').first();
        await expect(signOutButton).toBeVisible({ timeout: 10000 });
        await signOutButton.click();

        // Wait for redirect
        await expect(page).toHaveURL(/.*login.*/, { timeout: 10000 });

        // Check that storage is cleared or reset
        const storageAfter = await page.evaluate(() => {
            return localStorage.getItem('falconforge-storage');
        });

        // Storage should be different after logout (either null or reset to defaults)
        expect(storageAfter !== storageBefore || storageAfter === null).toBe(true);
    });
});
