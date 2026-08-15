/**
 * B1 — the sync queue is drained in random order.
 *
 * `sync.ts` drains the queue with:
 *
 *     const queueItems = await db.syncQueue.toArray();
 *
 * Dexie returns rows in PRIMARY KEY order. The primary key is `generateId()`, which is
 * `crypto.randomUUID()` -- so queued operations are applied in an order unrelated to the
 * order the user performed them. A delete can land before its create (the record comes
 * back); an update can land before its create (it targets a row that does not exist, fails
 * five times, and is then silently discarded).
 *
 * The `timestamp` column is already indexed in the Dexie schema. It is simply never used
 * for ordering.
 *
 * These tests run against real IndexedDB (fake-indexeddb) and real Dexie, so they exercise
 * the actual query `sync.ts` issues rather than a mock of it.
 *
 * STATUS: the first test documents current (broken) behaviour and passes today. The second
 * asserts the behaviour we want and FAILS today -- it is the proof that this test loop can
 * express the bug. Round B makes it pass by switching the drain to `orderBy('timestamp')`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/offline-db';
import type { SyncQueueItem } from '@/lib/offline-db';

/**
 * Three operations on ONE record, performed in this chronological order:
 *   1. create   (t=1000)
 *   2. update   (t=2000)
 *   3. delete   (t=3000)
 *
 * The ids are fixed so primary-key order is the exact reverse of chronological order.
 * `crypto.randomUUID()` produces an arbitrary permutation of these three in practice --
 * reverse is simply the worst case, chosen here so the test is deterministic instead of
 * flaky. Any permutation other than chronological is a bug.
 */
const RECORD_ID = 'task-under-test';

const OPERATIONS: SyncQueueItem[] = [
    {
        id: 'ccc-third-by-pk',
        tableName: 'tasks',
        recordId: RECORD_ID,
        operation: 'create',
        data: { id: RECORD_ID, title: 'Build intake' },
        timestamp: 1000,
        retryCount: 0,
    },
    {
        id: 'bbb-second-by-pk',
        tableName: 'tasks',
        recordId: RECORD_ID,
        operation: 'update',
        data: { id: RECORD_ID, title: 'Build intake v2' },
        timestamp: 2000,
        retryCount: 0,
    },
    {
        id: 'aaa-first-by-pk',
        tableName: 'tasks',
        recordId: RECORD_ID,
        operation: 'delete',
        data: null,
        timestamp: 3000,
        retryCount: 0,
    },
];

const CHRONOLOGICAL = ['create', 'update', 'delete'];

beforeEach(async () => {
    await db.syncQueue.clear();
    // Insert in chronological order -- the order the user actually performed them.
    for (const op of OPERATIONS) {
        await db.syncQueue.add(op);
    }
});

describe('sync queue drain order (B1)', () => {
    it('documents the bug: toArray() returns primary-key order, not chronological order', async () => {
        // This is the exact call sync.ts:130 makes.
        const drained = await db.syncQueue.toArray();

        expect(drained.map((i) => i.operation)).toEqual(['delete', 'update', 'create']);

        // The delete is applied first, against a row the server has never seen; the create
        // is applied last and resurrects the record the user deleted.
        expect(drained[0].operation).toBe('delete');
        expect(drained[drained.length - 1].operation).toBe('create');
    });

    // `it.fails` asserts this test throws -- it is green while the bug exists and turns RED
    // the moment B1 is fixed. That is deliberate: a permanently failing test trains people to
    // ignore red, whereas this one forces the fixer to come back and flip it to a plain `it`.
    it.fails('drains operations in the order the user performed them', async () => {
        // Round B: change sync.ts:130 to `db.syncQueue.orderBy('timestamp').toArray()`,
        // then remove `.fails` here and delete the "documents the bug" test above.
        const drained = await db.syncQueue.toArray();

        expect(drained.map((i) => i.operation)).toEqual(CHRONOLOGICAL);
    });

    it('orderBy(timestamp) is the fix, and the index for it already exists', async () => {
        const drained = await db.syncQueue.orderBy('timestamp').toArray();

        expect(drained.map((i) => i.operation)).toEqual(CHRONOLOGICAL);
    });
});
