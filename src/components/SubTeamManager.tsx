import React, { useState } from 'react';
import { Layers, Plus, Trash2, Check } from 'lucide-react';
import { SubTeam, TeamMember } from '../types';
import { useAppStore } from '../lib/store';
import { useSeasonScope } from '../lib/season-scope';

interface SubTeamManagerProps {
    subTeams: SubTeam[];
    teamMembers: TeamMember[];
    getMemberDisplayName: (member: TeamMember) => string;
}

const SubTeamManager: React.FC<SubTeamManagerProps> = ({ subTeams, teamMembers, getMemberDisplayName }) => {
    const [newSubTeamName, setNewSubTeamName] = useState('');
    const [editingSubTeamId, setEditingSubTeamId] = useState<string | null>(null);

    const storeAddSubTeam = useAppStore((state) => state.addSubTeam);
    const storeRemoveSubTeam = useAppStore((state) => state.removeSubTeam);
    const storeToggleMemberInSubTeam = useAppStore((state) => state.toggleMemberInSubTeam);
    // A prior season's sub-teams and their assignments are history. `season_is_open` gates
    // sub_teams' write policies too, so these are refused server-side either way.
    const { canEdit } = useSeasonScope();

    const addSubTeam = () => {
        if (newSubTeamName.trim()) {
            storeAddSubTeam(newSubTeamName.trim());
            setNewSubTeamName('');
        }
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-4">
            <div className="flex items-center gap-2 mb-3 border-b border-slate-100 dark:border-slate-700 pb-2">
                <Layers className="text-forge-600" size={18} />
                <h3 className="text-base font-bold text-slate-800 dark:text-white">Sub-Teams &amp; Assignments</h3>
            </div>

            <div className="flex gap-2 mb-3">
                <input
                    type="text"
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
                    title={canEdit ? undefined : 'This season is archived and read-only'}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50"
                    onKeyDown={(e) => e.key === 'Enter' && addSubTeam()}
                />
                <button
                    data-testid="add-sub-team"
                    onClick={addSubTeam}
                    disabled={!canEdit}
                    title={canEdit ? 'Add sub-team' : 'This season is archived and read-only'}
                    className="touch-target shrink-0 bg-forge-600 text-white px-2 rounded-lg hover:bg-forge-700 transition-colors w-9 h-9 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Add sub-team"
                >
                    <Plus size={18} />
                </button>
            </div>

            {subTeams.length === 0 ? (
                <div className="text-center py-6 px-4">
                    <Layers size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <h4 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1">No sub-teams yet</h4>
                    <p className="text-xs text-slate-500 dark:text-slate-500 max-w-prose mx-auto">
                        Create sub-teams to organize your members by role (e.g., Pit Crew, Drivers, Build Team). Add a sub-team using the form above, then assign members to it.
                    </p>
                </div>
            ) : (
                <div className="space-y-2 max-h-panel scroll-region-thin">
                    {subTeams.map((subTeam) => (
                        <div key={subTeam.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                            <div className="flex flex-wrap justify-between items-center gap-2 px-2.5 py-2 bg-slate-50 dark:bg-slate-700/50">
                                <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 min-w-0 truncate">{subTeam.name}</h4>
                                <div className="flex gap-1.5 items-center shrink-0">
                                    <button
                                        onClick={() => setEditingSubTeamId(editingSubTeamId === subTeam.id ? null : subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? undefined : 'This season is archived and read-only'}
                                        className={`text-2xs font-medium px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${editingSubTeamId === subTeam.id ? 'bg-forge-100 text-forge-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {editingSubTeamId === subTeam.id ? 'Done' : 'Manage Members'}
                                    </button>
                                    <button
                                        onClick={() => storeRemoveSubTeam(subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? 'Delete sub-team' : 'This season is archived and read-only'}
                                        className="touch-target text-slate-400 hover:text-red-500 p-1 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                                        aria-label={`Delete ${subTeam.name}`}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-2.5 bg-white dark:bg-slate-800">
                                {editingSubTeamId === subTeam.id ? (
                                    teamMembers.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Add members to your Team Roster first before assigning them to sub-teams.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
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
                                                        title={canEdit ? undefined : 'This season is archived and read-only'}
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
