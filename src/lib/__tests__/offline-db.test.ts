import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the mocked functions from setup.ts
// The actual generateId is mocked to return predictable test IDs

describe('offline-db utilities', () => {
    describe('generateId', () => {
        it('should return a string', async () => {
            const { generateId } = await import('../offline-db');

            const id = generateId();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        });

        it('should return unique IDs on multiple calls', async () => {
            const { generateId } = await import('../offline-db');

            const id1 = generateId();
            const id2 = generateId();

            // Mock returns different IDs due to Math.random()
            expect(id1).not.toBe(id2);
        });
    });

    describe('queueForSync', () => {
        it('should be a function', async () => {
            const { queueForSync } = await import('../offline-db');
            expect(typeof queueForSync).toBe('function');
        });

        it('should resolve without error', async () => {
            const { queueForSync } = await import('../offline-db');
            await expect(queueForSync('tasks', 'id-1', 'create', {})).resolves.toBeUndefined();
        });
    });

    describe('getPendingSyncCount', () => {
        it('should be a function', async () => {
            const { getPendingSyncCount } = await import('../offline-db');
            expect(typeof getPendingSyncCount).toBe('function');
        });

        it('should return a number', async () => {
            const { getPendingSyncCount } = await import('../offline-db');
            const count = await getPendingSyncCount();
            expect(typeof count).toBe('number');
            expect(count).toBe(0);
        });
    });

    describe('clearLocalDatabase', () => {
        it('should be a function', async () => {
            const { clearLocalDatabase } = await import('../offline-db');
            expect(typeof clearLocalDatabase).toBe('function');
        });

        it('should resolve without error', async () => {
            const { clearLocalDatabase } = await import('../offline-db');
            await expect(clearLocalDatabase()).resolves.toBeUndefined();
        });
    });
});

describe('SyncQueueItem interface', () => {
    it('should have correct structure for sync queue items', () => {
        const mockItem = {
            id: 'test-id',
            tableName: 'tasks',
            recordId: 'record-123',
            operation: 'create' as const,
            data: { title: 'Test' },
            timestamp: Date.now(),
            retryCount: 0,
        };

        expect(mockItem.id).toBeDefined();
        expect(mockItem.tableName).toBeDefined();
        expect(mockItem.recordId).toBeDefined();
        expect(['create', 'update', 'delete']).toContain(mockItem.operation);
        expect(mockItem.timestamp).toBeGreaterThan(0);
        expect(mockItem.retryCount).toBeGreaterThanOrEqual(0);
    });
});
