import React, { useRef, useEffect } from 'react';
import { Task, TaskStatus, TaskType, SubTeam, TeamMember } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { Plus, Trash2, X, Archive } from 'lucide-react';
import SprintTaskActivity from './SprintTaskActivity';
import Modal from './ui/Modal';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { getMemberDisplayName } from '../lib/member-utils';

/**
 * The task create/edit modal, extracted from SprintPlanning.
 *
 * It was ~250 lines of JSX inline in a 558-line component, and reached for 22 different
 * values from its parent. Most of those did not need to be parent state: the comment draft
 * is only ever typed here, the refs only point at inputs here, and the author name/initials
 * are derivable from `teamMembers` plus the current user.
 *
 * What genuinely belongs to the parent is anything that touches the store -- saving,
 * deleting, archiving, and persisting comments -- so those stay as callbacks. That is the
 * line: this component renders and edits a draft task, the parent decides what reaches the
 * database.
 */
interface SprintTaskDetailProps {
    /** The task being edited. A draft for new tasks -- not yet in the store. */
    task: Task;
    /** New tasks have no history to persist against, so some actions are hidden. */
    isNewTask: boolean;
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
    /** Draft edits. Nothing is persisted until onSave. */
    onChange: (task: Task) => void;
    onSave: () => void;
    /** Opens the confirmation dialog; the parent owns the actual delete. */
    onRequestDelete: () => void;
    onArchive: () => void;
    onClose: () => void;
    /** Comments persist immediately rather than waiting for Save. */
    onAddComment: (text: string) => void;
    onDeleteComment: (commentId: string) => void;
}

const SprintTaskDetail: React.FC<SprintTaskDetailProps> = ({
    task,
    isNewTask,
    teamMembers,
    subTeams,
    onChange,
    onSave,
    onRequestDelete,
    onArchive,
    onClose,
    onAddComment,
    onDeleteComment,
}) => {
    const newChecklistRef = useRef<HTMLInputElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    // A new task opens with a placeholder title, so select it for immediate overtyping.
    useEffect(() => {
        if (isNewTask && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [isNewTask]);



    return (
        <Modal label="Task details" width="wide" className="flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex-1 mr-4">
                        <input
                            ref={titleInputRef}
                            value={task.title}
                            onChange={(e) => onChange({ ...task, title: e.target.value })}
                            placeholder="Task Title"
                            data-testid="task-title-input"
                            className="field text-base font-semibold"
                        />
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full flex items-center justify-center w-8 h-8">
                        <span className="sr-only">Close</span>
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Type</label>
                            <select
                                value={task.type}
                                onChange={(e) => onChange({ ...task, type: e.target.value as TaskType })}
                                className="field"
                            >
                                <option value={TaskType.Feature}>Feature</option>
                                <option value={TaskType.Bug}>Bug</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Status</label>
                            <select
                                value={task.status}
                                onChange={(e) => onChange({ ...task, status: e.target.value as TaskStatus })}
                                className="field"
                            >
                                {STATUS_COLUMNS.map(s => <option key={s} value={s}>{s}</option>)}
                                {task.status === TaskStatus.Archived && (
                                    <option value={TaskStatus.Archived}>Archived</option>
                                )}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Sub-Team</label>
                            <select
                                value={task.department}
                                onChange={(e) => onChange({ ...task, department: e.target.value })}
                                className="field"
                            >
                                {subTeams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assigned To</label>
                            <select
                                value={task.assignedTo}
                                onChange={(e) => onChange({ ...task, assignedTo: e.target.value })}
                                className="field"
                            >
                                <option value="">Unassigned</option>
                                {teamMembers.map(m => <option key={m.id} value={m.id}>{getMemberDisplayName(m)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Due Date</label>
                            <input
                                type="date"
                                value={task.dueDate ? new Date(task.dueDate).toISOString().substr(0, 10) : ''}
                                onChange={(e) => onChange({ ...task, dueDate: e.target.valueAsNumber })}
                                className="field"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Description / Notes</label>
                        <textarea
                            value={task.description}
                            onChange={(e) => onChange({ ...task, description: e.target.value })}
                            className="field h-32"
                            placeholder="Describe the task, paste meeting minutes, or log bug details..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Checklist</label>
                        <div className="space-y-2">
                            {task.checklist.map((item, idx) => (
                                <div key={idx} className="flex items-center gap-2 group">
                                    <input
                                        type="checkbox"
                                        checked={item.completed}
                                        onChange={(e) => {
                                            const newChecklist = [...task.checklist];
                                            newChecklist[idx].completed = e.target.checked;
                                            onChange({ ...task, checklist: newChecklist });
                                        }}
                                        className="w-5 h-5 rounded text-forge-600 accent-forge-600 focus:ring-forge-500 cursor-pointer"
                                    />
                                    <input
                                        ref={idx === task.checklist.length - 1 ? newChecklistRef : null}
                                        type="text"
                                        value={item.text}
                                        placeholder="Enter checklist item..."
                                        onChange={(e) => {
                                            const newChecklist = [...task.checklist];
                                            newChecklist[idx].text = e.target.value;
                                            onChange({ ...task, checklist: newChecklist });
                                        }}
                                        className="field py-1 flex-1"
                                    />
                                    <IconButton
                                        danger
                                        onClick={() => {
                                            const newChecklist = task.checklist.filter((_, i) => i !== idx);
                                            onChange({ ...task, checklist: newChecklist });
                                        }}
                                        className="p-1"
                                        title="Delete item"
                                    >
                                        <Trash2 size={14} />
                                    </IconButton>
                                </div>
                            ))}
                            <button
                                onClick={() => {
                                    onChange({ ...task, checklist: [...task.checklist, { id: Date.now().toString(), text: '', completed: false }] });
                                    setTimeout(() => {
                                        newChecklistRef.current?.focus();
                                    }, 50);
                                }}
                                className="text-sm text-forge-600 dark:text-forge-400 font-medium hover:underline flex items-center gap-1"
                            >
                                <Plus size={14} /> Add Checklist Item
                            </button>
                        </div>
                    </div>

                    <SprintTaskActivity
                        timeline={task.timeline}
                        teamMembers={teamMembers}
                        onAddComment={onAddComment}
                        onDeleteComment={onDeleteComment}
                    />
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-between bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex gap-3">
                        {!isNewTask && (
                            <Button variant="danger" onClick={onRequestDelete}>
                                <Trash2 size={16} />
                                Delete
                            </Button>
                        )}
                        {!isNewTask && task.status === TaskStatus.Done && (
                            <Button variant="secondary" onClick={onArchive}>
                                <Archive size={16} />
                                Archive
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button onClick={onSave} disabled={!task.title.trim()} data-testid="save-task">
                            Save Task
                        </Button>
                    </div>
                </div>
        </Modal>
    );
};

export default SprintTaskDetail;
