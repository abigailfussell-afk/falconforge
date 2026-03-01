import type { Task } from '../../types';
import { generateId, queueForSync } from '../offline-db';

export interface TaskSlice {
    tasks: Task[];
    setTasks: (tasks: Task[]) => void;
    addTask: (taskData: Omit<Task, 'id' | 'createdAt' | 'status' | 'checklist' | 'timeline'> & { status?: string, checklist?: any[] }) => string;
    updateTask: (id: string, updates: Partial<Task>) => void;
    deleteTask: (id: string) => void;
}

export const createTaskSlice = (set: any, get: any): TaskSlice => ({
    tasks: [],

    setTasks: (tasks: Task[]) => set({ tasks }),

    addTask: (taskData) => {
        const newTask: Task = {
            ...taskData,
            id: generateId(),
            createdAt: Date.now(),
            status: (taskData.status as any) || 'Backlog',
            checklist: taskData.checklist || [],
            timeline: [{
                id: generateId(),
                type: 'history',
                authorId: 'System',
                content: 'Task created',
                timestamp: Date.now()
            }]
        };

        set((state: any) => ({
            tasks: [...state.tasks, newTask]
        }));
        queueForSync('tasks', newTask.id, 'create', newTask).catch(console.error);

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
            queueForSync('tasks', id, 'update', task).catch(console.error);
        }
    },

    deleteTask: (id) => {
        set((state: any) => ({
            tasks: state.tasks.filter((task: Task) => task.id !== id)
        }));
        queueForSync('tasks', id, 'delete', { id }).catch(console.error);
    }
});
