import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Users, AlertCircle, CheckCircle, LogOut, UserPlus } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { performSignOut } from '../lib/sign-out';
import { CompleteProfileForm } from '../components/auth/CompleteProfileForm';
import type { AgeClassification } from '../types';

export default function JoinTeam() {
    const navigate = useNavigate();
    const { code: urlCode } = useParams<{ code?: string }>();
    const { user, isConfigured, ageClassification, signOut, updateAgeClassification } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [profileCompleteError, setProfileCompleteError] = useState<string | null>(null);

    // Form state
    const [inviteCode, setInviteCode] = useState(urlCode || '');
    const [teamName, setTeamName] = useState<string | null>(null);

    // If code provided in URL, set it
    useEffect(() => {
        if (urlCode && urlCode.length >= 6) {
            setInviteCode(urlCode);
        }
    }, [urlCode]);

    const joinTeam = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        if (!supabase || !user) {
            setError('Not authenticated');
            return;
        }

        if (inviteCode.trim().length < 6) {
            setError('Please enter a valid invite code');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Call the join team function - no extra params needed, age is already on user profile
            const { data, error: rpcError } = await supabase.rpc('join_team_with_invite', {
                invite_code: inviteCode.trim().toUpperCase(),
            });

            if (rpcError) {
                console.error('RPC error:', rpcError);
                setError(rpcError.message);
                setIsLoading(false);
                return;
            }

            const result = data as { success: boolean; team_name?: string; status?: string; error?: string };

            if (!result.success) {
                setError(result.error || 'Failed to join team');
                setIsLoading(false);
                return;
            }

            setTeamName(result.team_name || 'Team');
            setSuccess(true);
        } catch (err: any) {
            console.error('Exception joining team:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    /*
     * A THIRD copy of sign-out used to live here.
     *
     * Sprint 1 collapsed the App.tsx and Onboarding.tsx copies into `performSignOut` for the
     * reason that helper's own doc comment gives — a missed step leaks one user's data into
     * the next session on a shared team laptop — and this one was missed. It had drifted
     * exactly the way that warning predicts: no `teardownRealtimeSubscription()`, so an
     * in-flight subscription could repopulate the store after it was reset, and no
     * `sb-*-auth-token` sweep, so the Supabase session keys survived in localStorage if the
     * network call did not land. It also had no timeouts, so signing out at a venue with
     * unusable WiFi hung on `await signOut()` indefinitely.
     */
    const handleSignOut = async () => {
        setIsSigningOut(true);
        await performSignOut(signOut);
    };

    const handleProfileComplete = async (selectedAge: AgeClassification) => {
        setIsLoading(true);
        setProfileCompleteError(null);
        try {
            const { error, success } = await updateAgeClassification(selectedAge);
            if (!success || error) {
                setProfileCompleteError(error?.message || 'Failed to update profile');
                return;
            }
        } catch (err: any) {
            setProfileCompleteError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    // Signing out state
    if (isSigningOut) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="text-center">
                    <Loader2 className="w-12 h-12 text-forge-500 animate-spin mx-auto mb-4" />
                    <p className="text-slate-400">Signing out securely...</p>
                </div>
            </div>
        );
    }

    // Not configured
    if (!isConfigured) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 max-w-md text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Configuration Required</h2>
                    <p className="text-slate-400 mb-6">Supabase is not configured. Please contact your administrator.</p>
                    <button
                        onClick={handleSignOut}
                        className="text-sm text-slate-400 hover:text-red-400 transition-colors flex items-center justify-center gap-2 mx-auto"
                    >
                        <LogOut size={16} />
                        Log Out
                    </button>
                </div>
            </div>
        );
    }

    // Not logged in
    if (!user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 max-w-md text-center">
                    <Users className="w-12 h-12 text-forge-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Join a Team</h2>
                    <p className="text-slate-400 mb-6">You need to sign in or create an account to join a team.</p>
                    <Link
                        to={`/login?redirect=/join/${inviteCode}`}
                        className="block w-full bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all"
                    >
                        Sign In / Create Account
                    </Link>
                </div>
            </div>
        );
    }

    // User needs to complete profile (no age classification yet)
    if (!ageClassification) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 max-w-md text-center">
                    <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Complete Your Profile</h2>
                    <div className="mb-6">
                        <CompleteProfileForm
                            isLoading={isLoading}
                            error={profileCompleteError}
                            onSubmit={handleProfileComplete}
                            submitLabel="Save and Continue"
                        />
                    </div>
                    <div className="pt-6 border-t border-slate-700/50">
                        <button
                            onClick={handleSignOut}
                            className="text-sm text-slate-400 hover:text-red-400 transition-colors flex items-center justify-center gap-2 mx-auto"
                        >
                            <LogOut size={16} />
                            Log Out
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Success state
    if (success) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/20 rounded-full mb-4">
                            <CheckCircle className="w-10 h-10 text-amber-500" />
                        </div>
                        <h2 className="text-xl font-semibold text-white mb-2">Request Submitted!</h2>
                        <p className="text-slate-400 mb-4">
                            Your request to join <strong className="text-white">{teamName}</strong> has been submitted.
                        </p>
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                            <p className="text-amber-200 text-sm">
                                <strong>Pending Coach Approval</strong><br />
                                You will be able to access the team once a coach approves your membership.
                            </p>
                        </div>
                        <button
                            onClick={() => navigate('/onboarding')}
                            className="w-full bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all"
                        >
                            View My Teams
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Main form - single step!
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
                    <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                    <p className="text-slate-400">Enter the invite code from your coach</p>
                </div>

                {/* Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    <form onSubmit={joinTeam} className="space-y-6">
                        {/* Invite Code Input */}
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Invite Code
                            </label>
                            <input
                                type="text"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                placeholder="Enter invite code"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-4 text-white text-center text-xl font-mono tracking-wider placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500 uppercase"
                                maxLength={12}
                                autoFocus
                            />
                            <p className="text-slate-400 text-xs mt-2 text-center">
                                Ask your coach for the team invite code
                            </p>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                                <p className="text-red-400 text-sm">{error}</p>
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                data-testid="back-button"
                                onClick={() => navigate('/onboarding')}
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                Back
                            </button>
                            <button
                                type="submit"
                                disabled={isLoading || inviteCode.trim().length < 6}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : (
                                    <>
                                        <UserPlus size={18} />
                                        Join Team
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
