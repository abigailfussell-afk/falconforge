import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Tests that run against a REAL local Postgres (`supabase start`), with the real
 * migrations and the real RLS policies applied.
 *
 * Two kinds live here:
 *   - `*.rls.db.test.ts`  — behavioural tenant isolation (C7). `npm run test:rls`.
 *   - `*.db.test.ts`      — the data layer: sync drain, pull, transforms, constraints.
 *
 * Nothing is mocked. There is deliberately no "skip if the stack is down" path: a suite
 * that quietly passes when the database is absent reports green while testing nothing,
 * which is the exact failure this sprint exists to remove. `globalSetup` fails loudly
 * instead, and tells you to run `npm run db:start`.
 */
export default defineConfig({
    test: {
        // Named so the three configs can be composed as projects for coverage.
        name: 'db',
        globals: true,
        environment: 'jsdom',
        globalSetup: ['./src/test/db/globalSetup.ts'],
        setupFiles: ['./src/test/db/setup.ts'],
        include: ['src/**/*.db.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', 'e2e'],
        // Real network round-trips to PostgREST, plus fixture creation per file.
        testTimeout: 30_000,
        hookTimeout: 60_000,
        // Fixtures create auth users and teams; parallel files racing over the same
        // Postgres is fine, but keeping them serial makes a failure readable.
        fileParallelism: false,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
