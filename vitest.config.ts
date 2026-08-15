import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: [
            'node_modules',
            'dist',
            'e2e',
            'src/**/*.integration.test.{ts,tsx}',
            // Require a running Postgres; they have their own config and npm scripts.
            'src/**/*.db.test.{ts,tsx}',
        ],
        coverage: {
            provider: 'v8',
            // json-summary writes coverage/coverage-summary.json, which is what a CI step or
            // a badge can read without parsing the text table.
            reporter: ['text', 'json', 'json-summary', 'html'],
            exclude: [
                'node_modules/',
                'src/test/',
                '**/*.d.ts',
                '**/*.config.*',
                'e2e/',
            ],
            /**
             * A ratchet, not an aspiration.
             *
             * These sit just under the real numbers measured on 2026-08-15 (55.62 stmts /
             * 53.66 branch / 53.82 funcs / 57.66 lines), so coverage cannot slide backwards
             * unnoticed. They are deliberately not round aspirational targets like 80: a
             * threshold nobody can meet gets deleted, and then nothing is enforced at all.
             *
             * Raise them as coverage genuinely improves. Never lower them to get a build
             * green — that is the failure mode this exists to prevent.
             *
             * Caveat worth knowing when reading these: this config covers the unit suite
             * only. The integration suite runs separately, so the combined picture is better
             * than these numbers and the per-file picture for sync.ts is worse.
             */
            thresholds: {
                statements: 55,
                branches: 53,
                functions: 53,
                lines: 57,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
