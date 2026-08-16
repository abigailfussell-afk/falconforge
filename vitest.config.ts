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
