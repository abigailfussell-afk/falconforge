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
 */
export const supabaseSync: SupabaseClient<Database> | null = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        accessToken: async () => {
            try {
                const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
                const raw = localStorage.getItem(storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed?.access_token) return parsed.access_token;
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
