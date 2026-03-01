import React from 'react';
import { Task, TaskType } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';

interface SprintBoardProps {
    tasks: Task[];
    collapsedColumns: Record<string, boolean>;
    toggleColumn: (status: string) => void;
    openTask: (task: Task) => void;
    getSubTeamName: (id: string) => string;
    getInitials: (id: string) => string;
}

const SprintBoard: React.FC<SprintBoardProps> = ({
    tasks,
    collapsedColumns,
    toggleColumn,
    openTask,
    getSubTeamName,
    getInitials
}) => {
    return (
        <div className="flex flex-col md:flex-row gap-4 h-full md:pb-4 overflow-y-auto md:overflow-x-auto">
            {STATUS_COLUMNS.map(status => {
                const isCollapsed = collapsedColumns[status];
                return (
                    <div
                        key={status}
                        className={`bg-slate-100 dark:bg-slate-800 rounded-xl flex flex-col flex-shrink-0 transition-all ${isCollapsed ? 'md:w-12 h-auto' : 'md:w-[280px] md:h-full'}`}
                    >
                        <div
                            className="p-3 font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center cursor-pointer md:cursor-default"
                            onClick={() => { if (window.innerWidth < 768) toggleColumn(status); }}
                        >
                            <div className="flex items-center gap-2">
                                <span className="md:hidden">
                                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                </span>
                                <span className={isCollapsed ? "md:hidden" : ""}>{status}</span>
                            </div>
                            <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs px-2 py-1 rounded-full">
                                {tasks.filter(t => t.status === status).length}
                            </span>
                        </div>

                        <div className={`flex-1 overflow-y-auto p-2 space-y-2 transition-all ${isCollapsed ? 'hidden' : 'block'} min-h-[50px] md:min-h-0`}>
                            {tasks.filter(t => t.status === status).map(task => (
                                <div
                                    key={task.id}
                                    onClick={() => openTask(task)}
                                    className="bg-white dark:bg-slate-700 p-3 rounded-lg shadow-sm border border-slate-200 dark:border-slate-600 cursor-pointer hover:shadow-md transition group relative"
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                                            {task.type}
                                        </span>
                                        <div className="text-xs text-slate-400 dark:text-slate-500">{new Date(task.createdAt).toLocaleDateString()}</div>
                                    </div>
                                    <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-1">{task.title || 'Untitled'}</h4>
                                    <div className="flex items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400">
                                        <span className="bg-slate-100 dark:bg-slate-600 px-1.5 py-0.5 rounded">{getSubTeamName(task.department)}</span>
                                        {task.dueDate && <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400"><Clock size={10} />{new Date(task.dueDate).toLocaleDateString()}</span>}
                                        <div className="flex-1"></div>
                                        {task.assignedTo && (
                                            <div className="w-6 h-6 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400 flex items-center justify-center font-bold text-[10px] border border-orange-200 dark:border-orange-800">
                                                {getInitials(task.assignedTo)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default SprintBoard;
