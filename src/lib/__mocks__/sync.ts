import { vi } from 'vitest';

/**
 * Only `useSync` is stubbed. Everything else is re-exported from the real module, because
 * a test asserting on `transformToSupabaseSchema` or `drainSyncQueue` should be asserting
 * on the real implementation — a stub of a pure function proves nothing.
 */
const actual = await vi.importActual<typeof import('../sync')>('../sync');

export const {
    withTimeout,
    transformToSupabaseSchema,
    drainSyncQueue,
    processSyncItem,
    MAX_SYNC_RETRIES,
} = actual;

export const useSync = vi.fn(() => ({
    isOnline: true,
    syncStatus: 'idle' as const,
    pendingChanges: 0,
    failedChanges: 0,
    lastSyncTime: null,
    sync: vi.fn(),
    retryFailedChanges: vi.fn().mockResolvedValue(0),
    error: null,
}));

