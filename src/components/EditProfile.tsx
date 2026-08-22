import { useState } from 'react';
import { User, Save, Edit3, X, CalendarCheck, CheckCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { recordAttestation } from '../lib/attestations';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

/**
 * "I've turned 18" — the only writer `users.age_classification` has after signup.
 *
 * WHY IT EXISTS. The column is asserted once at signup and there is no birth date anywhere on
 * `users` (plan §3: the app never knows anyone's age, only what was asserted once), so nothing
 * can recompute it and a 17-year-old who turns 18 stays `13_to_17` for ever.
 * `enforce_member_role_eligibility` gates admin, coach AND mentor on `18_plus`, and
 * `nominate_team_admin` refuses earlier still — so the stale value does not merely mislead, it
 * locks a member out of three roles with an error nobody on their team can clear from any
 * screen. A fact with readers and no writer is `docs/failure-modes.md` §7.
 *
 * IT ONLY EVER RAISES, and only from `13_to_17`. Lowering it would have to demote whatever roles
 * the account already holds, which is `enforce_member_role_eligibility`'s job rather than a
 * profile screen's; an under-13 cannot reach it at all, because turning 13 is a different
 * transition with a guardian-shaped answer, and because a one-press path from `under_13` to
 * `18_plus` is the thing COPPA is about.
 *
 * The claim is recorded as an attestation BEFORE the column moves. `age_18_plus` has been in
 * `AttestationType` and the database CHECK since Sprint 3 with nothing that could write it —
 * this is its writer — and the order is deliberate: the attestation is the record of who claimed
 * this and when, so a raised column with no record behind it is the one outcome worth refusing.
 * Self-asserted, like the same claim at signup; what is gained is that it is asserted at the
 * moment it matters rather than years earlier.
 */
const EditProfile = () => {
    const { user, updateProfile, isConfigured, ageClassification, isOffline, updateAgeClassification } = useAuth();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editDisplayName, setEditDisplayName] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isConfirmingAge, setIsConfirmingAge] = useState(false);
    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [isSavingAge, setIsSavingAge] = useState(false);
    const [ageError, setAgeError] = useState<string | null>(null);
    const [ageRaised, setAgeRaised] = useState(false);

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

    const handleTurnedEighteen = async () => {
        setIsSavingAge(true);
        setAgeError(null);
        try {
            // The record of the claim first — see the note above on why this is the order that
            // fails safely.
            const attested = await recordAttestation('age_18_plus');
            if (!attested.success) {
                setAgeError(attested.error ?? 'Could not record your confirmation');
                return;
            }

            const { error, success } = await updateAgeClassification('18_plus');
            if (!success) {
                setAgeError(error?.message ?? 'Could not update your age');
                return;
            }

            setAgeRaised(true);
            setIsConfirmingAge(false);
        } finally {
            setIsSavingAge(false);
        }
    };

    if (!isConfigured || !user) return null;

    return (
        <div className="max-w-panel mx-auto w-full">
            <h2 className="text-lg font-bold text-slate-800 dark:text-white mb-6">Edit Profile</h2>

            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6">
                <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                    <User className="text-forge-600" size={24} />
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
                        <div className="w-12 h-12 rounded-full bg-forge-100 dark:bg-forge-900/50 flex items-center justify-center">
                            <User size={24} className="text-forge-600 dark:text-forge-400" />
                        </div>
                        <div className="flex-1">
                            {isEditingProfile ? (
                                <div className="flex gap-2 items-center">
                                    <input
                                        type="text"
                                        value={editDisplayName}
                                        onChange={(e) => setEditDisplayName(e.target.value)}
                                        placeholder="Enter your name"
                                        className="field flex-1"
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                                        autoFocus
                                    />
                                    <Button
                                        onClick={handleSaveProfile}
                                        busy={isSavingProfile}
                                        disabled={!editDisplayName.trim()}
                                        title="Save name"
                                    >
                                        {!isSavingProfile && <Save size={18} />}
                                    </Button>
                                    <IconButton
                                        onClick={() => {
                                            setIsEditingProfile(false);
                                            setProfileMessage(null);
                                        }}
                                        title="Cancel"
                                    >
                                        <X size={18} />
                                    </IconButton>
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
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setEditDisplayName(user.user_metadata?.full_name || '');
                                setIsEditingProfile(true);
                                setProfileMessage(null);
                            }}
                        >
                            <Edit3 size={16} />
                            Edit Name
                        </Button>
                    )}
                </div>
            </div>

            {(ageClassification === '13_to_17' || ageRaised) && (
                <div
                    data-testid="age-correction"
                    className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6"
                >
                    <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                        <CalendarCheck className="text-forge-600" size={24} />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Your age</h3>
                    </div>

                    {ageRaised ? (
                        <div className="flex items-start gap-3 rounded-lg border border-green-300 bg-green-50 p-3 dark:border-green-700/60 dark:bg-green-900/20">
                            <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                            <div>
                                <p className="text-sm font-bold text-green-900 dark:text-green-200">
                                    Your account is now recorded as 18 or over.
                                </p>
                                <p className="text-xs text-green-800/80 dark:text-green-300/80">
                                    Your team admin can now give you the coach, mentor or team admin role.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {ageError && (
                                <div
                                    role="alert"
                                    className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                >
                                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                                    <span className="min-w-0">{ageError}</span>
                                </div>
                            )}

                            <p className="text-sm text-slate-700 dark:text-slate-300">
                                Your account is recorded as <strong>13&ndash;17</strong>. We never asked for
                                your date of birth, so this only changes when you tell us it has.
                            </p>
                            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                                The coach, mentor and team admin roles need an account recorded as 18 or
                                over. If you have had a birthday since you signed up, say so here and your
                                team admin will be able to give you one of those roles.
                            </p>

                            {isConfirmingAge ? (
                                <>
                                    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 p-3 transition hover:border-forge-500/50 dark:border-slate-600">
                                        <input
                                            type="checkbox"
                                            checked={ageConfirmed}
                                            onChange={(e) => setAgeConfirmed(e.target.checked)}
                                            className="mt-0.5 h-5 w-5 rounded border-slate-400 text-forge-600 focus:ring-forge-500"
                                        />
                                        <span className="text-sm text-slate-700 dark:text-slate-300">
                                            I confirm I am now 18 or over. I understand this is recorded
                                            against my account and cannot be undone from this screen.
                                        </span>
                                    </label>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Button
                                            onClick={handleTurnedEighteen}
                                            busy={isSavingAge}
                                            disabled={!ageConfirmed || isOffline}
                                            title={
                                                isOffline
                                                    ? 'Confirming needs a connection'
                                                    : !ageConfirmed
                                                        ? 'Tick the confirmation first'
                                                        : 'Record that you are 18 or over'
                                            }
                                        >
                                            Confirm
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => {
                                                setIsConfirmingAge(false);
                                                setAgeConfirmed(false);
                                                setAgeError(null);
                                            }}
                                            disabled={isSavingAge}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <div className="mt-4">
                                    <Button
                                        variant="secondary"
                                        onClick={() => setIsConfirmingAge(true)}
                                        disabled={isOffline}
                                        title={isOffline ? 'Confirming needs a connection' : undefined}
                                    >
                                        I&apos;ve turned 18
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default EditProfile;
