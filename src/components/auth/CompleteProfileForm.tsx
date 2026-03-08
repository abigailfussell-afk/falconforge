import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AgeClassification } from '../../types';

interface CompleteProfileFormProps {
    isLoading: boolean;
    error: string | null;
    onSubmit: (ageSelection: AgeClassification, privacyAccepted: boolean) => void;
    submitLabel?: string;
    showBackButton?: boolean;
    onBack?: () => void;
}

export function CompleteProfileForm({
    isLoading,
    error,
    onSubmit,
    submitLabel = "Complete Profile",
    showBackButton = false,
    onBack
}: CompleteProfileFormProps) {
    const [ageSelection, setAgeSelection] = useState<AgeClassification | null>(null);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null);

        if (!ageSelection) {
            setLocalError('Please select your age range');
            return;
        }

        if (ageSelection === 'under_13') {
            setLocalError('Users under 13 cannot create an account directly. Please have your parent or guardian contact your team coach to be added to a team.');
            return;
        }

        if (!privacyAccepted) {
            setLocalError('Please accept the Privacy Policy and Community Guidelines');
            return;
        }

        onSubmit(ageSelection, privacyAccepted);
    };

    const displayError = localError || error;

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            {displayError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                    <p className="text-red-400 text-sm">{displayError}</p>
                </div>
            )}

            {/* Age Selection */}
            <div>
                <label className="block text-sm font-medium text-slate-300 mb-3">How old are you?</label>
                <div className="space-y-2">
                    <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${ageSelection === '18_plus' ? 'border-orange-500 bg-orange-500/10' : 'border-slate-600 hover:border-slate-500'}`}>
                        <input
                            type="radio"
                            name="age"
                            value="18_plus"
                            checked={ageSelection === '18_plus'}
                            onChange={() => setAgeSelection('18_plus')}
                            className="w-4 h-4 text-orange-500"
                        />
                        <span className="text-slate-200">I am 18 or older</span>
                    </label>
                    <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${ageSelection === '13_to_17' ? 'border-orange-500 bg-orange-500/10' : 'border-slate-600 hover:border-slate-500'}`}>
                        <input
                            type="radio"
                            name="age"
                            value="13_to_17"
                            checked={ageSelection === '13_to_17'}
                            onChange={() => setAgeSelection('13_to_17')}
                            className="w-4 h-4 text-orange-500"
                        />
                        <span className="text-slate-200">I am 13-17 years old</span>
                    </label>
                    <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition ${ageSelection === 'under_13' ? 'border-amber-500 bg-amber-500/10' : 'border-slate-600 hover:border-slate-500'}`}>
                        <input
                            type="radio"
                            name="age"
                            value="under_13"
                            checked={ageSelection === 'under_13'}
                            onChange={() => setAgeSelection('under_13')}
                            className="w-4 h-4 text-amber-500"
                        />
                        <span className="text-slate-200">I am under 13</span>
                    </label>
                </div>
            </div>

            {/* COPPA Warning for under 13 */}
            {ageSelection === 'under_13' && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <div className="flex gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-amber-200 text-sm font-medium">Parental Consent Required</p>
                            <p className="text-amber-300/80 text-xs mt-1">
                                Users under 13 cannot create an account directly due to COPPA regulations.
                                Please have your parent or guardian contact your team coach to be added to a team.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Privacy/Guidelines acceptance */}
            {ageSelection !== 'under_13' && (
                <div>
                    <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition ${privacyAccepted ? 'border-green-500 bg-green-500/10' : 'border-slate-600 hover:border-slate-500'}`}>
                        <input
                            type="checkbox"
                            checked={privacyAccepted}
                            onChange={(e) => setPrivacyAccepted(e.target.checked)}
                            className="w-5 h-5 mt-0.5 text-green-500 rounded"
                        />
                        <div>
                            <span className="text-slate-200 text-sm">
                                I have read and agree to the{' '}
                                <Link to="/legal/privacy" target="_blank" className="text-orange-400 hover:underline">Privacy Policy</Link>
                                {' '}and{' '}
                                <Link to="/legal/community" target="_blank" className="text-orange-400 hover:underline">Community Guidelines</Link>
                            </span>
                        </div>
                    </label>
                </div>
            )}

            <div className="flex gap-3">
                {showBackButton && onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-700/50 transition"
                    >
                        Back
                    </button>
                )}
                <button
                    type="submit"
                    disabled={isLoading || ageSelection === 'under_13' || !privacyAccepted}
                    className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50"
                >
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <>
                            {submitLabel}
                            <ArrowRight className="w-4 h-4" />
                        </>
                    )}
                </button>
            </div>
        </form>
    );
}
