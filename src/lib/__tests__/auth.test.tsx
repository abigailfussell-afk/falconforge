import React from 'react';
import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';

import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth';
import { supabase } from '../supabase';
import { useAppStore } from '../store';
import { PROFILE_CACHE_KEY } from '../profile-cache';

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

/**
 * Mock accessor for the stubbed client.
 *
 * `(supabase!.auth.getSession as any).mockResolvedValue(...)` was written nineteen times
 * in this file. This gives the same access without an `any`: the mock API is typed, while
 * the resolved values stay deliberately partial. Building a complete `Session` or `User`
 * for every stub would be pages of fields no test reads, and the fields these tests do
 * read are the ones they set.
 */
const asMock = (fn: unknown): Mock => fn as Mock;

const authMock = {
  getSession: asMock(supabase!.auth.getSession),
  onAuthStateChange: asMock(supabase!.auth.onAuthStateChange),
  signInWithPassword: asMock(supabase!.auth.signInWithPassword),
  signUp: asMock(supabase!.auth.signUp),
  signOut: asMock(supabase!.auth.signOut),
  resetPasswordForEmail: asMock(supabase!.auth.resetPasswordForEmail),
  updateUser: asMock(supabase!.auth.updateUser),
};
const fromMock = asMock(supabase!.from);
const rpcMock = asMock(supabase!.rpc);

// Shared by both describes below. Declared at file scope deliberately: when this lived
// inside the first `describe`, the second one silently ran with mocks that were never
// reset between tests, and its call-count assertions counted the whole file's traffic.
beforeEach(() => {
  vi.clearAllMocks();
  authMock.getSession.mockResolvedValue({ data: { session: null } });
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  fromMock.mockImplementation(() => tableStub());
  useAppStore.setState({ currentUserId: null });
  // The profile cache is real localStorage here; a leftover from a previous test would let
  // the "reads as Guest" case pass for the wrong reason.
  localStorage.removeItem(PROFILE_CACHE_KEY);
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('auth.tsx', () => {

  it('signInWithEmail returns error if fails', async () => {
    authMock.signInWithPassword.mockResolvedValueOnce({ error: new Error('Invalid login') });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    let error;
    await act(async () => {
      const res = await result.current.signInWithEmail('test@test.com', 'pwd');
      error = res.error;
    });

    expect(error).toBeDefined();
  });

  it('signUpWithEmail passes metadata properly', async () => {
    authMock.signUp.mockResolvedValueOnce({ data: { user: { id: '1' } }, error: null });

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
    authMock.updateUser.mockResolvedValueOnce({ data: { user: { id: '1', user_metadata: { full_name: 'New Name' } } }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    console.log("Current result keys:", Object.keys(result.current));
    
    await act(async () => {
      await result.current.updateProfile('New Name');
    });

    expect(supabase!.auth.updateUser).toHaveBeenCalledWith({ data: { full_name: 'New Name' } });
  });

  it('updateAgeClassification uses rpc', async () => {
    rpcMock.mockResolvedValueOnce({ data: { success: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      const res = await result.current.updateAgeClassification('13_to_17' as any);
      expect(res.success).toBe(true);
    });

    expect(supabase!.rpc).toHaveBeenCalledWith('update_user_age_classification', { classification: '13_to_17' });
  });

  it('signOut calls supabase signOut', async () => {
    authMock.signOut.mockResolvedValueOnce({ error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });
    
    await act(async () => {
      await result.current.signOut();
    });

    expect(supabase!.auth.signOut).toHaveBeenCalled();
  });

  it('resetPassword calls resetPasswordForEmail', async () => {
    authMock.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

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
      authMock.getSession.mockResolvedValue({ data: { session: session() } });

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
      authMock.getSession.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useAuth(), { wrapper });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.isLoading).toBe(false);
      vi.useRealTimers();
    });

    it('stops loading when the session lookup rejects', async () => {
      authMock.getSession.mockRejectedValue(new Error('network down'));

      const { result } = renderHook(() => useAuth(), { wrapper });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.user).toBeNull();
    });

    it('unsubscribes from auth changes on unmount', async () => {
      const unsubscribe = vi.fn();
      authMock.onAuthStateChange.mockReturnValue({
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
      authMock.onAuthStateChange.mockImplementation((cb: any) => {
        handler = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      const hook = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
      fromMock.mockClear();
      return { ...hook, handler: () => handler };
    }

    it('SIGNED_IN records the user, ensures a profile and loads the age classification', async () => {
      fromMock.mockImplementation(() =>
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
      fromMock.mockImplementation(() => tableStub({ data: null, error: null }));

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session({ user_metadata: { age_classification: '13_to_17' } }));
      });

      expect(result.current.ageClassification).toBe('13_to_17');
    });

    it('records the privacy attestation once, and not again if it already exists', async () => {
      const existing = tableStub({ data: { id: 'attestation-1' }, error: null });
      fromMock.mockImplementation((table: string) =>
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

  /**
   * The profile, merged in from `user-context.tsx` (Sprint 5).
   *
   * That file held a `CurrentUserProvider` nested inside this one, deriving its inputs from
   * `useAuth()` and then making its OWN `users` read and keeping its OWN localStorage cache
   * of the same person. Two sources for one row, which could and did disagree. These tests
   * pin the merged behaviour so it cannot quietly split again.
   */
  describe('profile', () => {
    async function captureHandler() {
      let handler!: (event: string, s: unknown) => Promise<void>;
      authMock.onAuthStateChange.mockImplementation((cb: any) => {
        handler = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });
      const hook = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
      return { ...hook, handler: () => handler };
    }

    it('resolves the profile from the users row, in the same read as the age classification', async () => {
      const users = tableStub({
        data: { full_name: 'Ada Lovelace', avatar_url: 'https://x/a.png', age_classification: '18_plus' },
        error: null,
      });
      fromMock.mockImplementation((table: string) => (table === 'users' ? users : tableStub()));

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session());
      });

      expect(result.current.profile).toEqual({
        id: 'user-1',
        email: 'coach@example.com',
        fullName: 'Ada Lovelace',
        avatarUrl: 'https://x/a.png',
      });
      expect(result.current.displayName).toBe('Ada Lovelace');
      expect(result.current.initials).toBe('AL');

      /*
       * ONE read of `users`, not two. `CurrentUserProvider` used to select
       * `id, email, full_name, avatar_url` from the same row that this provider was already
       * selecting `age_classification` from — two round trips to one row on every sign-in,
       * on a connection that at a competition is frequently a tethered phone. The columns
       * are merged into a single select; this is what stops the second one coming back.
       */
      expect(users.select).toHaveBeenCalledTimes(1);
    });

    it('falls back to auth metadata per field when the users row cannot be read', async () => {
      // Offline, or an RLS refusal. The JWT is still good, so a signed-in person must never
      // render as "Guest" just because the row read failed.
      fromMock.mockImplementation(() => tableStub({ data: null, error: null }));

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session({ user_metadata: { full_name: 'Grace Hopper' } }));
      });

      expect(result.current.profile?.fullName).toBe('Grace Hopper');
      expect(result.current.displayName).toBe('Grace Hopper');
    });

    it('reads as Guest when there is no profile at all', async () => {
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.profile).toBeNull();
      expect(result.current.displayName).toBe('Guest');
      expect(result.current.initials).toBe('G');
    });

    /*
     * REGRESSION: renaming yourself renamed you in one place.
     *
     * `updateProfile` wrote the new name into the auth user, which the sidebar rendered from
     * — but the roster and the task activity feed rendered from `CurrentUserProvider`'s
     * separately-cached copy, which was only refreshed on the next auth event. So after
     * "Save" the sidebar said the new name and your own comments still said the old one,
     * until a reload. One source is what fixes it; this is what proves it.
     */
    it('carries a rename through to the profile, not just the auth user', async () => {
      fromMock.mockImplementation(() =>
        tableStub({ data: { full_name: 'Old Name', avatar_url: null, age_classification: null }, error: null }),
      );

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session());
      });
      expect(result.current.displayName).toBe('Old Name');

      authMock.updateUser.mockResolvedValueOnce({
        data: { user: { id: 'user-1', email: 'coach@example.com', user_metadata: { full_name: 'New Name' } } },
        error: null,
      });
      await act(async () => {
        await result.current.updateProfile('New Name');
      });

      expect(result.current.profile?.fullName).toBe('New Name');
      expect(result.current.displayName).toBe('New Name');
    });

    it('caches the profile so a cold offline start renders a name, and drops it on sign-out', async () => {
      fromMock.mockImplementation(() =>
        tableStub({ data: { full_name: 'Ada Lovelace', avatar_url: null, age_classification: null }, error: null }),
      );

      const { result, handler } = await captureHandler();
      await act(async () => {
        await handler()('SIGNED_IN', session());
      });

      // Cached: this is what makes the PWA render a name rather than "Guest" when it opens
      // at a venue with no connection and the users read cannot run at all.
      expect(JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY)!).fullName).toBe('Ada Lovelace');

      await act(async () => {
        await handler()('SIGNED_OUT', null);
      });

      // Shared team laptop: the next person must not see the previous one's name while
      // their own profile resolves.
      expect(localStorage.getItem(PROFILE_CACHE_KEY)).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.displayName).toBe('Guest');
    });
  });
});
