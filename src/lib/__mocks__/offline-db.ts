import { vi } from 'vitest';

/**
 * An empty local database.
 *
 * Prefer NOT opting into this: `fake-indexeddb` gives the integration suite a real Dexie,
 * and the queue's behaviour (coalescing, ordering, dead-lettering) is the part most worth
 * exercising for real. This exists for component tests that merely import something in the
 * offline-db chain and have no interest in it.
 */
export const db = {
    syncQueue: {
        toArray: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
    },
    appState: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
    },
};

export const generateId = vi.fn(() => crypto.randomUUID());
export const queueForSync = vi.fn().mockResolvedValue(undefined);
export const getPendingSyncCount = vi.fn().mockResolvedValue(0);
export const getPendingSyncItems = vi.fn().mockResolvedValue([]);
/** Nothing pending by default, so pulls and realtime events apply normally (B3/B8). */
export const getPendingRecordIds = vi.fn().mockResolvedValue(new Set<string>());
export const moveToDeadLetter = vi.fn().mockResolvedValue(undefined);
export const getSyncFailureCount = vi.fn().mockResolvedValue(0);
export const getSyncFailures = vi.fn().mockResolvedValue([]);
export const retrySyncFailures = vi.fn().mockResolvedValue(0);
export const discardSyncFailures = vi.fn().mockResolvedValue(undefined);
export const clearLocalDatabase = vi.fn().mockResolvedValue(undefined);
export const clearAppState = vi.fn().mockResolvedValue(undefined);
export const indexedDBStorage = {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
};
