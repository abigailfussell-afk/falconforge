import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Search, WifiOff, X, AtSign, Plus, Trash2 } from 'lucide-react';
import { TeamMember, SubTeam } from '../types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useCurrentUser } from '../lib/user-context';
import { useAppStore } from '../lib/store';

interface SupabaseUser {
    id: string;
    email: string;
    full_name: string | null;
}

interface TeamRosterManagerProps {
    teamMembers: TeamMember[];
    setTeamMembers: (members: TeamMember[]) => void;
    subTeams: SubTeam[];
    setSubTeams: (subTeams: SubTeam[]) => void;
    getMemberDisplayName: (member: TeamMember) => string;
    getMemberInitials: (member: TeamMember) => string;
}

const TeamRosterManager: React.FC<TeamRosterManagerProps> = ({
    teamMembers,
    setTeamMembers,
    subTeams,
    setSubTeams,
    getMemberDisplayName,
    getMemberInitials
}) => {
    const [firstName, setFirstName] = useState('');
    const [lastInitial, setLastInitial] = useState('');
    const [userSearch, setUserSearch] = useState('');
    const [searchResults, setSearchResults] = useState<SupabaseUser[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const { isOffline } = useCurrentUser();
    const currentTeamId = useAppStore((state) => state.currentTeamId);

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

    const addUserFromSearch = (user: SupabaseUser) => {
        const newTeamMember: TeamMember = {
            id: `tm-${Date.now()}`,
            teamId: currentTeamId || 'demo-team-1',
            userId: user.id,
            role: 'student',
            status: 'pending',
            isBillingActive: false,
            fullName: user.full_name,
            email: user.email,
            avatarUrl: null,
            joinedAt: Date.now()
        };
        setTeamMembers([...teamMembers, newTeamMember]);
        setUserSearch('');
        setSearchResults([]);
        setShowSearch(false);
    };

    const addMemberManually = () => {
        if (firstName.trim() && lastInitial.trim().length === 1) {
            const newTeamMember: TeamMember = {
                id: `tm-${Date.now()}`,
                teamId: currentTeamId || 'demo-team-1',
                userId: `manual-${Date.now()}`,
                role: 'student',
                status: 'approved',
                isBillingActive: false,
                fullName: `${firstName.trim()} ${lastInitial.trim().toUpperCase()}.`,
                email: `${firstName.toLowerCase()}@demo.local`,
                avatarUrl: null,
                joinedAt: Date.now()
            };
            setTeamMembers([...teamMembers, newTeamMember]);
            setFirstName('');
            setLastInitial('');
        } else {
            alert("Please provide a First Name and a single letter Last Initial.");
        }
    };

    const removeTeamMember = (id: string) => {
        setTeamMembers(teamMembers.filter(m => m.id !== id));
        setSubTeams(subTeams.map(t => ({
            ...t,
            memberIds: t.memberIds.filter(mid => mid !== id)
        })));
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                <Users className="text-orange-600" size={24} />
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Team Roster</h3>
            </div>

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

            {isSupabaseConfigured() && isOffline && (
                <div className="flex items-center gap-2 mb-4 p-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                    <WifiOff size={16} />
                    <span>Search unavailable offline. Use manual entry below.</span>
                </div>
            )}

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
                            onKeyDown={(e) => e.key === 'Enter' && addMemberManually()}
                        />
                    </div>
                    <button
                        onClick={addMemberManually}
                        className="bg-orange-600 text-white p-2.5 rounded-lg hover:bg-orange-700 transition mb-[1px]"
                    >
                        <UserPlus size={20} />
                    </button>
                </div>
            )}

            {teamMembers.length === 0 ? (
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
                    {teamMembers.map((member) => (
                        <li key={member.id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg group hover:bg-slate-100 dark:hover:bg-slate-700 transition">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center font-bold text-slate-600 dark:text-slate-300 text-xs">
                                    {getMemberInitials(member)}
                                </div>
                                <div>
                                    <span className="font-medium text-slate-700 dark:text-slate-200">{getMemberDisplayName(member)}</span>
                                    <span className="text-xs text-slate-400 dark:text-slate-500 ml-2 capitalize">{member.role}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => removeTeamMember(member.id)}
                                className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                            >
                                <Trash2 size={18} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default TeamRosterManager;
