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

    switch (operation) {
        case 'create':
            const { error: createError } = await supabase
                .from(tableName)
                .insert(data);
            if (createError) throw createError;
            break;

        case 'update':
            const { error: updateError } = await (supabase
                .from(tableName) as any)
                .update(data)
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

async function pullChangesFromServer(): Promise<void> {
    if (!supabase) return;

    // This would be more sophisticated in production
    // For now, we'll just mark that sync completed
    // A full implementation would:
    // 1. Track last sync timestamp
    // 2. Fetch records updated since then
    // 3. Merge with local changes (conflict resolution)
    // 4. Update local database

    console.log('Pull from server completed');
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
