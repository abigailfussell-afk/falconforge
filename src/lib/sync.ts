import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getPendingSyncCount, SyncQueueItem } from './offline-db';
import { supabase } from './supabase';
import { useAppStore } from './store';

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

    // Auto-sync when coming back online or when pending changes increase
    // Added guard to prevent starting a sync while one is in progress
    useEffect(() => {
        if (isOnline && pendingChanges > 0 && syncStatus === 'idle' && !syncingRef.current) {
            sync();
        }
    }, [isOnline, pendingChanges, syncStatus]);

    const sync = useCallback(async () => {
        if (syncingRef.current) return;
        // FIX: Read navigator.onLine directly to avoid stale closure
        if (!navigator.onLine || !supabase) {
            setSyncStatus('offline');
            return;
        }

        syncingRef.current = true;
        setSyncStatus('syncing');
        setError(null);

        try {
            // Overall sync timeout to prevent hanging forever
            await withTimeout(
                (async () => {
                    // Get all pending sync items
                    const queueItems = await db.syncQueue.toArray();

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
    if (!supabase) throw new Error('Supabase not configured');

    const { tableName, operation, data, recordId } = item;

    // Transform local data to Supabase schema format
    const transformedData = transformToSupabaseSchema(tableName, data);

    switch (operation) {
        case 'create': {
            // Use upsert to handle cases where record already exists (409 conflict)
            // Wrap in async IIFE to convert Supabase thenable to a real Promise
            const result: any = await withTimeout(
                (async () => supabase.from(tableName).upsert(transformedData, { onConflict: 'id' }))(),
                PER_QUERY_TIMEOUT_MS,
                `upsert ${tableName}`
            );
            if (result.error) throw result.error;
            break;
        }

        case 'update': {
            const result: any = await withTimeout(
                (async () => (supabase.from(tableName) as any).update(transformedData).eq('id', recordId))(),
                PER_QUERY_TIMEOUT_MS,
                `update ${tableName}`
            );
            if (result.error) throw result.error;
            break;
        }

        case 'delete': {
            const result: any = await withTimeout(
                (async () => supabase.from(tableName).delete().eq('id', recordId))(),
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

        case 'scoutingReports':
        case 'scouting_reports':
            return {
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                opponent_team_number: data.teamNumber,
                match_number: data.matchNumber,
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

async function pullChangesFromServer(): Promise<void> {
    if (!supabase) return;

    // Get current team ID from localStorage (set by store)
    const storeData = localStorage.getItem('falconforge-storage');
    if (!storeData) return;

    let currentTeamId: string | null = null;
    try {
        const parsed = JSON.parse(storeData);
        currentTeamId = parsed.state?.currentTeamId;
    } catch {
        return;
    }

    if (!currentTeamId) return;
    const entities = [
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

            // Build query with per-query timeout to prevent hanging
            const query = supabase
                .from(table)
                .select('*')
                .eq('team_id', currentTeamId);

            // Note: We intentionally fetch ALL records for the team on each sync
            // to ensure cross-client synchronization works correctly.
            // Wrap in async IIFE to convert Supabase thenable to a real Promise.
            // Supabase's PostgrestFilterBuilder.then() returns itself, which causes
            // Promise.resolve() to infinitely try to unwrap the thenable.
            const result: any = await withTimeout(
                (async () => await query)(),
                PER_QUERY_TIMEOUT_MS,
                `pull ${table}`
            );

            if (result.error) {
                // Table may not exist yet - this is expected
                console.warn(`Pull sync for ${table} failed (table may not exist):`, result.error.message);
                continue;
            }

            // FIX: Always update local state, even with empty results.
            // This ensures deletions from other clients are propagated.
            updateLocalDatabase(localTable, result.data || []);

            // Update sync timestamp
            setSyncTimestamp(entityKey, Date.now());

        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }

    console.log('Pull from server completed');
}

/**
 * Update the Zustand store with data from Supabase
 * Transforms snake_case from Supabase to camelCase for local use
 */
export function updateLocalDatabase(tableName: string, records: any[]): void {
    if (!records) return;

    // Get the store state directly using the imported useAppStore
    const store = useAppStore.getState();

    console.log(`Updating store with ${records.length} records for ${tableName}`);

    switch (tableName) {
        case 'tasks':
            store.setTasks(records.map((t: any) => ({
                id: t.id,
                title: t.title,
                description: t.description || '',
                status: t.status,
                type: t.type,
                assignedTo: t.assigned_to || '',
                department: t.sub_team_id || '',
                tags: t.tags || [],
                checklist: t.checklist || [],
                timeline: t.timeline || [],
                createdAt: new Date(t.created_at).getTime(),
                dueDate: t.due_date ? new Date(t.due_date).getTime() : undefined,
                seasonId: t.season_id
            })));
            break;

        case 'scoutingReports':
            store.setScoutingReports(records.map((r: any) => ({
                id: r.id,
                teamNumber: r.opponent_team_number,
                matchNumber: r.match_number,
                hasAutonomous: r.data?.hasAutonomous ?? false,
                autoScore: r.data?.autoScore ?? 0,
                intakeType: r.data?.intakeType ?? 'No Intake',
                autoAim: r.data?.autoAim ?? false,
                farShooting: r.data?.farShooting ?? false,
                shotsTaken: r.data?.shotsTaken ?? 0,
                shotsMissed: r.data?.shotsMissed ?? 0,
                parking: r.data?.parking ?? 'No Park',
                rating: r.data?.rating ?? 0,
                endGameNotes: r.data?.endGameNotes ?? '',
                seasonId: r.season_id
            })));
            break;

        case 'matchPlans':
            store.setMatchPlans(records.map((p: any) => ({
                id: p.id,
                title: p.title || `Match ${p.match_number || '?'}`,
                drawingData: p.drawing_data,
                notes: p.notes || '',
                allianceTeam: p.alliance_team || '',
                partnerAutonomous: false,
                partnerPark: false,
                updatedAt: new Date(p.updated_at).getTime(),
                seasonId: p.season_id
            })));
            break;

        case 'checklists':
            // Checklists are stored as a single blob per team
            if (records[0]?.items && Array.isArray(records[0].items)) {
                store.setChecklist(records[0].items);
            }
            break;

        case 'subTeams':
            store.setSubTeams(records.map((st: any) => ({
                id: st.id,
                name: st.name,
                memberIds: st.member_ids || [],
                seasonId: st.season_id
            })));
            break;

        default:
            console.log(`No handler for table: ${tableName}`);
    }
}
