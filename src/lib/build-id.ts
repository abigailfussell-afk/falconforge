/**
 * WHICH BUILD THIS IS (OPS-03).
 *
 * `feedback.ts` used to compute `0.1.0` plus `-dev`, from a `package.json` version that has not
 * moved since 2026-01-02. Eighteen production deploys in sixty workflow runs all labelled
 * themselves `0.1.0`, under a comment saying the id exists "so a report is attached to a version
 * rather than to 'last Tuesday'". It was attached to nothing.
 *
 * The commit SHA is the only identifier that is different for every deploy and that can be
 * matched back to a diff, so it is what the build now carries. `vite.config.ts` reads
 * `GITHUB_SHA` (CI sets it) and defines `__BUILD_ID__`.
 *
 * WHAT IT SAYS WHEN THERE IS NO SHA, AND WHY IT SAYS IT LOUDLY
 *
 * A local build has no `GITHUB_SHA`, so it is `local`. That is deliberately not made to look
 * like a version: a coarse-but-honest id was the old comment's own defence of `0.1.0`, and the
 * lesson is that a plausible-looking wrong answer is worse than an obviously partial one. If a
 * beta report ever arrives saying `local`, the useful conclusion — that somebody deployed by
 * hand from a laptop — is one this string makes available rather than hides.
 */

declare const __BUILD_ID__: string;

/**
 * The short commit SHA this bundle was built from, or `local`.
 *
 * Read through a guard rather than referenced directly: `__BUILD_ID__` is a compile-time
 * substitution, and any consumer Vite does not process (a plain `node` script, a test that
 * imports this module outside the Vite pipeline) would otherwise throw a ReferenceError while
 * doing nothing more dangerous than composing a mailto link.
 */
export const BUILD_ID: string =
    typeof __BUILD_ID__ === 'string' && __BUILD_ID__ ? __BUILD_ID__ : 'local';

/** `abc1234` in production, `abc1234-dev` on a dev server. The suffix answers "is this live?". */
export const BUILD_LABEL: string = `${BUILD_ID}${import.meta.env.PROD ? '' : '-dev'}`;
