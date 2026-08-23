/**
 * The reason a change was parked must arrive WITH the badge, not five seconds after it.
 *
 * FOUND BY RUNNING THE APP, which is where fourteen of this repo's thirty-four fixes came
 * from and none came from the suite. `scripts/probe-queued-before-lapse.mjs` queues a task
 * while a team is licensed, revokes the licence underneath it, drains the queue, and reads the
 * sync panel. IndexedDB held the right `terminalReason` — "Your team's licence has lapsed …
 * renew the licence and retry this change" — and the screen said:
 *
 *     1 change didn't save
 *     They're still stored on this device. Retry when you have a connection.
 *
 * On a device that was ONLINE, about a problem that is not the connection, next to a status
 * chip reading "Live". Advice that is not merely unhelpful but points away from the fix.
 *
 * THE CAUSE was three hand-maintained copies of the same refresh, one of which had two of the
 * three values: `sync()`'s post-drain block set `pendingChanges` and `failedChanges` and left
 * `failureReasons` on its previous value, so the correct sentence only appeared when the 5 s
 * polling effect next fired. `docs/failure-modes.md` §12, and its prescribed fix — derive it
 * once — is what `refreshQueueCounts` now is.
 *
 * WHY THE WINDOW MATTERS AT ALL. Five seconds is the moment the user is looking: the badge
 * appearing is what makes them look. It is also exactly when a coach at a venue decides
 * whether to go and find better WiFi, which is what the wrong message tells them to do.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const REASON =
    "Your team's licence has lapsed, so the server is not accepting changes. " +
    'Nothing has been lost — renew the licence and retry this change.';

/*
 * The queue's observable state, flipped by the test rather than by a real drain. What is
 * under test is the WIRING between "a change was parked" and "the panel can say why", not
 * the classification itself — that has its own tests and was already correct.
 */
const queue = vi.hoisted(() => ({ pending: 0, failed: 0, reasons: [] as string[] }));

vi.mock('@/lib/auth');

vi.mock('@/lib/offline-db', () => ({
    db: { syncQueue: { toArray: async () => [] } },
    getPendingSyncCount: async () => queue.pending,
    getPendingSyncItems: async () => [],
    getSyncFailureCount: async () => queue.failed,
    getTerminalFailureReasons: async () => queue.reasons,
    moveToDeadLetter: async () => {},
    retrySyncFailures: async () => 0,
}));

vi.mock('@/lib/supabase', () => ({
    supabaseSync: { auth: { getSession: async () => ({ data: { session: null } }) } },
    isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/server-pull', () => ({ pullFromServer: async () => {} }));

import { useSync } from '@/lib/sync';
import { useAuth } from '@/lib/auth';

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
    queue.pending = 0;
    queue.failed = 0;
    queue.reasons = [];
    mockUseAuth.mockReturnValue({
        session: { access_token: 't' },
        isLoading: false,
    } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a parked change and its reason appear together', () => {
    /*
     * THE RED TEST. Put the two-value refresh back inside `sync()` — `setPendingChanges` and
     * `setFailedChanges` without `setFailureReasons` — and this fails: `failedChanges` is 1
     * and `failureReasons` is still `[]`, which is precisely the state that renders the wrong
     * sentence.
     *
     * FAKE TIMERS ARE LOAD-BEARING HERE, and this is the part a naive version gets wrong. The
     * 5 s polling effect fixes the omission on its own, so a test using real timers and any
     * generous `waitFor` goes green against the defect — it would simply be waiting out the
     * window the bug lives in. The clock is frozen so that `sync()`'s own refresh is the only
     * thing that can have set these values.
     */
    it('the reason is set by sync() itself, not by the 5s poll that follows', async () => {
        const { result } = renderHook(() => useSync());
        await waitFor(() => expect(result.current.failedChanges).toBe(0));

        // The drain parks a change. From here the clock does not move.
        vi.useFakeTimers();
        queue.failed = 1;
        queue.reasons = [REASON];

        await act(async () => {
            await result.current.sync();
        });

        expect(result.current.failedChanges).toBe(1);
        expect(result.current.failureReasons).toEqual([REASON]);
    });

    /*
     * The same wiring on the other path a user can take: pressing "Retry them" when the change
     * is still dead. The panel must not fall back to "retry when you have a connection" for the
     * gap between the retry and the next poll either.
     */
    it('survives a retry that re-parks the same change', async () => {
        queue.failed = 1;
        queue.reasons = [REASON];

        const { result } = renderHook(() => useSync());
        await waitFor(() => expect(result.current.failureReasons).toEqual([REASON]));

        vi.useFakeTimers();
        await act(async () => {
            await result.current.retryFailedChanges();
        });

        expect(result.current.failureReasons).toEqual([REASON]);
    });

    /*
     * The other direction, so the fix cannot be "always keep the last reasons". When the
     * parked change is finally accepted, the sentence must go with it — a stale "your licence
     * has lapsed" under a badge reading zero is its own kind of lie.
     */
    it('clears the reason when the parked change finally lands', async () => {
        queue.failed = 1;
        queue.reasons = [REASON];

        const { result } = renderHook(() => useSync());
        await waitFor(() => expect(result.current.failureReasons).toEqual([REASON]));

        vi.useFakeTimers();
        queue.failed = 0;
        queue.reasons = [];

        await act(async () => {
            await result.current.retryFailedChanges();
        });

        expect(result.current.failedChanges).toBe(0);
        expect(result.current.failureReasons).toEqual([]);
    });
});
