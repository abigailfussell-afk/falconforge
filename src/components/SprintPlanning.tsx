import React, { useState, useRef, useEffect } from 'react';
import { Task, TaskStatus, TaskType, SubTeam, TeamMember, TimelineEvent } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { Plus, Calendar as CalendarIcon, List, Layout, Send, Trash2, X, Archive } from 'lucide-react';
import { useCurrentUser } from '../lib/user-context';
import { useAppStore } from '../lib/store';
import { useTasksQuery } from '../lib/queries';
import SprintBoard from './SprintBoard';
import SprintList from './SprintList';
import SprintCalendar from './SprintCalendar';
import SprintArchived from './SprintArchived';


interface SprintPlanningProps {
    tasks: Task[];
    setTasks: React.Dispatch<React.SetStateAction<Task[]>>; // Kept for backward compat but now unused
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
}

const SprintPlanning: React.FC<SprintPlanningProps> = ({ tasks, teamMembers, subTeams }) => {
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isNewTask, setIsNewTask] = useState(false);
    const [view, setView] = useState<'board' | 'list' | 'calendar' | 'archived'>('board');
    const [newComment, setNewComment] = useState('');
    const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const newChecklistRef = useRef<HTMLInputElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    // Use store's sync-enabled functions
    const storeAddTask = useAppStore((state) => state.addTask);
    const storeUpdateTask = useAppStore((state) => state.updateTask);
    const storeDeleteTask = useAppStore((state) => state.deleteTask);
    const currentTeamId = useAppStore((state) => state.currentTeamId);

    // Background refresh — fetches latest tasks when this page is visited
    useTasksQuery(currentTeamId);

    // Get current logged-in user for comments
    const { currentUser, displayName, initials: userInitials } = useCurrentUser();

    // Auto-focus title input when creating new task
    useEffect(() => {
        if (isModalOpen && isNewTask && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [isModalOpen, isNewTask]);

    // Helper to get display name for a TeamMember
    const getMemberDisplayName = (member: TeamMember): string => {
        if (member.fullName) return member.fullName;
        return member.email.split('@')[0];
    };

    // Helper to get initials for a TeamMember
    const getMemberInitials = (member: TeamMember): string => {
        if (member.fullName) {
            const parts = member.fullName.trim().split(/\s+/);
            if (parts.length >= 2) {
                return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
            }
            return parts[0]?.substring(0, 2).toUpperCase() || '?';
        }
        return member.email.substring(0, 2).toUpperCase();
    };

    const getMemberName = (id: string) => {
        const m = teamMembers.find(mem => mem.id === id);
        return m ? getMemberDisplayName(m) : 'Unassigned';
    };

    const getSubTeamName = (id: string) => {
        const t = subTeams.find(team => team.id === id);
        return t ? t.name : 'General';
    };

    const getInitials = (id: string) => {
        const m = teamMembers.find(mem => mem.id === id);
        return m ? getMemberInitials(m) : '?';
    };

    const openTask = (task: Task) => {
        setActiveTask(task);
        setIsNewTask(false);
        setIsModalOpen(true);
    };

    const createNewTask = () => {
        const newTask: Task = {
            id: Date.now().toString(),
            title: 'New Task',
            description: '',
            status: TaskStatus.Backlog,
            type: TaskType.Feature,
            assignedTo: teamMembers[0]?.id || '',
            department: subTeams[0]?.id || '',
            tags: [],
            checklist: [],
            timeline: [],
            createdAt: Date.now()
        };
        setActiveTask(newTask);
        setIsNewTask(true);
        setIsModalOpen(true);
    };

    const saveTask = () => {
        if (!activeTask) return;

        const originalTask = tasks.find(t => t.id === activeTask.id);
        let updatedTask = { ...activeTask };

        // Add status change timeline event
        if (!isNewTask && originalTask && originalTask.status !== activeTask.status) {
            const statusEvent: TimelineEvent = {
                id: Date.now().toString(),
                type: 'history',
                authorId: currentUser?.id || 'System',
                content: `moved to ${activeTask.status}`,
                timestamp: Date.now()
            };
            updatedTask.timeline = [statusEvent, ...updatedTask.timeline];
        }

        if (isNewTask) {
            // Use store's addTask which includes sync
            storeAddTask({
                title: updatedTask.title,
                description: updatedTask.description,
                status: updatedTask.status as any,
                type: updatedTask.type,
                assignedTo: updatedTask.assignedTo,
                department: updatedTask.department,
                tags: updatedTask.tags,
                checklist: updatedTask.checklist,
                dueDate: updatedTask.dueDate,
            });
        } else {
            // Use store's updateTask which includes sync
            storeUpdateTask(updatedTask.id, updatedTask as any);
        }
        setIsModalOpen(false);
    };

    const addComment = () => {
        if (!newComment.trim() || !activeTask) return;
        const comment: TimelineEvent = {
            id: Date.now().toString(),
            type: 'comment',
            authorId: currentUser?.id || 'guest',
            content: newComment,
            timestamp: Date.now()
        };
        const updatedTask = {
            ...activeTask,
            timeline: [comment, ...activeTask.timeline]
        };
        setActiveTask(updatedTask);
        // Save comment immediately via store
        if (!isNewTask) {
            storeUpdateTask(updatedTask.id, { timeline: updatedTask.timeline });
        }
        setNewComment('');
    };

    const deleteComment = (commentId: string) => {
        if (!activeTask) return;
        const updatedTimeline = activeTask.timeline.filter(t => t.id !== commentId);
        const updatedTask = {
            ...activeTask,
            timeline: updatedTimeline
        };
        setActiveTask(updatedTask);
        // Save deletion immediately via store
        if (!isNewTask) {
            storeUpdateTask(updatedTask.id, { timeline: updatedTimeline });
        }
    };

    const deleteTask = (id: string) => {
        // Use store's deleteTask which includes sync
        storeDeleteTask(id);
        setDeleteConfirmId(null);
        setIsModalOpen(false);
    };

    const archiveTask = () => {
        if (!activeTask) return;
        // Use store's updateTask which includes sync
        storeUpdateTask(activeTask.id, {
            status: TaskStatus.Archived as any,
            archivedAt: Date.now()
        });
        setIsModalOpen(false);
    };

    const restoreTask = (id: string) => {
        // Use store's updateTask which includes sync
        storeUpdateTask(id, {
            status: TaskStatus.Done as any,
            archivedAt: undefined
        });
    };




    const toggleColumn = (status: string) => {
        setCollapsedColumns(prev => ({
            ...prev,
            [status]: !prev[status]
        }));
    }



    return (
        <div className="h-full flex flex-col">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-3 md:mb-4 md:px-4 gap-3 md:gap-4">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Sprint Planning</h2>

                <div className="flex flex-row items-center justify-between w-full md:w-auto gap-3">
                    <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 p-1 rounded-lg">
                        <button onClick={() => setView('board')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'board' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Board"><Layout size={18} /></button>
                        <button onClick={() => setView('list')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'list' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="List"><List size={18} /></button>
                        <button onClick={() => setView('calendar')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'calendar' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Calendar"><CalendarIcon size={18} /></button>
                        <button onClick={() => setView('archived')} className={`p-2 rounded-md transition flex items-center justify-center ${view === 'archived' ? 'bg-white dark:bg-slate-600 shadow text-orange-600 dark:text-orange-400' : 'text-slate-500 dark:text-slate-400'}`} title="Archived"><Archive size={18} /></button>
                    </div>

                    <button
                        onClick={createNewTask}
                        className="flex items-center justify-center gap-2 bg-orange-600 text-white px-2 md:px-4 py-2 rounded-lg hover:bg-orange-700 transition"
                    >
                        <Plus size={20} /><span className="hidden md:inline">New Item</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden md:px-4">
                {view === 'board' && (
                    <SprintBoard
                        tasks={tasks}
                        collapsedColumns={collapsedColumns}
                        toggleColumn={toggleColumn}
                        openTask={openTask}
                        getSubTeamName={getSubTeamName}
                        getInitials={getInitials}
                    />
                )}
                {view === 'list' && (
                    <SprintList
                        tasks={tasks}
                        openTask={openTask}
                        getMemberName={getMemberName}
                    />
                )}
                {view === 'calendar' && (
                    <SprintCalendar
                        tasks={tasks}
                        openTask={openTask}
                        getMemberName={getMemberName}
                    />
                )}
                {view === 'archived' && (
                    <SprintArchived
                        tasks={tasks}
                        openTask={openTask}
                        getSubTeamName={getSubTeamName}
                        getMemberName={getMemberName}
                        restoreTask={restoreTask}
                    />
                )}
            </div>

            {isModalOpen && activeTask && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                            <div className="flex-1 mr-4">
                                <input
                                    ref={titleInputRef}
                                    value={activeTask.title}
                                    onChange={(e) => setActiveTask({ ...activeTask, title: e.target.value })}
                                    placeholder="Task Title"
                                    className="text-xl font-bold bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-600 rounded-lg p-2 focus:ring-2 focus:ring-orange-500 w-full placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white"
                                />
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full flex items-center justify-center w-8 h-8">
                                <span className="sr-only">Close</span>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Type</label>
                                    <select
                                        value={activeTask.type}
                                        onChange={(e) => setActiveTask({ ...activeTask, type: e.target.value as TaskType })}
                                        className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                    >
                                        <option value={TaskType.Feature}>Feature</option>
                                        <option value={TaskType.Bug}>Bug</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Status</label>
                                    <select
                                        value={activeTask.status}
                                        onChange={(e) => setActiveTask({ ...activeTask, status: e.target.value as TaskStatus })}
                                        className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                    >
                                        {STATUS_COLUMNS.map(s => <option key={s} value={s}>{s}</option>)}
                                        {activeTask.status === TaskStatus.Archived && (
                                            <option value={TaskStatus.Archived}>Archived</option>
                                        )}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Sub-Team</label>
                                    <select
                                        value={activeTask.department}
                                        onChange={(e) => setActiveTask({ ...activeTask, department: e.target.value })}
                                        className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                    >
                                        {subTeams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assigned To</label>
                                    <select
                                        value={activeTask.assignedTo}
                                        onChange={(e) => setActiveTask({ ...activeTask, assignedTo: e.target.value })}
                                        className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                    >
                                        <option value="">Unassigned</option>
                                        {teamMembers.map(m => <option key={m.id} value={m.id}>{getMemberDisplayName(m)}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Due Date</label>
                                    <input
                                        type="date"
                                        value={activeTask.dueDate ? new Date(activeTask.dueDate).toISOString().substr(0, 10) : ''}
                                        onChange={(e) => setActiveTask({ ...activeTask, dueDate: e.target.valueAsNumber })}
                                        className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Description / Notes</label>
                                <textarea
                                    value={activeTask.description}
                                    onChange={(e) => setActiveTask({ ...activeTask, description: e.target.value })}
                                    className="w-full h-32 p-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                    placeholder="Describe the task, paste meeting minutes, or log bug details..."
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Checklist</label>
                                <div className="space-y-2">
                                    {activeTask.checklist.map((item, idx) => (
                                        <div key={idx} className="flex items-center gap-2 group">
                                            <input
                                                type="checkbox"
                                                checked={item.completed}
                                                onChange={(e) => {
                                                    const newChecklist = [...activeTask.checklist];
                                                    newChecklist[idx].completed = e.target.checked;
                                                    setActiveTask({ ...activeTask, checklist: newChecklist });
                                                }}
                                                className="w-5 h-5 rounded text-orange-600 focus:ring-orange-500 cursor-pointer mt-0.5"
                                                style={{ minWidth: '20px', minHeight: '20px' }}
                                            />
                                            <input
                                                ref={idx === activeTask.checklist.length - 1 ? newChecklistRef : null}
                                                type="text"
                                                value={item.text}
                                                placeholder="Enter checklist item..."
                                                onChange={(e) => {
                                                    const newChecklist = [...activeTask.checklist];
                                                    newChecklist[idx].text = e.target.value;
                                                    setActiveTask({ ...activeTask, checklist: newChecklist });
                                                }}
                                                className="flex-1 text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 rounded px-2 py-1 focus:ring-1 focus:ring-orange-500 text-slate-900 dark:text-white placeholder-slate-400"
                                            />
                                            <button
                                                onClick={() => {
                                                    const newChecklist = activeTask.checklist.filter((_, i) => i !== idx);
                                                    setActiveTask({ ...activeTask, checklist: newChecklist });
                                                }}
                                                className="text-slate-400 hover:text-red-500 border border-slate-300 dark:border-slate-600 hover:border-red-400 rounded p-1 transition-colors flex items-center justify-center h-8 w-8"
                                                title="Delete item"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => {
                                            setActiveTask({ ...activeTask, checklist: [...activeTask.checklist, { id: Date.now().toString(), text: '', completed: false }] });
                                            setTimeout(() => {
                                                newChecklistRef.current?.focus();
                                            }, 50);
                                        }}
                                        className="text-sm text-orange-600 dark:text-orange-400 font-medium hover:underline flex items-center gap-1"
                                    >
                                        <Plus size={14} /> Add Checklist Item
                                    </button>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 dark:border-slate-700 pt-6">
                                <h3 className="font-bold text-slate-800 dark:text-white mb-4">Activity & Comments</h3>

                                <div className="flex items-center gap-2 mb-6">
                                    <input
                                        type="text"
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        placeholder="Add a comment..."
                                        className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
                                        onKeyDown={(e) => e.key === 'Enter' && addComment()}
                                    />
                                    <button onClick={addComment} className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 flex items-center justify-center">
                                        <Send size={18} />
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {activeTask.timeline.map((event) => {
                                        // Check if author is the current logged-in user or a roster member
                                        const isCurrentUser = currentUser && event.authorId === currentUser.id;
                                        const isSystem = event.authorId === 'System';
                                        const isMember = !isCurrentUser && !isSystem && teamMembers.find(m => m.id === event.authorId);

                                        // Determine display name and initials
                                        const authorName = isSystem
                                            ? 'System'
                                            : isCurrentUser
                                                ? displayName
                                                : isMember
                                                    ? getMemberName(event.authorId)
                                                    : 'Guest';
                                        const authorInitials = isSystem
                                            ? 'S'
                                            : isCurrentUser
                                                ? userInitials
                                                : isMember
                                                    ? getInitials(event.authorId)
                                                    : 'G';

                                        return (
                                            <div key={event.id} className="flex gap-3 text-sm">
                                                <div className="mt-1 w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 flex-shrink-0">
                                                    {authorInitials}
                                                </div>
                                                <div className="flex-1 bg-slate-50 dark:bg-slate-700/50 p-3 rounded-r-lg rounded-bl-lg">
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className="font-bold text-slate-700 dark:text-slate-200">
                                                            {authorName}
                                                        </span>
                                                        <span className="text-xs text-slate-400">{new Date(event.timestamp).toLocaleDateString()}</span>
                                                    </div>
                                                    <div className={event.type === 'history' ? 'italic text-slate-500' : 'text-slate-800 dark:text-slate-300'}>
                                                        {event.content}
                                                    </div>
                                                    {event.type === 'comment' && (
                                                        <div className="flex justify-end mt-2">
                                                            <button onClick={() => deleteComment(event.id)} className="text-xs text-red-500 hover:text-red-700 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded inline-flex items-center gap-1 transition-colors">
                                                                <Trash2 size={12} /> Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-between bg-slate-50 dark:bg-slate-900/50">
                            <div className="flex gap-2">
                                {!isNewTask && (
                                    <button
                                        onClick={() => setDeleteConfirmId(activeTask.id)}
                                        className="px-3 py-2 rounded-lg text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 font-medium flex items-center gap-1 transition"
                                    >
                                        <Trash2 size={16} />
                                        Delete
                                    </button>
                                )}
                                {!isNewTask && activeTask.status === TaskStatus.Done && (
                                    <button
                                        onClick={archiveTask}
                                        className="px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium flex items-center gap-1 transition"
                                    >
                                        <Archive size={16} />
                                        Archive
                                    </button>
                                )}
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={saveTask}
                                    className="px-6 py-2 rounded-lg bg-orange-600 text-white font-medium hover:bg-orange-700 shadow-sm"
                                >
                                    Save Task
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirmId && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Delete Task?</h3>
                        <p className="text-slate-600 dark:text-slate-300 mb-6">
                            This task will be permanently deleted. This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteTask(deleteConfirmId)}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SprintPlanning;
