import { useState, useEffect, useCallback, useRef } from 'react';
import { db, getPendingSyncCount, SyncQueueItem } from './offline-db';
import { supabase } from './supabase';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

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
        if (!isOnline || !supabase) {
            setSyncStatus('offline');
            return;
        }

        syncingRef.current = true;
        setSyncStatus('syncing');
        setError(null);

        try {
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
    }, [isOnline]);

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
        case 'create':
            // Use upsert to handle cases where record already exists (409 conflict)
            const { error: createError } = await supabase
                .from(tableName)
                .upsert(transformedData, { onConflict: 'id' });
            if (createError) throw createError;
            break;

        case 'update':
            const { error: updateError } = await (supabase
                .from(tableName) as any)
                .update(transformedData)
                .eq('id', recordId);
            if (updateError) throw updateError;
            break;

        case 'delete':
            const { error: deleteError } = await supabase
                .from(tableName)
                .delete()
                .eq('id', recordId);
            if (deleteError) throw deleteError;
            break;
    }
}

/**
 * Transform local store data to Supabase schema format
 * Converts camelCase to snake_case and restructures as needed
 */
function transformToSupabaseSchema(tableName: string, data: any): any {
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
                id: data.id,
                team_id: data.teamId,
                season_id: data.seasonId,
                name: data.name || 'Pre-Match Checklist',
                items: data.items || data.checklist,
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

    const timestamps = getSyncTimestamps();
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
            const lastSync = timestamps[entityKey] || 0;
            const lastSyncDate = lastSync > 0 ? new Date(lastSync).toISOString() : null;

            // Build query
            let query = supabase
                .from(table)
                .select('*')
                .eq('team_id', currentTeamId);

            // Only fetch updated records if we have a last sync time
            // Note: sub_teams, checklists, scouting_reports don't have updated_at column
            if (lastSyncDate && table !== 'sub_teams' && table !== 'checklists' && table !== 'scouting_reports' && table !== 'portfolio_entries') {
                // Only tables with updated_at can use this optimization
                query = query.gte('updated_at', lastSyncDate);
            }

            const { data, error } = await query;

            if (error) {
                // Table may not exist yet - this is expected
                console.warn(`Pull sync for ${table} failed (table may not exist):`, error.message);
                continue;
            }

            if (data && data.length > 0) {
                // Update IndexedDB with fetched data
                await updateLocalDatabase(localTable, data);
            }

            // Update sync timestamp
            setSyncTimestamp(entityKey, Date.now());

        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }

    console.log('Pull from server completed');
}

/**
 * Update IndexedDB with data from server
 * Uses last-write-wins strategy for simplicity
 */
async function updateLocalDatabase(tableName: string, records: any[]): Promise<void> {
    // For now, just log that we received updates
    // Full implementation would merge with local IndexedDB
    // The store's fetchTeamData already populates the store from Supabase
    // This function is for keeping IndexedDB in sync for offline use
    console.log(`Received ${records.length} records for ${tableName}`);
}

// Hook to detect if user is offline
export function useOnlineStatus(): boolean {
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return isOnline;
}
