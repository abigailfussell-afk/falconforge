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
    /*
     * Capped deliberately. Every spec in this pack shares ONE Postgres, ONE preview server and
     * one machine, so workers past about four buy no wall-clock and cost determinism: at the
     * default 8 the pack failed one test per run, a different one each time, always on an app
     * boot or a reload that ran out of patience under contention. Verified as contention rather
     * than a defect by running the offline spec serially three times -- green every time, so
     * offline cold-boot with a stored session genuinely works.
     */
    /*
     * THREE, not four, since the `mobile` project landed (OPS-13).
     *
     * The cap was 4 for one project and the comment above says it is load-bearing. Adding a
     * second project raised the concurrent load, and it showed immediately: the toggle-knob
     * GEOMETRY assertion in `meetings.spec.ts` failed in two of three full-pack runs at 4 and
     * passed every time in isolation — the same contention signature §9 describes, on the same
     * kind of test (a measurement, which is what suffers when layout has not settled).
     *
     * Measured at 3: three consecutive full-pack runs green. CI stays at 2.
     */
    /*
     * Unchanged at 4/2 despite the pack gaining a second project (OPS-13).
     *
     * Adding `mobile` did surface a failure, twice in three full runs — but reducing workers
     * was the wrong fix and the measurement said so: the same test failed in ISOLATION under
     * `--repeat-each=4`, so it was never contention. It was the toggle-knob geometry test
     * measuring its "off" position before the knob had settled, which the busier machine simply
     * made likely rather than rare. Fixed where it belonged, in the test.
     *
     * Three consecutive full-pack runs green at 4 afterwards.
     */
    workers: process.env.CI ? 2 : 4,
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
        /*
         * A PHONE, because that is what the app is used on (OPS-13).
         *
         * The pack had one `setViewportSize` in it and it was 1280x800. CLAUDE.md requires
         * "375px as every role the feature touches" and that requirement was met by hand, every
         * sprint, by somebody remembering — which is the shape of every other thing in this repo
         * that turned out not to be happening.
         *
         * `devices['iPhone 13']` is 390x844 with touch and a mobile user agent, so the mobile
         * header, the nav drawer and `pointer: coarse` rules are all exercised. It is still
         * Chromium: `docs/environment-divergences.md` section 10 says plainly that this
         * emulates iOS and is not WebKit, and no claim about Safari can come from it.
         *
         * Only the specs tagged `@mobile` run here — see `grep`. Running all 21 twice would
         * double a 37-second pack for very little: most of them assert data flow, which does not
         * change with the viewport, and the four workers are already the determinism ceiling
         * (environment-divergences section 9).
         */
        {
            name: 'mobile',
            use: {
                ...devices['iPhone 13'],
                /*
                 * CHROMIUM, OVERRIDING THE DEVICE'S OWN DEFAULT — and stated rather than
                 * stumbled into.
                 *
                 * `devices['iPhone 13']` selects WebKit, which would be a genuinely better
                 * test and is not what this pack installs: CI runs
                 * `npx playwright install --with-deps chromium`, so a WebKit project would
                 * fail on the runner rather than on a laptop where somebody notices.
                 *
                 * So this keeps the viewport, the touch points and the mobile user agent, and
                 * `docs/environment-divergences.md` section 10 stays exactly as true as it
                 * was: this emulates iOS, it is not Safari, and no claim about WebKit can come
                 * from it. Installing WebKit for real is in the parking lot.
                 */
                defaultBrowserType: 'chromium',
                browserName: 'chromium',
            },
            grep: /@mobile/,
        },
    ],

    /*
     * A real BUILD served by `vite preview`, not the dev server.
     *
     * This is not fussiness. The dev server has no service worker, so an offline navigation
     * cannot fetch a React.lazy chunk and the app renders a blank page -- which says nothing
     * about the shipped app, where Workbox precaches 36 entries. Testing offline behaviour
     * against a dev server measures the harness rather than the product, and offline behaviour
     * is the whole point of this codebase.
     *
     * The env applies to the BUILD as well as the serve, because `import.meta.env.VITE_*` is
     * inlined at build time -- which is also why the smoke pack cannot inherit whatever the
     * developer's env files happen to say that day.
     */
    webServer: {
        command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
        url: `http://127.0.0.1:${PORT}`,
        // Never reuse: a stale preview is serving a stale bundle, and this pack exists to
        // catch exactly that class of thing.
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
            VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
            VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
        },
    },
});
