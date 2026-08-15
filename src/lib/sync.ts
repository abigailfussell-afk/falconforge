import { useState, useEffect, useCallback, useRef } from 'react';
import {
    db,
    getPendingSyncCount,
    getPendingSyncItems,
    getSyncFailureCount,
    moveToDeadLetter,
    retrySyncFailures,
    SyncQueueItem,
} from './offline-db';
import { supabaseSync } from './supabase';
import { useAppStore } from './store';
import { useAuth } from './auth';
import { findEntity, SYNCED_ENTITIES, type RemoteTable } from './entity-registry';
import { pullFromServer } from './server-pull';
import {
    withTimeout,
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

interface UseSyncResult {
    isOnline: boolean;
    syncStatus: SyncStatus;
    pendingChanges: number;
    /** Changes that exhausted their retries and are parked, not lost (B2). */
    failedChanges: number;
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
    const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const syncingRef = useRef(false);

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
        const updatePendingCount = async () => {
            const [pending, failed] = await Promise.all([
                getPendingSyncCount(),
                getSyncFailureCount(),
            ]);
            setPendingChanges(pending);
            setFailedChanges(failed);
        };

        updatePendingCount();

        // Poll for changes every 5 seconds
        const interval = setInterval(updatePendingCount, 5000);
        return () => clearInterval(interval);
    }, []);

    // Auto-sync when coming back online, when pending changes increase,
    // or when auth becomes ready (e.g., after Ctrl+F5 token refresh completes).
    useEffect(() => {
        if (authReady && isOnline && pendingChanges > 0 && syncStatus === 'idle' && !syncingRef.current) {
            sync();
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
        const token: SyncToken = { cancelled: false };

        try {
            // Overall sync timeout to prevent hanging forever
            await withTimeout(
                (async () => {
                    await drainSyncQueue(token);
                    await pullChangesFromServer(token);
                })(),
                OVERALL_SYNC_TIMEOUT_MS,
                'Overall sync'
            );

            setLastSyncTime(new Date());
            setSyncStatus('idle');

            // Update pending + failed counts
            const [pending, failed] = await Promise.all([
                getPendingSyncCount(),
                getSyncFailureCount(),
            ]);
            setPendingChanges(pending);
            setFailedChanges(failed);
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
    }, []);

    const retryFailedChanges = useCallback(async () => {
        const restored = await retrySyncFailures();
        setFailedChanges(await getSyncFailureCount());
        setPendingChanges(await getPendingSyncCount());
        return restored;
    }, []);

    return {
        isOnline,
        syncStatus,
        pendingChanges,
        failedChanges,
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
    /** True if the run stopped early because its token was cancelled (B6). */
    cancelled: boolean;
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
    const result: DrainResult = { pushed: 0, retried: 0, deadLettered: 0, cancelled: false };

    // Ordered by timestamp, NOT primary key — see getPendingSyncItems (B1).
    const queueItems = await getPendingSyncItems();

    for (const item of queueItems) {
        if (token.cancelled) {
            result.cancelled = true;
            return result;
        }
        try {
            await processSyncItem(item);
            // Remove from queue on success
            await db.syncQueue.delete(item.id);
            result.pushed++;
        } catch (err) {
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
                const result: any = await withTimeout(
                    (async () => supabaseSync.from(table).update(transformedData as never).eq('id', recordId))(),
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
 * Transform local store data to Supabase schema format
 * Converts camelCase to snake_case and restructures as needed
 */
export function transformToSupabaseSchema(tableName: string, data: any): any {
    if (!data) return data;

    const entity = findEntity(tableName);
    if (entity) return entity.toRemote(data);

    switch (tableName) {
        case 'checklists':
            // Blob-synced: one row per team holding the whole array, so the row id IS the
            // team id. Not an entity in the registry sense -- it has no per-record identity.
            return {
                id: data.teamId || data.id,
                team_id: data.teamId,
                season_id: data.seasonId || null,
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
async function pullChangesFromServer(token: SyncToken = { cancelled: false }): Promise<void> {
    const currentTeamId = useAppStore.getState().currentTeamId;
    if (!currentTeamId) return;

    // Retire the pre-IndexedDB bookkeeping if it is still lying around (B5).
    clearLegacySyncKeys();

    await pullFromServer({ teamId: currentTeamId, mode: 'auto', token });
}
