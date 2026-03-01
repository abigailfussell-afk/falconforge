import React from 'react';
import { Task, TaskStatus } from '../types';
import { Archive, RotateCcw } from 'lucide-react';

interface SprintArchivedProps {
    tasks: Task[];
    openTask: (task: Task) => void;
    getSubTeamName: (id: string) => string;
    getMemberName: (id: string) => string;
    restoreTask: (id: string) => void;
}

const SprintArchived: React.FC<SprintArchivedProps> = ({
    tasks,
    openTask,
    getSubTeamName,
    getMemberName,
    restoreTask
}) => {
    const archivedTasks = tasks
        .filter(t => t.status === TaskStatus.Archived)
        .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
            <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white flex items-center gap-2">
                <Archive size={20} className="text-slate-500" />
                Archived Tasks
            </h3>
            {archivedTasks.length === 0 ? (
                <div className="text-center text-slate-400 py-10">No archived tasks yet. Complete tasks and archive them when done.</div>
            ) : (
                <div className="space-y-3">
                    {archivedTasks.map(task => (
                        <div
                            key={task.id}
                            className="flex items-center gap-4 p-4 border border-slate-100 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-700/30 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                            onClick={() => openTask(task)}
                        >
                            <div className="flex-1 min-w-0">
                                <h4 className="font-medium text-slate-800 dark:text-white truncate">{task.title}</h4>
                                <div className="flex gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    <span className="bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">{getSubTeamName(task.department)}</span>
                                    <span>•</span>
                                    <span>{getMemberName(task.assignedTo)}</span>
                                    {task.archivedAt && (
                                        <>
                                            <span>•</span>
                                            <span>Archived {new Date(task.archivedAt).toLocaleDateString()}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); restoreTask(task.id); }}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-orange-600 dark:text-orange-400 border border-orange-300 dark:border-orange-700 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                            >
                                <RotateCcw size={14} />
                                Restore
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SprintArchived;
