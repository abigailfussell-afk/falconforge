import React from 'react';
import { Task, TaskType } from '../types';

interface SprintListProps {
    tasks: Task[];
    openTask: (task: Task) => void;
    getMemberName: (id: string) => string;
}

const SprintList: React.FC<SprintListProps> = ({ tasks, openTask, getMemberName }) => {
    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 dark:text-slate-300 min-w-table">
                <thead className="bg-slate-50 dark:bg-slate-700 text-xs uppercase font-bold text-slate-500 dark:text-slate-400">
                    <tr>
                        <th className="px-3 py-2">Title</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Assigned</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2">Created</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {tasks.map(task => (
                        <tr
                            key={task.id}
                            onClick={() => openTask(task)}
                            // A table row cannot be a <button>, so it carries the button semantics
                            // itself: tabbable, Enter/Space-activatable.
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openTask(task);
                                }
                            }}
                            className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors"
                        >
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{task.title || 'Untitled'}</td>
                            <td className="px-3 py-2"><span className={`text-2xs uppercase font-bold px-2 py-0.5 rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{task.type}</span></td>
                            <td className="px-3 py-2">{task.status}</td>
                            <td className="px-3 py-2">{getMemberName(task.assignedTo)}</td>
                            <td className="px-3 py-2">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}</td>
                            <td className="px-3 py-2 text-slate-400">{new Date(task.createdAt).toLocaleDateString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default SprintList;
