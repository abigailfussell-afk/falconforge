/**
 * Setup for the database-backed suite.
 *
 * Note what is NOT here: no `vi.mock('@/lib/supabase')`, no stubbed query builder, no
 * fake network. The whole point of this suite is that the code under test talks to a real
 * PostgREST over HTTP against a real Postgres with the real policies.
 *
 * IndexedDB is faked because jsdom has none — that is a browser API the tests need, not a
 * dependency being stubbed out.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';
import { db } from '@/lib/offline-db';

beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
    await db.appState.clear();
});
