import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.unmock('@/lib/auth');
vi.unmock('../auth');

import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth';
import { supabase } from '../supabase';
import { useAppStore } from '../store';

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
    from: vi.fn().mockReturnThis(),
    rpc: vi.fn(),
  },
  isSupabaseConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock('../store', () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({ setCurrentUserId: vi.fn() })
  }
}));

describe('auth.tsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (supabase.auth.getSession as any).mockResolvedValue({ data: { session: null } });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );

  it('signInWithEmail returns error if fails', async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({ error: new Error('Invalid login') });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    let error;
    await act(async () => {
      const res = await result.current.signInWithEmail('test@test.com', 'pwd');
      error = res.error;
    });

    expect(error).toBeDefined();
  });

  it('signUpWithEmail passes metadata properly', async () => {
    (supabase.auth.signUp as any).mockResolvedValueOnce({ data: { user: { id: '1' } }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.signUpWithEmail('test@test.com', 'pwd', 'John Doe');
    });

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'test@test.com',
      password: 'pwd',
      options: {
        data: {
          full_name: 'John Doe',
          age_classification: null,
          privacy_accepted: false,
        }
      }
    });
  });

  it('updateProfile updates state', async () => {
    (supabase.auth.updateUser as any).mockResolvedValueOnce({ data: { user: { id: '1', user_metadata: { full_name: 'New Name' } } }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    console.log("Current result keys:", Object.keys(result.current));
    
    await act(async () => {
      await result.current.updateProfile('New Name');
    });

    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'New Name' } });
  });

  it('updateAgeClassification uses rpc', async () => {
    (supabase.rpc as any).mockResolvedValueOnce({ data: { success: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      const res = await result.current.updateAgeClassification('13-17');
      expect(res.success).toBe(true);
    });

    expect(supabase.rpc).toHaveBeenCalledWith('update_user_age_classification', { classification: '13-17' });
  });

  it('signOut calls supabase signOut', async () => {
    (supabase.auth.signOut as any).mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.signOut();
    });

    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('resetPassword calls resetPasswordForEmail', async () => {
    (supabase.auth.resetPasswordForEmail as any).mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.resetPassword('test@test.com');
    });

    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@test.com', expect.any(Object));
  });
});
