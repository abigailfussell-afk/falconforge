import React from 'react';
import { Task, TaskType } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import { formatDateOnly } from '../lib/date-only';

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
    /*
     * DENSITY IS THE FEATURE HERE, NOT THE POLISH.
     *
     * This board is read standing up, on a phone, in a pit, between matches. The old card
     * spent 12px of padding, a 12px gap between cards and a 12px gap between the title and
     * the meta row, so about two and a half cards fitted on a 375px screen — and the blanket
     * `@media (pointer: coarse)` rule in index.css was forcing the sub-team chip and the date
     * to 44px wide on top of that, because their class lists contained `px-`. Tightened to
     * roughly four and a half cards with nothing removed from them.
     */
    return (
        <div className="flex flex-col md:flex-row gap-2.5 h-full md:pb-2 overflow-y-auto md:overflow-x-auto">
            {STATUS_COLUMNS.map(status => {
                const isCollapsed = collapsedColumns[status];
                const columnTasks = tasks.filter(t => t.status === status);
                return (
                    <div
                        key={status}
                        className={`bg-slate-100 dark:bg-slate-800 rounded-xl flex flex-col shrink-0 transition-all ${isCollapsed ? 'md:w-11 h-auto' : 'md:w-64 md:h-full'}`}
                    >
                        <button
                            className="px-2.5 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center w-full md:cursor-default text-left"
                            onClick={() => { if (window.innerWidth < 768) toggleColumn(status); }}
                            aria-expanded={!isCollapsed}
                        >
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="md:hidden shrink-0">
                                    {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                </span>
                                <span className={`truncate ${isCollapsed ? 'md:hidden' : ''}`}>{status}</span>
                            </span>
                            <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-2xs font-bold px-1.5 py-0.5 rounded-full tabular-nums shrink-0">
                                {columnTasks.length}
                            </span>
                        </button>

                        <div className={`flex-1 scroll-region-thin p-1.5 space-y-1.5 ${isCollapsed ? 'hidden' : 'block'} min-h-12 md:min-h-0`}>
                            {columnTasks.map(task => (
                                <button
                                    key={task.id}
                                    data-testid="task-card"
                                    onClick={() => openTask(task)}
                                    className="w-full text-left bg-white dark:bg-slate-700 p-2 rounded-lg shadow-card border border-slate-200 dark:border-slate-600 hover:shadow-raised hover:border-forge-300 dark:hover:border-forge-600 transition-all"
                                >
                                    <div className="flex justify-between items-start gap-2 mb-1">
                                        <span className={`text-2xs uppercase font-bold px-1.5 py-px rounded ${task.type === TaskType.Bug ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                                            {task.type}
                                        </span>
                                        <span className="text-2xs text-slate-400 dark:text-slate-300 shrink-0 tabular-nums">{new Date(task.createdAt).toLocaleDateString()}</span>
                                    </div>
                                    <h4 className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-snug">{task.title || 'Untitled'}</h4>
                                    <div className="flex items-center gap-1.5 mt-1.5 text-2xs text-slate-500 dark:text-slate-400">
                                        <span className="bg-slate-100 dark:bg-slate-600 px-1.5 py-px rounded truncate">{getSubTeamName(task.department)}</span>
                                        {task.dueDate && <span className="flex items-center gap-0.5 text-forge-600 dark:text-forge-400 shrink-0 tabular-nums"><Clock size={10} />{formatDateOnly(task.dueDate)}</span>}
                                        <span className="flex-1" />
                                        {task.assignedTo && (
                                            <span className="w-5 h-5 rounded-full bg-forge-100 dark:bg-forge-900 text-forge-600 dark:text-forge-400 flex items-center justify-center font-bold text-2xs border border-forge-200 dark:border-forge-800 shrink-0">
                                                {getInitials(task.assignedTo)}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default SprintBoard;
