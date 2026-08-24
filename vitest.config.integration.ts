import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Named so the three configs can be composed as projects for coverage.
        name: 'integration',
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup-integration.ts'],
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
        include: ['src/**/*.integration.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', 'e2e'],
        testTimeout: 10000, // Longer timeout for async operations
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'src/test/',
                '**/*.d.ts',
                '**/*.config.*',
                'e2e/',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
