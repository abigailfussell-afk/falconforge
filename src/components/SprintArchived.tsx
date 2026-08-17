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
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-6 overflow-y-auto">
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
                            className="flex items-center gap-4 p-4 border border-slate-100 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-700/30 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition"
                        >
                            {/*
                             * The row summary is a real button, not a clickable div.
                             *
                             * Restore is a nested control, so the row itself cannot be the
                             * button — hence a focusable summary beside it. Opening an
                             * archived task was keyboard-unreachable until Sprint 8's
                             * retrospective; Sprint 5.5 fixed four rows of exactly this shape
                             * and did not reach this one. See docs/failure-modes.md §12.
                             */}
                            <button
                                type="button"
                                onClick={() => openTask(task)}
                                className="flex-1 min-w-0 text-left cursor-pointer rounded"
                            >
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
                            </button>
                            <button
                                type="button"
                                onClick={() => restoreTask(task.id)}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-forge-600 dark:text-forge-400 border border-forge-300 dark:border-forge-700 rounded-lg hover:bg-forge-50 dark:hover:bg-forge-900/20 transition"
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
