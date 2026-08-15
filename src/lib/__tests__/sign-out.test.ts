import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performSignOut } from '../sign-out';
import { teardownRealtimeSubscription } from '../realtime';
import { clearLocalDatabase, clearAppState } from '../offline-db';
import { useAppStore } from '../store';

// Sign-out's contract is *that it calls* each teardown step, so both collaborators are
// mocked here to be observable. That it actually empties IndexedDB is asserted for real in
// `sign-out-cleanup.integration.test.ts`.
vi.mock('../realtime');
vi.mock('../offline-db');

/**
 * Sign-out used to be duplicated verbatim in App.tsx and Onboarding.tsx. On a shared team
 * laptop a step missed in one copy leaks the previous user's data into the next session, so
 * these tests pin the full teardown contract on the single helper.
 */

describe('performSignOut', () => {
    let resetSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        resetSpy = vi.spyOn(useAppStore.getState(), 'resetToDefaults').mockImplementation(() => { });

        localStorage.setItem('sb-abcdef-auth-token', 'secret-session');
        localStorage.setItem('falconforge-sync-timestamps', '{"tasks":1}');
        localStorage.setItem('unrelated-key', 'keep me');
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
        resetSpy.mockRestore();
    });

    it('tears down realtime, resets the store, clears tokens and IndexedDB, then redirects', async () => {
        const redirect = vi.fn();
        const signOut = vi.fn().mockResolvedValue(undefined);

        await performSignOut(signOut, redirect);

        expect(teardownRealtimeSubscription).toHaveBeenCalled();
        expect(resetSpy).toHaveBeenCalled();
        expect(signOut).toHaveBeenCalled();
        expect(clearLocalDatabase).toHaveBeenCalled();
        expect(clearAppState).toHaveBeenCalled();
        expect(redirect).toHaveBeenCalled();
    });

    it('removes Supabase auth tokens and sync cursors but leaves unrelated keys alone', async () => {
        await performSignOut(vi.fn().mockResolvedValue(undefined), vi.fn());

        expect(localStorage.getItem('sb-abcdef-auth-token')).toBeNull();
        expect(localStorage.getItem('falconforge-sync-timestamps')).toBeNull();
        expect(localStorage.getItem('unrelated-key')).toBe('keep me');
    });

    it('still clears local state and redirects when Supabase sign-out hangs', async () => {
        const redirect = vi.fn();
        // Never settles — the venue-WiFi case the timeouts exist for.
        const signOut = vi.fn(() => new Promise<void>(() => { }));

        const pending = performSignOut(signOut, redirect);
        await vi.advanceTimersByTimeAsync(3000);
        await pending;

        expect(localStorage.getItem('sb-abcdef-auth-token')).toBeNull();
        expect(clearLocalDatabase).toHaveBeenCalled();
        expect(redirect).toHaveBeenCalled();
    });

    it('redirects even when Supabase sign-out rejects', async () => {
        const redirect = vi.fn();
        const signOut = vi.fn().mockRejectedValue(new Error('network down'));

        await performSignOut(signOut, redirect);

        expect(clearLocalDatabase).toHaveBeenCalled();
        expect(redirect).toHaveBeenCalled();
    });

    it('redirects even when clearing IndexedDB fails', async () => {
        const redirect = vi.fn();
        vi.mocked(clearLocalDatabase).mockRejectedValueOnce(new Error('IDB blocked'));

        await performSignOut(vi.fn().mockResolvedValue(undefined), redirect);

        expect(redirect).toHaveBeenCalled();
    });
});
