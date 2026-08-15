import { vi } from 'vitest';

/**
 * An unconfigured Supabase environment: what the app sees with no credentials.
 *
 * `isSupabaseConfigured()` returns false, so code guarded on it takes the offline branch.
 * Tests that need a specific server response should define their own factory instead of
 * opting into this one — a shared stub that answers every query with `[]` makes it very
 * easy to assert on nothing.
 */
export const supabase = {
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
};

export const supabaseSync = {
    from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
};

export const isSupabaseConfigured = () => false;
