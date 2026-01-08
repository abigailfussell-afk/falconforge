import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Key, ChevronRight, LogOut } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useAuth } from '../lib/auth';

interface TeamPickerProps {
    onTeamSelected?: () => void;
}

const TeamPicker: React.FC<TeamPickerProps> = ({ onTeamSelected }) => {
    const navigate = useNavigate();
    const { user, signOut, isConfigured, ageClassification } = useAuth();
    const { teams, setCurrentTeam, currentTeamId } = useAppStore();
    const [showJoinTeam, setShowJoinTeam] = useState(false);
    const [inviteCode, setInviteCode] = useState('');
    const [isJoining, setIsJoining] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);

    const handleSelectTeam = (teamId: string) => {
        setCurrentTeam(teamId);
        if (onTeamSelected) {
            onTeamSelected();
        } else {
            navigate('/');
        }
    };

    const handleJoinTeam = async () => {
        if (!inviteCode.trim()) {
            setJoinError('Please enter an invite code');
            return;
        }

        setIsJoining(true);
        setJoinError(null);

        try {
            // TODO: Implement actual join team via Supabase RPC
            // For now, just show an error
            setJoinError('Team joining via invite code is not yet implemented');
        } catch (error: any) {
            setJoinError(error.message || 'Failed to join team');
        } finally {
            setIsJoining(false);
        }
    };

    const handleCreateTeam = () => {
        // TODO: Navigate to team creation flow
        navigate('/create-team');
    };

    const handleSignOut = async () => {
        await signOut();
        // Use window.location for a clean redirect to ensure auth state is cleared
        window.location.href = `${import.meta.env.BASE_URL}#/login`;
    };

    // If no teams and no pending, redirect to onboarding
    if (teams.length === 0) {
        // Will be checked after render - could redirect in useEffect
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
            {/* Header - Matches Login page styling */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 mb-4 p-2">
                    <img
                        src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                        className="w-full h-full object-contain"
                        alt="FalconForge Logo"
                    />
                </div>
                <h1 className="text-3xl font-black italic tracking-tighter mb-2">
                    <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span>
                    <span className="text-slate-300">FORGE</span>
                </h1>
                <p className="text-slate-400">Select a team to continue</p>
            </div>

            {/* Team List Card */}
            <div className="w-full max-w-md bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden">
                {/* User Info */}
                {isConfigured && user && (
                    <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-orange-500/20 rounded-full flex items-center justify-center">
                                <Users size={20} className="text-orange-400" />
                            </div>
                            <div>
                                <p className="font-medium text-white">{user.user_metadata?.full_name || user.email}</p>
                                <p className="text-xs text-slate-400">{user.email}</p>
                            </div>
                        </div>
                        <button
                            onClick={handleSignOut}
                            className="p-2 text-slate-400 hover:text-red-400 transition-colors"
                            title="Sign out"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                )}

                {/* Teams List */}
                <div className="p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">Your Teams</p>

                    {teams.map((team) => (
                        <button
                            key={team.id}
                            onClick={() => handleSelectTeam(team.id)}
                            className={`w-full flex items-center justify-between p-4 rounded-xl transition-all ${currentTeamId === team.id
                                ? 'bg-orange-500/20 border border-orange-500/50 text-orange-400'
                                : 'bg-slate-700/30 hover:bg-slate-700/50 border border-transparent text-white'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${currentTeamId === team.id
                                    ? 'bg-orange-500/30 text-orange-400'
                                    : 'bg-slate-600 text-slate-300'
                                    }`}>
                                    {team.teamNumber ? `#${team.teamNumber.slice(-3)}` : team.name.charAt(0)}
                                </div>
                                <div className="text-left">
                                    <p className="font-semibold">{team.name}</p>
                                    {team.teamNumber && (
                                        <p className="text-xs text-slate-400">Team #{team.teamNumber}</p>
                                    )}
                                </div>
                            </div>
                            <ChevronRight size={20} className="text-slate-400" />
                        </button>
                    ))}

                    {teams.length === 0 && (
                        <div className="text-center py-8 text-slate-400">
                            <Users size={40} className="mx-auto mb-3 opacity-50" />
                            <p>You're not a member of any teams yet.</p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="p-4 border-t border-slate-700/50 space-y-3">
                    {!showJoinTeam ? (
                        <>
                            {ageClassification === '18_plus' && (
                                <button
                                    onClick={handleCreateTeam}
                                    className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                                >
                                    <Plus size={20} />
                                    Create a Team
                                </button>
                            )}
                            <button
                                onClick={() => navigate('/join')}
                                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors"
                            >
                                <Key size={20} />
                                Join with Invite Code
                            </button>
                        </>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                    placeholder="Enter invite code"
                                    className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    maxLength={10}
                                />
                                <button
                                    onClick={handleJoinTeam}
                                    disabled={isJoining}
                                    className="bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                                >
                                    {isJoining ? '...' : 'Join'}
                                </button>
                            </div>
                            {joinError && (
                                <p className="text-red-400 text-sm text-center">{joinError}</p>
                            )}
                            <button
                                onClick={() => { setShowJoinTeam(false); setJoinError(null); }}
                                className="w-full text-slate-400 hover:text-white text-sm py-2 transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TeamPicker;
