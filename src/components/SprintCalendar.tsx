import React from 'react';
import { Task } from '../types';

interface SprintCalendarProps {
    tasks: Task[];
    openTask: (task: Task) => void;
    getMemberName: (id: string) => string;
}

const SprintCalendar: React.FC<SprintCalendarProps> = ({ tasks, openTask, getMemberName }) => {
    const tasksByDate = tasks
        .filter(t => t.dueDate)
        .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0));

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
            <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white">Upcoming Deadlines</h3>
            {tasksByDate.length === 0 ? (
                <div className="text-center text-slate-400 py-10">No tasks with due dates found.</div>
            ) : (
                <div className="space-y-6">
                    {tasksByDate.map(task => (
                        <div key={task.id} onClick={() => openTask(task)} className="flex items-center gap-4 p-4 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition">
                            <div className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 p-3 rounded-lg flex flex-col items-center min-w-[60px]">
                                <span className="text-xs uppercase font-bold">{new Date(task.dueDate!).toLocaleString('default', { month: 'short' })}</span>
                                <span className="text-xl font-bold">{new Date(task.dueDate!).getDate()}</span>
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-slate-800 dark:text-white">{task.title}</h4>
                                <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{task.status}</span>
                                    <span>•</span>
                                    <span>{getMemberName(task.assignedTo)}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SprintCalendar;
