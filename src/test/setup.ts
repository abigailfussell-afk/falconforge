import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Supabase client for unit tests
vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
    },
    isSupabaseConfigured: () => false,
}));

// Mock offline-db module
vi.mock('@/lib/offline-db', () => ({
    db: {
        syncQueue: {
            toArray: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
        },
        teams: { clear: vi.fn() },
        teamMembers: { clear: vi.fn() },
        subTeams: { clear: vi.fn() },
        tasks: { clear: vi.fn() },
        checklists: { clear: vi.fn() },
        scoutingReports: { clear: vi.fn() },
        matchPlans: { clear: vi.fn() },
    },
    generateId: vi.fn(() => `test-id-${Math.random().toString(36).substr(2, 9)}`),
    queueForSync: vi.fn().mockResolvedValue(undefined),
    getPendingSyncCount: vi.fn().mockResolvedValue(0),
    clearLocalDatabase: vi.fn().mockResolvedValue(undefined),
}));

// Mock sync module
vi.mock('@/lib/sync', () => ({
    useSyncStatus: vi.fn(() => ({
        isSyncing: false,
        pendingCount: 0,
        lastSyncTime: null,
    })),
    useSync: vi.fn(() => ({
        isOnline: true,
        syncStatus: 'idle',
        pendingChanges: 0,
        lastSyncTime: null,
        sync: vi.fn(),
        error: null,
    })),
    SyncProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock IndexedDB for any direct usage
const mockIndexedDB = {
    open: vi.fn(),
};
vi.stubGlobal('indexedDB', mockIndexedDB);
