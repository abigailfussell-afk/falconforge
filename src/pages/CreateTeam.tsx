import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2, Users, FileText, CreditCard, Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { recordAttestations, COACH_REQUIRED_ATTESTATIONS } from '../lib/attestations';

type Step = 'age' | 'terms' | 'billing' | 'coppa' | 'details' | 'complete';

const STEPS: { id: Step; title: string; icon: React.ElementType }[] = [
    { id: 'age', title: 'Age Verification', icon: Shield },
    { id: 'terms', title: 'Terms & Conditions', icon: FileText },
    { id: 'billing', title: 'Billing', icon: CreditCard },
    { id: 'coppa', title: 'COPPA Compliance', icon: Users },
    { id: 'details', title: 'Team Details', icon: Users },
];

export default function CreateTeam() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [currentStep, setCurrentStep] = useState<Step>('age');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [billingAcknowledged, setBillingAcknowledged] = useState(false);
    const [coppaAcknowledged, setCoppaAcknowledged] = useState(false);
    const [teamName, setTeamName] = useState('');
    const [teamNumber, setTeamNumber] = useState('');

    // Created team info
    const [inviteCode, setInviteCode] = useState<string | null>(null);

    const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

    const canProceed = () => {
        switch (currentStep) {
            case 'age': return ageConfirmed;
            case 'terms': return termsAccepted;
            case 'billing': return billingAcknowledged;
            case 'coppa': return coppaAcknowledged;
            case 'details': return teamName.trim().length >= 3;
            default: return false;
        }
    };

    const handleNext = async () => {
        const stepIndex = STEPS.findIndex(s => s.id === currentStep);

        if (currentStep === 'details') {
            // Final step - create the team
            await createTeam();
        } else if (stepIndex < STEPS.length - 1) {
            setCurrentStep(STEPS[stepIndex + 1].id);
        }
    };

    const handleBack = () => {
        if (currentStep === 'complete') {
            // Can't go back from complete
            return;
        }
        const stepIndex = STEPS.findIndex(s => s.id === currentStep);
        if (stepIndex > 0) {
            setCurrentStep(STEPS[stepIndex - 1].id);
        } else {
            navigate('/teams');
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
            // First, record all attestations
            const attestResult = await recordAttestations(COACH_REQUIRED_ATTESTATIONS);
            if (!attestResult.success) {
                setError(attestResult.error || 'Failed to record attestations');
                setIsLoading(false);
                return;
            }

            // Call the create team function
            const { data, error: rpcError } = await (supabase.rpc as any)('create_team_as_coach', {
                team_name: teamName.trim(),
                team_number: teamNumber.trim() || null,
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
            case 'age':
                return (
                    <div className="space-y-6">
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                            <p className="text-amber-200 text-sm">
                                <strong>Age Requirement:</strong> You must be at least 18 years old to create and manage a team on FalconForge.
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={ageConfirmed}
                                onChange={(e) => setAgeConfirmed(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I confirm that I am at least 18 years of age.
                            </span>
                        </label>
                    </div>
                );

            case 'terms':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 max-h-64 overflow-y-auto text-sm text-slate-300 space-y-4">
                            <p><strong>Terms and Conditions Summary:</strong></p>
                            <ul className="list-disc list-inside space-y-2">
                                <li>You must be 18+ to create and manage teams</li>
                                <li>Coaches control team membership and approval</li>
                                <li>Subscriptions are billed monthly based on team members</li>
                                <li>You agree to acceptable use policies</li>
                                <li>Service is provided "as is"</li>
                            </ul>
                            <p className="text-slate-400">
                                <Link to="/legal/terms" className="text-orange-400 hover:text-orange-300 underline" target="_blank">
                                    Read full Terms and Conditions
                                </Link>
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(e) => setTermsAccepted(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I have read and agree to the Terms and Conditions.
                            </span>
                        </label>
                    </div>
                );

            case 'billing':
                return (
                    <div className="space-y-6">
                        <div className="bg-slate-700/50 rounded-xl p-4 space-y-4">
                            <p className="text-slate-300">
                                <strong>Billing Information:</strong>
                            </p>
                            <ul className="list-disc list-inside text-slate-300 space-y-2 text-sm">
                                <li>You will be billed monthly based on the number of approved team members</li>
                                <li>Billing begins when you approve a team member</li>
                                <li>Removing a member immediately stops billing for that user</li>
                                <li>You can manage your team roster at any time</li>
                            </ul>
                            <p className="text-slate-400 text-sm italic">
                                Billing integration coming soon. Your team will be in free tier during beta.
                            </p>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={billingAcknowledged}
                                onChange={(e) => setBillingAcknowledged(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I understand that I will be billed monthly based on the number of approved team members.
                            </span>
                        </label>
                    </div>
                );

            case 'coppa':
                return (
                    <div className="space-y-6">
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                            <p className="text-amber-200 text-sm">
                                <strong>COPPA Compliance:</strong> The Children's Online Privacy Protection Act requires parental consent for users under 13.
                            </p>
                        </div>
                        <div className="bg-slate-700/50 rounded-xl p-4 space-y-4 text-sm text-slate-300">
                            <p>By creating a team, you acknowledge and agree that:</p>
                            <ul className="list-disc list-inside space-y-2">
                                <li>You are an authorized adult (coach, mentor, or teacher)</li>
                                <li>You have obtained all necessary parental or guardian consent for minor team members</li>
                                <li>You accept responsibility for ensuring COPPA compliance for your team</li>
                                <li>You will act as the parent's or guardian's agent for COPPA purposes</li>
                            </ul>
                        </div>
                        <label className="flex items-start gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={coppaAcknowledged}
                                onChange={(e) => setCoppaAcknowledged(e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-orange-500 focus:ring-orange-500 mt-0.5"
                            />
                            <span className="text-slate-300 group-hover:text-white transition-colors">
                                I accept responsibility for minors on my team and agree to ensure COPPA compliance.
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
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-xl border border-slate-700/50 mb-4 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge Logo"
                        />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-1">Create Your Team</h1>
                    <p className="text-slate-400">Set up your FTC team on FalconForge</p>
                </div>

                {/* Progress Steps */}
                {currentStep !== 'complete' && (
                    <div className="flex justify-center gap-2 mb-8">
                        {STEPS.map((step, index) => (
                            <div
                                key={step.id}
                                className={`h-2 w-12 rounded-full transition-colors ${index <= currentStepIndex ? 'bg-orange-500' : 'bg-slate-700'
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
                            {React.createElement(STEPS[currentStepIndex].icon, {
                                className: 'text-orange-500',
                                size: 24
                            })}
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
