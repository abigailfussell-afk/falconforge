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
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mb-6">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                <Layers className="text-orange-600" size={24} />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Sub-Teams & Assignments</h3>
            </div>

            <div className="flex gap-2 mb-4">
                <input
                    type="text"
                    value={newSubTeamName}
                    onChange={(e) => setNewSubTeamName(e.target.value)}
                    placeholder="New Sub-Team Name (e.g. Pit Crew)"
                    disabled={!canEdit}
                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white disabled:opacity-50"
                    onKeyDown={(e) => e.key === 'Enter' && addSubTeam()}
                />
                <button
                    data-testid="add-sub-team"
                    onClick={addSubTeam}
                    disabled={!canEdit}
                    title={canEdit ? 'Add sub-team' : 'This season is archived and read-only'}
                    className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition flex items-center justify-center w-10 h-10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Plus size={20} />
                </button>
            </div>

            {subTeams.length === 0 ? (
                <div className="text-center py-8 px-4">
                    <Layers size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                    <h4 className="font-semibold text-slate-600 dark:text-slate-400 mb-2">No sub-teams yet</h4>
                    <p className="text-sm text-slate-500 dark:text-slate-500">
                        Create sub-teams to organize your members by role (e.g., Pit Crew, Drivers, Build Team). Add a sub-team using the form above, then assign members to it.
                    </p>
                </div>
            ) : (
                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                    {subTeams.map((subTeam) => (
                        <div key={subTeam.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                            <div className="flex flex-wrap justify-between items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50">
                                <h4 className="font-bold text-slate-700 dark:text-slate-200">{subTeam.name}</h4>
                                <div className="flex gap-2 items-center">
                                    <button
                                        onClick={() => setEditingSubTeamId(editingSubTeamId === subTeam.id ? null : subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? undefined : 'This season is archived and read-only'}
                                        className={`text-xs px-3 py-1.5 rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed ${editingSubTeamId === subTeam.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {editingSubTeamId === subTeam.id ? 'Done' : 'Manage Members'}
                                    </button>
                                    <button
                                        onClick={() => storeRemoveSubTeam(subTeam.id)}
                                        disabled={!canEdit}
                                        title={canEdit ? 'Delete sub-team' : 'This season is archived and read-only'}
                                        className="text-slate-400 hover:text-red-500 p-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-3 bg-white dark:bg-slate-800">
                                {editingSubTeamId === subTeam.id ? (
                                    teamMembers.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic">Add members to your Team Roster first before assigning them to sub-teams.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {teamMembers.map(m => (
                                                <div
                                                    key={m.id}
                                                    onClick={() => storeToggleMemberInSubTeam(subTeam.id, m.id)}
                                                    className={`cursor-pointer p-2 rounded border flex items-center justify-between text-sm ${subTeam.memberIds.includes(m.id) ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
                                                >
                                                    <span>{getMemberDisplayName(m)}</span>
                                                    {subTeam.memberIds.includes(m.id) && <Check size={14} />}
                                                </div>
                                            ))}
                                        </div>
                                    )
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {subTeam.memberIds.length === 0 && <span className="text-xs text-slate-400 italic">No members assigned.</span>}
                                        {subTeam.memberIds.map(mid => {
                                            const m = teamMembers.find(mem => mem.id === mid);
                                            if (!m) return null;
                                            return (
                                                <span key={mid} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full border border-slate-200 dark:border-slate-600">
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
