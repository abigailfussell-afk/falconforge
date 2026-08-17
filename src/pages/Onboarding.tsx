import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Users, Plus, Key, Clock, LogOut, Loader2, ChevronRight, CheckCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabaseSync } from '../lib/supabase';
import { useAppStore } from '../lib/store';
import { performSignOut } from '../lib/sign-out';
import { readReturnTo } from '../lib/navigation';
import { CompleteProfileForm } from '../components/auth/CompleteProfileForm';
import type { Team, AgeClassification } from '../types';

interface PendingTeam {
    teamId: string;
    teamName: string;
    status: 'pending' | 'approved' | 'removed';
}

export default function Onboarding() {
    const navigate = useNavigate();
    const location = useLocation();
    /**
     * Where the visitor was going before they were asked to sign in — a scanned QR, usually.
     * Null for anybody who simply opened the app.
     */
    const returnTo = readReturnTo(location.search);
    const { user, signOut, ageClassification, updateAgeClassification } = useAuth();
    const { teams, setTeams, setCurrentTeam, currentTeamId } = useAppStore();
    const [pendingTeams, setPendingTeams] = useState<PendingTeam[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [profileCompleteError, setProfileCompleteError] = useState<string | null>(null);
    const [profileCompleteSuccess, setProfileCompleteSuccess] = useState(false);

    useEffect(() => {
        void loadTeams();
    }, [user]);

    const loadTeams = async () => {
        // Safety timeout: don't let loading screen hang forever
        const loadTimeout = setTimeout(() => {
            console.warn('loadTeams timed out after 8 seconds');
            setIsLoading(false);
        }, 8000);

        if (!supabaseSync || !user) {
            clearTimeout(loadTimeout);
            setIsLoading(false);
            return;
        }

        try {
            // Get all team memberships for the current user
            const { data: memberships, error } = await supabaseSync
                .from('team_members')
                .select(`
                    team_id,
                    status,
                    teams:team_id (
                        id,
                        name,
                        team_number,
                        owner_id
                    )
                `)
                .eq('user_id', user.id) as { data: any[] | null; error: any };

            if (error) {
                console.error('Error loading teams:', error);
                clearTimeout(loadTimeout);
                setIsLoading(false);
                return;
            }

            if (memberships && memberships.length > 0) {
                // Get approved teams
                const approved = memberships.filter(m => m.status === 'approved');
                if (approved.length > 0) {
                    // Build teams array for the store
                    const approvedTeams: Team[] = approved.map(m => ({
                        id: m.teams?.id || m.team_id,
                        name: m.teams?.name || 'Unknown Team',
                        teamNumber: m.teams?.team_number || null,
                        ownerId: m.teams?.owner_id || '',
                        createdAt: Date.now(),
                    }));

                    // Populate the store
                    setTeams(approvedTeams);
                }

                // Get pending teams
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
            clearTimeout(loadTimeout);
            setIsLoading(false);
        }
    };

    /*
     * Pick a team, and let the ONE read path load it.
     *
     * This used to do its own `.from('seasons').select(...)` with a hand-written row-to-
     * Season mapping — a fourth read path that C3 missed because it reads only one table on
     * one screen. It was wrong in three ways that all follow from being hand-written:
     *
     *   * It listed columns explicitly, so `is_archived` and `game_title` were simply
     *     dropped. A user arriving through this screen would have seen every archived season
     *     as editable until the next background pull corrected it.
     *   * It had never heard of the sync queue, so a season created offline and still
     *     queued was replaced by the server's copy — B3, in the one place it had not been
     *     fixed.
     *   * It needed a network. With none, it silently did nothing, which is not what an
     *     offline-first app should do on its team picker.
     *
     * `Dashboard` calls `fetchTeamData(currentTeamId)` on mount, which pulls seasons through
     * `pullFromServer` with the registry's mapping and the pending-record protection. There
     * was never anything for this to add.
     */
    const handleSelectTeam = (teamId: string) => {
        setCurrentTeam(teamId);
        // `/` bounces to the dashboard. A visitor who was going somewhere specific gets to
        // finish the journey they started at the poster.
        navigate(returnTo ?? '/');
    };

    /*
     * One team and somewhere to be: skip the picker.
     *
     * The picker exists because an account can belong to several teams, and asking is right
     * when the answer is genuinely ambiguous. It is not ambiguous for a student with one team
     * who has just pointed their camera at a poster — there, the screen is a speed bump
     * between them and the thing they scanned.
     *
     * Deliberately narrow: only with a pending `returnTo`, and only when the choice is
     * forced. Opening the app normally still shows the picker, which is what the existing
     * flow and its tests describe.
     */
    useEffect(() => {
        if (!returnTo || isLoading) return;
        if (teams.length !== 1) return;
        if (currentTeamId === teams[0].id) {
            navigate(returnTo, { replace: true });
            return;
        }
        setCurrentTeam(teams[0].id);
    }, [returnTo, isLoading, teams, currentTeamId, setCurrentTeam, navigate]);

    const handleSignOut = () => performSignOut(signOut);

    const handleProfileComplete = async (selectedAge: AgeClassification) => {
        setIsLoading(true);
        setProfileCompleteError(null);

        try {
            // Need to update the age via API since user is already created.
            // `updateAgeClassification` comes from the hook call in the component body --
            // calling useAuth() here would break the rules of hooks and throw (C2).
            const { error, success } = await updateAgeClassification(selectedAge);

            if (!success || error) {
                setProfileCompleteError(error?.message || 'Failed to update profile');
                setIsLoading(false);
                return;
            }

            setProfileCompleteSuccess(true);
            setTimeout(() => {
                setProfileCompleteSuccess(false);
            }, 3000);

        } catch (err: any) {
            setProfileCompleteError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="text-center">
                    {/* Logo with pulsing gradient backdrop */}
                    <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6">
                        {/* Pulsing gradient background */}
                        <div className="absolute inset-0 bg-gradient-to-r from-forge-500 to-amber-500 rounded-3xl blur-xl opacity-30 animate-pulse"></div>
                        {/* Logo container */}
                        <div className="relative w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 p-2">
                            <img
                                src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                className="w-full h-full object-contain"
                                alt="FalconForge Logo"
                            />
                        </div>
                    </div>
                    <Loader2 className="w-12 h-12 text-forge-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Loading your teams...</p>
                </div>
            </div>
        );
    }

    // Force profile completion if missing
    if (user && !ageClassification) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 mb-4 p-2">
                            <img
                                src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                className="w-full h-full object-contain"
                                alt="FalconForge Logo"
                            />
                        </div>
                        <h1 className="text-3xl font-black italic tracking-tighter mb-2">
                            <span className="text-white">Almost </span>
                            <span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">Done!</span>
                        </h1>
                        <p className="text-slate-400">
                            Please complete your profile configuration to continue.
                        </p>
                    </div>

                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-xl overflow-hidden p-6">
                        {profileCompleteSuccess ? (
                            <div className="text-center py-4">
                                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full mb-4">
                                    <CheckCircle className="w-10 h-10 text-green-500" />
                                </div>
                                <h2 className="text-xl font-semibold text-white mb-2">Profile Complete!</h2>
                                <p className="text-slate-400">Loading your teams...</p>
                                <Loader2 className="w-6 h-6 animate-spin text-forge-500 mx-auto mt-4" />
                            </div>
                        ) : (
                            <>
                                <CompleteProfileForm
                                    isLoading={isLoading}
                                    error={profileCompleteError}
                                    onSubmit={handleProfileComplete}
                                    submitLabel="Complete Setup"
                                />
                                <div className="mt-8 pt-6 border-t border-slate-700/50 text-center">
                                    <button
                                        onClick={handleSignOut}
                                        className="text-sm text-slate-400 hover:text-red-400 transition-colors flex items-center justify-center gap-2 mx-auto"
                                    >
                                        <LogOut size={16} />
                                        Log Out
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4" data-testid="team-picker">
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
                        <span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span>
                        <span className="text-slate-300">FORGE</span>
                    </h1>
                    <p className="text-slate-400">
                        {teams.length > 0 ? 'Select a team to continue' : 'Welcome! Let\'s get you set up.'}
                    </p>
                </div>

                {/* Main Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-xl overflow-hidden">
                    {/* User Info */}
                    {user && (
                        <div className="px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-forge-500/20 rounded-full flex items-center justify-center">
                                    <Users size={20} className="text-forge-400" />
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

                    {/* Approved Teams Section */}
                    {teams.length > 0 && (
                        <div className="p-4 border-b border-slate-700/50">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-2">Your Teams</p>
                            <div className="space-y-2">
                                {teams.map((team) => (
                                    <button
                                        key={team.id}
                                        onClick={() => handleSelectTeam(team.id)}
                                        data-testid="team-option"
                                        className={`w-full flex items-center justify-between p-4 rounded-xl transition-all ${currentTeamId === team.id
                                            ? 'bg-forge-500/20 border border-forge-500/50 text-forge-400'
                                            : 'bg-slate-700/30 hover:bg-slate-700/50 border border-transparent text-white'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm ${currentTeamId === team.id
                                                ? 'bg-forge-500/30 text-forge-400'
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
                            </div>
                        </div>
                    )}

                    {/* Pending Teams Section */}
                    {pendingTeams.length > 0 && (
                        <div className="p-4 border-b border-slate-700/50">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-2">Pending Invitations</p>
                            <div className="space-y-2">
                                {pendingTeams.map((team) => (
                                    <div
                                        key={team.teamId}
                                        className="bg-slate-700/30 border border-slate-600/50 rounded-xl p-4 flex items-center"
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
                        </div>
                    )}

                    {/* Actions */}
                    <div className="p-4 space-y-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-2">
                            {teams.length > 0 || pendingTeams.length > 0 ? 'Or...' : 'Get Started'}
                        </p>

                        {ageClassification === '18_plus' && (
                            <button
                                onClick={() => navigate('/create-team')}
                                className="w-full flex items-center gap-4 bg-gradient-to-r from-forge-500 to-forge-600 hover:from-forge-600 hover:to-forge-700 text-white font-semibold py-4 px-5 rounded-xl transition-all shadow-lg shadow-forge-500/20"
                            >
                                <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                                    <Plus size={22} />
                                </div>
                                <div className="text-left">
                                    <p className="font-semibold">Create a Team</p>
                                    <p className="text-sm text-forge-100/80">For coaches starting a new team</p>
                                </div>
                            </button>
                        )}

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
