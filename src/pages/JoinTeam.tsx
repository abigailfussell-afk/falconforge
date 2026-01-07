import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Users, Shield, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { recordAttestations, MEMBER_REQUIRED_ATTESTATIONS } from '../lib/attestations';

type Step = 'code' | 'privacy' | 'guidelines' | 'age' | 'complete';

export default function JoinTeam() {
    const navigate = useNavigate();
    const { code: urlCode } = useParams<{ code?: string }>();
    const { user, isConfigured } = useAuth();

    const [currentStep, setCurrentStep] = useState<Step>('code');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [inviteCode, setInviteCode] = useState(urlCode || '');
    const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
    const [guidelinesAcknowledged, setGuidelinesAcknowledged] = useState(false);
    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [isUnder13, setIsUnder13] = useState(false);

    // Result state
    const [teamName, setTeamName] = useState<string | null>(null);

    // If code provided in URL, skip to next step
    useEffect(() => {
        if (urlCode && urlCode.length >= 6) {
            setInviteCode(urlCode);
        }
    }, [urlCode]);

    const canProceed = () => {
        switch (currentStep) {
            case 'code': return inviteCode.trim().length >= 6;
            case 'privacy': return privacyAcknowledged;
            case 'guidelines': return guidelinesAcknowledged;
            case 'age': return ageConfirmed || isUnder13;
            default: return false;
        }
    };

    const handleNext = async () => {
        setError(null);

        switch (currentStep) {
            case 'code':
                setCurrentStep('privacy');
                break;
            case 'privacy':
                setCurrentStep('guidelines');
                break;
            case 'guidelines':
                setCurrentStep('age');
                break;
            case 'age':
                if (isUnder13) {
                    setError('Users under 13 must have their legal guardian contact the team coach directly.');
                    return;
                }
                await joinTeam();
                break;
        }
    };

    const handleBack = () => {
        switch (currentStep) {
            case 'privacy':
                setCurrentStep('code');
                break;
            case 'guidelines':
                setCurrentStep('privacy');
                break;
            case 'age':
                setCurrentStep('guidelines');
                break;
            default:
                navigate('/teams');
        }
    };

    const joinTeam = async () => {
        if (!supabase || !user) {
            setError('Not authenticated');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Record attestations
            const attestResult = await recordAttestations(MEMBER_REQUIRED_ATTESTATIONS);
            if (!attestResult.success) {
                setError(attestResult.error || 'Failed to record attestations');
                setIsLoading(false);
                return;
            }

            // Call the join team function
            const { data, error: rpcError } = await (supabase.rpc as any)('join_team_with_invite', {
                invite_code: inviteCode.trim().toUpperCase(),
                age_confirmed: ageConfirmed,
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
            setCurrentStep('complete');
        } catch (err: any) {
            console.error('Exception joining team:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    // Not authenticated - redirect to login with return URL
    if (!isConfigured) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 max-w-md text-center">
                    <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Configuration Required</h2>
                    <p className="text-slate-400">Supabase is not configured. Please contact your administrator.</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 max-w-md text-center">
                    <Users className="w-12 h-12 text-orange-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Join a Team</h2>
                    <p className="text-slate-400 mb-6">You need to sign in or create an account to join a team.</p>
                    <div className="space-y-3">
                        <Link
                            to={`/login?redirect=/join/${inviteCode}`}
                            className="block w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all"
                        >
                            Sign In / Create Account
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const renderStepContent = () => {
        switch (currentStep) {
            case 'code':
                return (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Invite Code
                            </label>
                            <input
                                type="text"
                                value={inviteCode}
                                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                                placeholder="Enter invite code"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white text-center text-xl font-mono tracking-wider placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 uppercase"
                                maxLength={12}
                            />
                            <p className="text-slate-400 text-xs mt-2 text-center">
                                Ask your coach for the team invite code
                            </p>
                        </div>
                    </div>
                );

            case 'privacy':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 max-h-48 overflow-y-auto text-sm text-slate-300 space-y-3">
                            <p><strong>Privacy Policy Summary:</strong></p>
                            <ul className="list-disc list-inside space-y-1 text-slate-400">
                                <li>We collect your email and name for account purposes</li>
                                <li>Your information is only visible to team members</li>
                                <li>We do not sell your personal data</li>
                                <li>You can request deletion of your account</li>
                            </ul>
                            <p>
                                <Link to="/legal/privacy" className="text-orange-400 hover:text-orange-300 underline" target="_blank">
                                    Read full Privacy Policy
                                </Link>
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={privacyAcknowledged}
                                onChange={(e) => setPrivacyAcknowledged(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I have read and acknowledge the Privacy Policy.
                            </span>
                        </label>
                    </div>
                );

            case 'guidelines':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 max-h-48 overflow-y-auto text-sm text-slate-300 space-y-3">
                            <p><strong>Community Guidelines Summary:</strong></p>
                            <ul className="list-disc list-inside space-y-1 text-slate-400">
                                <li>Treat all users with respect</li>
                                <li>No harassment, bullying, or discrimination</li>
                                <li>Use the service for educational purposes only</li>
                                <li>Do not share inappropriate content</li>
                            </ul>
                            <p>
                                <Link to="/legal/community" className="text-orange-400 hover:text-orange-300 underline" target="_blank">
                                    Read full Community Guidelines
                                </Link>
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={guidelinesAcknowledged}
                                onChange={(e) => setGuidelinesAcknowledged(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I agree to follow the Community Guidelines.
                            </span>
                        </label>
                    </div>
                );

            case 'age':
                return (
                    <div className="space-y-6">
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                            <p className="text-amber-200 text-sm">
                                <strong>Age Confirmation:</strong> Please confirm your age to continue.
                            </p>
                        </div>
                        <div className="space-y-4">
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="age"
                                    checked={ageConfirmed && !isUnder13}
                                    onChange={() => { setAgeConfirmed(true); setIsUnder13(false); }}
                                    className="w-5 h-5 rounded-full border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                                />
                                <span className="text-slate-300 group-hover:text-white transition-colors">
                                    I am at least 13 years old.
                                </span>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="age"
                                    checked={isUnder13}
                                    onChange={() => { setIsUnder13(true); setAgeConfirmed(false); }}
                                    className="w-5 h-5 rounded-full border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                                />
                                <span className="text-slate-300 group-hover:text-white transition-colors">
                                    I am under 13 years old.
                                </span>
                            </label>
                        </div>
                        {isUnder13 && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                                <p className="text-red-200 text-sm">
                                    <strong>Under 13:</strong> If you are under 13 years old, your legal guardian must contact the team coach directly to add you to the team.
                                </p>
                            </div>
                        )}
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center space-y-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/20 rounded-full">
                            <CheckCircle className="w-10 h-10 text-amber-500" />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-white mb-2">Request Submitted!</h3>
                            <p className="text-slate-400">
                                Your request to join <strong className="text-white">{teamName}</strong> has been submitted.
                            </p>
                        </div>
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                            <p className="text-amber-200 text-sm">
                                <strong>Pending Coach Approval</strong><br />
                                You will be able to access the team once a coach approves your membership.
                            </p>
                        </div>
                        <button
                            onClick={() => navigate('/teams')}
                            className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all"
                        >
                            View My Teams
                        </button>
                    </div>
                );
        }
    };

    const stepTitles: Record<Step, string> = {
        code: 'Enter Invite Code',
        privacy: 'Privacy Policy',
        guidelines: 'Community Guidelines',
        age: 'Age Confirmation',
        complete: 'Complete',
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-xl border border-slate-700/50 mb-4 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge Logo"
                        />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-1">Join a Team</h1>
                    <p className="text-slate-400">Use an invite code from your coach</p>
                </div>

                {/* Progress */}
                {currentStep !== 'complete' && (
                    <div className="flex justify-center gap-2 mb-8">
                        {(['code', 'privacy', 'guidelines', 'age'] as Step[]).map((step, index) => (
                            <div
                                key={step}
                                className={`h-2 w-10 rounded-full transition-colors ${(['code', 'privacy', 'guidelines', 'age'] as Step[]).indexOf(currentStep) >= index
                                    ? 'bg-orange-500'
                                    : 'bg-slate-700'
                                    }`}
                            />
                        ))}
                    </div>
                )}

                {/* Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    {/* Step Title */}
                    {currentStep !== 'complete' && (
                        <div className="flex items-center gap-3 mb-6">
                            <Shield className="text-orange-500" size={24} />
                            <h2 className="text-lg font-semibold text-white">
                                {stepTitles[currentStep]}
                            </h2>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Content */}
                    {renderStepContent()}

                    {/* Navigation */}
                    {currentStep !== 'complete' && (
                        <div className="flex gap-3 mt-8">
                            <button
                                onClick={handleBack}
                                className="flex-1 flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                Back
                            </button>
                            <button
                                onClick={handleNext}
                                disabled={!canProceed() || isLoading}
                                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <Loader2 size={18} className="animate-spin" />
                                ) : currentStep === 'age' ? (
                                    <>
                                        <Check size={18} />
                                        Join Team
                                    </>
                                ) : (
                                    <>
                                        Next
                                        <ArrowRight size={18} />
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
