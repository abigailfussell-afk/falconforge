/**
 * The two timeouts that govern an async unit test, in one place because they are a PAIR
 * and were previously set in two files that could not see each other.
 *
 * Testing Library's `waitFor`/`findBy*` budget (`asyncUtilTimeout`) is applied in
 * `setup.ts`. Vitest's per-test budget (`testTimeout`) is applied in `vitest.config.ts`.
 * Nothing connected them, and they had drifted into being EQUAL — both 5000ms — which
 * made the async budget unreachable.
 *
 * Why equal is broken, precisely: a `waitFor` does not start when the test starts. It
 * starts after `render()` and whatever setup precedes it, so its window always extends
 * past the test's own deadline. The test therefore dies at `testTimeout` first, every
 * time, and the async budget can literally never elapse. Measured, not reasoned: a probe
 * component settling at 4800ms passed, one settling at 5500ms failed at 5011ms with
 *
 *     Error: Test timed out in 5000ms.
 *
 * and a code frame pointing at the `it(...)` line rather than at the assertion.
 *
 * That is exactly how the flake presented. Sprint 7's merge Gate saw the deep-link
 * `it.each` block in `Dashboard.test.tsx` fail on a cold, loaded run (jsdom environment
 * setup measured 258s against a normal 67s, right after a 52-file merge) and pass on a
 * warm one. Every deep-link target is behind `React.lazy`, so the render alone can eat
 * most of the 5s under load, leaving the wait to be killed by the test ceiling.
 *
 * The cost of the old arrangement was not only flakiness but DIAGNOSIS: a test timeout
 * says "something took too long" and names nothing, whereas the async util's own timeout
 * fails with the actual assertion and the DOM it could not find. Keeping headroom between
 * them buys a readable failure.
 *
 * This matters more from Sprint 7 on, because CI now runs on `v2/**` branches and a CI
 * runner is cold and contended every single time.
 */

/**
 * How long a `waitFor`/`findBy*` may keep retrying.
 *
 * Sprint 2 raised this from Testing Library's 1s default after "shows the Complete Setup
 * form" failed twice in eleven full-suite runs, both times immediately after the database
 * suite had loaded the machine, and passed in isolation every time. Five seconds still
 * fails a component that never settles; it just stops failing one that settles slowly
 * because 200 other tests are sharing the CPU.
 */
export const ASYNC_UTIL_TIMEOUT_MS = 5_000;

/**
 * How long a single test may run before Vitest kills it.
 *
 * Must stay comfortably ABOVE `ASYNC_UTIL_TIMEOUT_MS` or the budget above is a fiction.
 * The headroom covers render/import cost before the first wait, plus tests that legitimately
 * perform two sequential waits. It is not a licence for slow tests: nothing in the suite
 * comes close, and a test that genuinely needs 15s is a test with a bug in it.
 */
export const TEST_TIMEOUT_MS = 15_000;
