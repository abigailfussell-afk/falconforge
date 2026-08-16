import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Crown, AlertCircle, CheckCircle } from 'lucide-react';
import { supabaseSync } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { recordAttestation } from '../../lib/attestations';
import { ADMIN_TRANSFER_REQUIRED_ATTESTATIONS } from '../../lib/attestations';
import type { TeamMember } from '../../types';
import Button from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';

interface AcceptAdminNominationProps {
    teamId: string;
    teamMembers: TeamMember[];
    /** Called after a successful transfer so the console can re-read the roster. */
    onTransferred: () => void;
}

/**
 * "You have been nominated as team admin." The successor's half of the handshake.
 *
 * THIS IS WHERE THE ATTESTATION IS COLLECTED, and that is the reason the flow has two halves.
 * `enforce_member_role_eligibility` refuses `role = 'admin'` to anyone without a `terms` or
 * `coach_terms` attestation, and until this component existed nothing in the app ever wrote one
 * for an existing member — so `transfer_team_admin` could not have succeeded for any ordinary
 * member no matter who called it.
 *
 * The attestation is recorded BEFORE the RPC, not after, because the trigger is what enforces it:
 * if the record is missing the promotion is refused, so writing it first is the only order that
 * can work. If the RPC then fails for some other reason the attestation is harmless — the person
 * did read and accept the terms, and `user_attestations` now keeps every version rather than
 * overwriting, so the record is honest either way.
 *
 * Renders nothing at all unless the signed-in user is the nominee, so it can sit unconditionally
 * at the top of the console.
 */
export default function AcceptAdminNomination({
    teamId,
    teamMembers,
    onTransferred,
}: AcceptAdminNominationProps) {
    const { profile, isOffline } = useAuth();
    const [isNominee, setIsNominee] = useState(false);
    const [accepted, setAccepted] = useState(false);
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const myMember = teamMembers.find((m) => m.userId === profile?.id && !m.managedProfileId);

    const checkNomination = useCallback(async () => {
        if (!supabaseSync || !teamId || !myMember || isOffline) return;

        const { data } = await supabaseSync
            .from('teams')
            .select('pending_admin_member_id')
            .eq('id', teamId)
            .maybeSingle();

        setIsNominee(!!data?.pending_admin_member_id && data.pending_admin_member_id === myMember.id);
    }, [teamId, myMember, isOffline]);

    useEffect(() => {
        checkNomination();
    }, [checkNomination]);

    const accept = async () => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        try {
            // Every attestation the admin role requires, recorded first — see the note above on
            // why this order is the only one that can work.
            for (const type of ADMIN_TRANSFER_REQUIRED_ATTESTATIONS) {
                const result = await recordAttestation(type);
                if (!result.success) {
                    setError(result.error ?? 'Could not record your agreement');
                    return;
                }
            }

            const { data, error: rpcError } = await supabaseSync.rpc('accept_team_admin_nomination', {
                p_team_id: teamId,
            });
            if (rpcError) throw rpcError;

            const result = data as { success: boolean; error?: string };
            if (!result.success) {
                setError(result.error ?? 'Could not accept the nomination');
                return;
            }

            setDone(true);
            onTransferred();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not accept the nomination');
        } finally {
            setIsBusy(false);
        }
    };

    const decline = async () => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        try {
            const { error: rpcError } = await supabaseSync.rpc('cancel_team_admin_nomination', {
                p_team_id: teamId,
            });
            if (rpcError) throw rpcError;
            setIsNominee(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not decline');
        } finally {
            setIsBusy(false);
        }
    };

    if (done) {
        return (
            <div
                data-testid="nomination-accepted"
                className="mb-6 flex items-start gap-3 rounded-xl border border-green-300 bg-green-50 p-4 dark:border-green-700/60 dark:bg-green-900/20"
            >
                <CheckCircle size={18} className="mt-0.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                <div>
                    <p className="text-sm font-bold text-green-900 dark:text-green-200">
                        You are now the team admin.
                    </p>
                    <p className="text-xs text-green-800/80 dark:text-green-300/80">
                        The previous admin is now a coach and keeps their seat. You can change that
                        from the roster below.
                    </p>
                </div>
            </div>
        );
    }

    if (!isNominee) return null;

    return (
        <div
            data-testid="accept-nomination"
            className="mb-6 rounded-xl border border-forge-300 bg-forge-50 p-4 dark:border-forge-700/60 dark:bg-forge-900/20"
        >
            <SectionHeader icon={Crown} title="You have been nominated as team admin" />

            {error && (
                <div
                    role="alert"
                    className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{error}</span>
                </div>
            )}

            <p className="text-sm text-slate-700 dark:text-slate-300">
                The current team admin has asked you to take the role on. As team admin you become
                the person responsible for this team on FalconForge:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300">
                <li>You control who is on the team, and how many licensed seats are in use.</li>
                <li>
                    You accept responsibility for obtaining parental consent for members under 13,
                    and act as the parent&apos;s agent for COPPA purposes.
                </li>
                <li>You are the billing contact for the team.</li>
            </ul>

            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-slate-300 p-3 transition hover:border-forge-500/50 dark:border-slate-600">
                <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="mt-0.5 h-5 w-5 rounded border-slate-400 text-forge-600 focus:ring-forge-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">
                    I am 18 or over and I accept the{' '}
                    <Link
                        to="/legal/terms"
                        target="_blank"
                        className="font-semibold text-forge-600 underline dark:text-forge-400"
                    >
                        Terms &amp; Conditions
                    </Link>
                    , the billing responsibility and the COPPA responsibilities of a team admin.
                </span>
            </label>

            <div className="mt-3 flex flex-wrap gap-2">
                <Button
                    onClick={accept}
                    busy={isBusy}
                    disabled={!accepted || isOffline}
                    title={
                        isOffline
                            ? 'Accepting needs a connection'
                            : !accepted
                                ? 'Read and accept the terms first'
                                : 'Become the team admin'
                    }
                >
                    Become team admin
                </Button>
                <Button variant="secondary" onClick={decline} busy={isBusy} disabled={isOffline}>
                    Decline
                </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Nothing changes until you accept. Declining leaves the current admin in place.
            </p>
        </div>
    );
}
