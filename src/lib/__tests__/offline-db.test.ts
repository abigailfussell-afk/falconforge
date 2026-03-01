import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Unmock the module so we test the REAL implementation
vi.unmock('@/lib/offline-db');

import { db, generateId, queueForSync, getPendingSyncCount, clearLocalDatabase } from '../offline-db';

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
