import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1, // Retry once locally for flaky tests
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    timeout: 60000, // 60 second timeout per test
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        actionTimeout: 15000, // 15 second timeout for each action
        navigationTimeout: 30000, // 30 second timeout for navigation
    },
    projects: [
        // Setup project for authentication
        {
            name: 'setup',
            testMatch: /.*\.setup\.ts/,
        },
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Use stored auth state from setup
                storageState: 'playwright/.auth/user.json',
            },
            dependencies: ['setup'],
            // Exclude login tests since they need to start logged out
            testIgnore: /login\.spec\.ts/,
        },
        // Tests that don't need auth (like login tests)
        {
            name: 'chromium-no-auth',
            use: { ...devices['Desktop Chrome'] },
            testMatch: /login\.spec\.ts/,
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
