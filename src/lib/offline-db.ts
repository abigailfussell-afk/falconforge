import Dexie, { Table } from 'dexie';

/**
 * Local database for offline-first functionality
 * Uses IndexedDB via Dexie for the sync queue.
 * 
 * Note: Application data is stored in Zustand (persisted to localStorage).
 * IndexedDB is only used for the sync queue that tracks pending changes
 * to be pushed to Supabase.
 */

export interface SyncQueueItem {
    id: string;
    tableName: string;
    recordId: string;
    operation: 'create' | 'update' | 'delete';
    data: any;
    timestamp: number;
    retryCount: number;
    lastError?: string;
}

class FalconForgeDatabase extends Dexie {
    syncQueue!: Table<SyncQueueItem, string>;

    constructor() {
        super('FalconForgeDB');

        // Version 1: Original schema (entity tables + syncQueue)
        this.version(1).stores({
            teams: 'id, ownerId, syncStatus',
            teamMembers: 'id, teamId, userId, syncStatus',
            subTeams: 'id, teamId, seasonId, syncStatus',
            tasks: 'id, teamId, subTeamId, seasonId, status, syncStatus, updatedAt',
            checklists: 'id, teamId, seasonId, syncStatus',
            scoutingReports: 'id, teamId, seasonId, opponentTeamNumber, matchNumber, syncStatus',
            matchPlans: 'id, teamId, seasonId, syncStatus',
            syncQueue: 'id, tableName, timestamp, retryCount',
        });

        // Version 2: Remove unused entity tables (data lives in Zustand/localStorage)
        this.version(2).stores({
            teams: null,
            teamMembers: null,
            subTeams: null,
            tasks: null,
            checklists: null,
            scoutingReports: null,
            matchPlans: null,
            syncQueue: 'id, tableName, timestamp, retryCount',
        });
    }
}

export const db = new FalconForgeDatabase();

// Helper to generate UUIDs
export function generateId(): string {
    return crypto.randomUUID();
}

// Helper to add item to sync queue
export async function queueForSync(
    tableName: string,
    recordId: string,
    operation: 'create' | 'update' | 'delete',
    data: any
) {
    await db.syncQueue.add({
        id: generateId(),
        tableName,
        recordId,
        operation,
        data,
        timestamp: Date.now(),
        retryCount: 0,
    });
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
    return await db.syncQueue.count();
}

// Clear all local data (for logout)
export async function clearLocalDatabase() {
    await db.syncQueue.clear();
}
