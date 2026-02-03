/**
 * Integration Test Setup
 * 
 * This setup is for integration tests that need real IndexedDB 
 * but mock network calls to Supabase.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/offline-db';

// Mock only Supabase network calls
vi.mock('@/lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
    },
    isSupabaseConfigured: () => true,
}));

// Clear IndexedDB tables before each test
beforeEach(async () => {
    await db.syncQueue.clear();
    await db.tasks.clear();
    await db.checklists.clear();
    await db.scoutingReports.clear();
    await db.matchPlans.clear();
    await db.teams.clear();
    await db.teamMembers.clear();
    await db.subTeams.clear();
});

// Cleanup after each test
afterEach(async () => {
    vi.clearAllMocks();
});

// Helper to wait for async operations
export const waitForAsync = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to create a mock Supabase response
export const mockSupabaseResponse = <T>(data: T, error: null = null) => ({
    data,
    error,
});

export const mockSupabaseError = (message: string) => ({
    data: null,
    error: { message, code: 'ERROR' },
});
