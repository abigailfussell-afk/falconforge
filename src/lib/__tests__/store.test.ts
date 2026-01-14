import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store';

describe('AppStore', () => {
    beforeEach(() => {
        // Reset store to initial state before each test
        useAppStore.setState({
            tasks: [],
            checklist: [],
            scoutingReports: [],
            theme: 'dark',
        });
    });

    describe('Tasks', () => {
        it('should add a task', () => {
            const store = useAppStore.getState();

            store.addTask({
                title: 'Test Task',
                description: 'Test Description',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                department: 'programming',
                tags: ['urgent'],
                checklist: [],
            });

            const tasks = useAppStore.getState().tasks;
            expect(tasks).toHaveLength(1);
            expect(tasks[0].title).toBe('Test Task');
            expect(tasks[0].status).toBe('To Do');
        });

        it('should update a task', () => {
            const store = useAppStore.getState();

            // Add a task first
            store.addTask({
                title: 'Original Title',
                description: 'Original Description',
                status: 'To Do',
                type: 'Feature',
                assignedTo: 'member-1',
                department: 'programming',
                tags: [],
                checklist: [],
            });

            const taskId = useAppStore.getState().tasks[0].id;

            // Update the task
            store.updateTask(taskId, { title: 'Updated Title', status: 'In Progress' });

            const updatedTask = useAppStore.getState().tasks.find(t => t.id === taskId);
            expect(updatedTask?.title).toBe('Updated Title');
            expect(updatedTask?.status).toBe('In Progress');
        });

        it('should delete a task', () => {
            const store = useAppStore.getState();

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

            const taskId = useAppStore.getState().tasks[0].id;
            expect(useAppStore.getState().tasks).toHaveLength(1);

            store.deleteTask(taskId);
            expect(useAppStore.getState().tasks).toHaveLength(0);
        });
    });

    describe('Checklist', () => {
        it('should add a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('New checklist item');

            const checklist = useAppStore.getState().checklist;
            expect(checklist).toHaveLength(1);
            expect(checklist[0].text).toBe('New checklist item');
            expect(checklist[0].checked).toBe(false);
        });

        it('should toggle a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Toggle me');
            const itemId = useAppStore.getState().checklist[0].id;

            // Toggle to checked
            store.toggleChecklistItem(itemId);
            expect(useAppStore.getState().checklist[0].checked).toBe(true);

            // Toggle back to unchecked
            store.toggleChecklistItem(itemId);
            expect(useAppStore.getState().checklist[0].checked).toBe(false);
        });

        it('should delete a checklist item', () => {
            const store = useAppStore.getState();

            store.addChecklistItem('Delete me');
            const itemId = useAppStore.getState().checklist[0].id;
            expect(useAppStore.getState().checklist).toHaveLength(1);

            store.deleteChecklistItem(itemId);
            expect(useAppStore.getState().checklist).toHaveLength(0);
        });
    });

    describe('Theme', () => {
        it('should set theme to light', () => {
            const store = useAppStore.getState();

            store.setTheme('light');
            expect(useAppStore.getState().theme).toBe('light');
        });

        it('should set theme to dark', () => {
            const store = useAppStore.getState();

            store.setTheme('dark');
            expect(useAppStore.getState().theme).toBe('dark');
        });
    });

    describe('Scouting Reports', () => {
        it('should add a scouting report', () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great match!',
            });

            const reports = useAppStore.getState().scoutingReports;
            expect(reports).toHaveLength(1);
            expect(reports[0].teamNumber).toBe('12345');
            expect(reports[0].rating).toBe(4);
        });

        it('should delete a scouting report', () => {
            const store = useAppStore.getState();

            store.addScoutingReport({
                teamNumber: '12345',
                matchNumber: 1,
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great match!',
            });

            const reportId = useAppStore.getState().scoutingReports[0].id;
            store.deleteScoutingReport(reportId);
            expect(useAppStore.getState().scoutingReports).toHaveLength(0);
        });
    });
});
