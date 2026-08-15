/**
 * Store → Sync Queue Integration Tests
 *
 * These tests verify that store actions correctly queue items for sync.
 * Uses real IndexedDB (via fake-indexeddb) and the real Zustand store. No Supabase mock:
 * the store no longer talks to the server at all — reads go through `server-pull.ts` and
 * writes go onto the queue, which is exactly what is under test here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, selectChecklist } from '../store';
import { db } from '../offline-db';

/** Store actions queue without awaiting; give the Dexie transaction time to commit. */
const waitForAsync = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Store → Sync Queue Integration', () => {
    beforeEach(() => {
        // Reset store state
        useAppStore.setState({
            currentTeamId: 'test-team-123',
            currentSeasonId: 'test-season-456',
            tasks: [],
            scoutingReports: [],
            checklistsBySeason: {},
            matchPlans: [],
            subTeams: [],
            teamMembers: [],
            seasons: [],
        });
    });

    describe('Task Actions', () => {
        it('addTask queues item for sync with correct structure', async () => {
            const store = useAppStore.getState();

            store.addTask({
                title: 'Integration Test Task',
                description: 'Testing sync queue',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                tags: ['urgent', 'test'],
                department: 'programming',
                checklist: [{ id: 'item-1', text: 'Sub-task', completed: false }],
            });

            // Wait for async queueForSync operation
            await waitForAsync(150);

            // Verify item was added to store
            const tasks = useAppStore.getState().tasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0].title).toBe('Integration Test Task');

            // Verify item was queued for sync
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('tasks');
            expect(queueItems[0].operation).toBe('create');
            expect(queueItems[0].recordId).toBe(tasks[0].id);

            // Verify queue item contains teamId
            expect(queueItems[0].data.teamId).toBe('test-team-123');
            expect(queueItems[0].data.seasonId).toBe('test-season-456');
        });

        it('updateTask queues update operation', async () => {
            const store = useAppStore.getState();

            // First add a task
            store.addTask({
                title: 'Original Title',
                description: 'Original Description',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                department: 'build',
                tags: [],
                checklist: [],
            });

            await waitForAsync(150);
            const taskId = useAppStore.getState().tasks[0].id;

            // Clear queue to test update separately
            await db.syncQueue.clear();

            // Update the task
            store.updateTask(taskId, {
                title: 'Updated Title',
                status: 'In Progress',
            });

            await waitForAsync(150);

            // Verify store was updated
            const updatedTask = useAppStore.getState().tasks.find(t => t.id === taskId);
            expect(updatedTask?.title).toBe('Updated Title');
            expect(updatedTask?.status).toBe('In Progress');

            // Verify update was queued
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('tasks');
            expect(queueItems[0].operation).toBe('update');
            expect(queueItems[0].data.title).toBe('Updated Title');
        });

        it('deleteTask queues delete operation', async () => {
            const store = useAppStore.getState();

            // Add a task first
            store.addTask({
                title: 'Task to Delete',
                description: 'Will be deleted',
                status: 'To Do',
                type: 'Bug',
                assignedTo: 'member-1',
                department: 'build',
                tags: [],
                checklist: [],
            });

            await waitForAsync(150);
            const taskId = useAppStore.getState().tasks[0].id;

            // Clear queue to test delete separately
            await db.syncQueue.clear();

            // Delete the task
            store.deleteTask(taskId);

            await waitForAsync(150);

            // Verify task removed from store
            expect(useAppStore.getState().tasks).toHaveLength(0);

            // Verify delete was queued
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('tasks');
            expect(queueItems[0].operation).toBe('delete');
            expect(queueItems[0].recordId).toBe(taskId);
        });
    });

    describe('Scouting Report Actions', () => {
        it('addScoutingReport queues item for sync', async () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 5,
                hasAutonomous: true,
                autoScore: 30,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 15,
                shotsMissed: 3,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great autonomous, good scoring',
            });

            await waitForAsync(150);

            // Verify added to store
            const reports = useAppStore.getState().scoutingReports;
            expect(reports).toHaveLength(1);
            expect(reports[0].teamNumber).toBe('12345');

            // Verify queued for sync
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('scouting_reports');
            expect(queueItems[0].operation).toBe('create');
            expect(queueItems[0].data.teamId).toBe('test-team-123');
        });

        it('deleteScoutingReport queues delete operation', async () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: false,
                autoScore: 0,
                intakeType: 'No Intake',
                autoAim: false,
                farShooting: false,
                shotsTaken: 0,
                shotsMissed: 0,
                parking: 'No Park',
                rating: 2,
                endGameNotes: '',
            });

            await waitForAsync(150);
            const reportId = useAppStore.getState().scoutingReports[0].id;

            await db.syncQueue.clear();

            store.deleteScoutingReport(reportId);

            await waitForAsync(150);

            expect(useAppStore.getState().scoutingReports).toHaveLength(0);

            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].operation).toBe('delete');
        });
    });

    describe('Checklist Actions', () => {
        it('addChecklistItem queues item for sync', async () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Check battery voltage');

            await waitForAsync(150);

            const checklist = selectChecklist(useAppStore.getState());
            expect(checklist.length).toBeGreaterThan(0);

            // Find the newly added item
            const newItem = checklist.find(item => item.text === 'Check battery voltage');
            expect(newItem).toBeDefined();
            expect(newItem?.checked).toBe(false);

            // Verify queued for sync
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems.length).toBeGreaterThan(0);

            const checklistQueue = queueItems.find(q => q.tableName === 'checklists');
            expect(checklistQueue).toBeDefined();
        });

        it('toggleChecklistItem queues update', async () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Toggle this item');

            await waitForAsync(150);

            const itemId = selectChecklist(useAppStore.getState()).find(
                item => item.text === 'Toggle this item'
            )?.id;

            expect(itemId).toBeDefined();

            await db.syncQueue.clear();

            store.toggleChecklistItem(itemId!);

            await waitForAsync(150);

            const toggledItem = selectChecklist(useAppStore.getState()).find(item => item.id === itemId);
            expect(toggledItem?.checked).toBe(true);

            const queueItems = await db.syncQueue.toArray();
            expect(queueItems.length).toBeGreaterThan(0);
        });
    });

    describe('Season Actions', () => {
        it('addSeason queues item for sync', async () => {
            const store = useAppStore.getState();

            store.addSeason('Centerstage 2023-2024');

            await waitForAsync(150);

            const seasons = useAppStore.getState().seasons;
            expect(seasons).toHaveLength(1);
            expect(seasons[0].name).toBe('Centerstage 2023-2024');

            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('seasons');
            expect(queueItems[0].operation).toBe('create');
            expect(queueItems[0].data.name).toBe('Centerstage 2023-2024');
        });

        it('updateSeason queues update operation', async () => {
            const store = useAppStore.getState();

            store.addSeason('Test Season');
            await waitForAsync(150);
            
            const seasonId = useAppStore.getState().seasons[0].id;
            await db.syncQueue.clear();

            store.updateSeason(seasonId, { name: 'Updated Season' });
            await waitForAsync(150);

            const updatedSeason = useAppStore.getState().seasons.find(s => s.id === seasonId);
            expect(updatedSeason?.name).toBe('Updated Season');

            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('seasons');
            expect(queueItems[0].operation).toBe('update');
        });

        it('deleteSeason queues delete operation', async () => {
            const store = useAppStore.getState();

            store.addSeason('Delete Me Season');
            await waitForAsync(150);
            
            const seasonId = useAppStore.getState().seasons[0].id;
            await db.syncQueue.clear();

            store.deleteSeason(seasonId);
            await waitForAsync(150);

            expect(useAppStore.getState().seasons).toHaveLength(0);

            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(1);
            expect(queueItems[0].tableName).toBe('seasons');
            expect(queueItems[0].operation).toBe('delete');
        });
    });

    describe('Multiple Operations', () => {
        it('multiple operations queue multiple items', async () => {
            const store = useAppStore.getState();

            // Add multiple items
            store.addTask({
                title: 'Task 1',
                description: 'First task',
                status: 'To Do',
                type: 'Feature',
                assignedTo: '',
                department: 'build',
                tags: [],
                checklist: [],
            });

            store.addTask({
                title: 'Task 2',
                description: 'Second task',
                status: 'To Do',
                type: 'Bug',
                assignedTo: '',
                department: 'programming',
                tags: [],
                checklist: [],
            });

            store.addScoutingReport({
                teamNumber: '99999',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Human Player',
                autoAim: false,
                farShooting: true,
                shotsTaken: 10,
                shotsMissed: 5,
                parking: 'Partial Park',
                rating: 3,
                endGameNotes: 'Test',
            });

            await waitForAsync(200);

            // Verify all items in store
            expect(useAppStore.getState().tasks).toHaveLength(2);
            expect(useAppStore.getState().scoutingReports).toHaveLength(1);

            // Verify all items queued
            const queueItems = await db.syncQueue.toArray();
            expect(queueItems).toHaveLength(3);

            const taskQueues = queueItems.filter(q => q.tableName === 'tasks');
            const reportQueues = queueItems.filter(q => q.tableName === 'scouting_reports');

            expect(taskQueues).toHaveLength(2);
            expect(reportQueues).toHaveLength(1);
        });
    });
});
