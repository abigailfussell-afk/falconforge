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

/**
 * A change that exhausted its retries and could not be pushed to the server.
 *
 * Previously these were deleted from the queue outright, so the user's work was destroyed
 * with nothing but a console.error to show for it (B2). They are parked here instead, so
 * the change still exists and the UI can tell somebody about it.
 */
export interface SyncFailure extends SyncQueueItem {
    /** When the change was moved out of the retry queue. */
    failedAt: number;
    /** Error text from the final attempt. */
    lastError: string;
}

class FalconForgeDatabase extends Dexie {
    syncQueue!: Table<SyncQueueItem, string>;
    appState!: Table<AppStateRow, string>;
    syncFailures!: Table<SyncFailure, string>;

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

        // Version 4: Dead-letter store for changes that exhausted their retries (B2).
        this.version(4).stores({
            syncQueue: 'id, tableName, timestamp, retryCount',
            appState: 'key',
            syncFailures: 'id, tableName, failedAt',
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

/**
 * Queued operations, in the order the user performed them.
 *
 * Must NOT be `db.syncQueue.toArray()`. Dexie returns rows in primary-key order, and the
 * primary key is `generateId()` -> `crypto.randomUUID()`, so a plain toArray() drains the
 * queue in an order unrelated to what the user did: a delete can be applied before its
 * create (the record comes back), or an update before its create (it targets a row that
 * does not exist, fails, and is eventually discarded).
 *
 * `timestamp` is indexed in the schema above precisely so this ordering is cheap.
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
    return await db.syncQueue.orderBy('timestamp').toArray();
}

/**
 * Park a change that exhausted its retries, instead of deleting it.
 *
 * The queue entry is removed so the drain can make progress, but the change itself is
 * preserved so it can be retried later or inspected. Losing a scouting report entered at a
 * competition because five pushes happened to fail is not an acceptable outcome (B2).
 */
export async function moveToDeadLetter(item: SyncQueueItem, error: unknown): Promise<void> {
    await db.transaction('rw', db.syncQueue, db.syncFailures, async () => {
        await db.syncFailures.put({
            ...item,
            failedAt: Date.now(),
            lastError: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
        });
        await db.syncQueue.delete(item.id);
    });
}

export async function getSyncFailureCount(): Promise<number> {
    return await db.syncFailures.count();
}

export async function getSyncFailures(): Promise<SyncFailure[]> {
    return await db.syncFailures.orderBy('failedAt').toArray();
}

/**
 * Put every parked change back on the queue with its retry count reset.
 * Ordering is preserved because the original `timestamp` travels with the item.
 */
export async function retrySyncFailures(): Promise<number> {
    return await db.transaction('rw', db.syncQueue, db.syncFailures, async () => {
        const failures = await db.syncFailures.toArray();
        for (const failure of failures) {
            const { failedAt: _failedAt, lastError: _lastError, ...item } = failure;
            await db.syncQueue.put({ ...item, retryCount: 0 });
        }
        await db.syncFailures.clear();
        return failures.length;
    });
}

/** Give up on parked changes. Only ever called from an explicit user action. */
export async function discardSyncFailures(): Promise<void> {
    await db.syncFailures.clear();
}

// Clear sync queue (for logout)
export async function clearLocalDatabase() {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
}

// Clear persisted app state from IndexedDB (for logout)
export async function clearAppState() {
    await db.appState.clear();
}
