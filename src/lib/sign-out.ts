import { teardownRealtimeSubscription } from './realtime';
import { useAppStore } from './store';
import {
    clearLocalDatabase,
    clearAppState,
    getPendingSyncCount,
    getSyncFailureCount,
} from './offline-db';
import { PROFILE_CACHE_KEY } from './profile-cache';
import { clearAttestationSnooze } from './attestations';
import { resetServerReachability } from './server-reachability';
import { drainSyncQueue } from './sync';
import { retrySyncFailures } from './offline-db';

/** How long to wait on Supabase before giving up and clearing local state anyway. */
const SIGN_OUT_TIMEOUT_MS = 3000;
/** How long to wait on IndexedDB before giving up. */
const IDB_TIMEOUT_MS = 2000;

/**
 * Work on this device that the server has not accepted: queued pushes and parked ones.
 *
 * Both count. A dead letter is not "already dealt with" — it is a change that failed five
 * times and is waiting for a human to retry it (B2), and clearing it is the same loss as
 * clearing the queue.
 */
export interface UnsyncedWork {
    /** Changes still queued for a push. */
    pending: number;
    /** Changes parked in the dead-letter store, waiting to be retried (B2/B24). */
    failed: number;
    /** The number a person cares about. */
    total: number;
}

/** What the person decided when told there was unsynced work. */
export type UnsyncedChoice = 'sign-out' | 'sync-first' | 'cancel';

/** What has already been tried, so the question can be asked honestly the second time. */
export interface UnsyncedPrompt {
    /**
     * True once "sync first" has been tried and the work is still here.
     *
     * Without it the dialog reappears with the identical sentence and the identical button,
     * which is `docs/failure-modes.md` section 8 exactly: an enabled control whose handler
     * silently does nothing, and at a venue with no WiFi that is indistinguishable from a
     * broken app. Seen doing precisely that in the browser at 375px before this existed.
     */
    syncAttempted: boolean;
}

/** How many times a caller may answer `sync-first` before this gives up and cancels. */
const MAX_SYNC_FIRST_ROUNDS = 5;

/** How much of this device's work has not reached the server. Never throws. */
export async function getUnsyncedWork(): Promise<UnsyncedWork> {
    try {
        const [pending, failed] = await Promise.all([
            getPendingSyncCount(),
            getSyncFailureCount(),
        ]);
        return { pending, failed, total: pending + failed };
    } catch (err) {
        /*
         * An unreadable queue reports zero, and that is not the absence-as-a-value mistake
         * it looks like: the same IndexedDB that cannot be counted cannot be cleared either,
         * so the work is not destroyed by carrying on. Blocking sign-out on a database read
         * would strand somebody on a shared laptop with the previous person still signed in.
         */
        console.warn('Could not read the sync queue before signing out:', err);
        return { pending: 0, failed: 0, total: 0 };
    }
}

/**
 * The sentence shown to the person, written once.
 *
 * Named counts, not "some changes": the whole point of the warning is that a student who
 * scouted three matches in a gym can tell that from a device with nothing on it.
 */
export function describeUnsyncedWork(work: UnsyncedWork): string {
    const one = work.total === 1;
    const changes = one ? '1 change' : `${work.total} changes`;
    return `${changes} ${one ? "hasn't" : "haven't"} reached the server yet. ` +
        `Signing out deletes ${one ? 'it' : 'them'} from this device.`;
}

/**
 * The fallback prompt, for sign-out buttons that are not inside the app shell.
 *
 * `window.confirm` cannot offer three options, so it offers the two that matter: sign out
 * and lose the work, or stay. `Onboarding` and `JoinTeam` are the two screens on this path
 * and neither renders the shell's dialog; a plain confirm there is a great deal better than
 * the silence that used to be there.
 */
function confirmViaWindow(work: UnsyncedWork, _prompt: UnsyncedPrompt): UnsyncedChoice {
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') return 'sign-out';
    return window.confirm(`${describeUnsyncedWork(work)}\n\nSign out anyway?`) ? 'sign-out' : 'cancel';
}

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
    redirect: () => void = redirectToLanding,
    /**
     * Asked when the device still holds work the server has not accepted.
     *
     * The POLICY lives here rather than at the three call sites, because sign-out is the one
     * path where a missed step loses somebody's data and the three copies of it are how this
     * project learned that (`docs/failure-modes.md` section 1). What differs per call site is
     * only how the question is asked: the app shell shows a real dialog, the two screens
     * outside it get `window.confirm`.
     */
    askAboutUnsyncedWork: (
        work: UnsyncedWork,
        prompt: UnsyncedPrompt,
    ) => Promise<UnsyncedChoice> | UnsyncedChoice = confirmViaWindow,
): Promise<void> {
    /*
     * SIGNING OUT DESTROYS QUEUED AND PARKED WORK, SO IT HAS TO SAY SO (SYNC-05).
     *
     * `clearLocalDatabase()` empties the sync queue AND the dead-letter store. That is
     * correct — the next person on this laptop must not inherit them — and it used to happen
     * on one unannounced click. The case is not hypothetical and is one this product is
     * explicitly designed around: a student scouts three matches offline, signs out so the
     * next student can sign in, and the reports are gone. Principle 2 says failed sync work
     * is never silently dropped; this was the one path that dropped it on purpose.
     *
     * Before the try block, because a cancel must leave EVERYTHING alone — including the
     * redirect, which lives in `finally` and would otherwise fire on the way out.
     */
    let syncAttempted = false;
    for (let round = 0; ; round++) {
        const work = await getUnsyncedWork();
        if (work.total === 0) break;

        if (round >= MAX_SYNC_FIRST_ROUNDS) {
            console.warn('Giving up on syncing before sign-out; leaving the queue alone.');
            return;
        }

        const choice = await askAboutUnsyncedWork(work, { syncAttempted });
        if (choice === 'cancel') return;
        if (choice === 'sign-out') break;

        /*
         * 'sync-first': put the PARKED changes back on the queue first, then push.
         *
         * `drainSyncQueue` alone would not touch a dead letter, and a dead letter is most of
         * what is here after a bad afternoon — so the button would have run, changed nothing,
         * and asked the same question again. Which is what it did, in the browser, before
         * this line existed.
         */
        syncAttempted = true;
        try {
            await retrySyncFailures();
            await drainSyncQueue();
        } catch (err) {
            console.warn('Could not push the outstanding changes before signing out:', err);
        }
    }

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
        // The "remind me later" snooze is keyed by user id, so it is already harmless to the
        // next person on a shared laptop — cleared here as well because it is one more thing
        // about the previous user sitting in their storage.
        clearAttestationSnooze();
        // The next person's device must not inherit this session's idea of whether the
        // server was up.
        resetServerReachability();
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
