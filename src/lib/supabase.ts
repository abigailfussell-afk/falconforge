import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        'Supabase credentials not found. Running in offline/demo mode. ' +
        'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local to enable cloud features.'
    );
}

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
    })
    : null;

/**
 * A dedicated Supabase client for sync operations.
 *
 * The main `supabase` client's auth subsystem uses a navigator.locks-based
 * mutex.  Its internal `getSession()` waits for `initializePromise` to settle
 * **inside** that lock.  When the initial token refresh hangs (e.g. flaky
 * network on a PWA cold-start), the lock is never released and every
 * subsequent data query deadlocks – because the postgrest fetch wrapper calls
 * `_getAccessToken()` -> `getSession()` -> `_acquireLock()`.
 *
 * This client sidesteps the problem by supplying a custom `accessToken`
 * callback that reads the JWT straight from localStorage.  Because
 * `_getAccessToken()` checks `this.accessToken` *before* calling
 * `getSession()`, the lock is never touched and queries go out immediately.
 *
 * Stale-JWT mitigation: the callback checks the token's `exp` claim.  If the
 * token has expired (or will expire within 30 seconds), we ask the main
 * `supabase` client for a fresh session instead of sending an expired JWT
 * that would cause RLS-protected queries to fail.
 */

/** Decode JWT payload without a library (browser-safe). Returns null on failure. */
function decodeJwtPayload(token: string): Record<string, any> | null {
    try {
        const base64 = token.split('.')[1];
        if (!base64) return null;
        const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

/** Returns true if the JWT's exp is within `bufferSec` seconds of now (or already past). */
function isTokenExpired(token: string, bufferSec = 30): boolean {
    const payload = decodeJwtPayload(token);
    if (!payload?.exp) return true; // treat decode failures as expired
    return payload.exp - bufferSec <= Date.now() / 1000;
}

/**
 * The signed-in user's JWT for a sync request, or `null` when there is not one.
 *
 * `null` is the answer that matters, and it has to be distinguishable from the anon key.
 * `supabaseSync`'s `accessToken` callback below still falls back to the anon key, because the
 * PUSH path legitimately relies on that: a queued write sent with the anon key is refused
 * with a 42501, which the classifier understands and the queue retries. That is a request
 * that fails loudly.
 *
 * A PULL sent with the anon key does not fail. `anon` holds SELECT on every table, so
 * PostgREST answers `200 []` -- and zero rows is how this read path detects a deletion, so a
 * successful full pull replaced every collection with nothing and the device's offline copy
 * was gone (SYNC-02). That is the absence-read-as-a-value class (`docs/failure-modes.md`
 * section 4, B20) reaching every table at once.
 *
 * So the fallback stays where it is safe and the pull asks THIS function instead, refusing to
 * run at all when it returns `null`. One resolver, two callers, one place that knows how the
 * token is found.
 *
 * Returns `null` when: there is no stored session; the stored token has expired and the main
 * client cannot mint a fresh one (a failed refresh returns `{session: null}` even for a
 * retryable network error); or the token does not carry `role: 'authenticated'`.
 */
export function resolveSyncAccessToken(): string | null {
    try {
        if (!supabaseUrl) return null;
        const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
        const raw = localStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const token = parsed?.access_token;
        if (typeof token !== 'string' || !token) return null;
        if (isTokenExpired(token)) return null;
        return isAuthenticatedToken(token) ? token : null;
    } catch {
        return null;
    }
}

/**
 * Does this JWT speak for a signed-in user?
 *
 * The anon key is a perfectly valid JWT -- it just carries `role: 'anon'`. Checking the claim
 * rather than comparing against `supabaseAnonKey` means a DIFFERENT anon-ish token (a
 * publishable key, a stale key from another project) is refused too.
 */
export function isAuthenticatedToken(token: string): boolean {
    return decodeJwtPayload(token)?.role === 'authenticated';
}

/**
 * The same question, having gone as far as asking the main client for a refresh.
 *
 * The fast path is synchronous and covers the overwhelming majority of pulls; this is what
 * the pull calls, so an access token that expired while the tab was in the background is
 * refreshed once rather than skipping a pull the user is waiting for.
 */
export async function resolveSyncAccessTokenAsync(): Promise<string | null> {
    const fast = resolveSyncAccessToken();
    if (fast) return fast;
    try {
        if (!supabase) return null;
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) return null;
        return isAuthenticatedToken(token) ? token : null;
    } catch {
        return null;
    }
}

export const supabaseSync: SupabaseClient<Database> | null = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => (await resolveSyncAccessTokenAsync()) ?? supabaseAnonKey,
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
    : null;

export const isSupabaseConfigured = () => !!supabase;
