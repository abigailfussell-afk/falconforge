import path from 'path';
import { defineConfig } from 'vitest/config';

/**
 * Coverage across ALL three suites in one run.
 *
 * The coverage report used to come from the unit suite alone, which made it actively
 * misleading in both directions: the integration suite's sync regressions counted for
 * nothing, so the number understated what was covered, while `sync.ts` looked better than
 * it was because the branches nobody tested were also the ones nobody imported.
 *
 * v8 coverage cannot be merged across separate `vitest run` invocations, so the three
 * configs are composed as projects and measured together.
 *
 * Requires Docker, because one of the projects talks to a real Postgres. That is the
 * point: a coverage number that silently omits the suite proving tenant isolation would be
 * the same kind of half-truth this replaced.
 */
export default defineConfig({
    test: {
        projects: [
            './vitest.config.ts',
            './vitest.config.integration.ts',
            './vitest.config.db.ts',
        ],
        coverage: {
            provider: 'v8',
            // json-summary writes coverage/coverage-summary.json, which a CI step or a
            // badge can read without parsing the text table.
            reporter: ['text', 'json', 'json-summary', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'node_modules/',
                'src/test/',
                'src/lib/__mocks__/',
                '**/__tests__/**',
                '**/*.d.ts',
                '**/*.config.*',
                'e2e/',
            ],
            /**
             * A ratchet, not an aspiration.
             *
             * These sit just under the numbers measured on 2026-08-15 across all three
             * suites. They are deliberately not round aspirational targets: a threshold
             * nobody can meet gets deleted, and then nothing is enforced at all.
             *
             * Raise them as coverage genuinely improves. Never lower them to get a build
             * green — that is the failure mode this exists to prevent.
             */
            thresholds: {
                statements: 68,
                branches: 63,
                functions: 64,
                lines: 70,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
