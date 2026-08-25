/**
 * Pre-commit checks. Kevin's decision, 2026-08-24: typecheck at commit time.
 *
 * WHY THIS FILE IS A FUNCTION AND NOT THE `lint-staged` KEY IN `package.json`.
 *
 * lint-staged appends the staged filenames to every command it runs. `tsc --noEmit` given
 * explicit filenames IGNORES `tsconfig.json` entirely — no `paths`, no `jsx`, no `strict` —
 * so the command form does not merely check less, it checks something else and reports
 * hundreds of phantom errors. Returning the command from a function is how you get
 * lint-staged to run it with no arguments at all.
 *
 * WHAT IT COSTS AND WHY IT IS WORTH IT. About ten seconds on every commit. The retrospective
 * proved the gap on itself: a commit in that very branch landed with `TaskType.Build` — an enum
 * with only `Feature` and `Bug` — passed the hook, passed the tests the hook ran, and was caught
 * only by the next `tsc`. Vitest does not typecheck, so `vitest related` never could have.
 *
 * The whole project is typechecked, not just the staged files, because that is the only thing
 * `tsc` can actually do: a type error is a property of the program, and staging one file can
 * break a different one.
 */
export default {
    '*.{ts,tsx}': [
        () => 'tsc --noEmit',
        'vitest related --run',
    ],
};
