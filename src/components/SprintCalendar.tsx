import React from 'react';
import { Calendar } from 'lucide-react';
import { Task } from '../types';
import EmptyState from './ui/EmptyState';
import { dateOnlyDay, dateOnlyMonthShort } from '../lib/date-only';

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
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 h-full flex flex-col">
            <h3 className="font-bold text-lg mb-3 text-slate-800 dark:text-white">Upcoming Deadlines</h3>
            {tasksByDate.length === 0 ? (
                <EmptyState
                    icon={Calendar}
                    title="No deadlines this sprint"
                    body="Tasks with due dates appear here."
                />
            ) : (
                <div className="flex-1 scroll-region-thin space-y-1.5">
                    {tasksByDate.map(task => (
                        <button
                            key={task.id}
                            type="button"
                            onClick={() => openTask(task)}
                            className="w-full text-left flex items-center gap-3 px-3 py-2 border border-slate-100 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                        >
                            <div className="bg-forge-100 dark:bg-forge-900/30 text-forge-600 dark:text-forge-400 p-3 rounded-lg flex flex-col items-center min-w-16">
                                <span className="text-2xs uppercase font-bold">{dateOnlyMonthShort(task.dueDate!)}</span>
                                <span className="text-xl font-bold">{dateOnlyDay(task.dueDate!)}</span>
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-slate-800 dark:text-white">{task.title}</h4>
                                <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{task.status}</span>
                                    <span>•</span>
                                    <span>{getMemberName(task.assignedTo)}</span>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SprintCalendar;
