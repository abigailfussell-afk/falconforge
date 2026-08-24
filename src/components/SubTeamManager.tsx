import { TITLE_MAX_LENGTH } from '../lib/text-limits';
import React, { useState } from 'react';
import { Layers, Plus, Trash2, Check, Pencil, X } from 'lucide-react';
import { SubTeam, TeamMember } from '../types';
import { useAppStore } from '../lib/store';
import { useAccessState } from '../lib/entitlement';
import IconButton from './ui/IconButton';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

interface SubTeamManagerProps {
    subTeams: SubTeam[];
    teamMembers: TeamMember[];
    getMemberDisplayName: (member: TeamMember) => string;
}

const SubTeamManager: React.FC<SubTeamManagerProps> = ({ subTeams, teamMembers, getMemberDisplayName }) => {
    const [newSubTeamName, setNewSubTeamName] = useState('');
    const [editingSubTeamId, setEditingSubTeamId] = useState<string | null>(null);
    /**
     * Which sub-team is being renamed, and the draft (FEAT-14).
     *
     * Draft state, not a write-through to the store: this is a text field, and committing every
     * keystroke would queue a sync push per character. Escape and the Cancel button therefore
     * have something to discard — which is the half `SprintTaskDetail` got wrong for checklists
     * (FEAT-04, next sprint), where Cancel could not revert because the edits had already
     * mutated the store's own objects.
     */
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');

    const storeAddSubTeam = useAppStore((state) => state.addSubTeam);
    const storeRenameSubTeam = useAppStore((state) => state.renameSubTeam);
    const storeRemoveSubTeam = useAppStore((state) => state.removeSubTeam);
    const storeToggleMemberInSubTeam = useAppStore((state) => state.toggleMemberInSubTeam);
    // A prior season's sub-teams and their assignments are history. `season_is_open` gates
    // sub_teams' write policies too, so these are refused server-side either way.
    const { canEdit, editRefusalReason } = useAccessState();

    const addSubTeam = () => {
        if (newSubTeamName.trim()) {
            storeAddSubTeam(newSubTeamName.trim());
            setNewSubTeamName('');
        }
    };

    const startRename = (id: string, currentName: string) => {
        setRenamingId(id);
        setRenameDraft(currentName);
    };

    const cancelRename = () => {
        setRenamingId(null);
        setRenameDraft('');
    };

    const commitRename = (id: string) => {
        storeRenameSubTeam(id, renameDraft);
        cancelRename();
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-4">
            <SectionHeader icon={Layers} title="Sub-Teams & Assignments" />

            <div className="flex gap-2 mb-3">
                <input
                    type="text"
                    maxLength={TITLE_MAX_LENGTH}
                    value={newSubTeamName}
                    onChange={(e) => setNewSubTeamName(e.target.value)}
                    placeholder="New Sub-Team Name (e.g. Pit Crew)"
                    disabled={!canEdit}
                    /*
                     * The archived-season explanation belongs on the INPUT as well as on the
                     * button. Sprint 4 put it on the button only, so on a prior season this
                     * field greyed out with nothing to say for itself — and a disabled field
                     * is where someone tries to type FIRST, before they ever reach the button
                     * whose tooltip would have told them why.
                     */
                    title={canEdit ? undefined : editRefusalReason}
                    className="field flex-1 min-w-0 disabled:opacity-50"
                    onKeyDown={(e) => e.key === 'Enter' && addSubTeam()}
                />
                <IconButton
                    data-testid="add-sub-team"
                    onClick={addSubTeam}
                    disabled={!canEdit}
                    title={canEdit ? 'Add sub-team' : editRefusalReason}
                    className="touch-target shrink-0"
                    aria-label="Add sub-team"
                >
                    <Plus size={18} />
                </IconButton>
            </div>

            {subTeams.length === 0 ? (
                <EmptyState
                    icon={Layers}
                    title="No sub-teams yet"
                    body="Create sub-teams to organize your members by role (e.g., Pit Crew, Drivers, Build Team). Add a sub-team using the form above, then assign members to it."
                />
            ) : (
                <div className="space-y-2 max-h-panel scroll-region-thin">
                    {subTeams.map((subTeam) => (
                        <div key={subTeam.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                            <div className="flex flex-wrap justify-between items-center gap-2 px-2.5 py-2 bg-slate-50 dark:bg-slate-700/50">
                                {renamingId === subTeam.id ? (
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                        <input
                                            type="text"
                                            autoFocus
                                            maxLength={TITLE_MAX_LENGTH}
                                            value={renameDraft}
                                            onChange={(e) => setRenameDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitRename(subTeam.id);
                                                // Escape discards, which is the whole reason the
                                                // draft is local state rather than the store.
                                                if (e.key === 'Escape') cancelRename();
                                            }}
                                            aria-label={`Rename ${subTeam.name}`}
                                            data-testid="rename-sub-team-input"
                                            /*
                                             * No `text-sm` here, deliberately. It was written
                                             * and measured at 16px in a real browser: `.field`
                                             * carries the iOS zoom floor and outranks a utility,
                                             * so the class was in the DOM doing nothing — which
                                             * is `docs/failure-modes.md` §5's whole subject.
                                             */
                                            className="field flex-1 min-w-0 py-1"
                                        />
                                        <IconButton
                                            data-testid="rename-sub-team-save"
                                            onClick={() => commitRename(subTeam.id)}
                                            disabled={!renameDraft.trim()}
                                            title={renameDraft.trim() ? 'Save name' : 'Enter a name'}
                                            className="touch-target"
                                            aria-label="Save name"
                                        >
                                            <Check size={16} />
                                        </IconButton>
                                        <IconButton
                                            data-testid="rename-sub-team-cancel"
                                            onClick={cancelRename}
                                            title="Cancel rename"
                                            className="touch-target"
                                            aria-label="Cancel rename"
                                        >
                                            <X size={16} />
                                        </IconButton>
                                    </div>
                                ) : (
                                    <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 min-w-0 truncate">{subTeam.name}</h4>
                                )}
                                <div className={`flex gap-1.5 items-center shrink-0 ${renamingId === subTeam.id ? 'hidden' : ''}`}>
                                    <IconButton
                                        data-testid="rename-sub-team"
                                        onClick={() => startRename(subTeam.id, subTeam.name)}
                                        disabled={!canEdit}
                                        title={canEdit ? 'Rename sub-team' : editRefusalReason}
                                        className="touch-target"
                                        aria-label={`Rename ${subTeam.name}`}
                                    >
                                        <Pencil size={15} />
                                    </IconButton>
                                    <button
                                        onClick={() => setEditingSubTeamId(editingSubTeamId === subTeam.id ? null : subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? undefined : editRefusalReason}
                                        className={`text-2xs font-medium px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${editingSubTeamId === subTeam.id ? 'bg-forge-100 text-forge-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {editingSubTeamId === subTeam.id ? 'Done' : 'Manage Members'}
                                    </button>
                                    <IconButton
                                        danger
                                        onClick={() => storeRemoveSubTeam(subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? 'Delete sub-team' : editRefusalReason}
                                        className="touch-target"
                                        aria-label={`Delete ${subTeam.name}`}
                                    >
                                        <Trash2 size={16} />
                                    </IconButton>
                                </div>
                            </div>

                            <div className="p-2.5 bg-white dark:bg-slate-800">
                                {editingSubTeamId === subTeam.id ? (
                                    teamMembers.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Add members to your Team Roster first before assigning them to sub-teams.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-1.5">
                                            {teamMembers.map(m => {
                                                const assigned = subTeam.memberIds.includes(m.id);
                                                return (
                                                    // A real <button>, not a clickable <div>. It was neither
                                                    // keyboard-reachable nor disabled on an archived season —
                                                    // the store's guard refused the write, so it was a control
                                                    // that looked live, did nothing, and said nothing.
                                                    <button
                                                        key={m.id}
                                                        type="button"
                                                        onClick={() => storeToggleMemberInSubTeam(subTeam.id, m.id)}
                                                        disabled={!canEdit}
                                                        title={canEdit ? undefined : editRefusalReason}
                                                        aria-pressed={assigned}
                                                        className={`px-2 py-1.5 rounded border flex items-center justify-between gap-1 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${assigned ? 'border-forge-500 bg-forge-50 dark:bg-forge-900/20 text-forge-700 dark:text-forge-300' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
                                                    >
                                                        <span className="truncate">{getMemberDisplayName(m)}</span>
                                                        {assigned && <Check size={13} className="shrink-0" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-wrap gap-1.5">
                                        {subTeam.memberIds.length === 0 && <span className="text-xs text-slate-400 italic">No members assigned.</span>}
                                        {subTeam.memberIds.map(mid => {
                                            const m = teamMembers.find(mem => mem.id === mid);
                                            if (!m) return null;
                                            return (
                                                <span key={mid} className="text-2xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600">
                                                    {getMemberDisplayName(m)}
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SubTeamManager;
