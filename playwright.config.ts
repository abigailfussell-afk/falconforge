import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke pack: a handful of whole-app flows against the real local stack.
 *
 * It is deliberately NOT a second unit suite. The 476-test unit suite, 87 integration tests
 * and 364 database tests already assert behaviour in isolation; what none of them can do is
 * drive a browser through a flow the way a coach does, across the service worker, the sync
 * queue, real PostgREST and real RLS. These are the flows whose breakage would make the app
 * unusable at a competition.
 *
 * WHY THE STACK IS CONFIGURED HERE RATHER THAN IN AN ENV FILE
 *
 * `.env.local` points at the HOSTED project, and `.env.development.local` -- which points dev
 * at the local stack -- is gitignored, so CI does not have it and a laptop is one deleted file
 * away from running these against production. The dev server this starts is therefore given
 * the local stack explicitly, and the keys below are Supabase's published local-development
 * demo keys: identical on every machine, worthless anywhere else. They are not a secret, and
 * writing them here is what makes the pack refuse to drift onto a real database.
 */
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

/** Its own port, so a smoke run never fights the review servers on 5188/5189/5190. */
const PORT = 5199;

export default defineConfig({
    testDir: './e2e',
    // Each spec registers its own team, so they do not contend for state and can run together.
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    // Generous, because these wait on a real database and a real sync drain -- and because
    // the whole point of src/test/timeouts.ts is that a budget which cannot elapse is a lie.
    timeout: 90_000,
    expect: { timeout: 15_000 },

    use: {
        // 127.0.0.1 rather than `localhost`, deliberately. On this Windows box `localhost`
        // resolves to ::1 first for Node's fetch, and the dev server answers 404 there while
        // 127.0.0.1 answers 200 -- so the webServer readiness probe waited out its full two
        // minutes against a server that had been up for one second. Pinning the family removes
        // a dual-stack ambiguity that has nothing to do with the app.
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: process.env.CI ? 'retain-on-failure' : 'off',
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],

    webServer: {
        command: `npm run dev -- --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
            VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
        },
    },
});
