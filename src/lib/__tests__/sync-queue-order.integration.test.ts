/**
 * B1 — the sync queue must drain in the order the user performed the operations.
 *
 * The bug: `sync.ts` drained with `db.syncQueue.toArray()`. Dexie returns rows in PRIMARY
 * KEY order, and the primary key is `generateId()` -> `crypto.randomUUID()`, so operations
 * were applied in an order unrelated to what the user did. A delete could land before its
 * create (the record comes back); an update could land before its create (it targets a row
 * that does not exist, fails five times, and is then silently discarded).
 *
 * The fix: the drain goes through `getPendingSyncItems()`, which orders by `timestamp` --
 * a column that was already indexed in the Dexie schema and simply never used.
 *
 * These tests run against real IndexedDB (fake-indexeddb) and real Dexie, so they exercise
 * the actual query the drain issues rather than a mock of it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, getPendingSyncItems } from '@/lib/offline-db';
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
    it('drains operations in the order the user performed them', async () => {
        const drained = await getPendingSyncItems();

        expect(drained.map((i) => i.operation)).toEqual(CHRONOLOGICAL);
    });

    it('does not resurrect a deleted record by applying its create last', async () => {
        const drained = await getPendingSyncItems();

        expect(drained[0].operation).toBe('create');
        expect(drained[drained.length - 1].operation).toBe('delete');
    });

    it('keeps ordering stable regardless of insertion order', async () => {
        // Same three operations, inserted back-to-front. Chronological order is a property
        // of the timestamps, not of how rows happen to land in IndexedDB.
        await db.syncQueue.clear();
        for (const op of [...OPERATIONS].reverse()) {
            await db.syncQueue.add(op);
        }

        const drained = await getPendingSyncItems();

        expect(drained.map((i) => i.operation)).toEqual(CHRONOLOGICAL);
    });

    it('guards the regression: a raw toArray() would still be primary-key ordered', async () => {
        // Not how the drain works any more -- this pins WHY. If someone "simplifies"
        // getPendingSyncItems back to toArray(), the tests above start failing and this one
        // explains what they just reintroduced.
        const rawPrimaryKeyOrder = await db.syncQueue.toArray();

        expect(rawPrimaryKeyOrder.map((i) => i.operation)).toEqual(['delete', 'update', 'create']);
    });
});
