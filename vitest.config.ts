import path from 'path';
import { defineConfig } from 'vitest/config';
import { TEST_TIMEOUT_MS } from './src/test/timeouts';

export default defineConfig({
    test: {
        // Named so the three configs can be composed as projects for coverage.
        name: 'unit',
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        /*
         * THE UNIT AND INTEGRATION SUITES NEVER TALK TO A SERVER, and until Sprint 26 they did.
         *
         * Vite loads `.env.local` in every mode including `test`, and `.env.local` in this repo
         * points at PRODUCTION. So `src/lib/supabase.ts` built a real client against
         * `https://<prod>.supabase.co` in every unit and integration run, and the sync tests
         * pushed queued writes to it — refused by RLS, since there is no session, which is the
         * only reason this was invisible for eight sprints. `setup-integration.ts`'s own
         * docblock says both clients are null "(no VITE_ credentials in the test environment)";
         * that sentence was simply false.
         *
         * `docs/environment-divergences.md` section 2 is this exact class, recorded three times
         * as a near miss: "a build or script that inherits ambient environment writes to the
         * real database". The rule it states is that every write-capable runner passes its
         * environment EXPLICITLY. This is that, for the two suites that had no such line.
         *
         * Emptied rather than pointed at the local stack on purpose: a unit test that reaches a
         * server is a db test in the wrong file. The db config (`vitest.config.db.ts`) stubs
         * these two the other way, at the local stack, deliberately and with a comment.
         */
        env: {
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_ANON_KEY: '',
        },
        // Vitest's default is 5000ms -- identical to the `asyncUtilTimeout` that
        // `setup.ts` configures, which made that budget unreachable and turned a slow
        // render under load into an opaque "Test timed out in 5000ms" with no assertion
        // named. `src/test/timeouts.ts` holds the pair and the measurements.
        testTimeout: TEST_TIMEOUT_MS,
        /*
         * NOT set yet: `mockReset: true`.
         *
         * It is the systemic fix for the Sprint 7 leak — `vi.clearAllMocks()` clears recorded
         * *calls*, not implementations, so a `mockReturnValue({ user: null })` leaked a
         * signed-out user into every test declared after it and the new Upcoming Deadlines
         * tests were asserting against the landing page. Invisible for as long as that test
         * happened to be last in the file, which is not a property anyone can maintain.
         *
         * Turning it on today fails 39 tests across 3 files, because they set their return
         * values at factory scope and expect them to persist. That is a real conversion, not
         * a config flip. See the plan's parking lot.
         */
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: [
            'node_modules',
            'dist',
            'e2e',
            'src/**/*.integration.test.{ts,tsx}',
            // Require a running Postgres; they have their own config and npm scripts.
            'src/**/*.db.test.{ts,tsx}',
        ],
        // Coverage and its thresholds live in `vitest.config.coverage.ts`, which measures
        // all three suites in one run (`npm run test:coverage`). Measuring only the unit
        // suite here produced a number that was wrong in both directions: it ignored every
        // sync regression the integration suite holds, and it flattered files whose
        // untested branches were also unimported.
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
