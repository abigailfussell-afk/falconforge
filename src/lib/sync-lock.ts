/**
 * One drain at a time, across every tab on this device (SYNC-09).
 *
 * `useSync`'s guards are per-module-instance — `syncingRef`, `failedDrainsRef`, and
 * `lastIssuedTimestamp` in `offline-db.ts` — and every browser tab is its own module instance.
 * Two tabs open on the same team therefore drain the same IndexedDB queue at the same time, and
 * the consequences are small but real:
 *
 *   - **Double retry counts.** Two tabs each catch the same failing item and each increment its
 *     `retryCount`, so an item that has genuinely failed three times reaches
 *     `MAX_SYNC_RETRIES` and is parked. B2 keeps the work, but the user is told their change
 *     could not be saved two failures earlier than the engine intends.
 *   - **Double pushes.** Harmless in content — every write is an upsert or an id-scoped update —
 *     but it is twice the egress on the connection least able to afford it, which is the whole
 *     of SYNC-03.
 *
 * WHAT THIS DOES NOT FIX, and why that is a decision rather than an oversight.
 * `nextQueueTimestamp()` in `offline-db.ts` guarantees strictly increasing values WITHIN a tab
 * and knows nothing about the other one, so two tabs writing in the same millisecond can still
 * produce a tie in the key the drain orders by (B1). A lock around the drain does not touch
 * that, and seeding the allocator from the queue's own maximum would mean an async read inside
 * `queueForSync` — which is where B1 was reintroduced the second time, by moving exactly that
 * allocation across an await.
 *
 * A tie is harmless here, and the reason is worth stating so nobody "fixes" it later: ties can
 * only happen between DIFFERENT records, because `queueForSync` coalesces per `(table,
 * recordId)` against the SHARED Dexie queue, so two tabs touching one record produce one entry
 * and never two. Between different records the relative order does not matter, with the single
 * exception of a parent and its child queued in two tabs inside the same millisecond — which
 * requires two people, two tabs and one millisecond, and is a race the user has already created.
 *
 * `navigator.locks` is exactly this primitive and is in every browser this app supports. Where
 * it is absent the callback simply runs: a device with one tab is the overwhelming case, and
 * refusing to sync at all would be a far worse failure than the one being prevented.
 *
 * NOT A MUTEX AROUND THE WHOLE SYNC. Only the DRAIN is serialised. Two tabs pulling at the same
 * time is wasteful and harmless — `mergeIntoStore` honours `getPendingRecordIds()` on both — and
 * holding a cross-tab lock across a pull would mean one tab's slow read blocks the other tab's
 * writes, which is the opposite of what a venue needs.
 */

/** The lock's name. One per origin, which is one per device for this app. */
export const SYNC_LOCK = 'falconforge-sync';

/**
 * Does this browser have the Web Locks API?
 *
 * A function rather than a constant so a test can hide it, and so the check happens at call
 * time rather than at module load — jsdom acquires and loses globals depending on the setup file
 * that ran, and a constant captured at import would be answering about a different environment
 * than the one the code runs in.
 */
export function locksAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
}

/**
 * Run `work` while holding the sync lock, or run it directly where locks do not exist.
 *
 * `ifAvailable: true`, deliberately: if another tab holds the lock this call gets `null` instead
 * of waiting, and returns `undefined` without running the work. Waiting would be wrong — the
 * other tab is draining the same queue this one would have drained, so by the time the lock is
 * free the work is done, and a queue of waiters would each then run a pointless empty drain.
 * "Somebody else is already doing it" is a complete answer.
 */
export async function withSyncLock<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (!locksAvailable()) return await work();

    return await navigator.locks.request(
        SYNC_LOCK,
        { ifAvailable: true },
        async (lock) => (lock ? await work() : undefined),
    );
}
