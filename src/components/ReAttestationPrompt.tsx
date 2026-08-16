import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, AlertCircle } from 'lucide-react';
import {
    SIGNUP_REQUIRED_ATTESTATIONS,
    getOutdatedAttestations,
    recordAttestation,
} from '../lib/attestations';
import type { AttestationType } from '../types';
import { useAuth } from '../lib/auth';
import Modal from './ui/Modal';
import Button from './ui/Button';

/** What each document is called when we have to ask somebody to accept it again. */
const DOCUMENT_LABELS: Partial<Record<AttestationType, { label: string; href: string }>> = {
    privacy_and_guidelines: { label: 'Privacy Policy and Acceptable Use', href: '/legal/privacy' },
    terms: { label: 'Terms and Conditions', href: '/legal/terms' },
    privacy: { label: 'Privacy Policy', href: '/legal/privacy' },
    community_guidelines: { label: 'Acceptable Use policy', href: '/legal/community' },
    coach_terms: { label: 'Terms and Conditions', href: '/legal/terms' },
};

/**
 * "We have updated these documents — please read and accept them again."
 *
 * This is what makes "versioned attestations re-required on change" real rather than a comment on
 * a constant. Sprint 6 rewrote all three documents substantively and raised them to 2.0, so every
 * existing account has accepted a version that no longer describes the service.
 *
 * WHY IT DOES NOT BLOCK THE APP.
 *
 * It is a modal over the shell, and the shell keeps rendering behind it. Nothing is unmounted and
 * no data is thrown away, because this is a consent refresh rather than a lockout — the user has
 * already agreed to a previous version, so the correct posture is "please look at this" and not
 * "you cannot use your team's data". A competition is exactly when a coach will meet this dialog,
 * and it must be dismissible in one click after reading.
 *
 * FAILS OPEN, like everything else licensing-adjacent. `getOutdatedAttestations` returns an empty
 * list when it cannot read — a flaky connection must not turn into a nag loop that reappears on
 * every render, and an offline device asks nothing at all.
 */
export default function ReAttestationPrompt() {
    const { user, isOffline } = useAuth();
    const [outdated, setOutdated] = useState<AttestationType[]>([]);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /** Set once accepted or dismissed, so it does not reappear for this session. */
    const [settled, setSettled] = useState(false);

    /*
     * DEPENDS ON `user?.id`, NOT ON `user` — AND THAT IS NOT A STYLE PREFERENCE.
     *
     * An effect that sets state must not depend on an object identity it does not control. The
     * first draft used `[user, isOffline]`, and any caller whose `useAuth()` returns a fresh user
     * object per render then produced: render -> effect -> setOutdated(new []) -> render ->
     * effect -> ... A test suite doing exactly that spun this component ~2 million times and
     * wrote a 2.7 GB log before anything failed. `AuthProvider` keeps `user` in state so the real
     * app was not looping, but relying on that means one refactor of the provider spins the live
     * app instead of a test.
     *
     * The equality check on the result closes the same hole from the other side: an effect that
     * re-runs for any reason must not re-render for no reason.
     */
    const userId = user?.id;
    useEffect(() => {
        if (!userId || isOffline) return;
        let cancelled = false;
        // `.catch` as well as the guard inside `getOutdatedAttestations`: an effect that can
        // reject is an unhandled rejection in every consumer's test suite.
        getOutdatedAttestations(SIGNUP_REQUIRED_ATTESTATIONS, userId)
            .then((types) => {
                if (cancelled) return;
                setOutdated((previous) =>
                    previous.length === types.length && previous.every((t, i) => t === types[i])
                        ? previous
                        : types,
                );
            })
            .catch(() => {
                /* Treated as "current" — see getOutdatedAttestations. */
            });
        return () => {
            cancelled = true;
        };
    }, [userId, isOffline]);

    const accept = async () => {
        setIsBusy(true);
        setError(null);
        try {
            for (const type of outdated) {
                const result = await recordAttestation(type);
                if (!result.success) {
                    setError(result.error ?? 'Could not record your acceptance');
                    return;
                }
            }
            setSettled(true);
        } finally {
            setIsBusy(false);
        }
    };

    if (settled || outdated.length === 0) return null;

    const documents = outdated
        .map((type) => DOCUMENT_LABELS[type])
        .filter((doc): doc is { label: string; href: string } => !!doc);

    return (
        <Modal label="Updated legal documents" width="panel">
            <div className="flex items-start gap-3">
                <FileText size={20} className="mt-0.5 flex-shrink-0 text-forge-600 dark:text-forge-400" />
                <div className="min-w-0">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">
                        We&apos;ve updated our legal documents
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        These have changed since you last accepted them. Please read them and accept
                        again to carry on.
                    </p>
                </div>
            </div>

            {error && (
                <div
                    role="alert"
                    className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{error}</span>
                </div>
            )}

            <ul className="mt-4 space-y-2">
                {documents.map((doc) => (
                    <li key={doc.href}>
                        <Link
                            to={doc.href}
                            target="_blank"
                            className="text-sm font-semibold text-forge-600 underline dark:text-forge-400"
                        >
                            {doc.label}
                        </Link>
                    </li>
                ))}
            </ul>

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                What changed: we now say plainly that there is no uptime guarantee, that the service
                may be discontinued, what a licence and a seat are, and how a member under 13 is
                handled. Nothing about your team&apos;s data has changed, and a lapsed licence still
                never deletes anything.
            </p>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
                {/*
                  * "Later" is not a loophole. The user has already accepted a previous version, so
                  * they are not unlicensed — they are out of date, and the honest response to that
                  * is to ask again next session rather than to lock them out mid-competition.
                  */}
                <Button variant="secondary" onClick={() => setSettled(true)} disabled={isBusy}>
                    Later
                </Button>
                <Button onClick={accept} busy={isBusy}>
                    I&apos;ve read and accept them
                </Button>
            </div>
        </Modal>
    );
}
