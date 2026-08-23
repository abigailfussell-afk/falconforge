import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, Edit, Trash2, ChevronUp, ChevronDown, BookmarkPlus } from 'lucide-react';
import { useAppStore, selectChecklist } from '../lib/store';
import { useAccessState } from '../lib/entitlement';
import { getMemberDisplayName } from '../lib/member-utils';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

const PreMatchChecklist: React.FC = () => {
    const [isEditingChecklist, setIsEditingChecklist] = useState(false);
    const [newChecklistItem, setNewChecklistItem] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);

    // An archived season's checklist is history: every write below is refused by
    // `season_is_open` server-side, so none of them are offered.
    const { canEdit, editRefusalReason } = useAccessState();
    const saveChecklistAsTemplate = useAppStore((state) => state.saveChecklistAsTemplate);

    // Get checklist and actions from the store (sync-enabled)
    // `selectChecklist` resolves the current season's list — one row per season now (C6),
    // so which list this is depends on the season picker, not on the team.
    const checklist = useAppStore(selectChecklist);
    const toggleChecklistItem = useAppStore((state) => state.toggleChecklistItem);
    const resetChecklist = useAppStore((state) => state.resetChecklist);
    const addChecklistItem = useAppStore((state) => state.addChecklistItem);
    const deleteChecklistItem = useAppStore((state) => state.deleteChecklistItem);
    const updateChecklistAssignment = useAppStore((state) => state.updateChecklistAssignment);
    const moveChecklistItem = useAppStore((state) => state.moveChecklistItem);

    // Get teamMembers and subTeams from the store
    const teamMembers = useAppStore((state) => state.teamMembers);
    const subTeams = useAppStore((state) => state.subTeams);

    // Helper to get display name for a TeamMember
    const displayNameForMemberId = (id: string): string => {
        const member = teamMembers.find(m => m.id === id);
        // No member record means a legacy free-text assignment; show it as stored.
        return member ? getMemberDisplayName(member) : id;
    };

    const toggleCheck = (id: string) => {
        if (isEditingChecklist || !canEdit) return;
        toggleChecklistItem(id);
    };

    const handleSaveTemplate = () => {
        if (!templateName.trim()) return;
        if (saveChecklistAsTemplate(templateName.trim())) {
            setTemplateName('');
            setIsSavingTemplate(false);
        }
    };

    const handleAddChecklistItem = () => {
        if (newChecklistItem.trim()) {
            addChecklistItem(newChecklistItem.trim());
            setNewChecklistItem('');
        }
    };

    const handleDeleteChecklistItem = (id: string) => {
        deleteChecklistItem(id);
    };

    const updateAssignment = (id: string, assignee: string) => {
        updateChecklistAssignment(id, assignee);
    };

    const moveItem = (id: string, direction: 'up' | 'down') => {
        moveChecklistItem(id, direction);
    };

    // Get the display value for assignment (could be subTeam name or member name)
    const getAssignmentDisplay = (assignedTo: string | undefined): string => {
        if (!assignedTo) return '';
        // Check if it's a subTeam
        const subTeam = subTeams.find(t => t.id === assignedTo || t.name === assignedTo);
        if (subTeam) return subTeam.name;
        // Check if it's a member
        const member = teamMembers.find(m => m.id === assignedTo);
        if (member) return getMemberDisplayName(member);
        // Return as-is (legacy value)
        return assignedTo;
    };

    return (
        // max-w-prose, not max-w-wide: a checklist row is a checkbox and a few words, and
        // at 800px the rows read as mostly gutter — 120px of dead margin each side at
        // 1280px for no legibility gain.
        <div className="h-full flex flex-col max-w-prose mx-auto w-full">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full">
                <div className="p-3 md:p-4 border-b border-slate-100 dark:border-slate-700 flex flex-row flex-wrap justify-between items-start sm:items-center gap-2 sm:gap-4 bg-slate-50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800 dark:text-white">Pre-Match Checklist</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Reset this list before every match.</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            data-testid="save-checklist-template"
                            onClick={() => setIsSavingTemplate(!isSavingTemplate)}
                            disabled={checklist.length === 0}
                            className={`p-2 rounded-full transition flex items-center justify-center w-9 h-9 disabled:opacity-40 disabled:cursor-not-allowed ${isSavingTemplate ? 'bg-forge-100 text-forge-600' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700'}`}
                            title="Save as a team template"
                        >
                            <BookmarkPlus size={20} />
                        </button>
                        <button
                            data-testid="edit-checklist"
                            onClick={() => setIsEditingChecklist(!isEditingChecklist)}
                            disabled={!canEdit}
                            className={`p-2 rounded-full transition flex items-center justify-center w-9 h-9 disabled:opacity-40 disabled:cursor-not-allowed ${isEditingChecklist ? 'bg-forge-100 text-forge-600' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700'}`}
                            title={canEdit ? 'Edit Checklist' : editRefusalReason}
                        >
                            <Edit size={20} />
                        </button>
                        <button
                            data-testid="reset-checklist"
                            onClick={resetChecklist}
                            disabled={!canEdit}
                            className="text-slate-500 hover:text-forge-600 p-2 rounded-full hover:bg-forge-50 dark:text-slate-400 dark:hover:bg-slate-700 transition flex items-center justify-center w-9 h-9 disabled:opacity-40 disabled:cursor-not-allowed"
                            title={canEdit ? 'Reset Checklist' : editRefusalReason}
                        >
                            <RotateCcw size={20} />
                        </button>
                    </div>
                </div>

                {/*
                  * Saving a template stays available on an archived season: it READS this
                  * list and writes a new row of its own, which no season owns. Capturing a
                  * checklist a team spent a season refining is exactly what somebody wants
                  * to do while looking back at it.
                  */}
                {isSavingTemplate && (
                    <div className="flex gap-2 border-b border-slate-100 p-4 dark:border-slate-700">
                        <input
                            type="text"
                            data-testid="template-name-input"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplate()}
                            placeholder="Template name, e.g. Standard pre-match"
                            className="field flex-1"
                        />
                        <Button
                            data-testid="confirm-save-template"
                            onClick={handleSaveTemplate}
                            disabled={!templateName.trim()}
                        >
                            Save
                        </Button>
                    </div>
                )}
                <div className="divide-y divide-slate-100 dark:divide-slate-700 flex-1 scroll-region-thin">
                    {/*
                     * THE EMPTY STATE.
                     *
                     * This was `checklist.map(...)` and nothing else, so a season whose
                     * checklist has no items rendered a completely blank panel — a header, a
                     * rule, and white space. That is not a rare corner: "blank" is one of the
                     * three sources Sprint 4's rollover wizard offers for a new season's
                     * checklist, so it is what a team sees on the first day of a new season
                     * if they pick it. The only way to add anything is behind the "Edit
                     * Checklist" button in the header, which an empty panel gives nobody a
                     * reason to press.
                     */}
                    {checklist.length === 0 && !isEditingChecklist && (
                        <div className="px-4 py-10 text-center">
                            <CheckCircle2 size={26} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                This checklist is empty
                            </h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-prose mx-auto mb-3">
                                {canEdit
                                    ? 'Add the things your team checks before every match — battery secured, bumpers on, driver station charged.'
                                    : 'Nothing was recorded on this season’s checklist.'}
                            </p>
                            {canEdit && (
                                <button
                                    data-testid="checklist-empty-add"
                                    onClick={() => setIsEditingChecklist(true)}
                                    className="touch-target gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg bg-forge-600 text-white hover:bg-forge-700 transition-colors"
                                >
                                    Add the first item
                                </button>
                            )}
                        </div>
                    )}
                    {checklist.map((item, index) => (
                        <div
                            key={item.id}
                            className={`px-3 py-2 transition-colors ${item.checked ? 'bg-green-50/50 dark:bg-green-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'} ${isEditingChecklist ? 'flex flex-col gap-1.5' : 'flex items-center gap-3'}`}
                        >
                            {/* First row: checkbox + item name. A real <button> in view mode —
                                the old clickable div/span pair was invisible to the keyboard,
                                and toggling items is this page's whole job. */}
                            {!isEditingChecklist ? (
                                <button
                                    type="button"
                                    onClick={() => toggleCheck(item.id)}
                                    disabled={!canEdit}
                                    data-testid="checklist-item-toggle"
                                    aria-pressed={item.checked}
                                    className="flex items-center gap-2.5 w-full text-left disabled:cursor-not-allowed"
                                >
                                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${item.checked ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 dark:border-slate-500 text-transparent'}`}>
                                        <CheckCircle2 size={13} fill="currentColor" className={item.checked ? 'text-white' : ''} />
                                    </span>
                                    <span className={`text-sm font-medium flex-1 transition-colors ${item.checked ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
                                        {item.text}
                                    </span>
                                    {item.assignedTo && (
                                        <span className="text-2xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-md shrink-0">
                                            {getAssignmentDisplay(item.assignedTo)}
                                        </span>
                                    )}
                                </button>
                            ) : (
                                <span className="text-sm font-medium w-full text-slate-700 dark:text-slate-200">
                                    {item.text}
                                </span>
                            )}

                            {/* Second row: controls (only in edit mode). No hand-tuned indent:
                                edit mode drops the checkbox, so text and controls both align to
                                the row's left edge instead of chasing a 30px offset with pl-10. */}
                            {isEditingChecklist && (
                                <div className="flex items-center justify-between gap-2">
                                    <select
                                        className="field text-xs p-1.5 flex-1 max-w-xs"
                                        value={item.assignedTo || ''}
                                        onChange={(e) => updateAssignment(item.id, e.target.value)}
                                    >
                                        <option value="">Anyone</option>
                                        <optgroup label="Sub-Teams">
                                            {subTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        </optgroup>
                                        <optgroup label="Team Members">
                                            {teamMembers.map(m => <option key={m.id} value={m.id}>{displayNameForMemberId(m.id)}</option>)}
                                        </optgroup>
                                    </select>

                                    <div className="flex items-center gap-1">
                                        <IconButton
                                            onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'up'); }}
                                            className="p-1.5"
                                            disabled={index === 0}
                                            title="Move up"
                                        >
                                            <ChevronUp size={18} />
                                        </IconButton>
                                        <IconButton
                                            onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'down'); }}
                                            className="p-1.5"
                                            disabled={index === checklist.length - 1}
                                            title="Move down"
                                        >
                                            <ChevronDown size={18} />
                                        </IconButton>
                                        <IconButton
                                            danger
                                            onClick={(e) => { e.stopPropagation(); handleDeleteChecklistItem(item.id); }}
                                            className="p-1.5 ml-1"
                                            title="Delete item"
                                        >
                                            <Trash2 size={18} />
                                        </IconButton>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {isEditingChecklist && (
                        <div className="p-4 flex gap-2 bg-slate-50 dark:bg-slate-700/50">
                            <input
                                type="text"
                                value={newChecklistItem}
                                onChange={(e) => setNewChecklistItem(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddChecklistItem()}
                                placeholder="Add new item..."
                                className="field flex-1"
                            />
                            {/* Disabled on empty input — the old button accepted the tap and
                                silently did nothing. */}
                            <Button onClick={handleAddChecklistItem} disabled={!newChecklistItem.trim()}>Add</Button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PreMatchChecklist;
