import React, { useState } from 'react';
import { Task, TaskStatus, TaskType, SubTeam, TeamMember, TimelineEvent } from '../types';
import { Plus, Calendar as CalendarIcon, List, Layout, Archive } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useSeasonScope } from '../lib/season-scope';
import { useTasksQuery } from '../lib/queries';
import { getMemberDisplayName, getMemberInitials } from '../lib/member-utils';
import SprintBoard from './SprintBoard';
import SprintList from './SprintList';
import SprintCalendar from './SprintCalendar';
import SprintArchived from './SprintArchived';
import SprintTaskDetail from './SprintTaskDetail';
import ConfirmDialog from './ConfirmDialog';
import Button from './ui/Button';


interface SprintPlanningProps {
    tasks: Task[];
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
}

const SprintPlanning: React.FC<SprintPlanningProps> = ({ tasks, teamMembers, subTeams }) => {
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isNewTask, setIsNewTask] = useState(false);
    const [view, setView] = useState<'board' | 'list' | 'calendar' | 'archived'>('board');
    const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    // Use store's sync-enabled functions
    const storeAddTask = useAppStore((state) => state.addTask);
    const storeUpdateTask = useAppStore((state) => state.updateTask);
    const storeDeleteTask = useAppStore((state) => state.deleteTask);
    const currentTeamId = useAppStore((state) => state.currentTeamId);
    // The draft task below is a real `Task` before it is saved, and `Task.seasonId` is
    // required now that `tasks.season_id` is NOT NULL. `canEdit` additionally covers an
    // ARCHIVED season, whose writes the database refuses outright (Sprint 4).
    const { currentSeasonId, canEdit } = useSeasonScope();

    // Background refresh — fetches latest tasks when this page is visited
    useTasksQuery(currentTeamId);

    // Get current logged-in user for comments
    const { profile } = useAuth();

    const getMemberName = (id: string) => {
        const m = teamMembers.find(mem => mem.id === id);
        return getMemberDisplayName(m, 'Unassigned');
    };

    const getSubTeamName = (id: string) => {
        const t = subTeams.find(team => team.id === id);
        return t ? t.name : 'General';
    };

    const getInitials = (id: string) => {
        const m = teamMembers.find(mem => mem.id === id);
        return getMemberInitials(m);
    };

    const openTask = (task: Task) => {
        setActiveTask(task);
        setIsNewTask(false);
        setIsModalOpen(true);
    };

    const createNewTask = () => {
        // `tasks.season_id` is NOT NULL, so a task drafted with no season could never be
        // saved — and an archived season refuses the INSERT. The button is disabled in the
        // same condition; this is the guard behind it.
        if (!canEdit || !currentSeasonId) return;

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
            createdAt: Date.now(),
            seasonId: currentSeasonId
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
                authorId: profile?.id || 'System',
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

    const addComment = (text: string) => {
        if (!text.trim() || !activeTask) return;
        const comment: TimelineEvent = {
            id: Date.now().toString(),
            type: 'comment',
            authorId: profile?.id || 'guest',
            content: text,
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
            {/* The sidebar's active label already names this page, so the toolbar row
                carries no heading — just the view switcher and the New Item action. */}
            <div className="flex flex-row items-center justify-between mb-3 md:mb-4 md:px-4 gap-3">
                <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700 p-1 rounded-lg">
                    <button onClick={() => setView('board')} className={`p-2 rounded-md transition-colors flex items-center justify-center ${view === 'board' ? 'bg-white dark:bg-slate-600 shadow-card text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-600/60'}`} title="Board"><Layout size={18} /></button>
                    <button onClick={() => setView('list')} className={`p-2 rounded-md transition-colors flex items-center justify-center ${view === 'list' ? 'bg-white dark:bg-slate-600 shadow-card text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-600/60'}`} title="List"><List size={18} /></button>
                    <button onClick={() => setView('calendar')} className={`p-2 rounded-md transition-colors flex items-center justify-center ${view === 'calendar' ? 'bg-white dark:bg-slate-600 shadow-card text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-600/60'}`} title="Calendar"><CalendarIcon size={18} /></button>
                    <button onClick={() => setView('archived')} className={`p-2 rounded-md transition-colors flex items-center justify-center ${view === 'archived' ? 'bg-white dark:bg-slate-600 shadow-card text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-600/60'}`} title="Archived"><Archive size={18} /></button>
                </div>

                <Button
                    onClick={createNewTask}
                    disabled={!canEdit}
                    title={
                        canEdit
                            ? 'New item'
                            : currentSeasonId
                                ? 'This season is archived and read-only'
                                : 'Select a season first'
                    }
                    // `!px-2 md:!px-4`: keeps the icon-only mobile width; without the important
                    // modifier the md size recipe's px-4 would win the cascade at every width.
                    className="!px-2 md:!px-4"
                    data-testid="new-task-button"
                >
                    <Plus size={20} /><span className="hidden md:inline">New Item</span>
                </Button>
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
                <SprintTaskDetail
                    task={activeTask}
                    isNewTask={isNewTask}
                    teamMembers={teamMembers}
                    subTeams={subTeams}
                    onChange={setActiveTask}
                    onSave={saveTask}
                    onRequestDelete={() => setDeleteConfirmId(activeTask.id)}
                    onArchive={archiveTask}
                    onClose={() => setIsModalOpen(false)}
                    onAddComment={addComment}
                    onDeleteComment={deleteComment}
                />
            )}

            {deleteConfirmId && (
                <ConfirmDialog
                    title="Delete Task?"
                    message="This task will be permanently deleted. This action cannot be undone."
                    onConfirm={() => deleteTask(deleteConfirmId)}
                    onCancel={() => setDeleteConfirmId(null)}
                />
            )}
        </div>
    );
};

export default SprintPlanning;
