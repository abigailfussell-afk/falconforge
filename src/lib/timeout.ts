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

/** 30s for an entire sync operation (drain + pull). */
export const OVERALL_SYNC_TIMEOUT_MS = 30_000;

/** Cooperative cancellation for a sync run (B6). */
export interface SyncToken {
    cancelled: boolean;
}
