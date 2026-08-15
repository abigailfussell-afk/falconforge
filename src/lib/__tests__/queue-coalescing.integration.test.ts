/**
 * B14 — redundant queue entries are coalesced.
 *
 * Every edit used to append a row, so twenty tweaks to one task meant twenty full upserts
 * of the same record. Checklist toggles were the worst case: each toggle queued the whole
 * blob. On a slow venue connection that turns a few seconds of editing into a queue that
 * takes minutes to drain, and the 30s overall timeout can cut it off partway.
 *
 * The invariant that matters: at most one pending entry per (tableName, recordId), and it
 * describes what the server still needs -- not a replay of every keystroke.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, queueForSync, getPendingSyncItems } from '@/lib/offline-db';

beforeEach(async () => {
    await db.syncQueue.clear();
});

describe('queue coalescing (B14)', () => {
    it('collapses repeated updates to one entry with the latest data', async () => {
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v1' });
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v2' });
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v3' });

        const queue = await getPendingSyncItems();
        expect(queue).toHaveLength(1);
        expect(queue[0].operation).toBe('update');
        expect(queue[0].data.title).toBe('v3');
    });

    it('keeps an update after a create as a CREATE', async () => {
        // The server has never seen this record, so it still has to be an insert --
        // downgrading to an update would target a row that does not exist.
        await queueForSync('tasks', 'task-1', 'create', { id: 'task-1', title: 'v1' });
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v2' });

        const queue = await getPendingSyncItems();
        expect(queue).toHaveLength(1);
        expect(queue[0].operation).toBe('create');
        expect(queue[0].data.title).toBe('v2');
    });

    it('cancels out a create followed by a delete', async () => {
        // Created and deleted before either reached the server: nothing to send. Sending
        // a delete for an id the server never saw just fails and burns retries.
        await queueForSync('tasks', 'task-1', 'create', { id: 'task-1' });
        await queueForSync('tasks', 'task-1', 'delete', { id: 'task-1' });

        expect(await getPendingSyncItems()).toHaveLength(0);
    });

    it('replaces a pending update with a delete', async () => {
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v1' });
        await queueForSync('tasks', 'task-1', 'delete', { id: 'task-1' });

        const queue = await getPendingSyncItems();
        expect(queue).toHaveLength(1);
        expect(queue[0].operation).toBe('delete');
    });

    it('preserves ordering against other records', async () => {
        // The surviving entry keeps its ORIGINAL timestamp, so coalescing cannot reorder
        // a record relative to others and B1's drain order still holds.
        await queueForSync('tasks', 'first', 'create', { id: 'first' });
        await queueForSync('tasks', 'second', 'create', { id: 'second' });
        await queueForSync('tasks', 'first', 'update', { id: 'first', title: 'edited' });

        const queue = await getPendingSyncItems();
        expect(queue.map((q) => q.recordId)).toEqual(['first', 'second']);
    });

    it('does not merge across different records or tables', async () => {
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1' });
        await queueForSync('tasks', 'task-2', 'update', { id: 'task-2' });
        await queueForSync('scouting_reports', 'task-1', 'update', { id: 'task-1' });

        expect(await getPendingSyncItems()).toHaveLength(3);
    });

    it('collapses rapid checklist toggles, the pathological case', async () => {
        for (let i = 0; i < 20; i++) {
            await queueForSync('checklists', 'team-1', 'update', { teamId: 'team-1', items: [i] });
        }

        const queue = await getPendingSyncItems();
        expect(queue).toHaveLength(1);
        expect(queue[0].data.items).toEqual([19]);
    });

    it('resets the retry count when a coalesced change supersedes a failing one', async () => {
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v1' });
        const [queued] = await getPendingSyncItems();
        await db.syncQueue.update(queued.id, { retryCount: 3 });

        // New data is a different request; it deserves a full set of attempts rather than
        // inheriting the old one's near-exhausted budget.
        await queueForSync('tasks', 'task-1', 'update', { id: 'task-1', title: 'v2' });

        const [after] = await getPendingSyncItems();
        expect(after.retryCount).toBe(0);
        expect(after.data.title).toBe('v2');
    });
});
