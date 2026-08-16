import { describe, it, expect, afterEach, vi } from 'vitest';
import { applyPersistedTheme } from '../store';

/**
 * Regression test for the unhandled `ReferenceError: document is not defined` that turned CI red
 * the first time it ever ran on this code.
 *
 * `onRehydrateStorage` fires when zustand finishes reading persisted state out of IndexedDB.
 * That is asynchronous and unscheduled, so under Vitest it can land AFTER the test file's jsdom
 * environment has been torn down — at which point `document` is gone. Because it throws from a
 * callback rather than from a test, it surfaces as an unhandled error: the run fails while every
 * individual test still reports as passing, which is a genuinely confusing way to lose an hour.
 *
 * It is a race against teardown, which is why it was green on a developer machine and red on a
 * two-core runner. This test removes the race and asks the question directly.
 */
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('applyPersistedTheme', () => {
    it('does nothing, rather than throwing, when there is no document', () => {
        // Exactly the post-teardown condition: the global is gone while the async rehydration
        // callback is still in flight.
        vi.stubGlobal('document', undefined);

        expect(() => applyPersistedTheme('dark')).not.toThrow();
        expect(() => applyPersistedTheme(undefined)).not.toThrow();
    });

    it('adds the dark class when the persisted theme is dark', () => {
        document.documentElement.classList.remove('dark');

        applyPersistedTheme('dark');

        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes the dark class for any other persisted theme, including none', () => {
        // The positive control matters as much as the guard: a version of this that returned
        // early always would pass the test above and quietly break theming for everyone.
        document.documentElement.classList.add('dark');
        applyPersistedTheme('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);

        document.documentElement.classList.add('dark');
        applyPersistedTheme(undefined);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
});
