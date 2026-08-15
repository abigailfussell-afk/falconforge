import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Users, Shield, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { recordAttestation } from '../lib/attestations';

type Step = 'attestation' | 'details' | 'complete';

const STEPS: { id: Step; title: string; }[] = [
    { id: 'attestation', title: 'Coach Agreement' },
    { id: 'details', title: 'Team Details' },
];

export default function CreateTeam() {
    const navigate = useNavigate();
    const { user, ageClassification, isLoading: authLoading } = useAuth();
    const [currentStep, setCurrentStep] = useState<Step>('attestation');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [coachTermsAccepted, setCoachTermsAccepted] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [teamNumber, setTeamNumber] = useState('');

    // Created team info
    const [inviteCode, setInviteCode] = useState<string | null>(null);

    // Check if user is 18+ - redirect if not
    useEffect(() => {
        if (!authLoading && !user) {
            navigate('/login');
        }
    }, [authLoading, user, navigate]);

    const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

    // If user isn't 18+, show a block message
    if (!authLoading && ageClassification !== '18_plus') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="w-full max-w-md">
                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/20 rounded-full mb-4">
                            <AlertTriangle className="w-8 h-8 text-amber-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">Age Requirement</h2>
                        <p className="text-slate-400 mb-6">
                            You must be 18 or older to create and manage a team on FalconForge.
                            {!ageClassification && ' Please complete your profile setup first.'}
                        </p>
                        <div className="space-y-3">
                            <button
                                onClick={() => navigate('/onboarding')}
                                className="w-full flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium py-3 px-4 rounded-xl transition-colors"
                            >
                                <ArrowLeft size={18} />
                                Back to Teams
                            </button>
                            <Link
                                to="/join"
                                className="block w-full text-center text-orange-400 hover:text-orange-300 font-medium py-2"
                            >
                                Join an existing team instead
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const canProceed = () => {
        switch (currentStep) {
            case 'attestation': return coachTermsAccepted;
            case 'details': return teamName.trim().length >= 3;
            default: return false;
        }
    };

    const handleNext = async () => {
        if (currentStep === 'attestation') {
            setCurrentStep('details');
        } else if (currentStep === 'details') {
            await createTeam();
        }
    };

    const handleBack = () => {
        if (currentStep === 'complete') {
            return;
        }
        if (currentStep === 'details') {
            setCurrentStep('attestation');
        } else {
            navigate('/onboarding');
        }
    };

    const createTeam = async () => {
        if (!supabase || !user) {
            setError('Not authenticated');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Record the combined coach attestation
            const attestResult = await recordAttestation('coach_terms');
            if (!attestResult.success) {
                setError(attestResult.error || 'Failed to record attestation');
                setIsLoading(false);
                return;
            }

            // Call the create team function
            const { data, error: rpcError } = await supabase.rpc('create_team_as_coach', {
                team_name: teamName.trim(),
                // undefined omits the argument so the function's `DEFAULT NULL` applies.
                // Passing null explicitly is equivalent at runtime but does not match the
                // generated signature (`team_number?: string`).
                team_number: teamNumber.trim() || undefined,
            });

            if (rpcError) {
                console.error('RPC error:', rpcError);
                setError(rpcError.message);
                setIsLoading(false);
                return;
            }

            const result = data as { success: boolean; team_id?: string; invite_code?: string; error?: string };

            if (!result.success) {
                setError(result.error || 'Failed to create team');
                setIsLoading(false);
                return;
            }

            setInviteCode(result.invite_code || null);
            setCurrentStep('complete');
        } catch (err: any) {
            console.error('Exception creating team:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const renderStepContent = () => {
        switch (currentStep) {
            case 'attestation':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 space-y-4 text-sm text-slate-300">
                            <p className="font-medium text-white">By creating a team, you agree to:</p>
                            <ul className="list-disc list-inside space-y-2">
                                <li><strong>Terms & Conditions:</strong> Coaches control team membership and approval</li>
                                <li><strong>Billing:</strong> You will be billed monthly based on approved team members (free during beta)</li>
                                <li><strong>COPPA Compliance:</strong> You accept responsibility for obtaining parental consent for minors and will act as the parent's agent for COPPA purposes</li>
                            </ul>
                            <p className="text-slate-400 text-xs">
                                <Link to="/legal/terms" className="text-orange-400 hover:text-orange-300 underline" target="_blank">
                                    Read full Terms and Conditions
                                </Link>
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group p-4 rounded-xl border border-slate-600 hover:border-orange-500/50 transition">
                            <input
                                type="checkbox"
                                checked={coachTermsAccepted}
                                onChange={(e) => setCoachTermsAccepted(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I am 18+ and I agree to the Terms & Conditions, Billing Policy, and COPPA responsibilities as a team coach.
                            </span>
                        </label>
                    </div>
                );

            case 'details':
                return (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                Team Name *
                            </label>
                            <input
                                type="text"
                                value={teamName}
                                onChange={(e) => setTeamName(e.target.value)}
                                placeholder="e.g., Falcon Force"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                minLength={3}
                            />
                            <p className="text-slate-400 text-xs mt-1">Minimum 3 characters</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                FTC Team Number (Optional)
                            </label>
                            <input
                                type="text"
                                value={teamNumber}
                                onChange={(e) => setTeamNumber(e.target.value)}
                                placeholder="e.g., 12345"
                                className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                            />
                        </div>
                    </div>
                );

            case 'complete':
                return (
                    <div className="text-center space-y-6">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full">
                            <CheckCircle className="w-10 h-10 text-green-500" />
                        </div>
                        <div>
                            <h3 className="text-xl font-semibold text-white mb-2">Team Created Successfully!</h3>
                            <p className="text-slate-400">Your team "{teamName}" has been created.</p>
                        </div>
                        {inviteCode && (
                            <div className="bg-slate-700/50 rounded-xl p-4">
                                <p className="text-sm text-slate-400 mb-2">Your team invite code:</p>
                                <p className="text-2xl font-mono font-bold text-orange-400">{inviteCode}</p>
                                <p className="text-xs text-slate-500 mt-2">Share this code with team members to invite them</p>
                            </div>
                        )}
                        <button
                            onClick={() => navigate('/')}
                            className="w-full bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all"
                        >
                            Go to Dashboard
                        </button>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-lg">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 mb-4 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge Logo"
                        />
                    </div>
                    <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                    <p className="text-slate-400">Create your FTC team</p>
                </div>

                {/* Progress Steps - simple dashes */}
                {currentStep !== 'complete' && (
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <div className={`h-1 w-12 rounded-full ${currentStepIndex >= 0 ? 'bg-orange-500' : 'bg-slate-700'}`} />
                        <div className={`h-1 w-12 rounded-full ${currentStepIndex >= 1 ? 'bg-orange-500' : 'bg-slate-700'}`} />
                    </div>
                )}

                {/* Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    {/* Step Title */}
                    {currentStep !== 'complete' && (
                        <div className="flex items-center gap-3 mb-6">
                            {currentStep === 'attestation' ? (
                                <Shield className="text-orange-500" size={24} />
                            ) : (
                                <Users className="text-orange-500" size={24} />
                            )}
                            <h2 className="text-lg font-semibold text-white">
                                {STEPS[currentStepIndex].title}
                            </h2>
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Step Content */}
                    {renderStepContent()}

                    {/* Navigation Buttons */}
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
                                ) : currentStep === 'details' ? (
                                    <>
                                        <Check size={18} />
                                        Create Team
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
