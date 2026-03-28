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

export const supabaseSync: SupabaseClient<Database> | null = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => {
            try {
                const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
                const raw = localStorage.getItem(storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.access_token) {
                        // If the token is still valid, use it directly (fast path)
                        if (!isTokenExpired(parsed.access_token)) {
                            return parsed.access_token;
                        }
                        // Token expired — ask the main client for a refreshed session
                        if (supabase) {
                            const { data } = await supabase.auth.getSession();
                            if (data?.session?.access_token) {
                                return data.session.access_token;
                            }
                        }
                    }
                }
            } catch {
                // fall through
            }
            return supabaseAnonKey;
        },
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    })
    : null;

export const isSupabaseConfigured = () => !!supabase;
