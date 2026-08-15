/**
 * Setup for the database-backed suite.
 *
 * Note what is NOT here: no `vi.mock('@/lib/supabase')`, no stubbed query builder, no fake
 * network. The whole point of this suite is that the code under test talks to a real
 * PostgREST over HTTP against a real Postgres with the real policies.
 *
 * The app reads its credentials from `import.meta.env` at module scope, so they are
 * stubbed here — before any test file imports `@/lib/supabase` — pointing the *real*
 * client factory at the local stack. That means `supabaseSync`'s access-token callback,
 * JWT expiry check and localStorage lookup are all exercised as written rather than
 * replaced.
 *
 * IndexedDB is faked because jsdom has none. That is a missing browser API, not a
 * dependency being stubbed out.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';
import { db } from '@/lib/offline-db';

const apiUrl = process.env.SUPABASE_API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!apiUrl || !anonKey) {
    throw new Error('Local stack credentials missing; globalSetup should have provided them.');
}

vi.stubEnv('VITE_SUPABASE_URL', apiUrl);
vi.stubEnv('VITE_SUPABASE_ANON_KEY', anonKey);

/**
 * Where `supabaseSync` looks for the JWT: `sb-${first label of the hostname}-auth-token`.
 * For http://127.0.0.1:54321 that is `sb-127-auth-token`. Tests put a real token here to
 * sign the app's own client in as a given user.
 */
export const SYNC_TOKEN_STORAGE_KEY = `sb-${new URL(apiUrl).hostname.split('.')[0]}-auth-token`;

/** Sign the app's real Supabase clients in as a test user. */
export function signInAppClientAs(accessToken: string): void {
    localStorage.setItem(SYNC_TOKEN_STORAGE_KEY, JSON.stringify({ access_token: accessToken }));
}

export function signOutAppClient(): void {
    localStorage.removeItem(SYNC_TOKEN_STORAGE_KEY);
}

beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
    await db.appState.clear();
});
