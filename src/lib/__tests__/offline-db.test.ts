import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Unmock the module so we test the REAL implementation
vi.unmock('@/lib/offline-db');

import { db, generateId, queueForSync, getPendingSyncCount, clearLocalDatabase, moveToDeadLetter } from '../offline-db';

describe('offline-db utilities with real IndexedDB', () => {
    beforeEach(async () => {
        // Clear real db queue before each test
        await db.syncQueue.clear();
    });

    describe('generateId', () => {
        it('should return a valid UUID string', () => {
            const id = generateId();
            expect(typeof id).toBe('string');
            expect(id.length).toBe(36); // UUID length
        });

        it('should return unique IDs on multiple calls', () => {
            const id1 = generateId();
            const id2 = generateId();
            expect(id1).not.toBe(id2);
        });
    });

    describe('queueForSync', () => {
        it('should add an item to the IndexedDB sync queue', async () => {
            // Act
            await queueForSync('tasks', 'record-123', 'create', { title: 'Test Task' });

            // Assert
            const items = await db.syncQueue.toArray();
            expect(items).toHaveLength(1);

            const item = items[0];
            expect(item.id).toBeDefined();
            expect(item.tableName).toBe('tasks');
            expect(item.recordId).toBe('record-123');
            expect(item.operation).toBe('create');
            expect(item.data.title).toBe('Test Task');
            expect(item.timestamp).toBeGreaterThan(0);
            expect(item.retryCount).toBe(0);
        });
    });

    describe('getPendingSyncCount', () => {
        it('should return 0 when queue is empty', async () => {
            const count = await getPendingSyncCount();
            expect(count).toBe(0);
        });

        it('should return correct count when items exist', async () => {
            await queueForSync('tasks', 'r1', 'create', {});
            await queueForSync('tasks', 'r2', 'update', {});

            const count = await getPendingSyncCount();
            expect(count).toBe(2);
        });
    });

    describe('clearLocalDatabase', () => {
        it('should remove all items from the sync queue', async () => {
            // Setup
            await queueForSync('tasks', 'r1', 'create', {});
            await queueForSync('tasks', 'r2', 'update', {});
            expect(await db.syncQueue.count()).toBe(2);

            // Act
            await clearLocalDatabase();

            // Assert
            expect(await db.syncQueue.count()).toBe(0);
        });
    });
});

/*
 * What a parked change RECORDS about why it was parked.
 *
 * Every dead-lettered change in this application recorded `lastError: "[object Object]"` for
 * every server refusal there is. supabase-js throws the PostgREST error OBJECT, and a
 * `PostgrestError` is a plain `{ message, code, details, hint }` — never an `Error` instance —
 * so the old `error instanceof Error ? error.message : String(error)` fell to `String({})`.
 *
 * These tests use the REAL shape rather than a hand-made stand-in. That is the whole point: a
 * test that threw `new Error('boom')` passes against the defect, because an Error is the one
 * input the broken branch handled correctly.
 */
describe('a parked change records why it was parked', () => {
    const item = {
        id: 'q-1',
        tableName: 'tasks',
        recordId: 'r-1',
        operation: 'create' as const,
        data: {},
        timestamp: 1,
        retryCount: 1,
    };

    beforeEach(async () => {
        await db.syncFailures.clear();
        await db.syncQueue.clear();
    });

    const parked = async () => (await db.syncFailures.toArray())[0];

    it('stores a PostgREST refusal as its message, not "[object Object]"', async () => {
        // The exact shape supabase-js throws — a plain object, not an Error.
        await moveToDeadLetter(item, {
            message: 'new row violates row-level security policy for table "tasks"',
            code: '42501',
            details: null,
            hint: null,
        });

        const row = await parked();
        expect(row.lastError).not.toBe('[object Object]');
        expect(row.lastError).toContain('row-level security policy');
        // The code is the half that says WHICH refusal; the message is often the generic half.
        expect(row.lastError).toContain('42501');
    });

    it('still handles a real Error, which is the case that always worked', async () => {
        await moveToDeadLetter(item, new Error('network down'));
        expect((await parked()).lastError).toBe('network down');
    });

    it('falls back to JSON rather than "[object Object]" for an object with no message', async () => {
        await moveToDeadLetter(item, { code: '23505' });
        const row = await parked();
        expect(row.lastError).not.toBe('[object Object]');
        expect(row.lastError).toContain('23505');
    });

    it('survives a circular object instead of throwing inside the failure path', async () => {
        // Parking a change is the LAST line of defence; it must not itself throw.
        const circular: Record<string, unknown> = { code: 'X' };
        circular.self = circular;
        await expect(moveToDeadLetter(item, circular)).resolves.not.toThrow();
        expect((await parked()).lastError).toBeTruthy();
    });

    it('keeps the terminal reason alongside it', async () => {
        await moveToDeadLetter(item, { message: 'refused', code: '42501' }, 'The licence has lapsed.');
        const row = await parked();
        expect(row.terminalReason).toBe('The licence has lapsed.');
        expect(row.lastError).toContain('refused');
    });
});
