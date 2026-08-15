import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, Edit, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { getMemberDisplayName } from '../lib/member-utils';

const PreMatchChecklist: React.FC = () => {
    const [isEditingChecklist, setIsEditingChecklist] = useState(false);
    const [newChecklistItem, setNewChecklistItem] = useState('');

    // Get checklist and actions from the store (sync-enabled)
    const checklist = useAppStore((state) => state.checklist);
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
        if (isEditingChecklist) return;
        toggleChecklistItem(id);
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
        <div className="h-full flex flex-col max-w-3xl mx-auto w-full">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col h-full">
                <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-700 flex flex-row flex-wrap justify-between items-start sm:items-center gap-2 sm:gap-4 bg-slate-50 dark:bg-slate-900/50">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Pre-Match Checklist</h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Reset this list before every match.</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setIsEditingChecklist(!isEditingChecklist)}
                            className={`p-2 rounded-full transition flex items-center justify-center w-9 h-9 ${isEditingChecklist ? 'bg-orange-100 text-orange-600' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700'}`}
                            title="Edit Checklist"
                        >
                            <Edit size={20} />
                        </button>
                        <button
                            onClick={resetChecklist}
                            className="text-slate-500 hover:text-orange-600 p-2 rounded-full hover:bg-orange-50 dark:text-slate-400 dark:hover:bg-slate-700 transition flex items-center justify-center w-9 h-9"
                            title="Reset Checklist"
                        >
                            <RotateCcw size={20} />
                        </button>
                    </div>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-slate-700 overflow-y-auto flex-1 pr-1 custom-scrollbar">
                    {checklist.map((item, index) => (
                        <div
                            key={item.id}
                            className={`p-4 transition ${item.checked ? 'bg-green-50/50 dark:bg-green-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'} ${isEditingChecklist ? 'flex flex-col gap-2' : 'flex items-center gap-4'}`}
                        >
                            {/* First row: checkbox + item name */}
                            <div className="flex items-center gap-4 w-full">
                                <div className="cursor-pointer flex-shrink-0" onClick={() => toggleCheck(item.id)}>
                                    {!isEditingChecklist && (
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${item.checked ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300 dark:border-slate-500 text-transparent'}`}>
                                            <CheckCircle2 size={16} fill="currentColor" className={item.checked ? 'text-white' : ''} />
                                        </div>
                                    )}
                                </div>

                                <span onClick={() => toggleCheck(item.id)} className={`text-lg font-medium flex-1 cursor-pointer transition ${item.checked ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                    {item.text}
                                </span>

                                {/* Show assignment badge in view mode */}
                                {!isEditingChecklist && item.assignedTo && (
                                    <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-1 rounded flex-shrink-0">
                                        {getAssignmentDisplay(item.assignedTo)}
                                    </span>
                                )}
                            </div>

                            {/* Second row: controls (only in edit mode) */}
                            {isEditingChecklist && (
                                <div className="flex items-center justify-between gap-2 pl-0 md:pl-10">
                                    <select
                                        className="text-xs border border-slate-200 dark:border-slate-600 rounded p-1.5 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex-1 max-w-[150px]"
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
                                        <button
                                            onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'up'); }}
                                            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 disabled:opacity-30"
                                            disabled={index === 0}
                                            title="Move up"
                                        >
                                            <ChevronUp size={18} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); moveItem(item.id, 'down'); }}
                                            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 disabled:opacity-30"
                                            disabled={index === checklist.length - 1}
                                            title="Move down"
                                        >
                                            <ChevronDown size={18} />
                                        </button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDeleteChecklistItem(item.id); }} className="text-red-500 hover:text-red-700 p-1.5 ml-1">
                                            <Trash2 size={18} />
                                        </button>
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
                                className="flex-1 border rounded px-3 py-2 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white"
                            />
                            <button onClick={handleAddChecklistItem} className="bg-orange-600 text-white px-4 py-2 rounded font-bold">Add</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PreMatchChecklist;
