import { useState, useEffect, useCallback } from 'react';
import { Crown, AlertCircle, Clock, X } from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { getMemberDisplayName } from '../../lib/member-utils';
import type { TeamMember } from '../../types';
import Button from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ConfirmDialog';

interface AdminTransferPanelProps {
    teamId: string;
    teamMembers: TeamMember[];
}

interface Nomination {
    memberId: string;
    nominatedAt: string | null;
}

/**
 * Handing the team over — the retiring-coach case.
 *
 * WHY THIS IS A HANDSHAKE AND NOT A BUTTON.
 *
 * `transfer_team_admin` has existed since Sprint 3 with no caller, and pointing a button at it
 * would not have worked: `enforce_member_role_eligibility` refuses `role = 'admin'` unless the
 * INCOMING admin has themselves accepted the terms, and nothing in the app had ever written that
 * attestation for an existing member. The gate was armed with no door.
 *
 * That is not an obstacle to route around. You cannot validly attest on somebody else's behalf —
 * it is the entire point of an attestation — and a one-click transfer would hand legal
 * responsibility for a team of minors to somebody who never agreed to it. So: the admin
 * NOMINATES here, and the successor ACCEPTS on their own screen, after reading the terms.
 *
 * The outgoing admin is demoted to `coach`, not removed. A retiring teacher is often still around
 * for weeks, and their seat is theirs until somebody removes them — which is why this panel says
 * so rather than leaving the admin to wonder why the seat count did not move.
 */
export default function AdminTransferPanel({ teamId, teamMembers }: AdminTransferPanelProps) {
    const { profile, isOffline } = useAuth();
    const [nomination, setNomination] = useState<Nomination | null>(null);
    const [selectedMemberId, setSelectedMemberId] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmTarget, setConfirmTarget] = useState<TeamMember | null>(null);

    const viewerIsAdmin =
        teamMembers.find((m) => m.userId === profile?.id)?.role === 'admin';

    /**
     * Candidates for the role.
     *
     * Mirrors `nominate_team_admin`'s own refusals so the console does not offer a nomination the
     * server would reject: approved, not a managed profile (a child has no login to attest with),
     * and not the current admin. The 18+ rule and the terms attestation are deliberately NOT
     * filtered on — the successor may well not have attested yet, since that is what accepting
     * is for, and hiding them here would make the flow impossible to start.
     */
    const candidates = teamMembers.filter(
        (m) => m.role !== 'admin' && (m.status === 'approved' || !m.status) && !m.managedProfileId,
    );

    const fetchNomination = useCallback(async () => {
        if (!supabaseSync || !teamId || isOffline) return;

        const { data, error: fetchError } = await supabaseSync
            .from('teams')
            .select('pending_admin_member_id, pending_admin_nominated_at')
            .eq('id', teamId)
            .maybeSingle();

        if (fetchError) {
            setError('Could not read the current nomination');
            return;
        }
        setNomination(
            data?.pending_admin_member_id
                ? {
                    memberId: data.pending_admin_member_id,
                    nominatedAt: data.pending_admin_nominated_at ?? null,
                }
                : null,
        );
    }, [teamId, isOffline]);

    useEffect(() => {
        void fetchNomination();
    }, [fetchNomination]);

    const nominate = async (memberId: string) => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('nominate_team_admin', {
                p_team_id: teamId,
                p_new_member_id: memberId,
            });
            if (rpcError) throw rpcError;
            const result = data as { success: boolean; error?: string };
            if (!result.success) {
                setError(result.error ?? 'Could not nominate that member');
                return;
            }
            setSelectedMemberId('');
            await fetchNomination();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not nominate that member');
        } finally {
            setIsBusy(false);
        }
    };

    const cancelNomination = async () => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        try {
            const { error: rpcError } = await supabaseSync.rpc('cancel_team_admin_nomination', {
                p_team_id: teamId,
            });
            if (rpcError) throw rpcError;
            await fetchNomination();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not withdraw the nomination');
        } finally {
            setIsBusy(false);
        }
    };

    const nominee = nomination
        ? teamMembers.find((m) => m.id === nomination.memberId)
        : undefined;

    if (!isSupabaseConfigured()) return null;

    return (
        <div data-testid="admin-transfer-panel">
            <SectionHeader icon={Crown} title="Team admin" />

            {error && (
                <div
                    role="alert"
                    className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{error}</span>
                </div>
            )}

            {!viewerIsAdmin ? (
                <EmptyState
                    icon={Crown}
                    title="Only the team admin can hand the role over."
                    body="There is exactly one admin per team. Ask them to nominate a successor."
                />
            ) : nomination && nominee ? (
                <div
                    data-testid="pending-nomination"
                    className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/20"
                >
                    <div className="flex items-start gap-2">
                        <Clock size={16} className="mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                Waiting for {getMemberDisplayName(nominee)} to accept
                            </p>
                            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
                                They keep their current role until they sign in and accept the
                                admin terms themselves — you cannot agree to those on their behalf.
                                The nomination stands for 14 days.
                            </p>
                            <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-300/80">
                                When they accept, you become a <strong>coach</strong> and keep your
                                seat. Remove yourself from the roster afterwards to free it up.
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={cancelNomination}
                            busy={isBusy}
                            disabled={isOffline}
                            title={isOffline ? 'Not available offline' : 'Withdraw this nomination'}
                        >
                            {!isBusy && <X size={14} />}
                            Withdraw
                        </Button>
                    </div>
                </div>
            ) : candidates.length === 0 ? (
                <EmptyState
                    icon={Crown}
                    title="No one to hand over to yet."
                    body="The admin role can only go to an approved adult member with their own account. Invite or approve someone first."
                />
            ) : (
                <div className="space-y-3">
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Hand the team over — to a new teacher taking the programme on, for example.
                        Everything the team has built stays exactly where it is.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-0 flex-1">
                            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                                New team admin
                            </span>
                            <select
                                value={selectedMemberId}
                                onChange={(e) => setSelectedMemberId(e.target.value)}
                                disabled={isOffline || isBusy}
                                className="field"
                                aria-label="New team admin"
                            >
                                <option value="">Choose a member…</option>
                                {candidates.map((member) => (
                                    <option key={member.id} value={member.id}>
                                        {getMemberDisplayName(member)}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <Button
                            onClick={() => {
                                const target = candidates.find((m) => m.id === selectedMemberId);
                                if (target) setConfirmTarget(target);
                            }}
                            disabled={!selectedMemberId || isOffline}
                            busy={isBusy}
                            title={
                                isOffline
                                    ? 'Handing over needs a connection'
                                    : !selectedMemberId
                                        ? 'Choose the member who will take over'
                                        : 'Nominate this member as team admin'
                            }
                        >
                            Nominate
                        </Button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        They must be 18 or over and will be asked to accept the admin terms before
                        the role moves. If you have already left when the handover is needed, the
                        FalconForge operator can reassign the team on request.
                    </p>
                </div>
            )}

            {confirmTarget && (
                <ConfirmDialog
                    title="Nominate a new team admin?"
                    message={`${getMemberDisplayName(confirmTarget)} will be asked to accept the admin terms. When they do, they become the team admin and you become a coach. Nothing is deleted and you keep access to the team.`}
                    confirmLabel="Nominate"
                    onConfirm={() => {
                        void nominate(confirmTarget.id);
                        setConfirmTarget(null);
                    }}
                    onCancel={() => setConfirmTarget(null)}
                />
            )}
        </div>
    );
}
