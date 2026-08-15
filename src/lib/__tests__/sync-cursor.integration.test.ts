/**
 * Round C — delta-sync bookkeeping.
 *
 * B4: the cursor came from `Date.now()` but was compared against `updated_at`, which a
 *     Postgres trigger writes on the SERVER clock. A client running fast skipped every
 *     record inside the skew window, silently, until the next full reconciliation. School
 *     Chromebooks and tablets with bad time sync make that routine.
 *
 * B5: the cursors and the pull counter lived in localStorage, which sign-out never cleared.
 *     The next user on a shared laptop inherited them and got an incomplete dataset.
 *
 * B15: the pull counter was global, so switching teams shifted which entity happened to
 *      land on the full-reconciliation cycle.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    db,
    getSyncMeta,
    setSyncCursor,
    bumpSyncCounter,
    clearAppState,
} from '@/lib/offline-db';

const { newestUpdatedAt } = await vi.importActual<typeof import('@/lib/sync')>('@/lib/sync');

beforeEach(async () => {
    await db.appState.clear();
});

describe('delta cursor comes from server data, not the local clock (B4)', () => {
    it('picks the newest updated_at from the returned rows', () => {
        const cursor = newestUpdatedAt([
            { id: 'a', updated_at: '2026-03-01T10:00:00.000Z' },
            { id: 'b', updated_at: '2026-03-01T12:30:00.000Z' },
            { id: 'c', updated_at: '2026-03-01T09:00:00.000Z' },
        ]);

        expect(cursor).toBe('2026-03-01T12:30:00.000Z');
    });

    it('is unaffected by a client clock running hours fast', () => {
        // The whole point: whatever Date.now() says, the cursor is the server's value.
        const skewed = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        const cursor = newestUpdatedAt([{ id: 'a', updated_at: '2026-03-01T10:00:00.000Z' }]);

        expect(cursor).toBe('2026-03-01T10:00:00.000Z');
        expect(cursor).not.toBe(skewed);
    });

    it('falls back to created_at for rows without updated_at', () => {
        const cursor = newestUpdatedAt([{ id: 'a', created_at: '2026-02-01T00:00:00.000Z' }]);

        expect(cursor).toBe('2026-02-01T00:00:00.000Z');
    });

    it('returns null for an empty result so the cursor does not jump forward', () => {
        // No rows means nothing newer exists. Advancing the cursor here is exactly how
        // records written during the request window used to be skipped forever.
        expect(newestUpdatedAt([])).toBeNull();
    });

    it('ignores unparseable timestamps rather than poisoning the cursor with NaN', () => {
        const cursor = newestUpdatedAt([
            { id: 'a', updated_at: 'not-a-date' },
            { id: 'b', updated_at: '2026-03-01T10:00:00.000Z' },
        ]);

        expect(cursor).toBe('2026-03-01T10:00:00.000Z');
    });
});

describe('sync metadata is cleared on sign-out (B5)', () => {
    it('stores cursors in IndexedDB, not localStorage', async () => {
        await setSyncCursor('store-check:tasks', '2026-03-01T10:00:00.000Z');

        // The old implementation kept these two localStorage keys, which sign-out never
        // touched. Nothing should write them any more.
        expect(localStorage.getItem('falconforge-sync-timestamps')).toBeNull();
        expect(localStorage.getItem('falconforge-sync-counter')).toBeNull();
        expect((await getSyncMeta()).cursors['store-check:tasks'])
            .toBe('2026-03-01T10:00:00.000Z');
    });

    it('does not leak a previous user cursors after sign-out', async () => {
        await setSyncCursor('leak-check:tasks', '2026-03-01T10:00:00.000Z');
        await bumpSyncCounter('leak-check');
        expect(await db.appState.count()).toBeGreaterThan(0);

        // clearAppState() is what App.tsx calls on sign-out. Because sync metadata now
        // lives in appState rather than localStorage, that single call covers it (B5).
        await clearAppState();

        expect(await db.appState.count()).toBe(0);
    });

    it('survives corrupt stored metadata instead of throwing', async () => {
        await db.appState.put({ key: 'falconforge-sync-meta', value: '{not json' });

        // A bad blob must degrade to "no cursors" (costing one full pull), not throw and
        // take the whole sync down with it.
        await expect(getSyncMeta()).resolves.toEqual({ cursors: {}, counters: {} });
    });
});

describe('full-pull counter is per team (B15)', () => {
    it('counts each team independently', async () => {
        expect(await bumpSyncCounter('count-a')).toBe(1);
        expect(await bumpSyncCounter('count-a')).toBe(2);
        // Switching teams must not inherit the other team's position in the cycle.
        expect(await bumpSyncCounter('count-b')).toBe(1);
        expect(await bumpSyncCounter('count-a')).toBe(3);
    });

    it('keeps counters and cursors side by side without clobbering', async () => {
        await setSyncCursor('mixed:tasks', '2026-03-01T10:00:00.000Z');
        await bumpSyncCounter('mixed');

        const meta = await getSyncMeta();
        expect(meta.cursors['mixed:tasks']).toBe('2026-03-01T10:00:00.000Z');
        expect(meta.counters['mixed']).toBe(1);
    });
});
