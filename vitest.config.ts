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
