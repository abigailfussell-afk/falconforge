import type { Task } from '../../types';
import { generateId, queueForSync } from '../offline-db';
import { canWriteToSeason } from '../season-rules';
import type { SliceCreator } from './types';

export interface TaskSlice {
    tasks: Task[];
    setTasks: (tasks: Task[]) => void;
    /**
     * Create a task in the CURRENT season.
     *
     * `seasonId` is not a parameter — it comes from the store, because a task belonging to
     * a season other than the one on screen is not a thing the UI can express. Returns null
     * when there is no current season: `tasks.season_id` is NOT NULL with a composite
     * foreign key, so a task created without one could never be pushed, and creating it
     * locally anyway is how you get a board full of records that silently never sync.
     */
    addTask: (taskData: Omit<Task, 'id' | 'createdAt' | 'status' | 'checklist' | 'timeline' | 'seasonId'> & { status?: string, checklist?: any[] }) => string | null;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;
}

export const taskInitialState = {
    tasks: [] as Task[],
};

export const createTaskSlice: SliceCreator<TaskSlice> = (set, get) => ({
    ...taskInitialState,

    setTasks: (tasks: Task[]) => set({ tasks }),

    addTask: (taskData) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addTask ignored: no season is selected');
            return null;
        }
        // A prior season is read-only (Sprint 4). `season_is_open` refuses this INSERT
        // server-side, so creating the card locally would put a task on the board that can
        // never sync — the silent-write failure this guard exists to avoid.
        if (!canWriteToSeason(state.seasons, state.currentSeasonId, 'addTask')) return null;

        const newTask: Task = {
            ...taskData,
            id: generateId(),
            createdAt: Date.now(),
            status: (taskData.status as any) || 'Backlog',
            checklist: taskData.checklist || [],
            seasonId: state.currentSeasonId,
            timeline: [{
                id: generateId(),
                type: 'history',
                authorId: 'System',
                content: 'Task created',
                timestamp: Date.now()
            }]
        };

        set((s: any) => ({
            tasks: [...s.tasks, newTask]
        }));
        queueForSync('tasks', newTask.id, 'create', {
            ...newTask,
            teamId: state.currentTeamId
        }).catch(console.error);

        return newTask.id;
    },

    updateTask: (id, updates) => {
        const state = get();
        // The TASK's season, not the one on screen. Editing last year's task is editing
        // last year's task whichever season the picker happens to be showing.
        const existing = state.tasks.find((t: Task) => t.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'updateTask')) return;

        set((s: any) => ({
            tasks: s.tasks.map((task: Task) =>
                task.id === id ? { ...task, ...updates } : task
            )
        }));

        const task = get().tasks.find((t: Task) => t.id === id);
        if (task) {
            queueForSync('tasks', id, 'update', {
                ...task,
                teamId: get().currentTeamId
            }).catch(console.error);
        }
    },

    deleteTask: (id) => {
        const state = get();
        const existing = state.tasks.find((t: Task) => t.id === id);
        if (existing && !canWriteToSeason(state.seasons, existing.seasonId, 'deleteTask')) return;

        set((s: any) => ({
            tasks: s.tasks.filter((task: Task) => task.id !== id)
        }));
        queueForSync('tasks', id, 'delete', { id }).catch(console.error);
    }
});
