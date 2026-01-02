import React, { useState } from 'react';
import { Trash2, Plus, Users, Layers, UserPlus, Check } from 'lucide-react';
import { Member, Team } from '../types';

interface AdminSettingsProps {
    members: Member[];
    setMembers: (members: Member[]) => void;
    teams: Team[];
    setTeams: (teams: Team[]) => void;
}

const AdminSettings: React.FC<AdminSettingsProps> = ({ members, setMembers, teams, setTeams }) => {
    const [firstName, setFirstName] = useState('');
    const [lastInitial, setLastInitial] = useState('');
    const [newTeamName, setNewTeamName] = useState('');
    const [editingTeamId, setEditingTeamId] = useState<string | null>(null);

    const addMember = () => {
        if (firstName.trim() && lastInitial.trim().length === 1) {
            const newMember: Member = {
                id: Date.now().toString(),
                firstName: firstName.trim(),
                lastNameInitial: lastInitial.trim().toUpperCase()
            };
            setMembers([...members, newMember]);
            setFirstName('');
            setLastInitial('');
        } else {
            alert("Please provide a First Name and a single letter Last Initial.");
        }
    };

    const removeMember = (id: string) => {
        setMembers(members.filter(m => m.id !== id));
        // Remove from teams as well
        setTeams(teams.map(t => ({
            ...t,
            memberIds: t.memberIds.filter(mid => mid !== id)
        })));
    };

    const addTeam = () => {
        if (newTeamName.trim()) {
            const newTeam: Team = {
                id: Date.now().toString(),
                name: newTeamName.trim(),
                memberIds: []
            };
            setTeams([...teams, newTeam]);
            setNewTeamName('');
        }
    };

    const removeTeam = (id: string) => {
        setTeams(teams.filter(t => t.id !== id));
    };

    const toggleMemberInTeam = (teamId: string, memberId: string) => {
        setTeams(teams.map(t => {
            if (t.id !== teamId) return t;
            const isMember = t.memberIds.includes(memberId);
            return {
                ...t,
                memberIds: isMember
                    ? t.memberIds.filter(id => id !== memberId)
                    : [...t.memberIds, memberId]
            };
        }));
    };

    return (
        <div className="p-6 max-w-6xl mx-auto w-full h-full overflow-y-auto">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">Admin Settings</h2>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Members Management */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <Users className="text-orange-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Team Roster</h3>
                    </div>

                    <div className="flex gap-2 mb-4 items-end">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">First Name</label>
                            <input
                                type="text"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="e.g. Abby"
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                            />
                        </div>
                        <div className="w-20">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400">Last Init.</label>
                            <input
                                type="text"
                                value={lastInitial}
                                maxLength={1}
                                onChange={(e) => setLastInitial(e.target.value)}
                                placeholder="B"
                                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-center"
                                onKeyDown={(e) => e.key === 'Enter' && addMember()}
                            />
                        </div>
                        <button
                            onClick={addMember}
                            className="bg-orange-600 text-white p-2.5 rounded-lg hover:bg-orange-700 transition mb-[1px]"
                        >
                            <UserPlus size={20} />
                        </button>
                    </div>

                    <ul className="space-y-2 max-h-96 overflow-y-auto pr-2">
                        {members.map((member) => (
                            <li key={member.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg group hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-xs">
                                        {member.firstName[0]}{member.lastNameInitial}
                                    </div>
                                    <span className="font-medium text-slate-700 dark:text-slate-200">{member.firstName} {member.lastNameInitial}.</span>
                                </div>
                                <button
                                    onClick={() => removeMember(member.id)}
                                    className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Teams Management */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <Layers className="text-orange-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Sub-Teams & Assignments</h3>
                    </div>

                    <div className="flex gap-2 mb-4">
                        <input
                            type="text"
                            value={newTeamName}
                            onChange={(e) => setNewTeamName(e.target.value)}
                            placeholder="New Team Name (e.g. Pit Crew)"
                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                            onKeyDown={(e) => e.key === 'Enter' && addTeam()}
                        />
                        <button
                            onClick={addTeam}
                            className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition"
                        >
                            <Plus size={20} />
                        </button>
                    </div>

                    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                        {teams.map((team) => (
                            <div key={team.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                                <div className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50">
                                    <h4 className="font-bold text-slate-700 dark:text-slate-200">{team.name}</h4>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setEditingTeamId(editingTeamId === team.id ? null : team.id)}
                                            className={`text-xs px-3 py-1 rounded-full transition ${editingTeamId === team.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                        >
                                            {editingTeamId === team.id ? 'Done' : 'Manage Members'}
                                        </button>
                                        <button
                                            onClick={() => removeTeam(team.id)}
                                            className="text-slate-400 hover:text-red-500"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>

                                {/* Member List for this Team */}
                                <div className="p-3 bg-white dark:bg-slate-800">
                                    {editingTeamId === team.id ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            {members.map(m => (
                                                <div
                                                    key={m.id}
                                                    onClick={() => toggleMemberInTeam(team.id, m.id)}
                                                    className={`cursor-pointer p-2 rounded border flex items-center justify-between text-sm ${team.memberIds.includes(m.id) ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400'}`}
                                                >
                                                    <span>{m.firstName} {m.lastNameInitial}.</span>
                                                    {team.memberIds.includes(m.id) && <Check size={14} />}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {team.memberIds.length === 0 && <span className="text-xs text-slate-400 italic">No members assigned.</span>}
                                            {team.memberIds.map(mid => {
                                                const m = members.find(mem => mem.id === mid);
                                                if (!m) return null;
                                                return (
                                                    <span key={mid} className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded-full border border-slate-200 dark:border-slate-600">
                                                        {m.firstName} {m.lastNameInitial}.
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminSettings;
