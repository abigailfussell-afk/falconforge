import { useState, useEffect, useCallback, useRef } from 'react';
import {
    db,
    getPendingSyncCount,
    getPendingSyncItems,
    getSyncFailureCount,
    getTerminalFailureReasons,
    moveToDeadLetter,
    retrySyncFailures,
    SyncQueueItem,
} from './offline-db';
import { supabaseSync } from './supabase';
import { useAppStore } from './store';
import { useAuth } from './auth';
import { findEntity, SYNCED_ENTITIES, GUARDIAN_ENTITIES, type RemoteTable } from './entity-registry';
import {
    classifySyncFailure,
    type SyncFailureContext,
} from './sync-failure-classification';
import { pullFromServer, pullEntitlement } from './server-pull';
import { isServerAnswer, recordServerContact } from './server-reachability';
import { withSyncLock } from './sync-lock';
import {
    withTimeout,
    progressDeadline,
    PER_QUERY_TIMEOUT_MS,
    OVERALL_SYNC_TIMEOUT_MS,
    type SyncToken,
} from './timeout';

export { withTimeout } from './timeout';
export type { SyncToken } from './timeout';

/**
 * Tables the sync queue is allowed to touch.
 *
 * The queue stores `tableName` as a plain string -- it is persisted data, so nothing stops
 * a stale or corrupted entry naming something that does not exist. The generated database
 * types narrow `.from()` to real tables, and this is the one place that boundary is
 * crossed: validate once, loudly, instead of casting at each of the four call sites.
 */
const SYNCABLE_TABLES = new Set<string>([
    ...SYNCED_ENTITIES.map((e) => e.remoteTable),
    // Guardian-scoped but pushed through the same queue: a child added on a phone with no
    // signal gets the same retry -> dead-letter guarantees as anything else. They are pulled
    // separately (they have no `team_id`), which is why they are a separate list — but the
    // QUEUE does not care what a row is scoped by, only whether the table is real.
    ...GUARDIAN_ENTITIES.map((e) => e.remoteTable),
    'checklists',
]);

function asSyncableTable(tableName: string): RemoteTable {
    if (!SYNCABLE_TABLES.has(tableName)) {
        // Throwing routes the item through the normal retry path and, after
        // MAX_SYNC_RETRIES, into the dead-letter store where a human can see it -- rather
        // than failing silently against a table that is not there.
        throw new Error(`Refusing to sync unknown table "${tableName}"`);
    }
    return tableName as RemoteTable;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

/** Attempts before a change is parked in the dead-letter store (B2). */
export const MAX_SYNC_RETRIES = 5;

/**
 * How often an open app re-checks whether its own cover has run out.
 *
 * Not a poll of the server: see `reAskEntitlementIfCoverLooksOver`, which makes a request only
 * when the device already believes cover has ended. This is how often that cheap local
 * question is asked. A minute is well inside the time it takes to walk to the pit.
 */
export const ENTITLEMENT_RECHECK_MS = 60_000;

/**
 * How long to wait before re-attempting a queue that still has work in it, indexed by how
 * many consecutive drains have failed (B19).
 *
 * WHY THIS EXISTS
 *
 * Retrying used to be left entirely to the auto-sync effect, which fires only when one of
 * its dependencies CHANGES. After a failed push nothing does: the failure is caught inside
 * `drainSyncQueue`, so `sync()` still resolves, `syncStatus` returns to `'idle'`, and
 * `pendingChanges` holds steady at the same number. An `online` event does not help either
 * -- `isOnline` is already `true` and `syncStatus` already `'idle'`, so React bails out of
 * both `setState` calls and no dependency changes.
 *
 * The result, reproduced in the browser: a task created while requests were failing stayed
 * queued for over a minute after connectivity returned, across several `online` events, and
 * only went up when the sync indicator was clicked by hand. At a competition that reads as
 * "my scouting report never uploaded" long after the WiFi came back -- the exact failure
 * this engine exists to prevent.
 *
 * Backoff rather than a fixed interval because a change is dead-lettered after
 * MAX_SYNC_RETRIES attempts. A tight retry loop would burn all five inside half a minute
 * and park work that a slightly longer wait would have pushed successfully. This schedule
 * spends those five attempts over roughly nine minutes instead.
 *
 * Genuine offline periods do not consume attempts at all: `sync()` returns early when
 * `navigator.onLine` is false, without touching the queue. What this schedule covers is the
 * harder case -- a network that claims to be up and is not, which is what venue WiFi and
 * captive portals actually look like.
 */
const RETRY_BACKOFF_MS = [3_000, 15_000, 60_000, 180_000, 300_000] as const;

function retryDelayFor(consecutiveFailures: number): number {
    return RETRY_BACKOFF_MS[Math.min(consecutiveFailures, RETRY_BACKOFF_MS.length - 1)];
}

interface UseSyncResult {
    isOnline: boolean;
    syncStatus: SyncStatus;
    pendingChanges: number;
    /** Changes that exhausted their retries and are parked, not lost (B2). */
    failedChanges: number;
    /**
     * Distinct reasons among the parked changes that were refused rather than merely
     * unreachable (B24).
     *
     * De-duplicated, because one lapsed licence produces one explanation however many changes
     * it stopped — a list repeating "your team's licence has lapsed" eleven times tells the
     * user nothing the first line did not.
     */
    failureReasons: string[];
    lastSyncTime: Date | null;
    sync: () => Promise<void>;
    /** Re-queue every parked change. Resolves to how many were restored. */
    retryFailedChanges: () => Promise<number>;
    error: string | null;
}

export function useSync(): UseSyncResult {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
    const [pendingChanges, setPendingChanges] = useState(0);
    const [failedChanges, setFailedChanges] = useState(0);
    const [failureReasons, setFailureReasons] = useState<string[]>([]);
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const syncingRef = useRef(false);

    /**
     * The three queue numbers, read together, from one place.
     *
     * THREE CALL SITES USED TO SET THEM BY HAND and one of them set only two: the post-drain
     * refresh inside `sync()` updated `failedChanges` and left `failureReasons` on its
     * previous value. So at the exact moment a change was parked — which is the moment the
     * user looks — the panel said "1 change didn't save. They're still stored on this device.
     * **Retry when you have a connection**" to a device that was online and whose problem was
     * a lapsed licence. The real reason arrived up to five seconds later, when the polling
     * effect caught up.
     *
     * Measured, not theorised: `scripts/probe-queued-before-lapse.mjs` queues a write, revokes
     * the licence underneath it, drains, and reads the panel. The parked record carried the
     * right `terminalReason` in IndexedDB the whole time; the screen did not say it.
     *
     * `docs/failure-modes.md` §12 — a hand-maintained list that must track another list — with
     * §12's own prescribed fix: derive it once instead of remembering to update three copies.
     */
    const refreshQueueCounts = useCallback(async () => {
        /*
         * Guarded, because this also runs on an interval. An unguarded throw here becomes an
         * unhandled rejection every five seconds for as long as the app is open — and it is a
         * READ of local state, so failing it changes nothing the user can act on. The right
         * response is to leave the last known numbers on screen and try again next tick.
         *
         * Not hypothetical: adding `getTerminalFailureReasons` to this list broke a test suite
         * whose offline-db mock predated it, and the symptom was not an assertion failure but
         * a file that hung for fifteen minutes.
         */
        try {
            const [pending, failed, reasons] = await Promise.all([
                getPendingSyncCount(),
                getSyncFailureCount(),
                getTerminalFailureReasons(),
            ]);
            setPendingChanges(pending);
            setFailedChanges(failed);
            setFailureReasons(reasons);
        } catch (err) {
            console.warn('Could not read the sync queue counts:', err);
        }
    }, []);
    /** Consecutive drains that left work behind. Drives the retry backoff (B19). */
    const failedDrainsRef = useRef(0);

    // Derive auth readiness from the AuthProvider context.
    // The AuthProvider already handles session restoration, token refresh,
    // and timeouts after hard refreshes (Ctrl+F5). We piggyback on it
    // instead of independently tracking auth state.
    const { session, isLoading: authLoading } = useAuth();
    const authReady = !!session && !authLoading;
    const authReadyRef = useRef(authReady);

    // Keep the ref in sync for use inside the sync() callback (avoids stale closures)
    useEffect(() => {
        authReadyRef.current = authReady;
    }, [authReady]);

    // Track online/offline status
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setSyncStatus('idle');
        };

        const handleOffline = () => {
            setIsOnline(false);
            setSyncStatus('offline');
            syncingRef.current = false;
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    // Update pending changes count
    useEffect(() => {
        void refreshQueueCounts();

        // Poll for changes every 5 seconds
        const interval = setInterval(() => void refreshQueueCounts(), 5000);
        return () => clearInterval(interval);
    }, [refreshQueueCounts]);

    /*
     * NOTICE OUR OWN LICENCE RUNNING OUT WHILE THE APP IS SIMPLY OPEN.
     *
     * `pullChangesFromServer` also calls this, which covers the case where there is queued
     * work. It is not enough on its own, and finding out why is what
     * `scripts/probe-queued-before-lapse.mjs` is for: `sync()` runs only when
     * `getPendingSyncCount() > 0`, so a client with an empty queue never pulls ANYTHING. A
     * coach who has the board open and is not typing — which at a competition is most of the
     * day — would go on being shown live New/Edit/Save controls until they queued something or
     * reloaded the tab, and `license_grants` has no realtime subscription to tell them either.
     *
     * A minute, not five seconds, because the answer this asks about changes at most once. And
     * it is nearly always free: `reAskEntitlementIfCoverLooksOver` returns without a request
     * unless the device ALREADY believes cover has ended, which for a licensed team is never,
     * and it stops asking the moment the server says `read_only`.
     */
    useEffect(() => {
        if (!authReady) return;

        const check = () => {
            if (!navigator.onLine) return;
            const teamId = useAppStore.getState().currentTeamId;
            if (teamId) void reAskEntitlementIfCoverLooksOver(teamId);
        };

        check();
        const interval = setInterval(check, ENTITLEMENT_RECHECK_MS);
        return () => clearInterval(interval);
    }, [authReady]);

    // Auto-sync when coming back online, when pending changes increase, or when auth
    // becomes ready (e.g. after Ctrl+F5 token refresh completes). This is the fast path:
    // it reacts to something changing. It is NOT the retry path -- see below for why it
    // cannot be (B19).
    useEffect(() => {
        if (authReady && isOnline && pendingChanges > 0 && syncStatus === 'idle' && !syncingRef.current) {
            void sync();
        }
    }, [authReady, isOnline, pendingChanges, syncStatus]);


    const sync = useCallback(async () => {
        if (syncingRef.current) return;
        // FIX: Read navigator.onLine directly to avoid stale closure
        if (!navigator.onLine || !supabaseSync) {
            setSyncStatus('offline');
            return;
        }

        // Check auth readiness via ref (avoids stale closure).
        // After Ctrl+F5, the Supabase client needs time to restore the session.
        // Syncing without a valid token causes RLS-protected queries to hang.
        if (!authReadyRef.current) {
            return;
        }

        syncingRef.current = true;
        setSyncStatus('syncing');
        setError(null);

        // withTimeout only rejects the outer promise -- the work inside keeps running (B6).
        // Without a cancellation flag, a timed-out run carried on mutating the queue and the
        // store while the next run started, so two loops raced over the same items.
        const token: SyncToken = { cancelled: false, deadline: progressDeadline() };

        try {
            /*
             * THE DRAIN IS BOUNDED BY PROGRESS, THE PULL BY THE CLOCK (SYNC-13).
             *
             * These are different shapes of work and the flat `withTimeout` around both treated
             * them the same. A drain is N independent round trips, each already bounded by
             * `PER_QUERY_TIMEOUT_MS`, and a long one that keeps succeeding is a device catching
             * up after a day offline — precisely what this app exists to survive. A pull is one
             * operation that either answers or hangs, so a wall-clock bound is the right
             * instrument for it and the wrong one for the drain.
             */
            /*
             * ONE TAB DRAINS AT A TIME (SYNC-09).
             *
             * `syncingRef` is per module instance and every tab is its own instance, so two tabs
             * on the same team drained the same IndexedDB queue together — double retry counts
             * (an item parked two failures early), double egress, and ties in the ordering key
             * B1 exists to make strict. If the other tab holds the lock this returns `undefined`
             * without running: that tab is draining the same queue, so there is nothing to wait
             * for, and a queue of waiters would each then run a pointless empty drain.
             *
             * The PULL is deliberately outside the lock. Two tabs reading at once is wasteful
             * and harmless — both honour `getPendingRecordIds()` — and holding a cross-tab lock
             * across a read would let one tab's slow pull block the other tab's writes.
             */
            const drain = (await withSyncLock(() => drainSyncQueue(token))) ?? {
                pushed: 0, retried: 0, deadLettered: 0, terminal: 0, cancelled: true, stalled: false,
            };

            // Widen the retry backoff while pushes keep failing, and collapse it back the
            // moment one succeeds. Counting drains rather than individual items keeps one
            // permanently-broken record (which dead-letters after MAX_SYNC_RETRIES anyway)
            // from slowing down everyone else's retries.
            if (drain.retried > 0 && drain.pushed === 0) {
                failedDrainsRef.current += 1;
            } else {
                failedDrainsRef.current = 0;
            }

            /*
             * A stall that pushed NOTHING is a failure and says so. A stall that pushed
             * something is a slow catch-up, and the queue count in the indicator already tells
             * the truth about what is left — "N pending", amber, rather than "Sync Error", red.
             * Reporting failure over work that succeeded is what SYNC-13 was.
             */
            if (drain.stalled && drain.pushed === 0) {
                throw new Error(
                    `Timeout: no queued change could be pushed in ${OVERALL_SYNC_TIMEOUT_MS}ms`,
                );
            }

            await withTimeout(
                pullChangesFromServer(token),
                OVERALL_SYNC_TIMEOUT_MS,
                'Server pull',
            );

            setLastSyncTime(new Date());
            setSyncStatus('idle');

            // Pending, failed AND the reasons — this is the site that used to omit the
            // third, so a change parked for a lapsed licence appeared with the generic
            // "retry when you have a connection" until the 5s poll corrected it.
            await refreshQueueCounts();
        } catch (err) {
            // Stop the orphaned run before releasing the lock, so the next sync does not
            // race it over the same queue items (B6).
            token.cancelled = true;
            console.error('Sync failed:', err);
            setError(err instanceof Error ? err.message : 'Sync failed');
            setSyncStatus('error');
        } finally {
            syncingRef.current = false;
        }
        // FIX: No deps on isOnline - we read navigator.onLine directly
    }, [refreshQueueCounts]);

    // Retry queued work that failed to push, without the user having to do anything.
    //
    // Reads the QUEUE rather than React state on purpose: `pendingChanges` staying at the
    // same number is exactly the case that needs a retry, and a dependency that does not
    // change cannot trigger one. The timer re-arms itself after each attempt rather than
    // relying on an effect re-run, for the same reason.
    useEffect(() => {
        if (!authReady || !isOnline) return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const attempt = async () => {
            if (cancelled) return;
            try {
                // navigator.onLine directly: `isOnline` is captured from the render that
                // armed this timer and may be minutes stale.
                if (!syncingRef.current && navigator.onLine && (await getPendingSyncCount()) > 0) {
                    await sync();
                }
            } catch {
                // sync() handles its own errors; a throw here must not kill the schedule.
            }
            if (!cancelled) schedule();
        };

        const schedule = () => {
            timer = setTimeout(attempt, retryDelayFor(failedDrainsRef.current));
        };

        schedule();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [authReady, isOnline, sync]);

    const retryFailedChanges = useCallback(async () => {
        const restored = await retrySyncFailures();
        await refreshQueueCounts();
        return restored;
    }, [refreshQueueCounts]);

    return {
        isOnline,
        syncStatus,
        pendingChanges,
        failedChanges,
        failureReasons,
        lastSyncTime,
        sync,
        retryFailedChanges,
        error,
    };
}

/** What one drain pass did. Returned so tests and callers can assert on it. */
export interface DrainResult {
    /** Items pushed to the server and removed from the queue. */
    pushed: number;
    /** Items that failed and had their retry count incremented, staying queued. */
    retried: number;
    /** Items that exhausted {@link MAX_SYNC_RETRIES} and were parked (B2). */
    deadLettered: number;
    /**
     * Items parked without spending their retries, because the refusal cannot succeed on
     * retry (B24). Counted separately from {@link deadLettered} because the two mean different
     * things to a user: one is "we could not reach the server five times", the other is "the
     * server will never accept this, and here is why".
     */
    terminal: number;
    /** True if the run stopped early because its token was cancelled (B6). */
    cancelled: boolean;
    /**
     * True if the run stopped early because nothing succeeded for the whole idle budget
     * (SYNC-13). Distinct from {@link cancelled}, which means somebody else abandoned the run —
     * this one means the run abandoned itself, and the two want different things said about them.
     */
    stalled: boolean;
}

/**
 * What the classifier needs to know, gathered once per drain.
 *
 * Read from the store rather than the server: the drain runs offline, and a device that
 * cannot ask must still be able to recognise the refusals it already has the answer to.
 */
function currentFailureContext(): SyncFailureContext {
    const state = useAppStore.getState();
    return {
        entitlementStatus: state.entitlement?.status ?? null,
        archivedSeasonIds: new Set(state.seasons.filter((s) => s.isArchived).map((s) => s.id)),
    };
}

/**
 * Push every queued change to the server, in the order the user made them.
 *
 * Extracted from the `useSync` callback so the drain can be tested directly against a real
 * database rather than only through a rendered hook. Partial failure, retry escalation and
 * cancellation are the behaviours that matter here and each one is a branch that was
 * previously only reachable via the hook.
 *
 * Never throws: a single item that cannot be pushed must not stop the rest of the queue
 * from draining, and must not be lost either (B2).
 */
export async function drainSyncQueue(token: SyncToken = { cancelled: false }): Promise<DrainResult> {
    const result: DrainResult = {
        pushed: 0, retried: 0, deadLettered: 0, terminal: 0, cancelled: false, stalled: false,
    };

    // Ordered by timestamp, NOT primary key — see getPendingSyncItems (B1).
    const queueItems = await getPendingSyncItems();
    const context = currentFailureContext();

    for (const item of queueItems) {
        if (token.cancelled) {
            result.cancelled = true;
            return result;
        }
        /*
         * STOP ONLY WHEN NOTHING IS WORKING (SYNC-13).
         *
         * Checked before the item rather than after, so the budget is spent attempting work
         * rather than noticing that it has run out. Items not reached stay queued with their
         * retry counts untouched — the next run picks them up in the same order, which is B1's
         * whole guarantee and the reason a partial drain is safe at all.
         */
        if (token.deadline?.expired()) {
            result.stalled = true;
            return result;
        }
        try {
            await processSyncItem(item);
            // Remove from queue on success
            await db.syncQueue.delete(item.id);
            result.pushed++;
            // A push that landed is the only thing that buys more time.
            token.deadline?.progress();
        } catch (err) {
            /*
             * A refusal that no retry can satisfy is parked NOW, with its reason (B24).
             *
             * The work is preserved exactly as B2 requires — same store, same retry affordance
             * in the UI — so this trades none of the engine's safety for the nine minutes and
             * the silence it removes. `retrySyncFailures` can still put it back on the queue
             * once the licence is renewed or the season reopened, which is the only thing that
             * WILL change the answer.
             */
            const classification = classifySyncFailure(item, err, context);
            if (classification.terminal) {
                console.warn(
                    `Sync item ${item.id} was refused by a rule that retrying cannot satisfy: ` +
                    `${classification.reason}`,
                    err,
                );
                await moveToDeadLetter(item, err, classification.reason);
                result.terminal++;
                continue;
            }

            // Update retry count
            const newRetryCount = (item.retryCount || 0) + 1;

            // Out of retries: park the change in the dead-letter store rather than
            // deleting it (B2). The queue still drains, but the user's work survives and
            // the UI can report it.
            if (newRetryCount >= MAX_SYNC_RETRIES) {
                console.error(
                    `Sync item ${item.id} failed after ${MAX_SYNC_RETRIES} retries. ` +
                    `Moved to failed changes.`,
                    err,
                );
                await moveToDeadLetter(item, err);
                result.deadLettered++;
            } else {
                await db.syncQueue.update(item.id, {
                    retryCount: newRetryCount,
                    lastError: err instanceof Error ? err.message : 'Unknown error',
                });
                result.retried++;
            }
        }
    }

    return result;
}

export async function processSyncItem(item: SyncQueueItem): Promise<void> {
    if (!supabaseSync) throw new Error('Supabase not configured');
    /*
     * A PUSH IS ALSO EVIDENCE ABOUT THE SERVER (SYNC-07).
     *
     * A device with a full queue and nothing to read learns whether the server is there from
     * its own writes, so both halves of the sync report. A refusal counts as contact for the
     * same reason it does on the pull: the server answered.
     */
    return pushSyncItem(item).then(
        (value) => {
            recordServerContact(true);
            return value;
        },
        (err) => {
            // A populated PostgREST `code` means it answered; a timeout, or the empty-string
            // code postgrest-js uses for a client-side network failure, means it did not.
            recordServerContact(isServerAnswer(err));
            throw err;
        },
    );
}

async function pushSyncItem(item: SyncQueueItem): Promise<void> {
    if (!supabaseSync) throw new Error('Supabase not configured');

    const { tableName, operation, data, recordId } = item;
    const table = asSyncableTable(tableName);

    // Transform local data to Supabase schema format
    const transformedData = transformToSupabaseSchema(tableName, data);

    switch (operation) {
        case 'create': {
            // Use upsert to handle cases where record already exists (409 conflict)
            // Wrap in async IIFE to convert Supabase thenable to a real Promise
            const result: any = await withTimeout(
                (async () => supabaseSync.from(table).upsert(transformedData as never, { onConflict: 'id' }))(),
                PER_QUERY_TIMEOUT_MS,
                `upsert ${tableName}`
            );
            if (result.error) throw result.error;
            break;
        }

        case 'update': {
            // Checklists use blob sync (single row per team) and may not exist yet,
            // so use upsert to create-or-update. Other entities use normal update.
            if (tableName === 'checklists') {
                const result: any = await withTimeout(
                    (async () => supabaseSync.from(table).upsert(transformedData as never, { onConflict: 'id' }))(),
                    PER_QUERY_TIMEOUT_MS,
                    `upsert ${tableName}`
                );
                if (result.error) throw result.error;
            } else {
                /*
                 * ONLY WHAT THIS EDIT CHANGED (SYNC-06).
                 *
                 * `previousData` is absent for a queue entry written by an older bundle, and
                 * for any caller that has not been given the pre-edit row yet — both fall back
                 * to the whole row, which is what the engine has always sent. An empty diff
                 * means the edit changed nothing the server can see, and pushing it would be a
                 * round trip for no reason; the item is still removed from the queue by the
                 * drain, which is correct, because there is nothing left to send.
                 */
                const diff = changedRemoteColumns(tableName, item.previousData, data);
                const payload = diff ?? transformedData;
                if (diff && Object.keys(diff).length === 0) break;

                const result: any = await withTimeout(
                    (async () => supabaseSync.from(table).update(payload as never).eq('id', recordId))(),
                    PER_QUERY_TIMEOUT_MS,
                    `update ${tableName}`
                );
                if (result.error) throw result.error;
            }
            break;
        }

        case 'delete': {
            const result: any = await withTimeout(
                (async () => supabaseSync.from(table).delete().eq('id', recordId))(),
                PER_QUERY_TIMEOUT_MS,
                `delete ${tableName}`
            );
            if (result.error) throw result.error;
            break;
        }
    }
}

/**
 * The columns this edit actually changed (SYNC-06).
 *
 * WHAT WAS WRONG. An `update` sent `toRemote(fullLocalRow)` — every column — with no
 * precondition. So device A, offline, renames a task; device B moves the same task to Done; A
 * reconnects and its stale `status` overwrites B's. Silent, invisible, and the loser never
 * knows. A kanban board at a competition is precisely two people touching the same card, which
 * is the case this app exists for.
 *
 * HOW THE DIFF IS TAKEN, and why it needs no new per-entity machinery. `toRemote` is a pure
 * function of a row, so running it over the pre-edit row and over the post-edit row and keeping
 * the columns that differ gives exactly the columns this edit touched — expressed in the
 * server's key space, by the one transform that owns that mapping. No second key map to drift
 * out of step with the first (`docs/failure-modes.md` §12), and no `toRemotePartial` on eleven
 * entities to fall behind `toRemote`.
 *
 * `id` is always kept: PostgREST filters on it and a payload without it is meaningless. Anything
 * the transform derives from the clock — `updated_at` — differs on every call and is therefore
 * always included, which is what a touch should do.
 *
 * WHAT THIS MEANS FOR PRINCIPLE 3, worked out rather than assumed.
 *
 * CLAUDE.md: "every server read must honour `getPendingRecordIds()` — a refetch must never
 * clobber un-synced local edits". A partial update changes what could be meant by "pending" for
 * a row: only some of its FIELDS are un-synced now, so in principle a pull could take the
 * server's version of every other field and be more correct than it is today.
 *
 * IT IS DELIBERATELY LEFT ALONE, and the reason is that the looser rule buys nothing and costs
 * the guarantee. What the pending guard protects is the window between an edit and its push. In
 * that window the local row is the user's own work in progress; letting a pull write half of it
 * would mean a row on screen that is partly theirs and partly the server's, changing under them
 * while they type — for a benefit measured in the seconds before the queue drains, since the
 * moment the push lands the id leaves `getPendingRecordIds()` and the very next pull merges
 * everything anyway. The stale-field window closes by itself.
 *
 * So the invariant is unchanged and stays exactly as strict as it was: an id with anything
 * queued is skipped by the merge, whole. B3 and B8 are untouched, and their regression tests are
 * green without modification — which is the evidence for this paragraph rather than the claim
 * of it.
 *
 * NO PRECONDITION, DELIBERATELY. The assessment's "better" option was
 * `.eq('updated_at', seenUpdatedAt)` with zero rows affected treated as a conflict. That is a
 * second, larger change: it needs a conflict path, a re-pull, a re-apply and a decision about
 * what the user is shown, and until that path exists a failed precondition would send the work
 * round the retry ladder and into the dead-letter store — turning a silent field revert into a
 * loud failure the coach cannot act on. Sending only the changed columns removes the reported
 * defect outright for every case where two people edit DIFFERENT fields, which is the case that
 * was reported. Two people editing the SAME field is still last-write-wins, and is written down
 * as such in the sprint report rather than left to be discovered.
 */
export function changedRemoteColumns(
    tableName: string,
    previous: unknown,
    next: unknown,
): Record<string, unknown> | null {
    if (previous === undefined || previous === null) return null;

    const before = transformToSupabaseSchema(tableName, previous) as Record<string, unknown>;
    const after = transformToSupabaseSchema(tableName, next) as Record<string, unknown>;
    if (!before || !after) return null;

    const diff: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
        // `id` is the filter, not a change; sending it in the SET list is harmless but noise.
        if (key === 'id') continue;
        /*
         * JSON comparison, not `!==`. Several columns are objects — `data` on a scouting
         * report, `checklist` and `timeline` on a task, `patch` on a game override — and
         * reference equality would report every one of them as changed on every edit, which
         * would make this function return the whole row and quietly do nothing at all.
         */
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff[key] = after[key];
    }

    return diff;
}

/**
 * Transform local store data to Supabase schema format
 * Converts camelCase to snake_case and restructures as needed
 */
export function transformToSupabaseSchema(tableName: string, data: any): any {
    if (!data) return data;

    const entity = findEntity(tableName);
    if (entity) return entity.toRemote(data);

    switch (tableName) {
        case 'checklists':
            // Blob-synced: one row per SEASON holding the whole array, so the row id IS the
            // season id. Not an entity in the registry sense -- it has no per-record
            // identity, which is exactly why the id has to be derived from something two
            // offline devices already agree on rather than generated.
            //
            // V1 used the team id here and wrote `seasonId || null` into a NOT NULL column
            // (C6): one checklist shared by every season, and an unpushable row whenever no
            // season was selected.
            //
            // A TEMPLATE is the one exception, and it is an exception because the reason for
            // the convention does not apply: a template is created once, deliberately, by
            // one device, so there is nothing for two offline clients to converge on. It
            // therefore carries its own generated id -- which it must, since the season id
            // is already taken by that season's working checklist and
            // `checklists_one_per_season` exempts templates rather than making room for
            // them. The working-checklist branch below is unchanged and unconditional.
            return {
                id: data.isTemplate ? data.id : data.seasonId,
                team_id: data.teamId,
                season_id: data.seasonId,
                name: data.name || 'Pre-Match Checklist',
                items: data.items || data.checklist || [],
                is_template: data.isTemplate || false,
            };


        default:
            // Unknown table: pass through untouched rather than silently dropping fields.
            return data;
    }
}

/**
 * Legacy localStorage keys for sync bookkeeping.
 *
 * Both are now stored in IndexedDB `appState` via offline-db's SyncMeta, so sign-out clears
 * them along with everything else (B5). These are removed on first pull so a shared device
 * does not keep serving a previous user's cursors out of localStorage.
 */
const LEGACY_SYNC_TIMESTAMPS_KEY = 'falconforge-sync-timestamps';
const LEGACY_SYNC_COUNTER_KEY = 'falconforge-sync-counter';

function clearLegacySyncKeys(): void {
    try {
        localStorage.removeItem(LEGACY_SYNC_TIMESTAMPS_KEY);
        localStorage.removeItem(LEGACY_SYNC_COUNTER_KEY);
    } catch { /* private mode / storage disabled */ }
}

/**
 * The pull half of a sync run.
 *
 * All of the machinery this used to contain now lives in `server-pull.ts`, which is the
 * single read path shared with team switches and page-level refreshes (C3). What is left
 * here is the sync loop's opinion about the pull: which team, cursor-driven mode, and the
 * legacy-key cleanup that only the background loop is in a position to do.
 */
/**
 * Exported for tests, alongside `drainSyncQueue` and `processSyncItem`, which are exported for
 * the same reason. Testing `reAskEntitlementIfCoverLooksOver` on its own would prove the rule
 * and not the WIRING — a correct helper nothing calls is `docs/failure-modes.md` §7, and this
 * repo has shipped that four times.
 */
export async function pullChangesFromServer(token: SyncToken = { cancelled: false }): Promise<void> {
    const currentTeamId = useAppStore.getState().currentTeamId;
    if (!currentTeamId) return;

    // Retire the pre-IndexedDB bookkeeping if it is still lying around (B5).
    clearLegacySyncKeys();

    await pullFromServer({ teamId: currentTeamId, mode: 'auto', token });
    await reAskEntitlementIfCoverLooksOver(currentTeamId);
}

/**
 * Re-read the licence when the cover we were told about looks like it has run out.
 *
 * WHAT THIS FIXES. `fetchTeamData` reads `team_entitlement` once, on arrival at a team, and
 * `server-pull.ts` explains why: *"Neither changes on its own between pulls: a licence is
 * granted or revoked by an operator."* That was true when the trial was 90 days. **D3 makes it
 * false.** Under a 30-day probation the ordinary way a licence ends is that a date passes —
 * which nobody does, so nothing prompts a re-read — and a team whose cover ends at 14:00 on a
 * competition Saturday keeps being offered writes until somebody reloads the tab. Nobody
 * reloads a tab at a venue. Measured with `scripts/probe-queued-before-lapse.mjs`: the probe
 * only reached the terminal message after it reloaded the page on purpose.
 *
 * THE CLIENT CLOCK TRIGGERS A QUESTION, NEVER AN ANSWER, and that distinction is the whole
 * design. The obvious version of this fix — "if `validUntil` is in the past, treat the team as
 * read-only" — compares a server-written timestamp against the device's clock and would flip a
 * perfectly licensed team to read-only on a school Chromebook running two days fast. That is
 * B4's defect pointed at a coach instead of at a cursor, and it is the exact lock-out
 * `entitlement.ts` is written to prevent. So a client clock past `validUntil` does one thing:
 * it asks the server again. The worst case is a wasted query; the server stays the authority,
 * and the fail-open rule is untouched.
 *
 * Cheap by construction: it only fires when the device already believes cover has ended, which
 * for a licensed team is never.
 */
async function reAskEntitlementIfCoverLooksOver(teamId: string): Promise<void> {
    const entitlement = useAppStore.getState().entitlement;
    // Nothing read yet, no team, or open-ended cover: nothing to re-ask about.
    if (!entitlement || entitlement.teamId !== teamId || !entitlement.validUntil) return;
    // Already known to be read-only — the answer will not change until an operator acts, and
    // an operator acting is what `fetchTeamData` on the next arrival is for.
    if (entitlement.status === 'read_only') return;

    const endsAt = new Date(entitlement.validUntil).getTime();
    if (Number.isNaN(endsAt) || Date.now() < endsAt) return;

    await pullEntitlement(teamId);
}
