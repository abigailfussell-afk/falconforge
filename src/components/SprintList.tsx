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
                        <th className="p-4">Title</th>
                        <th className="p-4">Type</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Assigned</th>
                        <th className="p-4">Due Date</th>
                        <th className="p-4">Created</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {tasks.map(task => (
                        <tr key={task.id} onClick={() => openTask(task)} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition">
                            <td className="p-4 font-medium text-slate-900 dark:text-white">{task.title || 'Untitled'}</td>
                            <td className="p-4"><span className={`text-2xs uppercase font-bold px-2 py-0.5 rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>{task.type}</span></td>
                            <td className="p-4">{task.status}</td>
                            <td className="p-4">{getMemberName(task.assignedTo)}</td>
                            <td className="p-4">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '-'}</td>
                            <td className="p-4 text-slate-400">{new Date(task.createdAt).toLocaleDateString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default SprintList;
