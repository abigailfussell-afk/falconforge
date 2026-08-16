import { describe, it, expect } from 'vitest';
import { getConfig } from '@testing-library/react';
import { ASYNC_UTIL_TIMEOUT_MS, TEST_TIMEOUT_MS } from '../timeouts';

/**
 * Guards the pairing described in `src/test/timeouts.ts`.
 *
 * Sprint 7's merge Gate caught the deep-link `it.each` block in `Dashboard.test.tsx`
 * failing on a cold, loaded run and passing on a warm one. The cause was not the test: the
 * async-util budget (5000ms) and Vitest's per-test ceiling (5000ms, the default, never set
 * explicitly) were equal, and a `waitFor` starts AFTER render -- so the ceiling always won
 * and the documented 5s of patience could never elapse.
 *
 * Both halves are asserted from where the suite actually reads them, not from the
 * constants alone: `getConfig()` is Testing Library's live value, so this fails if
 * `setup.ts` stops applying it. The Vitest half is asserted against the constant the
 * config imports, since a test cannot read its own runner's resolved options.
 */
describe('async test timeouts', () => {
    it('gives a test more time than a single wait may spend, so the wait can actually elapse', () => {
        /*
         * The specific regression: these were both 5000. Equal is not merely tight, it is
         * unreachable -- measured with a probe component, one settling at 4800ms passed and
         * one settling at 5500ms failed at 5011ms as a TEST timeout, naming no assertion.
         */
        expect(TEST_TIMEOUT_MS).toBeGreaterThan(ASYNC_UTIL_TIMEOUT_MS);

        /*
         * And not merely greater by a hair. A test may render (which is what consumed the
         * budget in the flake -- every deep-link target is behind React.lazy) and then wait,
         * or perform two sequential waits. Two full waits plus overhead is the honest floor.
         */
        expect(TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(ASYNC_UTIL_TIMEOUT_MS * 2 + 1_000);
    });

    it('actually applies the async budget to Testing Library, not just declares it', () => {
        // Fails if setup.ts drops the `configure` call or someone hardcodes a number back
        // into it -- the drift that made the two files disagree in the first place.
        expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
    });
});
