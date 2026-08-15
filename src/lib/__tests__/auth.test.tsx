import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth';
import { supabase } from '../supabase';
import { useAppStore } from '../store';

/**
 * `auth.tsx` sat at 25% branch coverage. The action methods were covered; the lifecycle
 * was not — session restore on mount, the `onAuthStateChange` subscription, profile
 * ensure, and the safety timeout. Those are the paths a user hits on every cold start of
 * an offline-capable PWA, and the ones that decide whether the app renders at all.
 */

/** A `.from()` chain that resolves however the test wants, per call. */
function tableStub(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.insert = vi.fn().mockResolvedValue(result);
  chain.upsert = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  return chain;
}

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
    from: vi.fn(),
    rpc: vi.fn(),
  },
  isSupabaseConfigured: vi.fn().mockReturnValue(true),
}));

const session = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'token',
  user: { id: 'user-1', email: 'coach@example.com', user_metadata: {}, ...overrides },
});

// Shared by both describes below. Declared at file scope deliberately: when this lived
// inside the first `describe`, the second one silently ran with mocks that were never
// reset between tests, and its call-count assertions counted the whole file's traffic.
beforeEach(() => {
  vi.clearAllMocks();
  (supabase!.auth.getSession as any).mockResolvedValue({ data: { session: null } });
  (supabase!.auth.onAuthStateChange as any).mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  (supabase!.from as any).mockImplementation(() => tableStub());
  useAppStore.setState({ currentUserId: null });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('auth.tsx', () => {

  it('signInWithEmail returns error if fails', async () => {
    (supabase!.auth.signInWithPassword as any).mockResolvedValueOnce({ error: new Error('Invalid login') });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    let error;
    await act(async () => {
      const res = await result.current.signInWithEmail('test@test.com', 'pwd');
      error = res.error;
    });

    expect(error).toBeDefined();
  });

  it('signUpWithEmail passes metadata properly', async () => {
    (supabase!.auth.signUp as any).mockResolvedValueOnce({ data: { user: { id: '1' } }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.signUpWithEmail('test@test.com', 'pwd', 'John Doe');
    });

    expect(supabase!.auth.signUp).toHaveBeenCalledWith({
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
    (supabase!.auth.updateUser as any).mockResolvedValueOnce({ data: { user: { id: '1', user_metadata: { full_name: 'New Name' } } }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    console.log("Current result keys:", Object.keys(result.current));
    
    await act(async () => {
      await result.current.updateProfile('New Name');
    });

    expect(supabase!.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'New Name' } });
  });

  it('updateAgeClassification uses rpc', async () => {
    (supabase!.rpc as any).mockResolvedValueOnce({ data: { success: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      const res = await result.current.updateAgeClassification('13_to_17' as any);
      expect(res.success).toBe(true);
    });

    expect(supabase!.rpc).toHaveBeenCalledWith('update_user_age_classification', { classification: '13_to_17' });
  });

  it('signOut calls supabase signOut', async () => {
    (supabase!.auth.signOut as any).mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.signOut();
    });

    expect(supabase!.auth.signOut).toHaveBeenCalled();
  });

  it('resetPassword calls resetPasswordForEmail', async () => {
    (supabase!.auth.resetPasswordForEmail as any).mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.resetPassword('test@test.com');
    });

    expect(supabase!.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@test.com', expect.any(Object));
  });
});

describe('auth lifecycle', () => {
  describe('session restore on mount', () => {
    it('finishes loading with no user when there is no stored session', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.user).toBeNull();
      expect(result.current.session).toBeNull();
      expect(useAppStore.getState().currentUserId).toBeNull();
    });

    it('restores a stored session and tells the store who the user is', async () => {
      (supabase!.auth.getSession as any).mockResolvedValue({ data: { session: session() } });

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.user?.id).toBe('user-1'));
      expect(result.current.session).not.toBeNull();
      // The store's currentUserId drives which team_members row counts as "me", so a
      // restore that forgets it leaves the user unable to be attributed to their own work.
      expect(useAppStore.getState().currentUserId).toBe('user-1');
    });

    it('does not hang forever when getSession never settles', async () => {
      // The offline PWA case: Supabase is unreachable, the promise never resolves. Without
      // the 5s safety timeout the app renders its loading screen and never leaves it.
      vi.useFakeTimers();
      (supabase!.auth.getSession as any).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.isLoading).toBe(false);
      vi.useRealTimers();
    });

    it('stops loading when the session lookup rejects', async () => {
      (supabase!.auth.getSession as any).mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.user).toBeNull();
    });

    it('unsubscribes from auth changes on unmount', async () => {
      const unsubscribe = vi.fn();
      (supabase!.auth.onAuthStateChange as any).mockReturnValue({
        data: { subscription: { unsubscribe } },
      });

      const { unmount } = renderHook(() => useAuth(), { wrapper });
      unmount();

      expect(unsubscribe).toHaveBeenCalled();
    });
  });

  describe('onAuthStateChange', () => {
    /**
     * Render the provider and hand back the callback it registered.
     *
     * Waits for the initial `getSession()` to settle first. Without that, the mount
     * lookup resolves partway through the event being dispatched and overwrites the
     * state the event just set — a race in the test, not in the app, where the two are
     * seconds apart.
     */
    async function captureHandler() {
      let handler!: (event: string, s: unknown) => Promise<void>;
      (supabase!.auth.onAuthStateChange as any).mockImplementation((cb: any) => {
        handler = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      const hook = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
      (supabase!.from as any).mockClear();
      return { ...hook, handler: () => handler };
    }

    it('SIGNED_IN records the user, ensures a profile and loads the age classification', async () => {
      (supabase!.from as any).mockImplementation(() =>
        tableStub({ data: { age_classification: '18_plus' }, error: null }),
      );

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session({ user_metadata: { full_name: 'Ada' } }));
      });

      expect(result.current.user?.id).toBe('user-1');
      expect(result.current.isLoading).toBe(false);
      expect(useAppStore.getState().currentUserId).toBe('user-1');
      // The profile row is upserted rather than inserted, so a returning user is not an
      // error and an RLS hiccup does not read as "user not found".
      expect(supabase!.from).toHaveBeenCalledWith('users');
      expect(result.current.ageClassification).toBe('18_plus');
    });

    it('falls back to signup metadata when the profile row cannot be read', async () => {
      // RLS or a network blip: the upsert lands but the read back returns nothing. The
      // classification gates the whole under-13 flow, so guessing null would be wrong.
      (supabase!.from as any).mockImplementation(() => tableStub({ data: null, error: null }));

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session({ user_metadata: { age_classification: '13_to_17' } }));
      });

      expect(result.current.ageClassification).toBe('13_to_17');
    });

    it('records the privacy attestation once, and not again if it already exists', async () => {
      const existing = tableStub({ data: { id: 'attestation-1' }, error: null });
      (supabase!.from as any).mockImplementation((table: string) =>
        table === 'user_attestations' ? existing : tableStub(),
      );

      const { handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session({ user_metadata: { privacy_accepted: true } }));
      });

      expect(existing.insert).not.toHaveBeenCalled();
    });

    it('SIGNED_OUT clears the user from state and from the store', async () => {
      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session());
      });
      expect(useAppStore.getState().currentUserId).toBe('user-1');

      await act(async () => {
        await handler()('SIGNED_OUT', null);
      });

      expect(result.current.user).toBeNull();
      expect(result.current.session).toBeNull();
      // A shared team laptop: the next person must not inherit the previous user's id.
      expect(useAppStore.getState().currentUserId).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('a token refresh does not re-run the profile sync', async () => {
      const { handler } = await captureHandler();
      await act(async () => {
        await handler()('TOKEN_REFRESHED', session());
      });

      expect(supabase!.from).not.toHaveBeenCalled();
    });
  });
});
