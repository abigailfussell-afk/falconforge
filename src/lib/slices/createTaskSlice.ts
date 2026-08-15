import type { Task } from '../../types';
import { generateId, queueForSync } from '../offline-db';

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

export const createTaskSlice = (set: any, get: any): TaskSlice => ({
    tasks: [],

    setTasks: (tasks: Task[]) => set({ tasks }),

    addTask: (taskData) => {
        const state = get();
        if (!state.currentSeasonId) {
            console.warn('[store] addTask ignored: no season is selected');
            return null;
        }
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
        set((state: any) => ({
            tasks: state.tasks.map((task: Task) =>
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
        set((state: any) => ({
            tasks: state.tasks.filter((task: Task) => task.id !== id)
        }));
        queueForSync('tasks', id, 'delete', { id }).catch(console.error);
    }
});
