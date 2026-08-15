/**
 * B2 — a change that cannot be pushed must not be destroyed.
 *
 * The drain used to delete a queue item outright once its retry count hit 5, leaving only a
 * console.error. A scouting report entered at a competition could vanish with no signal to
 * anyone. Changes are now parked in a dead-letter store so they survive, can be retried, and
 * can be counted by the UI.
 *
 * Runs against real Dexie and real IndexedDB.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    db,
    moveToDeadLetter,
    getSyncFailureCount,
    getSyncFailures,
    retrySyncFailures,
    discardSyncFailures,
    getPendingSyncItems,
    clearLocalDatabase,
} from '@/lib/offline-db';
import type { SyncQueueItem } from '@/lib/offline-db';

const item = (over: Partial<SyncQueueItem> = {}): SyncQueueItem => ({
    id: 'queue-1',
    tableName: 'scouting_reports',
    recordId: 'report-1',
    operation: 'create',
    data: { id: 'report-1', teamNumber: '12345', rating: 5 },
    timestamp: 1000,
    retryCount: 5,
    ...over,
});

beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
});

describe('dead-letter store (B2)', () => {
    it('preserves the change instead of deleting it', async () => {
        const failed = item();
        await db.syncQueue.add(failed);

        await moveToDeadLetter(failed, new Error('row-level security violation'));

        // Gone from the queue so the drain can make progress...
        expect(await db.syncQueue.count()).toBe(0);
        // ...but the user's work still exists.
        const parked = await getSyncFailures();
        expect(parked).toHaveLength(1);
        expect(parked[0].data).toEqual(failed.data);
        expect(parked[0].lastError).toBe('row-level security violation');
        expect(parked[0].failedAt).toBeGreaterThan(0);
    });

    it('counts failures so the UI can report them', async () => {
        expect(await getSyncFailureCount()).toBe(0);

        await moveToDeadLetter(item({ id: 'a' }), new Error('boom'));
        await moveToDeadLetter(item({ id: 'b' }), new Error('boom'));

        expect(await getSyncFailureCount()).toBe(2);
    });

    it('handles a non-Error rejection without losing the change', async () => {
        await moveToDeadLetter(item(), 'plain string rejection');

        const [parked] = await getSyncFailures();
        expect(parked.lastError).toBe('plain string rejection');
    });

    it('re-queues parked changes with retries reset, preserving original order', async () => {
        await moveToDeadLetter(item({ id: 'second', timestamp: 2000 }), new Error('x'));
        await moveToDeadLetter(item({ id: 'first', timestamp: 1000 }), new Error('x'));

        const restored = await retrySyncFailures();

        expect(restored).toBe(2);
        expect(await getSyncFailureCount()).toBe(0);

        const queued = await getPendingSyncItems();
        // Original timestamps travel with the item, so B1's ordering still holds.
        expect(queued.map((q) => q.id)).toEqual(['first', 'second']);
        expect(queued.every((q) => q.retryCount === 0)).toBe(true);
        // The dead-letter bookkeeping does not leak back into the queue.
        expect(queued.every((q) => !('failedAt' in q))).toBe(true);
    });

    it('discards parked changes only when explicitly asked', async () => {
        await moveToDeadLetter(item(), new Error('x'));

        await discardSyncFailures();

        expect(await getSyncFailureCount()).toBe(0);
        expect(await db.syncQueue.count()).toBe(0);
    });

    it('clears parked changes on sign-out so they do not leak to the next user', async () => {
        await moveToDeadLetter(item(), new Error('x'));
        await db.syncQueue.add(item({ id: 'still-queued', retryCount: 0 }));

        await clearLocalDatabase();

        expect(await getSyncFailureCount()).toBe(0);
        expect(await db.syncQueue.count()).toBe(0);
    });
});
