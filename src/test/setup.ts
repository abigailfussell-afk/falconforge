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
    supabaseSync: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
    },
    isSupabaseConfigured: () => false,
}));

// Mock auth module (used by sync.ts to check auth readiness)
vi.mock('@/lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'test-user' },
        session: { access_token: 'test-token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: null,
    })),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock offline-db module
vi.mock('@/lib/offline-db', () => ({
    db: {
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
    },
    generateId: vi.fn(() => `test-id-${Math.random().toString(36).substr(2, 9)}`),
    queueForSync: vi.fn().mockResolvedValue(undefined),
    getPendingSyncCount: vi.fn().mockResolvedValue(0),
    clearLocalDatabase: vi.fn().mockResolvedValue(undefined),
    clearAppState: vi.fn().mockResolvedValue(undefined),
    indexedDBStorage: {
        getItem: vi.fn().mockResolvedValue(null),
        setItem: vi.fn().mockResolvedValue(undefined),
        removeItem: vi.fn().mockResolvedValue(undefined),
    },
}));

// Mock realtime module
vi.mock('@/lib/realtime', () => ({
    getRealtimeStatus: vi.fn(() => 'disconnected'),
    onRealtimeStatusChange: vi.fn(() => () => { }),
    setupRealtimeSubscription: vi.fn(),
    teardownRealtimeSubscription: vi.fn(),
    handleRealtimeDelete: vi.fn(),
}));

// Mock queries module (React Query hooks for per-page refresh)
vi.mock('@/lib/queries', () => ({
    useTasksQuery: vi.fn(() => ({ isLoading: false, isError: false, data: null })),
    useScoutingQuery: vi.fn(() => ({ isLoading: false, isError: false, data: null })),
    useMatchPlansQuery: vi.fn(() => ({ isLoading: false, isError: false, data: null })),
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

// Mock global DOMMatrix which is used by pdfjs in jsdom environment
if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix { } as any;
}
