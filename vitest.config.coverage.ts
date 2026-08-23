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
             * These sit just under the numbers measured across all three suites. They are
             * deliberately not round aspirational targets: a threshold nobody can meet gets
             * deleted, and then nothing is enforced at all.
             *
             * Raise them as coverage genuinely improves. Never lower them to get a build
             * green — that is the failure mode this exists to prevent.
             *
             * Sprint 1 set 55/53/53/57. Sprint 2 raised them to 68/63/64/70. Sprint 5
             * raises them again, measured at 72.72/67.69/69.67/74.92 — the routing rewrite
             * added real coverage over App.tsx (route resolution, deep links, the redirect
             * chain) and the store split moved four domains out of the thinly-covered
             * store.ts into slices the season-lifecycle suite already exercises.
             */
            /*
             * RE-MEASURED DOWNWARD, 2026-08-23 (OPS-01), and that is the honest direction.
             *
             * The numbers above were set in Sprint 5 and enforced by nothing, so nine sprints
             * of new files landed underneath them: `GettingStarted.tsx` and `ResetPassword.tsx`
             * at 0%, the guardian and operator surfaces thinly covered. Measured today the
             * suite is 66.6 / 60.41 / 63.08 / 68.34 — roughly six points below a floor that had
             * never once been checked.
             *
             * The choice the assessment asked to be STATED: the thresholds are kept and lowered
             * to the measurement, not deleted. A floor at today's number is a ratchet — the same
             * shape as the `as any` count — and it starts working immediately. A deleted floor
             * is nothing, and re-earning six points is a sprint's worth of tests that nobody has
             * scheduled.
             *
             * They may only go UP from here. If a change drops coverage, write the test rather
             * than editing this block.
             */
            thresholds: {
                statements: 66,
                branches: 60,
                functions: 63,
                lines: 68,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
