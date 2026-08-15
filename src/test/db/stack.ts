/**
 * Connection to the local Supabase stack.
 *
 * Everything in `*.db.test.ts` runs against a real Postgres with the real migrations and
 * the real RLS policies applied — `supabase start`, the same stack CI's schema job uses.
 * Not a hand-rolled mock of a query builder.
 *
 * WHY: the repo's own history is the argument. `setup-integration.ts` stubbed `.gt()`
 * while sync.ts calls `.gte()`, so the delta-pull path threw on contact and had never
 * once been exercised by the suite that claimed to cover it. A mock cannot tell you that
 * a policy denies a row, that a uuid cast fails, or that a NOT NULL column rejects a
 * write. Those are the failures that actually reach users.
 *
 * Credentials come from the environment, populated by `globalSetup.ts`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export interface StackCredentials {
    apiUrl: string;
    anonKey: string;
    serviceRoleKey: string;
    dbUrl: string;
}

export function stackCredentials(): StackCredentials {
    const apiUrl = process.env.SUPABASE_API_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const dbUrl = process.env.SUPABASE_DB_URL;

    if (!apiUrl || !anonKey || !serviceRoleKey || !dbUrl) {
        throw new Error(
            'Local Supabase credentials are missing from the environment. These tests run ' +
            'against a real database; start it with `npm run db:start`.',
        );
    }
    return { apiUrl, anonKey, serviceRoleKey, dbUrl };
}

/**
 * Refuse to touch anything that is not the local stack.
 *
 * These helpers delete users and truncate tables. Pointing them at a hosted project would
 * destroy real data, so the guard is a hard failure rather than a warning.
 */
export function assertLocalStack(url: string): void {
    const host = new URL(url).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error(
            `Refusing to run destructive test helpers against "${host}". These tests only ` +
            'ever run against the local Supabase stack.',
        );
    }
}

/**
 * Every client gets its own storage key.
 *
 * supabase-js warns loudly when several clients share one, and a suite that models many
 * simultaneous users legitimately needs many clients. Distinct keys make the warning go
 * away for the right reason rather than by suppressing it.
 */
let clientSeq = 0;
const nextStorageKey = () => `falconforge-test-client-${clientSeq++}`;

/** A client with no session: exactly what an unauthenticated visitor gets. */
export function anonClient(): SupabaseClient<Database> {
    const { apiUrl, anonKey } = stackCredentials();
    return createClient<Database>(apiUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: nextStorageKey() },
    });
}

/**
 * A client that bypasses RLS entirely.
 *
 * Used ONLY to set up fixtures — creating the rows a test then tries (and should fail) to
 * reach as somebody else. Never use it to make an assertion: it would prove nothing about
 * the policies, which are the thing under test.
 */
export function serviceClient(): SupabaseClient<Database> {
    const { apiUrl, serviceRoleKey } = stackCredentials();
    assertLocalStack(apiUrl);
    return createClient<Database>(apiUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: nextStorageKey() },
    });
}

/** A client carrying a real user's JWT — subject to RLS like the browser is. */
export function userClient(accessToken: string): SupabaseClient<Database> {
    const { apiUrl, anonKey } = stackCredentials();
    return createClient<Database>(apiUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: nextStorageKey() },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
}
