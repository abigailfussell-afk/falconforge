import { useState } from 'react';
import { User, Save, Edit3, X, CalendarCheck, CheckCircle, AlertCircle, Mail } from 'lucide-react';
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
    const { user, updateProfile, updateEmail, isConfigured, ageClassification, isOffline, updateAgeClassification } = useAuth();
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editDisplayName, setEditDisplayName] = useState('');
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isConfirmingAge, setIsConfirmingAge] = useState(false);
    const [ageConfirmed, setAgeConfirmed] = useState(false);
    const [isSavingAge, setIsSavingAge] = useState(false);
    const [ageError, setAgeError] = useState<string | null>(null);
    const [ageRaised, setAgeRaised] = useState(false);
    const [isEditingEmail, setIsEditingEmail] = useState(false);
    const [editEmail, setEditEmail] = useState('');
    const [isSavingEmail, setIsSavingEmail] = useState(false);
    const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    /**
     * Ask GoTrue to send a confirmation to the NEW address.
     *
     * Nothing changes here on success, and the copy must not pretend otherwise: the address is
     * swapped only when the link is followed. That is the behaviour you want — a typo leaves the
     * account reachable at the OLD address rather than stranding it at one nobody reads — but it
     * makes "Saved" an outright lie, so this says what was sent and where.
     */
    const handleSaveEmail = async () => {
        const next = editEmail.trim();
        setEmailMessage(null);

        /*
         * Two client-side refusals, both about saying something USEFUL rather than about
         * security — GoTrue validates the address itself and is the authority.
         *
         * The shape check is deliberately loose (`something@something.something`). A stricter
         * regex rejects addresses that are perfectly valid, and the failure mode is a coach who
         * cannot enter their own school address and has no idea why.
         */
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
            setEmailMessage({ type: 'error', text: 'That does not look like an email address.' });
            return;
        }
        if (next.toLowerCase() === (user?.email ?? '').toLowerCase()) {
            setEmailMessage({ type: 'error', text: 'That is already your email address.' });
            return;
        }

        setIsSavingEmail(true);
        const { error, pending } = await updateEmail(next);
        setIsSavingEmail(false);

        if (error) {
            setEmailMessage({ type: 'error', text: error.message });
            return;
        }

        setEmailMessage({
            type: 'success',
            // Naming the address matters: "check your email" is useless to somebody who has just
            // typed the wrong one, and this is the last moment they can notice.
            text: `Confirmation sent to ${pending ?? next}. Your address changes when you follow that link — until then, this account still uses ${user?.email ?? 'your current address'}.`,
        });
        setIsEditingEmail(false);
    };

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

            {/*
              * EMAIL ADDRESS.
              *
              * This screen edited the name and the age classification and nothing else, so
              * changing an address meant asking Kevin — and there was no runbook entry for that
              * either. It matters most for a GUARDIAN: under §3 a managed child has no login, so
              * the guardian's address is the ONLY contactable address the team holds for that
              * child. SEC-16 made the server carry the change onto every child's roster row, so
              * the capability was complete and unreachable.
              */}
            <div
                data-testid="email-change"
                className="bg-white dark:bg-slate-800 rounded-xl shadow-card border border-slate-200 dark:border-slate-700 p-3 md:p-4 mb-6"
            >
                <div className="flex items-center gap-2 mb-4 border-b border-slate-100 dark:border-slate-700 pb-2">
                    <Mail className="text-forge-600" size={24} />
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Email address</h3>
                </div>

                {emailMessage && (
                    <div
                        data-testid="email-message"
                        role="status"
                        className={`mb-4 flex items-start gap-2 rounded-lg p-3 text-sm ${
                            emailMessage.type === 'success'
                                ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300'
                                : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'
                        }`}
                    >
                        {emailMessage.type === 'success' ? (
                            <CheckCircle size={16} className="mt-0.5 shrink-0" />
                        ) : (
                            <AlertCircle size={16} className="mt-0.5 shrink-0" />
                        )}
                        <span>{emailMessage.text}</span>
                    </div>
                )}

                {isEditingEmail ? (
                    <div className="space-y-3">
                        <div>
                            <label
                                className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400 mb-1"
                                htmlFor="new-email"
                            >
                                New email address
                            </label>
                            <input
                                id="new-email"
                                data-testid="new-email-input"
                                type="email"
                                autoComplete="email"
                                className="field"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                disabled={isSavingEmail}
                            />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            We will email the new address to confirm it. Nothing changes until you
                            follow that link.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                data-testid="save-email"
                                onClick={handleSaveEmail}
                                disabled={isSavingEmail || isOffline || !editEmail.trim()}
                                title={isOffline ? 'Changing your email needs a connection' : undefined}
                            >
                                <Save size={16} />
                                {isSavingEmail ? 'Sending…' : 'Send confirmation'}
                            </Button>
                            <Button
                                variant="secondary"
                                data-testid="cancel-email"
                                onClick={() => {
                                    setIsEditingEmail(false);
                                    setEmailMessage(null);
                                }}
                                disabled={isSavingEmail}
                            >
                                <X size={16} />
                                Cancel
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                            <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                                Current
                            </p>
                            {/* `break-all`, not `truncate`: an address you cannot read in full is
                                no use on the screen where you are deciding whether to change it. */}
                            <p className="break-all text-sm text-slate-700 dark:text-slate-200">
                                {user?.email ?? 'Not set'}
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            data-testid="edit-email"
                            onClick={() => {
                                setEditEmail('');
                                setEmailMessage(null);
                                setIsEditingEmail(true);
                            }}
                            disabled={isOffline}
                            title={isOffline ? 'Changing your email needs a connection' : undefined}
                        >
                            <Edit3 size={16} />
                            Change
                        </Button>
                    </div>
                )}
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
