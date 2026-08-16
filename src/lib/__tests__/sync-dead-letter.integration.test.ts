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
    retrySyncFailure,
    discardSyncFailure,
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

/**
 * Per-item retry and discard — the operations the review UI needs, which the all-or-nothing
 * versions above cannot express.
 *
 * The motivating case is mixed: several parked changes where one is genuinely dead (it belongs
 * to an archived season and will be refused forever) and the others would go through fine.
 * `retrySyncFailures` requeues everything, so the dead one re-parks on every attempt and the
 * badge never clears; `discardSyncFailures` clears the badge by destroying the good work too.
 */
describe('per-item dead-letter operations', () => {
    it('requeues ONE change and leaves the others parked', async () => {
        await moveToDeadLetter(item({ id: 'a', recordId: 'r-a' }), new Error('boom'));
        await moveToDeadLetter(item({ id: 'b', recordId: 'r-b' }), new Error('boom'));
        await moveToDeadLetter(item({ id: 'c', recordId: 'r-c' }), new Error('boom'));

        expect(await retrySyncFailure('b')).toBe(true);

        const stillParked = (await getSyncFailures()).map((f) => f.id);
        expect(stillParked.sort()).toEqual(['a', 'c']);

        const queued = await getPendingSyncItems();
        expect(queued).toHaveLength(1);
        expect(queued[0].recordId).toBe('r-b');
    });

    it('resets the retry count but keeps the original timestamp, so queue order survives', async () => {
        // B1: ordering comes from `timestamp`, not from insertion order into the queue. A
        // requeued change must not jump ahead of work that was created after it.
        await moveToDeadLetter(item({ id: 'a', timestamp: 500 }), new Error('boom'));

        await retrySyncFailure('a');

        const [queued] = await getPendingSyncItems();
        expect(queued.retryCount).toBe(0);
        expect(queued.timestamp).toBe(500);
    });

    it('discards ONE change without touching the others, and without queueing it', async () => {
        await moveToDeadLetter(item({ id: 'a' }), new Error('boom'));
        await moveToDeadLetter(item({ id: 'b' }), new Error('boom'));

        expect(await discardSyncFailure('a')).toBe(true);

        expect((await getSyncFailures()).map((f) => f.id)).toEqual(['b']);
        // Discarded means gone, not quietly retried: this is the one operation in the app that
        // destroys the user's work on purpose.
        expect(await getPendingSyncItems()).toHaveLength(0);
    });

    it('reports a miss rather than throwing, because two devices can race', async () => {
        expect(await retrySyncFailure('never-existed')).toBe(false);
        expect(await discardSyncFailure('never-existed')).toBe(false);
    });
});
