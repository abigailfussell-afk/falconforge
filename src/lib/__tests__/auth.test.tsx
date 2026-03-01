import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from '../auth';
import { supabase } from '../supabase';

// Unmock auth to test real implementation
vi.unmock('@/lib/auth');
vi.unmock('../auth');

// Setup mock before tests run
vi.mock('../supabase', () => ({
    supabase: {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
            onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
            signInWithPassword: vi.fn(),
            signOut: vi.fn(),
        },
        from: vi.fn(),
    },
    isSupabaseConfigured: () => true,
}));

describe('Auth Context', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should throw error if useAuth is used outside provider', () => {
        // Prevent React error boundary from catching the expected error
        const originalError = console.error;
        console.error = vi.fn();

        try {
            renderHook(() => useAuth());
        } catch (e: any) {
            expect(e.message).toBe('useAuth must be used within an AuthProvider');
        }

        console.error = originalError;
    });

    describe('signInWithEmail', () => {
        it('should call supabase auth and return error if it fails', async () => {
            const mockError = new Error('Invalid credentials');
            vi.mocked(supabase!.auth.signInWithPassword).mockResolvedValue({
                data: { user: null, session: null },
                error: mockError as any
            });

            const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

            console.log("RESULT CURRENT:", result.current);

            const response = await act(async () => {
                return await result.current.signInWithEmail('test@test.com', 'password');
            });

            expect(supabase!.auth.signInWithPassword).toHaveBeenCalledWith({
                email: 'test@test.com',
                password: 'password'
            });
            expect(response.error).toBe(mockError);
        });
    });

    describe('signOut', () => {
        it('should call supabase signOut', async () => {
            vi.mocked(supabase!.auth.signOut).mockResolvedValue({ error: null });

            const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

            await act(async () => {
                await result.current.signOut();
            });

            expect(supabase!.auth.signOut).toHaveBeenCalled();
        });
    });
});
