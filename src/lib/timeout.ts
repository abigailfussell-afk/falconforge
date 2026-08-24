/**
 * Promise timeouts, shared by the sync drain and the server pull.
 *
 * Lives in its own module because both `sync.ts` (push) and `server-pull.ts` (read) need
 * it, and sync.ts imports server-pull.ts. Leaving it in sync.ts would make that a cycle.
 */

/**
 * Race a promise against a timeout. Rejects with a descriptive error if the timeout fires
 * first.
 *
 * The timer must be cleared when the promise settles first (B13). Previously every call
 * left a pending timer alive for up to its full duration -- harmless in the browser, but it
 * keeps the event loop busy and is a plausible source of slow test teardown, since a suite
 * could accumulate hundreds of 10-30s timers.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;

    return Promise.race([
        Promise.resolve(promise),
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** 10s per Supabase query. */
export const PER_QUERY_TIMEOUT_MS = 10_000;

/**
 * 30s without PROGRESS, not 30s in total (SYNC-13).
 *
 * It used to cap an entire sync — drain plus pull — at thirty seconds flat. A device that had
 * been offline for a day comes back with a large queue, each item a round trip; at the ~500 ms a
 * venue connection manages, about sixty items fit in the window. The rest of the drain was
 * cancelled mid-way and the run reported "Sync failed" — while it had in fact pushed sixty items
 * and would push sixty more on the next attempt. The user is told they have failed, repeatedly,
 * for as long as the queue is bigger than one window.
 *
 * The number stays the same and its meaning changes: it is now the longest the engine will wait
 * while NOTHING is succeeding. See {@link progressDeadline}.
 */
export const OVERALL_SYNC_TIMEOUT_MS = 30_000;

/**
 * A deadline that moves whenever work actually gets done.
 *
 * The distinction this draws is between a run that is SLOW and a run that is STUCK. A flat
 * timeout cannot tell them apart, and the two want opposite treatment: a slow drain should be
 * left to finish, and a stuck one should be abandoned so the next attempt can start.
 *
 * Only SUCCESS counts as progress. A queue of five hundred items that are all being refused
 * would otherwise extend the deadline five hundred times over and hold the sync lock for an hour
 * — each item is separately bounded by {@link PER_QUERY_TIMEOUT_MS}, so failures alone can still
 * consume a great deal of wall clock.
 *
 * `now` is injectable because a test that has to wait thirty real seconds to prove this is a test
 * nobody runs.
 */
export interface ProgressDeadline {
    /** Called by the worker each time it completes a unit of work. */
    progress(): void;
    /** True when nothing has progressed for the idle budget. */
    expired(): boolean;
}

export function progressDeadline(
    idleMs: number = OVERALL_SYNC_TIMEOUT_MS,
    now: () => number = () => Date.now(),
): ProgressDeadline {
    let last = now();
    return {
        progress() {
            last = now();
        },
        expired() {
            return now() - last >= idleMs;
        },
    };
}

/** Cooperative cancellation for a sync run (B6). */
export interface SyncToken {
    cancelled: boolean;
    /**
     * Optional idle budget for a drain (SYNC-13). Absent means no deadline at all, which is
     * what every existing caller and every B-test gets — the drain is then bounded only by the
     * queue snapshot it started with, and by each item's own per-query timeout.
     */
    deadline?: ProgressDeadline;
}
