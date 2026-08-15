/**
 * Integration test setup: real IndexedDB, real store, real sync queue.
 *
 * WHAT USED TO BE HERE, AND WHY IT ISN'T
 *
 * A global `vi.mock('@/lib/supabase')` returning a hand-written query builder. It had
 * drifted: it stubbed `.gt()` while sync.ts calls `.gte()`, so the delta-pull path threw on
 * contact and had never once been exercised by the suite that claimed to cover it. It also
 * mocked `supabase` but not `supabaseSync`, which is the client every sync query actually
 * uses — so the mock was not even in the path most of the time.
 *
 * A hand-rolled mock of a query builder is a second, worse implementation of PostgREST
 * that nothing keeps in step with the real one. Tests that genuinely need a server now run
 * against a real Postgres (`npm run test:db`); tests that need a *specific* server
 * response declare their own mock in the file that needs it, where the drift is visible.
 *
 * Without a global mock, `@/lib/supabase` resolves for real and both clients are `null`
 * (no VITE_ credentials in the test environment), which is the honest offline case these
 * tests are mostly about anyway.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { vi, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/offline-db';

// Clear IndexedDB tables before each test
beforeEach(async () => {
    await db.syncQueue.clear();
});

// Cleanup after each test
afterEach(async () => {
    vi.clearAllMocks();
});
