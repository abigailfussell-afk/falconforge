import Dexie, { Table } from 'dexie';

/**
 * Local database for offline-first functionality
 * Uses IndexedDB via Dexie for:
 *   1. syncQueue — tracks pending changes to be pushed to Supabase
 *   2. appState — Zustand persisted state (replaces localStorage to avoid 5 MB limit)
 *
 * Lightweight metadata (sync timestamps, sync counter, theme) stays in localStorage.
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

/** Simple key-value row used by the appState table. */
export interface AppStateRow {
    key: string;
    value: string;
}

class FalconForgeDatabase extends Dexie {
    syncQueue!: Table<SyncQueueItem, string>;
    appState!: Table<AppStateRow, string>;

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

        // Version 2: Remove unused entity tables (data lives in Zustand store)
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

        // Version 3: Add appState table for Zustand persistence (replaces localStorage)
        this.version(3).stores({
            syncQueue: 'id, tableName, timestamp, retryCount',
            appState: 'key',
        });
    }
}

export const db = new FalconForgeDatabase();

// ---------------------------------------------------------------------------
// IndexedDB storage adapter for Zustand's `persist` middleware
// ---------------------------------------------------------------------------

/**
 * Zustand-compatible async storage adapter backed by IndexedDB.
 * Works with `createJSONStorage(() => indexedDBStorage)`.
 */
export const indexedDBStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const row = await db.appState.get(name);
        return row?.value ?? null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
        await db.appState.put({ key: name, value });
    },
    removeItem: async (name: string): Promise<void> => {
        await db.appState.delete(name);
    },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// Clear sync queue (for logout)
export async function clearLocalDatabase() {
    await db.syncQueue.clear();
}

// Clear persisted app state from IndexedDB (for logout)
export async function clearAppState() {
    await db.appState.clear();
}
