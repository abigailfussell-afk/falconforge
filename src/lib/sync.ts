import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getPendingSyncCount, getPendingSyncItems, SyncQueueItem } from './offline-db';
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
    lastSyncTime: Date | null;
    sync: () => Promise<void>;
    error: string | null;
}

export function useSync(): UseSyncResult {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
    const [pendingChanges, setPendingChanges] = useState(0);
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
            const count = await getPendingSyncCount();
            setPendingChanges(count);
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

        try {
            // Overall sync timeout to prevent hanging forever
            await withTimeout(
                (async () => {
                    // Ordered by timestamp, NOT primary key — see getPendingSyncItems (B1).
                    const queueItems = await getPendingSyncItems();

                    for (const item of queueItems) {
                        try {
                            await processSyncItem(item);
                            // Remove from queue on success
                            await db.syncQueue.delete(item.id);
                        } catch (err) {
                            // Update retry count
                            const newRetryCount = (item.retryCount || 0) + 1;

                            // If too many retries, log error and remove from queue to prevent stuck state
                            if (newRetryCount >= 5) {
                                console.error(`Sync item ${item.id} failed after 5 retries. Removing from queue.`, err);
                                await db.syncQueue.delete(item.id);
                            } else {
                                await db.syncQueue.update(item.id, {
                                    retryCount: newRetryCount,
                                    lastError: err instanceof Error ? err.message : 'Unknown error',
                                });
                            }
                        }
                    }

                    // Pull latest changes from server
                    await pullChangesFromServer();
                })(),
                OVERALL_SYNC_TIMEOUT_MS,
                'Overall sync'
            );

            setLastSyncTime(new Date());
            setSyncStatus('idle');

            // Update pending count
            const count = await getPendingSyncCount();
            setPendingChanges(count);
        } catch (err) {
            console.error('Sync failed:', err);
            setError(err instanceof Error ? err.message : 'Sync failed');
            setSyncStatus('error');
        } finally {
            syncingRef.current = false;
        }
        // FIX: No deps on isOnline - we read navigator.onLine directly
    }, []);

    return {
        isOnline,
        syncStatus,
        pendingChanges,
        lastSyncTime,
        sync,
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

// Keys for storing last sync timestamps in localStorage
const SYNC_TIMESTAMPS_KEY = 'falconforge-sync-timestamps';

function getSyncTimestamps(): Record<string, number> {
    try {
        const stored = localStorage.getItem(SYNC_TIMESTAMPS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
}

function setSyncTimestamp(entityKey: string, timestamp: number): void {
    try {
        const timestamps = getSyncTimestamps();
        timestamps[entityKey] = timestamp;
        localStorage.setItem(SYNC_TIMESTAMPS_KEY, JSON.stringify(timestamps));
    } catch (err) {
        console.warn('Failed to save sync timestamp:', err);
    }
}

// How often to do a full reconciliation (every Nth pull)
// Full pulls detect cross-client deletions; delta pulls only get new/updated records
const FULL_SYNC_INTERVAL = 5;
const SYNC_COUNTER_KEY = 'falconforge-sync-counter';

function getSyncCounter(): number {
    try {
        return parseInt(localStorage.getItem(SYNC_COUNTER_KEY) || '0', 10);
    } catch {
        return 0;
    }
}

function incrementSyncCounter(): number {
    const next = getSyncCounter() + 1;
    try {
        localStorage.setItem(SYNC_COUNTER_KEY, String(next));
    } catch { /* ignore */ }
    return next;
}

async function pullChangesFromServer(): Promise<void> {
    if (!supabaseSync) return;

    // Get current team ID from the Zustand store
    const currentTeamId = useAppStore.getState().currentTeamId;

    if (!currentTeamId) return;

    // Decide whether this is a full or delta pull
    const counter = incrementSyncCounter();
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

    for (const { table, localTable } of entities) {
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

            // For delta pulls, add timestamp filter (skip for checklists — blob sync always full)
            const timestamps = getSyncTimestamps();
            const lastSync = timestamps[entityKey];
            const isDelta = !isFullPull && lastSync && table !== 'checklists';

            if (isDelta) {
                // Convert timestamp to ISO string for the query
                const lastSyncISO = new Date(lastSync).toISOString();
                query = query.gte('updated_at', lastSyncISO);
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

            if (isDelta) {
                // Delta: merge new/updated records into existing state
                mergeIntoStore(localTable, result.data || []);
            } else {
                // Full: replace entire state (detects deletions)
                updateLocalDatabase(localTable, result.data || []);
            }

            // Update sync timestamp
            setSyncTimestamp(entityKey, Date.now());

        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }
}

/**
 * Update the Zustand store with data from Supabase
 * Transforms snake_case from Supabase to camelCase for local use
 */
export function updateLocalDatabase(tableName: string, records: any[]): void {
    if (!records) return;

    // Get the store state directly using the imported useAppStore
    const store = useAppStore.getState();



    switch (tableName) {
        case 'tasks':
            store.setTasks(records.map(transformTaskFromSupabase));
            break;

        case 'seasons':
            store.setSeasons(records.map(transformSeasonFromSupabase));
            break;

        case 'scoutingReports':
            store.setScoutingReports(records.map(transformScoutingReportFromSupabase));
            break;

        case 'matchPlans':
            store.setMatchPlans(records.map(transformMatchPlanFromSupabase));
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
            store.setSubTeams(records.map(transformSubTeamFromSupabase));
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
export function mergeIntoStore(tableName: string, records: any[]): void {
    if (!records || records.length === 0) return;

    const store = useAppStore.getState();

    // Generic upsert helper: merge new records into existing array by id
    function upsertById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
        const map = new Map(existing.map(item => [item.id, item]));
        for (const item of incoming) {
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
