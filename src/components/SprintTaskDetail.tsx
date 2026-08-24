import React, { useRef, useEffect, useId } from 'react';
import { Task, TaskStatus, TaskType, SubTeam, TeamMember } from '../types';
import { STATUS_COLUMNS } from '../constants';
import { Plus, Trash2, X, Archive } from 'lucide-react';
import SprintTaskActivity from './SprintTaskActivity';
import Modal from './ui/Modal';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import { getMemberDisplayName } from '../lib/member-utils';
import { toDateInputValue } from '../lib/date-only';
import { TITLE_MAX_LENGTH } from '../lib/text-limits';

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
    /**
     * False on an archived season (FEAT-02).
     *
     * The modal still OPENS — reading last season's work is the use case archiving exists
     * to serve — and every control that writes is disabled with the same sentence the rest
     * of the app uses. It used to offer Save, Delete and Archive in full: the store refused
     * with a `console.warn` and `saveTask` closed the modal anyway, so the edit vanished
     * with nothing on screen to say why.
     */
    canEdit?: boolean;
    /**
     * Why editing is refused, for the `title` of every control this component disables.
     *
     * REQUIRED, WITH NO DEFAULT, and that is the point. It used to be a hard-coded "This
     * season is archived and read-only" inside each control, which was simply false for the
     * two other ways `canEdit` goes false — a lapsed licence (WALK-B-12) and no season
     * selected. A default here would let the next caller forget and get the same wrong
     * sentence back; a required prop makes the compiler ask. Comes from
     * `useAccessState().editRefusalReason`, and is undefined exactly when `canEdit` is true.
     */
    refusalReason: string | undefined;
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
    canEdit = true,
    refusalReason,
}) => {
    /** The one place the archived reason is spelled, so the controls cannot disagree. */
    const readOnlyReason = canEdit ? undefined : refusalReason;
    const newChecklistRef = useRef<HTMLInputElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);

    /*
     * One prefix for the whole modal's htmlFor/id pairs (WALK-A-09).
     *
     * The five field labels were plain <label>s with no `htmlFor`, so they named nothing: a
     * screen reader announced five unnamed selects, and clicking a label did not focus its
     * control either. `useId` rather than `task.id` because a NEW task has no id until it is
     * saved, and two modals must never mint the same ids.
     */
    const fieldId = useId();

    // A new task opens with a placeholder title, so select it for immediate overtyping.
    useEffect(() => {
        if (isNewTask && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [isNewTask]);



    return (
        <Modal label="Task details" width="wide" className="flex flex-col overflow-hidden" onClose={onClose}>
                <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex-1 mr-4">
                        <input
                            ref={titleInputRef}
                            aria-label="Task title"
                            maxLength={TITLE_MAX_LENGTH}
                            value={task.title}
                            onChange={(e) => onChange({ ...task, title: e.target.value })}
                            placeholder="Task Title"
                            data-testid="task-title-input"
                            disabled={!canEdit}
                            title={readOnlyReason}
                            className="field text-base font-semibold"
                        />
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 p-2 rounded-full flex items-center justify-center w-8 h-8">
                        <span className="sr-only">Close</span>
                        <X size={18} />
                    </button>
                </div>

                {/*
                  * A FIELDSET, so "read-only" cannot drift (FEAT-02).
                  *
                  * `fieldset[disabled]` disables every form control inside it, including ones
                  * added later — which is the difference between a rule and a list of eight
                  * `disabled` props that a ninth field will not be added to
                  * (`docs/failure-modes.md` §12). The feed inside stays readable; only its
                  * controls go.
                  *
                  * `min-w-0` because a fieldset defaults to `min-width: min-content`, which
                  * is the flex child that refuses to shrink and pushes a modal wider than its
                  * container. Measured at 375px rather than assumed.
                  */}
                <fieldset disabled={!canEdit} className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor={`${fieldId}-type`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Type</label>
                            <select
                                id={`${fieldId}-type`}
                                value={task.type}
                                onChange={(e) => onChange({ ...task, type: e.target.value as TaskType })}
                                className="field"
                            >
                                <option value={TaskType.Feature}>Feature</option>
                                <option value={TaskType.Bug}>Bug</option>
                            </select>
                        </div>
                        <div>
                            <label htmlFor={`${fieldId}-status`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Status</label>
                            <select
                                id={`${fieldId}-status`}
                                data-testid="task-status-select"
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
                            <label htmlFor={`${fieldId}-subteam`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Sub-Team</label>
                            <select
                                id={`${fieldId}-subteam`}
                                value={task.department}
                                onChange={(e) => onChange({ ...task, department: e.target.value })}
                                className="field"
                            >
                                {subTeams.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor={`${fieldId}-assignee`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Assigned To</label>
                            <select
                                id={`${fieldId}-assignee`}
                                value={task.assignedTo}
                                onChange={(e) => onChange({ ...task, assignedTo: e.target.value })}
                                className="field"
                            >
                                <option value="">Unassigned</option>
                                {teamMembers.map(m => <option key={m.id} value={m.id}>{getMemberDisplayName(m)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor={`${fieldId}-due`} className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Due Date</label>
                            <input
                                id={`${fieldId}-due`}
                                type="date"
                                value={toDateInputValue(task.dueDate)}
                                onChange={(e) => onChange({ ...task, dueDate: e.target.valueAsNumber })}
                                className="field"
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor={`${fieldId}-description`} className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Description / Notes</label>
                        <textarea
                            id={`${fieldId}-description`}
                            value={task.description}
                            onChange={(e) => onChange({ ...task, description: e.target.value })}
                            className="field h-32"
                            placeholder="Describe the task, paste meeting minutes, or log bug details..."
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Checklist</label>
                        <div className="space-y-2">
                            {/*
                              * REPLACED, NEVER MUTATED (FEAT-04).
                              *
                              * These two handlers used to be `const c = [...task.checklist];
                              * c[idx].completed = ...` — a shallow copy of the ARRAY whose item
                              * objects are still the store's, because the route adapter in
                              * `App.tsx` copies the task and its timeline and not its checklist.
                              * So ticking a box wrote straight into the store, which broke the
                              * contract this component's own docblock states: "Draft edits.
                              * Nothing is persisted until onSave."
                              *
                              * What that cost: Cancel could not revert. The tick stayed on
                              * screen, it was never queued for sync, and it vanished on the next
                              * pull or reload — so a student ticked "wiring checked", closed the
                              * dialog, and the item silently un-ticked itself later, on their
                              * device only. `docs/failure-modes.md` §8: the control acted, and
                              * then unacted, and nothing said so.
                              */}
                            {task.checklist.map((item, idx) => (
                                <div key={idx} className="flex items-center gap-2 group">
                                    <input
                                        type="checkbox"
                                        checked={item.completed}
                                        onChange={(e) =>
                                            onChange({
                                                ...task,
                                                checklist: task.checklist.map((c, i) =>
                                                    i === idx ? { ...c, completed: e.target.checked } : c,
                                                ),
                                            })
                                        }
                                        className="w-5 h-5 rounded text-forge-600 accent-forge-600 focus:ring-forge-500 cursor-pointer"
                                    />
                                    <input
                                        ref={idx === task.checklist.length - 1 ? newChecklistRef : null}
                                        type="text"
                                        value={item.text}
                                        placeholder="Enter checklist item..."
                                        onChange={(e) =>
                                            onChange({
                                                ...task,
                                                checklist: task.checklist.map((c, i) =>
                                                    i === idx ? { ...c, text: e.target.value } : c,
                                                ),
                                            })
                                        }
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
                        canEdit={canEdit}
                        refusalReason={refusalReason}
                    />
                </fieldset>

                <div className="p-4 border-t border-slate-100 dark:border-slate-700 flex justify-between bg-slate-50 dark:bg-slate-900/50">
                    <div className="flex gap-3">
                        {!isNewTask && (
                            <Button
                                variant="danger"
                                onClick={onRequestDelete}
                                disabled={!canEdit}
                                title={readOnlyReason}
                                data-testid="delete-task"
                            >
                                <Trash2 size={16} />
                                Delete
                            </Button>
                        )}
                        {!isNewTask && task.status === TaskStatus.Done && (
                            <Button
                                variant="secondary"
                                onClick={onArchive}
                                disabled={!canEdit}
                                title={readOnlyReason}
                                data-testid="archive-task"
                            >
                                <Archive size={16} />
                                Archive
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            onClick={onSave}
                            disabled={!canEdit || !task.title.trim()}
                            title={readOnlyReason}
                            data-testid="save-task"
                        >
                            Save Task
                        </Button>
                    </div>
                </div>
        </Modal>
    );
};

export default SprintTaskDetail;
