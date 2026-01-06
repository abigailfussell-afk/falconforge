import React, { useState, useEffect } from 'react';
import { Trash2, Plus, Users, Layers, UserPlus, Check, Calendar, AlertTriangle, Search, WifiOff, X, AtSign, User, Save, Edit3 } from 'lucide-react';
import { Member, Team } from '../../types';
import { useAppStore } from '../lib/store';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useCurrentUser } from '../lib/user-context';
import { useAuth } from '../lib/auth';

interface SupabaseUser {
    id: string;
    email: string;
    full_name: string | null;
}

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

    // Supabase user search state
    const [userSearch, setUserSearch] = useState('');
    const [searchResults, setSearchResults] = useState<SupabaseUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const { isOffline } = useCurrentUser();

    // Season Manager state
    const seasons = useAppStore((state) => state.seasons);
    const currentSeasonId = useAppStore((state) => state.currentSeasonId);
    const addSeason = useAppStore((state) => state.addSeason);
    const updateSeason = useAppStore((state) => state.updateSeason);
    const deleteSeason = useAppStore((state) => state.deleteSeason);
    const [newSeasonName, setNewSeasonName] = useState('');
    const [editingSeasonId, setEditingSeasonId] = useState<string | null>(null);
    const [editSeasonName, setEditSeasonName] = useState('');
    const [editFieldImageUrl, setEditFieldImageUrl] = useState('');
    const [deleteConfirmSeasonId, setDeleteConfirmSeasonId] = useState<string | null>(null);

    // Profile editing state
    const { user, updateProfile, isConfigured } = useAuth();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editDisplayName, setEditDisplayName] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const handleSaveProfile = async () => {
        if (!editDisplayName.trim()) return;

        setIsSavingProfile(true);
        setProfileMessage(null);

        const { error } = await updateProfile(editDisplayName.trim());

        if (error) {
            setProfileMessage({ type: 'error', text: error.message });
        } else {
            setProfileMessage({ type: 'success', text: 'Profile updated successfully!' });
            setIsEditingProfile(false);
        }
        setIsSavingProfile(false);
    };

    // Search for users in Supabase
    const searchUsers = async (query: string) => {
        if (!query.trim() || !supabase || !isSupabaseConfigured() || isOffline) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id, email, full_name')
                .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
                .limit(10);

            if (error) throw error;
            setSearchResults((data as SupabaseUser[]) || []);
        } catch (error) {
            console.error('Error searching users:', error);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
        }
    };

    // Debounced search effect
    useEffect(() => {
        if (!showSearch || !userSearch.trim()) {
            setSearchResults([]);
            return;
        }

        const timer = setTimeout(() => {
            searchUsers(userSearch);
        }, 300);

        return () => clearTimeout(timer);
    }, [userSearch, showSearch, isOffline]);

    // Add a user from search results to the roster
    const addUserFromSearch = (user: SupabaseUser) => {
        const nameParts = user.full_name?.trim().split(/\s+/) || [user.email.split('@')[0]];
        const firstNameVal = nameParts[0] || 'User';
        const lastInitialVal = nameParts.length > 1 ? nameParts[nameParts.length - 1][0] : firstNameVal[0];

        const newMember: Member = {
            id: user.id, // Use the Supabase user ID
            firstName: firstNameVal,
            lastNameInitial: lastInitialVal.toUpperCase()
        };
        setMembers([...members, newMember]);
        setUserSearch('');
        setSearchResults([]);
        setShowSearch(false);
    };

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
        <div className="max-w-6xl mx-auto w-full h-full overflow-y-auto overflow-x-hidden">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-4">Admin Settings</h2>

            {/* Profile Section - only show when logged in with Supabase */}
            {isConfigured && user && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mb-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <User className="text-orange-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Your Profile</h3>
                    </div>

                    {/* Profile Message */}
                    {profileMessage && (
                        <div className={`mb-4 p-3 rounded-lg text-sm ${profileMessage.type === 'success'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                            }`}>
                            {profileMessage.text}
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-3 flex-1">
                            <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center">
                                <User size={24} className="text-orange-600 dark:text-orange-400" />
                            </div>
                            <div className="flex-1">
                                {isEditingProfile ? (
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={editDisplayName}
                                            onChange={(e) => setEditDisplayName(e.target.value)}
                                            placeholder="Enter your name"
                                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                                            autoFocus
                                        />
                                        <button
                                            onClick={handleSaveProfile}
                                            disabled={isSavingProfile || !editDisplayName.trim()}
                                            className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition disabled:opacity-50"
                                        >
                                            <Save size={18} />
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsEditingProfile(false);
                                                setProfileMessage(null);
                                            }}
                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-2"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <p className="font-semibold text-slate-800 dark:text-white">
                                            {user.user_metadata?.full_name || 'No name set'}
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
                                    </>
                                )}
                            </div>
                        </div>
                        {!isEditingProfile && (
                            <button
                                onClick={() => {
                                    setEditDisplayName(user.user_metadata?.full_name || '');
                                    setIsEditingProfile(true);
                                    setProfileMessage(null);
                                }}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                            >
                                <Edit3 size={16} />
                                Edit Name
                            </button>
                        )}
                    </div>
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8">
                {/* Members Management */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6">
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <Users className="text-orange-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Team Roster</h3>
                    </div>

                    {/* Toggle between search and manual entry */}
                    {isSupabaseConfigured() && !isOffline && (
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setShowSearch(false)}
                                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${!showSearch
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                    }`}
                            >
                                <UserPlus size={16} className="inline mr-2" />
                                Manual Entry
                            </button>
                            <button
                                onClick={() => setShowSearch(true)}
                                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${showSearch
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
                                    }`}
                            >
                                <Search size={16} className="inline mr-2" />
                                Find User
                            </button>
                        </div>
                    )}

                    {/* Offline indicator */}
                    {isSupabaseConfigured() && isOffline && (
                        <div className="flex items-center gap-2 mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                            <WifiOff size={16} />
                            <span>Search unavailable offline. Use manual entry below.</span>
                        </div>
                    )}

                    {/* User Search Mode */}
                    {showSearch && !isOffline && isSupabaseConfigured() ? (
                        <div className="mb-4">
                            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 block">
                                Search by name or email
                            </label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={userSearch}
                                    onChange={(e) => setUserSearch(e.target.value)}
                                    placeholder="Type a name or email..."
                                    className="w-full p-2 pl-9 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                />
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                {userSearch && (
                                    <button
                                        onClick={() => setUserSearch('')}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Search Results */}
                            {isSearching && (
                                <div className="mt-2 p-3 text-center text-slate-500 dark:text-slate-400 text-sm">
                                    Searching...
                                </div>
                            )}
                            {!isSearching && searchResults.length > 0 && (
                                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                                    {searchResults.map((user) => (
                                        <li
                                            key={user.id}
                                            onClick={() => addUserFromSearch(user)}
                                            className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-orange-50 dark:hover:bg-orange-900/20 transition"
                                        >
                                            <div className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/50 flex items-center justify-center text-orange-600 dark:text-orange-400 font-bold text-xs">
                                                {user.full_name?.[0]?.toUpperCase() || user.email[0].toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-slate-700 dark:text-slate-200 truncate">
                                                    {user.full_name || 'No name'}
                                                </div>
                                                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
                                                    <AtSign size={10} />
                                                    {user.email}
                                                </div>
                                            </div>
                                            <Plus size={18} className="text-orange-600 dark:text-orange-400 flex-shrink-0" />
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {!isSearching && userSearch && searchResults.length === 0 && (
                                <div className="mt-2 p-3 text-center text-slate-500 dark:text-slate-400 text-sm">
                                    No users found. Try a different search or use manual entry.
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Manual Entry Mode */
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
                    )}

                    {/* Member List or Empty State */}
                    {members.length === 0 ? (
                        <div className="text-center py-8 px-4">
                            <Users size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                            <h4 className="font-semibold text-slate-600 dark:text-slate-400 mb-2">No team members yet</h4>
                            <p className="text-sm text-slate-500 dark:text-slate-500">
                                {isSupabaseConfigured() && !isOffline
                                    ? 'Use "Find User" to search for existing accounts, or "Manual Entry" to add members by name.'
                                    : 'Add team members by entering their first name and last initial above.'}
                            </p>
                        </div>
                    ) : (
                        <ul className="space-y-2 max-h-96 overflow-y-auto pr-1 custom-scrollbar">
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
                    )}
                </div>

                {/* Teams Management */}
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6">
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
                            className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition flex items-center justify-center w-10 h-10"
                        >
                            <Plus size={20} />
                        </button>
                    </div>

                    {/* Teams List or Empty State */}
                    {teams.length === 0 ? (
                        <div className="text-center py-8 px-4">
                            <Layers size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                            <h4 className="font-semibold text-slate-600 dark:text-slate-400 mb-2">No sub-teams yet</h4>
                            <p className="text-sm text-slate-500 dark:text-slate-500">
                                Create sub-teams to organize your members by role (e.g., Pit Crew, Drivers, Build Team). Add a team using the form above, then assign members to it.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                            {teams.map((team) => (
                                <div key={team.id} className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                                    <div className="flex flex-wrap justify-between items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50">
                                        <h4 className="font-bold text-slate-700 dark:text-slate-200">{team.name}</h4>
                                        <div className="flex gap-2 items-center">
                                            <button
                                                onClick={() => setEditingTeamId(editingTeamId === team.id ? null : team.id)}
                                                className={`text-xs px-3 py-1.5 rounded-full transition ${editingTeamId === team.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                            >
                                                {editingTeamId === team.id ? 'Done' : 'Manage Members'}
                                            </button>
                                            <button
                                                onClick={() => removeTeam(team.id)}
                                                className="text-slate-400 hover:text-red-500 p-1"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Member List for this Team */}
                                    <div className="p-3 bg-white dark:bg-slate-800">
                                        {editingTeamId === team.id ? (
                                            members.length === 0 ? (
                                                <p className="text-xs text-slate-400 italic">Add members to your Team Roster first before assigning them to sub-teams.</p>
                                            ) : (
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
                                            )
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
                    )}
                </div>
            </div>

            {/* Season Manager */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6 mt-6">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                    <Calendar className="text-orange-600" size={24} />
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Season Manager</h3>
                </div>

                {/* Create New Season */}
                <div className="flex gap-2 mb-4">
                    <input
                        type="text"
                        value={newSeasonName}
                        onChange={(e) => setNewSeasonName(e.target.value)}
                        placeholder="New Season Name (e.g. 2025-2026 Decode)"
                        className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                        onKeyDown={(e) => e.key === 'Enter' && newSeasonName.trim() && (addSeason(newSeasonName.trim()), setNewSeasonName(''))}
                    />
                    <button
                        onClick={() => { if (newSeasonName.trim()) { addSeason(newSeasonName.trim()); setNewSeasonName(''); } }}
                        className="bg-orange-600 text-white p-2 rounded-lg hover:bg-orange-700 transition flex items-center justify-center w-10 h-10"
                    >
                        <Plus size={20} />
                    </button>
                </div>

                {/* Season List */}
                <div className="space-y-3">
                    {seasons.map((season) => (
                        <div key={season.id} className={`border rounded-lg overflow-hidden ${currentSeasonId === season.id ? 'border-orange-400 ring-2 ring-orange-200 dark:ring-orange-900/50' : 'border-slate-200 dark:border-slate-600'}`}>
                            <div className="flex flex-wrap justify-between items-center gap-2 p-3 bg-slate-50 dark:bg-slate-700/50">
                                <div className="flex items-center gap-2">
                                    {currentSeasonId === season.id && (
                                        <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full font-bold">Active</span>
                                    )}
                                    <h4 className="font-bold text-slate-700 dark:text-slate-200">{season.name}</h4>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <button
                                        onClick={() => {
                                            if (editingSeasonId === season.id) {
                                                setEditingSeasonId(null);
                                            } else {
                                                setEditingSeasonId(season.id);
                                                setEditSeasonName(season.name);
                                                setEditFieldImageUrl(season.fieldImageUrl || '');
                                            }
                                        }}
                                        className={`text-xs px-3 py-1.5 rounded-full transition ${editingSeasonId === season.id ? 'bg-orange-100 text-orange-700' : 'bg-white dark:bg-slate-600 text-slate-600 dark:text-slate-300'}`}
                                    >
                                        {editingSeasonId === season.id ? 'Done' : 'Edit'}
                                    </button>
                                    {seasons.length > 1 && (
                                        <button
                                            onClick={() => setDeleteConfirmSeasonId(season.id)}
                                            className="text-slate-400 hover:text-red-500 p-1"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Season Edit Form */}
                            {editingSeasonId === season.id && (
                                <div className="p-3 bg-white dark:bg-slate-800 space-y-3">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Season Name</label>
                                        <input
                                            type="text"
                                            value={editSeasonName}
                                            onChange={(e) => setEditSeasonName(e.target.value)}
                                            onBlur={() => editSeasonName.trim() && updateSeason(season.id, { name: editSeasonName.trim() })}
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 block mb-1">Field Image URL (for Match Planner)</label>
                                        <input
                                            type="text"
                                            value={editFieldImageUrl}
                                            onChange={(e) => setEditFieldImageUrl(e.target.value)}
                                            onBlur={() => updateSeason(season.id, { fieldImageUrl: editFieldImageUrl })}
                                            placeholder="https://example.com/field.png (1200x800 recommended)"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white text-sm"
                                        />
                                        <p className="text-[10px] text-slate-400 mt-1">Recommended dimensions: 1200×800 pixels (3:2 ratio)</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Delete Season Confirmation Modal */}
            {deleteConfirmSeasonId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-800 rounded-xl p-6 max-w-md w-full shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                                <AlertTriangle className="text-red-600" size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Delete Season?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-2">
                            <strong>Warning:</strong> This will permanently delete the season <strong>"{seasons.find(s => s.id === deleteConfirmSeasonId)?.name}"</strong> and ALL associated data:
                        </p>
                        <ul className="text-sm text-slate-500 dark:text-slate-400 list-disc list-inside mb-4">
                            <li>All tasks</li>
                            <li>All team members</li>
                            <li>All scouting reports</li>
                            <li>All match plans</li>
                            <li>All portfolio entries</li>
                        </ul>
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium mb-6">This action cannot be undone.</p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setDeleteConfirmSeasonId(null)}
                                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { deleteSeason(deleteConfirmSeasonId); setDeleteConfirmSeasonId(null); }}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition"
                            >
                                Delete Season
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminSettings;
