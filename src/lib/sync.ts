import { useState, useEffect, useCallback, useRef } from 'react';
import {
    db,
    getPendingSyncCount,
    getPendingSyncItems,
    getPendingRecordIds,
    getSyncMeta,
    setSyncCursor,
    bumpSyncCounter,
    getSyncFailureCount,
    moveToDeadLetter,
    retrySyncFailures,
    SyncQueueItem,
} from './offline-db';
import { supabaseSync } from './supabase';
import { useAppStore } from './store';
import { useAuth } from './auth';
import {
    transformTaskFromSupabase,
    transformScoutingReportFromSupabase,
    transformMatchPlanFromSupabase,
    transformSeasonFromSupabase,
    transformSubTeamFromSupabase,
} from './transformers';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

// Timeout constants
const PER_QUERY_TIMEOUT_MS = 10_000;  // 10s per Supabase query
const OVERALL_SYNC_TIMEOUT_MS = 30_000; // 30s for entire sync operation

/** Attempts before a change is parked in the dead-letter store (B2). */
export const MAX_SYNC_RETRIES = 5;

/**
 * Race a promise against a timeout. Rejects with a descriptive error if timeout fires first.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${label} after ${ms}ms`)), ms)
        ),
    ]);
}

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
                    // Ordered by timestamp, NOT primary key — see getPendingSyncItems (B1).
                    const queueItems = await getPendingSyncItems();

                    for (const item of queueItems) {
                        if (token.cancelled) return;
                        try {
                            await processSyncItem(item);
                            // Remove from queue on success
                            await db.syncQueue.delete(item.id);
                        } catch (err) {
                            // Update retry count
                            const newRetryCount = (item.retryCount || 0) + 1;

                            // Out of retries: park the change in the dead-letter store rather
                            // than deleting it (B2). The queue still drains, but the user's
                            // work survives and the UI can report it.
                            if (newRetryCount >= MAX_SYNC_RETRIES) {
                                console.error(
                                    `Sync item ${item.id} failed after ${MAX_SYNC_RETRIES} retries. ` +
                                    `Moved to failed changes.`,
                                    err,
                                );
                                await moveToDeadLetter(item, err);
                            } else {
                                await db.syncQueue.update(item.id, {
                                    retryCount: newRetryCount,
                                    lastError: err instanceof Error ? err.message : 'Unknown error',
                                });
                            }
                        }
                    }

                    // Pull latest changes from server
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

async function processSyncItem(item: SyncQueueItem): Promise<void> {
    if (!supabaseSync) throw new Error('Supabase not configured');

    const { tableName, operation, data, recordId } = item;

    // Transform local data to Supabase schema format
    const transformedData = transformToSupabaseSchema(tableName, data);

    switch (operation) {
        case 'create': {
            // Use upsert to handle cases where record already exists (409 conflict)
            // Wrap in async IIFE to convert Supabase thenable to a real Promise
            const result: any = await withTimeout(
                (async () => supabaseSync.from(tableName).upsert(transformedData, { onConflict: 'id' }))(),
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
                    (async () => supabaseSync.from(tableName).upsert(transformedData, { onConflict: 'id' }))(),
                    PER_QUERY_TIMEOUT_MS,
                    `upsert ${tableName}`
                );
                if (result.error) throw result.error;
            } else {
                const result: any = await withTimeout(
                    (async () => (supabaseSync.from(tableName) as any).update(transformedData).eq('id', recordId))(),
                    PER_QUERY_TIMEOUT_MS,
                    `update ${tableName}`
                );
                if (result.error) throw result.error;
            }
            break;
        }

        case 'delete': {
            const result: any = await withTimeout(
                (async () => supabaseSync.from(tableName).delete().eq('id', recordId))(),
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

    switch (tableName) {
        case 'tasks':
            return {
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                sub_team_id: data.department || data.subTeamId || null,
                title: data.title,
                description: data.description,
                status: data.status,
                type: data.type,
                assigned_to: data.assignedTo || null,
                tags: data.tags || [],
                checklist: data.checklist || [],
                timeline: data.timeline || [],
                due_date: data.dueDate ? new Date(data.dueDate).toISOString() : null,
            };

        case 'seasons':
            return {
                id: data.id,
                name: data.name,
                team_id: data.teamId,
                field_image_data: data.fieldImageData || null,
            };

        case 'scoutingReports':
        case 'scouting_reports':
            return {
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                opponent_team_number: data.teamNumber,
                // Undefined must become NULL, not 0 — the column is nullable now (B18).
                match_number: data.matchNumber ?? null,
                event_name: data.eventName || null,
                created_by: data.createdBy || null,
                data: {
                    hasAutonomous: data.hasAutonomous,
                    autoScore: data.autoScore,
                    intakeType: data.intakeType,
                    autoAim: data.autoAim,
                    farShooting: data.farShooting,
                    shotsTaken: data.shotsTaken,
                    shotsMissed: data.shotsMissed,
                    parking: data.parking,
                    rating: data.rating,
                    endGameNotes: data.endGameNotes,
                },
            };

        case 'matchPlans':
        case 'match_plans':
            return {
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                title: data.title,
                match_number: data.matchNumber || null,
                alliance_team: data.allianceTeam || null,
                drawing_data: data.drawingData,
                notes: data.notes,
            };

        case 'checklists':
            return {
                id: data.teamId || data.id, // Use teamId as the row ID for blob sync
                team_id: data.teamId,
                season_id: data.seasonId || null,
                name: data.name || 'Pre-Match Checklist',
                items: data.items || data.checklist || [],
                is_template: data.isTemplate || false,
            };

        case 'sub_teams':
        case 'subTeams':
            return {
                id: data.id,
                team_id: data.teamId,
                name: data.name,
                member_ids: data.memberIds || [],
                season_id: data.seasonId || null,
            };

        case 'portfolio_entries':
        case 'portfolioHistory':
            return {
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                content: data.content,
                task_count: data.taskCount || 0,
            };

        default:
            // Return as-is for unknown tables
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

// How often to do a full reconciliation (every Nth pull)
// Full pulls detect cross-client deletions; delta pulls only get new/updated records
const FULL_SYNC_INTERVAL = 5;

/**
 * Newest server `updated_at` across a set of rows, as an ISO string.
 *
 * This is the delta cursor. It has to come from the DATA, not from `Date.now()`:
 * `updated_at` is written by a Postgres trigger on the server clock, so a client running
 * even slightly fast would skip every record written inside the skew window, and would do
 * so silently until the next full reconciliation (B4).
 */
export function newestUpdatedAt(rows: any[]): string | null {
    let newest: number | null = null;
    let newestISO: string | null = null;

    for (const row of rows) {
        const raw = row?.updated_at ?? row?.created_at;
        if (!raw) continue;
        const ms = new Date(raw).getTime();
        if (Number.isNaN(ms)) continue;
        if (newest === null || ms > newest) {
            newest = ms;
            newestISO = new Date(ms).toISOString();
        }
    }

    return newestISO;
}

/** Cooperative cancellation for a sync run (B6). */
export interface SyncToken {
    cancelled: boolean;
}

async function pullChangesFromServer(token: SyncToken = { cancelled: false }): Promise<void> {
    if (!supabaseSync) return;

    // Get current team ID from the Zustand store
    const currentTeamId = useAppStore.getState().currentTeamId;

    if (!currentTeamId) return;

    // Retire the pre-IndexedDB bookkeeping if it is still lying around (B5).
    clearLegacySyncKeys();

    // Decide whether this is a full or delta pull. The counter is per-team, so switching
    // teams no longer shifts which entity lands on the reconciliation cycle (B15).
    const counter = await bumpSyncCounter(currentTeamId);
    const isFullPull = counter % FULL_SYNC_INTERVAL === 0;

    const entities = [
        { table: 'seasons', localTable: 'seasons' },
        { table: 'sub_teams', localTable: 'subTeams' },
        { table: 'tasks', localTable: 'tasks' },
        { table: 'scouting_reports', localTable: 'scoutingReports' },
        { table: 'match_plans', localTable: 'matchPlans' },
        { table: 'checklists', localTable: 'checklists' },
        // Note: portfolio_entries is intentionally local-only (not synced)
    ];

    const meta = await getSyncMeta();

    for (const { table, localTable } of entities) {
        // A timed-out run must stop touching the store instead of racing the next one (B6).
        if (token.cancelled) return;

        try {
            const entityKey = `${currentTeamId}:${table}`;

            // Checklists are blob-synced (entire array per team). If there are
            // pending local changes still in the queue, skip the pull to avoid
            // overwriting newer local state with stale server data.
            if (table === 'checklists') {
                const pendingChecklistItems = await db.syncQueue
                    .where('tableName')
                    .equals('checklists')
                    .count();
                if (pendingChecklistItems > 0) {
                    continue;
                }
            }

            // Build the query
            let query = supabaseSync.from(table).select('*').eq('team_id', currentTeamId);

            // updateLocalDatabase takes records[0] for the checklist blob, and Postgres row
            // order is otherwise unspecified -- so the active checklist could flip between
            // syncs when more than one row existed (B12). Order explicitly and ignore
            // templates, which are not the team's working checklist.
            if (table === 'checklists') {
                query = query.eq('is_template', false).order('created_at', { ascending: true });
            }

            // For delta pulls, filter on the cursor (skip for checklists — blob sync always full)
            const cursor = meta.cursors[entityKey];
            const isDelta = !isFullPull && !!cursor && table !== 'checklists';

            if (isDelta) {
                query = query.gte('updated_at', cursor);
            }

            const result: any = await withTimeout(
                (async () => query)(),
                PER_QUERY_TIMEOUT_MS,
                `pull ${table}`
            );

            if (result.error) {
                // Table may not exist yet - this is expected
                console.warn(`Pull sync for ${table} failed (table may not exist):`, result.error.message);
                continue;
            }

            if (token.cancelled) return;

            // Records with unpushed local changes must survive the pull (B3). Read this
            // AFTER the query so anything queued while it was in flight is still covered.
            const pendingIds = await getPendingRecordIds(table);

            if (isDelta) {
                // Delta: merge new/updated records into existing state
                mergeIntoStore(localTable, result.data || [], pendingIds);
            } else {
                // Full: replace entire state (detects deletions), keeping pending records
                updateLocalDatabase(localTable, result.data || [], pendingIds);
            }

            // Advance the cursor to the newest SERVER timestamp we actually saw, never to
            // the local clock (B4). No rows means nothing newer exists, so the cursor stays
            // put rather than jumping forward over records we never received.
            const newest = newestUpdatedAt(result.data || []);
            if (newest) {
                meta.cursors[entityKey] = newest;
                await setSyncCursor(entityKey, newest);
            }

        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }
}

/**
 * Update the Zustand store with data from Supabase
 * Transforms snake_case from Supabase to camelCase for local use
 */
export function updateLocalDatabase(
    tableName: string,
    records: any[],
    /**
     * Ids with unpushed local changes. Their local version is kept and the server's copy is
     * ignored, because the local one is newer by definition -- it has not been sent yet.
     * Omitted by callers that already know nothing is pending (B3).
     */
    pendingIds: Set<string> = new Set(),
): void {
    if (!records) return;

    // Get the store state directly using the imported useAppStore
    const store = useAppStore.getState();

    /**
     * A full pull REPLACES the collection, which is how deletions made on another device
     * propagate. That is also how it used to delete records that had never been pushed:
     * they are absent from the server, so a replace dropped them. Records with a pending
     * queue entry are carried over instead.
     */
    function reconcile<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
        if (pendingIds.size === 0) return incoming;
        const preserved = existing.filter((e) => pendingIds.has(e.id));
        const notPending = incoming.filter((r) => !pendingIds.has(r.id));
        return [...notPending, ...preserved];
    }

    switch (tableName) {
        case 'tasks':
            store.setTasks(reconcile(store.tasks, records.map(transformTaskFromSupabase)));
            break;

        case 'seasons':
            store.setSeasons(reconcile(store.seasons, records.map(transformSeasonFromSupabase)));
            break;

        case 'scoutingReports':
            store.setScoutingReports(
                reconcile(store.scoutingReports, records.map(transformScoutingReportFromSupabase)),
            );
            break;

        case 'matchPlans':
            store.setMatchPlans(
                reconcile(store.matchPlans, records.map(transformMatchPlanFromSupabase)),
            );
            break;

        case 'checklists':
            // Checklists are stored as a single blob per team
            if (records.length > 0 && records[0]?.items && Array.isArray(records[0].items)) {
                store.setChecklist(records[0].items);
            } else if (records.length === 0) {
                // Empty results = checklist was cleared/deleted on another client
                store.setChecklist([]);
            }
            break;

        case 'subTeams':
            store.setSubTeams(reconcile(store.subTeams, records.map(transformSubTeamFromSupabase)));
            break;

        default:
        // No handler for unknown tables
    }
}

/**
 * Merge delta-synced records into the existing Zustand store state.
 * Upserts by `id` — existing records are updated, new records are added.
 * Records NOT in the delta set are preserved (unlike updateLocalDatabase which replaces).
 * Checklists are excluded from delta sync so this function never handles them.
 */
export function mergeIntoStore(
    tableName: string,
    records: any[],
    /**
     * Ids with unpushed local changes. Incoming rows for these are dropped so a teammate's
     * update cannot overwrite an edit the user has not sent yet (B3/B8). The local change
     * is pushed on the next drain, and last-write-wins settles it there.
     */
    pendingIds: Set<string> = new Set(),
): void {
    if (!records || records.length === 0) return;

    const store = useAppStore.getState();

    // Generic upsert helper: merge new records into existing array by id
    function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
        const map = new Map(existing.map(item => [item.id, item]));
        for (const item of incoming) {
            if (pendingIds.has(item.id)) continue;
            map.set(item.id, item);
        }
        return Array.from(map.values());
    }

    switch (tableName) {
        case 'tasks': {
            const transformed = records.map(transformTaskFromSupabase);
            store.setTasks(upsertById(store.tasks, transformed));
            break;
        }

        case 'seasons': {
            const transformed = records.map(transformSeasonFromSupabase);
            store.setSeasons(upsertById(store.seasons, transformed));
            break;
        }

        case 'scoutingReports': {
            const transformed = records.map(transformScoutingReportFromSupabase);
            store.setScoutingReports(upsertById(store.scoutingReports, transformed));
            break;
        }

        case 'matchPlans': {
            const transformed = records.map(transformMatchPlanFromSupabase);
            store.setMatchPlans(upsertById(store.matchPlans, transformed));
            break;
        }

        case 'subTeams': {
            const transformed = records.map(transformSubTeamFromSupabase);
            store.setSubTeams(upsertById(store.subTeams, transformed));
            break;
        }

        // Note: checklists are always full-synced (blob), never delta
        default:
            break;
    }
}
