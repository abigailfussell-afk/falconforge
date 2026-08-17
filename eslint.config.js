// ESLint — deliberately small.
//
// Every rule enabled here is one that would have caught a defect this project actually
// shipped. That is the bar for adding another: name the commit, or leave it out. A large
// ruleset would bury the four findings that matter under style noise, and this repo has
// gone eight sprints with zero `eslint-disable` comments — worth keeping.
//
// See docs/failure-modes.md for the incidents behind each rule.

import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'dev-dist/**',
            'coverage/**',
            'node_modules/**',
            'playwright-report/**',
            'test-results/**',
            'screenshots/**',
            'backups/**',
            'supabase/**',
        ],
    },

    // ---------------------------------------------------------------------------------
    // Application source. Type-aware, because no-floating-promises needs types.
    // ---------------------------------------------------------------------------------
    {
        files: ['src/**/*.{ts,tsx}'],
        extends: [tseslint.configs.base],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
        },
        rules: {
            // B23's shape, and caaf187: an invalid useAuth() call inside an async click
            // handler threw, the surrounding try/catch swallowed it, and a user *forced*
            // through age-profile completion saw a generic failure with no way forward.
            'react-hooks/rules-of-hooks': 'error',

            // NOT enabled yet: react-hooks/exhaustive-deps.
            //
            // It reports exactly four sites — InviteManager.tsx:109, MemberManager.tsx:122,
            // Onboarding.tsx:35 and sync.ts:207 — and each is a plain async function
            // redefined every render, so the fix is a useCallback, not a dependency added to
            // the array. Adding the dependency without memoising produces an infinite render
            // loop, which is precisely the Sprint 6 defect that spun ~2M times and wrote a
            // 2.7 GB log. One of the four is inside the sync engine, which CLAUDE.md
            // principle 2 protects.
            //
            // That is scoped work with browser verification attached, not a lint fix. Turning
            // the rule on is the last step of it. See the plan's parking lot.

            // e35fe0a and 13ddc66: ticking a checklist item went through a clickable
            // div/span pair — invisible to a keyboard, on the page whose entire job is
            // ticking items. Report cards were clickable divs too.
            'jsx-a11y/click-events-have-key-events': 'error',
            'jsx-a11y/no-static-element-interactions': 'error',
            'jsx-a11y/no-noninteractive-element-interactions': 'error',

            // 56f1c15 and 742f5ab: fire-and-forget writes are how B1 was reintroduced, and
            // a swallowed rejection is how the venue simulation reported success while
            // clicking nothing. Deliberate detachment must be written as void.
            '@typescript-eslint/no-floating-promises': 'error',
        },
    },
);

// The harness directories (e2e/, scripts/) are deliberately NOT linted here. They are
// outside tsconfig's include, so type-aware rules cannot run over them without a second
// project, and the rules that matter there — no Node clock in e2e, no swallowed rejection
// in a script — are asserted as source invariants instead, in
// src/test/__tests__/harness-invariants.test.ts. A config block with an empty rule set
// would have been a gate with no door (docs/failure-modes.md §11).
