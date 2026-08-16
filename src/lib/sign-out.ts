import { teardownRealtimeSubscription } from './realtime';
import { useAppStore } from './store';
import { clearLocalDatabase, clearAppState } from './offline-db';
import { PROFILE_CACHE_KEY } from './profile-cache';

/** How long to wait on Supabase before giving up and clearing local state anyway. */
const SIGN_OUT_TIMEOUT_MS = 3000;
/** How long to wait on IndexedDB before giving up. */
const IDB_TIMEOUT_MS = 2000;

/**
 * Tears down a signed-in session and returns the user to the landing page.
 *
 * This used to exist as two verbatim copies, in App.tsx and Onboarding.tsx. Sign-out is the
 * one path where a missed step leaks another user's data into the next session on a shared
 * team laptop, so it should not be possible for the two to drift.
 *
 * Every step is best-effort and time-boxed on purpose: at a competition the network is often
 * unusable, and a sign-out that hangs waiting on Supabase is worse than one that clears local
 * state and redirects. Local teardown therefore never depends on the remote call succeeding,
 * and the redirect runs from `finally` so it happens even if something above it throws.
 */
export async function performSignOut(
    signOut: () => Promise<void>,
    /** Injectable purely so tests can observe the redirect instead of navigating. */
    redirect: () => void = redirectToLanding
): Promise<void> {
    try {
        // Before clearing state, so no realtime event can repopulate the store mid-teardown.
        teardownRealtimeSubscription();

        // Reset the store next, which stops local edits from queueing new sync work.
        useAppStore.getState().resetToDefaults();

        // Belt and braces on top of supabase.auth.signOut(): drop the token keys directly.
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
                localStorage.removeItem(key);
            }
        });
        localStorage.removeItem('falconforge-sync-timestamps');
        // The cached display profile, cleared here as well as by the SIGNED_OUT handler in
        // auth.tsx. Belt and braces for the same reason the token sweep above is: this path
        // ends in a hard `window.location.reload()`, so it races the auth event, and on a
        // shared team laptop losing that race means the next person sees the previous one's
        // name in the sidebar until their own profile resolves.
        localStorage.removeItem(PROFILE_CACHE_KEY);

        try {
            await withTimeout(signOut(), SIGN_OUT_TIMEOUT_MS, 'Sign out timeout');
        } catch (authErr) {
            console.warn('Supabase signout issue ignored:', authErr);
        }

        /*
         * Sync queue + persisted app state.
         *
         * `offline-db` is imported statically. It used to be `await import('./offline-db')`
         * here and in JoinTeam, which is what produced the standing build warning that
         * offline-db was "both statically and dynamically imported, defeating its own
         * code-split". The plan blamed that on the missing route splitting; it is not — the
         * module is pulled into the entry chunk by `./store` (and by sync, realtime,
         * server-pull and three slices) two lines above, so nothing about a `React.lazy`
         * boundary could have moved it. The dynamic form deferred nothing, cost a Promise
         * tick on the sign-out path, and only ever bought the warning.
         */
        try {
            await withTimeout(
                (async () => {
                    await clearLocalDatabase();
                    await clearAppState();
                })(),
                IDB_TIMEOUT_MS,
                'IDB timeout'
            );
        } catch (dbErr) {
            console.warn('Failed to clear IndexedDB:', dbErr);
        }
    } finally {
        redirect();
    }
}

/** Hard navigation, so nothing survives in memory from the signed-in tree. */
function redirectToLanding(): void {
    window.location.href = `${import.meta.env.BASE_URL}#/`;
    window.location.reload();
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
        work,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}
