import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Key, Clock, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

interface PendingTeam {
    teamId: string;
    teamName: string;
    status: 'pending' | 'approved' | 'removed';
}

export default function Onboarding() {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();
    const [pendingTeams, setPendingTeams] = useState<PendingTeam[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadPendingTeams();
    }, [user]);

    const loadPendingTeams = async () => {
        if (!supabase || !user) {
            setIsLoading(false);
            return;
        }

        try {
            // Get all team memberships for the current user
            const { data: memberships, error } = await supabase
                .from('team_members')
                .select(`
                    team_id,
                    status,
                    teams:team_id (
                        id,
                        name
                    )
                `)
                .eq('user_id', user.id) as { data: any[] | null; error: any };

            if (error) {
                console.error('Error loading teams:', error);
                setIsLoading(false);
                return;
            }

            if (memberships && memberships.length > 0) {
                // Check if any are approved - if so, redirect to team picker
                const approved = memberships.filter(m => m.status === 'approved');
                if (approved.length > 0) {
                    navigate('/teams');
                    return;
                }

                // Show pending teams
                const pending: PendingTeam[] = memberships
                    .filter(m => m.status === 'pending')
                    .map(m => ({
                        teamId: m.team_id,
                        teamName: m.teams?.name || 'Unknown Team',
                        status: m.status as 'pending' | 'approved' | 'removed',
                    }));

                setPendingTeams(pending);
            }
        } catch (err) {
            console.error('Exception loading teams:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignOut = async () => {
        await signOut();
        window.location.href = `${import.meta.env.BASE_URL}#/login`;
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-orange-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Header */}
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
                    <p className="text-slate-400">Welcome! Let's get you set up.</p>
                </div>

                {/* User Info */}
                {user && (
                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-4 mb-6 flex items-center justify-between">
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

                {/* Main Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    {/* Pending Teams Section */}
                    {pendingTeams.length > 0 && (
                        <div className="mb-6">
                            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
                                Pending Invitations
                            </h2>
                            <div className="space-y-3">
                                {pendingTeams.map((team) => (
                                    <div
                                        key={team.teamId}
                                        className="bg-slate-700/30 border border-slate-600/50 rounded-xl p-4 flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                                                <Clock size={20} className="text-amber-400" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-white">{team.teamName}</p>
                                                <p className="text-xs text-amber-400">Pending Coach Approval</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-slate-500 text-xs mt-3 text-center">
                                You'll be able to access these teams once a coach approves your membership.
                            </p>
                        </div>
                    )}

                    {/* Divider */}
                    {pendingTeams.length > 0 && (
                        <div className="relative my-6">
                            <div className="border-t border-slate-700" />
                            <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800 px-3 text-sm text-slate-500">
                                or
                            </span>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="space-y-4">
                        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
                            {pendingTeams.length > 0 ? 'Get Started Another Way' : 'Get Started'}
                        </h2>

                        <button
                            onClick={() => navigate('/create-team')}
                            className="w-full flex items-center gap-4 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white font-semibold py-4 px-5 rounded-xl transition-all shadow-lg shadow-orange-500/20"
                        >
                            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                <Plus size={22} />
                            </div>
                            <div className="text-left">
                                <p className="font-semibold">Create a Team</p>
                                <p className="text-sm text-orange-100/80">For coaches starting a new team</p>
                            </div>
                        </button>

                        <button
                            onClick={() => navigate('/join')}
                            className="w-full flex items-center gap-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-4 px-5 rounded-xl transition-all"
                        >
                            <div className="w-10 h-10 bg-slate-600 rounded-lg flex items-center justify-center">
                                <Key size={22} />
                            </div>
                            <div className="text-left">
                                <p className="font-semibold">Join with Invite Code</p>
                                <p className="text-sm text-slate-400">Get a code from your coach</p>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
