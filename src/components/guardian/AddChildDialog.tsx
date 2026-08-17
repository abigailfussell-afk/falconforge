import { useState, type FormEvent } from 'react';
import { useAuth } from '../../lib/auth';
import { useAppStore } from '../../lib/store';
import {
    GUARDIAN_REQUIRED_CONSENTS,
    GUARDIAN_CONSENT_VERSIONS,
} from '../../lib/attestations';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

/**
 * Add a child, and give the consents for them, in one sitting.
 *
 * THE TWO HALVES ARE ONE FORM ON PURPOSE. Plan section 3: the guardian creates the profile,
 * never the coach, precisely so that "consent and the child's data arrive in the same sitting,
 * so there is nothing to chase". A coach-created profile would need an email round trip to the
 * parent, a blocked roster entry while it was outstanding, and a consent-chasing subsystem
 * built for no benefit. Splitting these into two screens would rebuild that gap inside the
 * guardian's own flow.
 *
 * NO DATE OF BIRTH. There is no field for one and there is no column behind it — section 3,
 * and `20260822000000_guardian_schema_cleanup.sql`. The app never knows anyone's age.
 */
export default function AddChildDialog({ onClose }: { onClose: () => void }) {
    const { user } = useAuth();
    const addManagedProfile = useAppStore((s) => s.addManagedProfile);

    const [fullName, setFullName] = useState('');
    const [notes, setNotes] = useState('');
    const [consented, setConsented] = useState(false);

    const trimmedName = fullName.trim();
    const canSubmit = trimmedName.length > 0 && consented && !!user?.id;

    /**
     * Why the button is disabled, on the button.
     *
     * `docs/failure-modes.md` §8 — five sprints of enabled controls whose handler early-returns.
     * A disabled control that does not say why is the same dead end with better manners.
     */
    const disabledReason = (): string | undefined => {
        if (!user?.id) return 'You need to be signed in.';
        if (!trimmedName) return "Enter your child's name.";
        if (!consented) return 'Tick the consent box to continue.';
        return undefined;
    };

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit || !user?.id) return;

        addManagedProfile(
            { fullName: trimmedName, notes },
            user.id,
            // All four, together. `GUARDIAN_REQUIRED_CONSENTS` is the list; the versions come
            // from `GUARDIAN_CONSENT_VERSIONS`, which reads the three shared documents out of
            // `ATTESTATION_VERSIONS` so they cannot drift apart on the next legal rewrite.
            GUARDIAN_REQUIRED_CONSENTS,
        );
        onClose();
    };

    return (
        <Modal label="Add a child" width="panel" className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Add a child
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        You hold the account; your child does not sign in. You can give them
                        their own login later, and they keep their place on the team when you do.
                    </p>
                </div>

                <div className="space-y-1">
                    <label htmlFor="child-name" className="label">
                        Child's full name
                    </label>
                    <input
                        id="child-name"
                        className="field w-full"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        autoComplete="off"
                        data-testid="child-name"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        This is the name the team's roster will show.
                    </p>
                </div>

                <div className="space-y-1">
                    <label htmlFor="child-notes" className="label">
                        Notes <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <textarea
                        id="child-notes"
                        className="field w-full"
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Allergies, pickup arrangements — anything you want to keep to hand."
                    />
                </div>

                <label className="flex gap-3 items-start cursor-pointer rounded-lg p-3 bg-slate-50 dark:bg-slate-900/40">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={consented}
                        onChange={(e) => setConsented(e.target.checked)}
                        data-testid="child-consent"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                        I am {trimmedName ? `${trimmedName}'s` : 'this child’s'} parent or legal
                        guardian, and I consent to FalconForge holding their information so they
                        can take part in the team. I accept the{' '}
                        <a href="#/legal/terms" className="underline" target="_blank" rel="noreferrer">
                            Terms
                        </a>
                        ,{' '}
                        <a href="#/legal/privacy" className="underline" target="_blank" rel="noreferrer">
                            Privacy Policy
                        </a>{' '}
                        and{' '}
                        <a href="#/legal/community" className="underline" target="_blank" rel="noreferrer">
                            Community Guidelines
                        </a>{' '}
                        on their behalf.
                        {/*
                         * The version is displayed, not just recorded. A consent record that
                         * says "v2.0" is only meaningful if 2.0 is what the person was actually
                         * looking at — which is the whole reason the database's DEFAULT was
                         * dropped in Sprint 9 and the client owns the number.
                         */}
                        <span className="block mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Documents version {GUARDIAN_CONSENT_VERSIONS.terms}. You can withdraw
                            consent by removing your child from the team.
                        </span>
                    </span>
                </label>

                <div className="flex justify-end gap-2 pt-1">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={!canSubmit}
                        title={disabledReason()}
                        data-testid="add-child-submit"
                    >
                        Add child
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
