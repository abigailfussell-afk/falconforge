import { useState, useEffect } from 'react';
import { X, UserCheck, UserX, Crown, GraduationCap, DollarSign, Shield, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../lib/supabase';
import { TeamMember, MemberRole } from '../types';
import { getMemberDisplayName } from '../lib/member-utils';
import { useAuth } from '../lib/auth';
import { recordAttestation } from '../lib/attestations';
import { useEntitlement } from '../lib/entitlement';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';
import ConfirmDialog from './ConfirmDialog';

interface PendingMember {
    id: string;
    team_id: string;
    user_id: string;
    full_name: string | null;
    email: string;
    status: 'pending' | 'approved' | 'rejected';
    joined_at: string;
    /**
     * Set when this request is a guardian joining on a CHILD's behalf.
     *
     * The only thing that distinguishes a managed request from any other on this screen, and
     * the reason it is selected: the admin's COPPA attestation is asked for exactly here and
     * nowhere else.
     */
    managed_profile_id: string | null;
}

interface MemberManagerProps {
    teamId: string;
    teamMembers: TeamMember[];
    onMembersChange: () => void;
}

/**
 * Roles this screen can assign.
 *
 * `admin` is deliberately absent. There is exactly one per team (a partial unique index
 * enforces it) and moving it is a transfer, not an edit — `transfer_team_admin` demotes and
 * promotes in one transaction because the index permits no moment with two. The admin
 * console in Sprint 6 is where that lives.
 */
const ASSIGNABLE_ROLES: { value: MemberRole; label: string }[] = [
    { value: 'student', label: 'Student' },
    { value: 'mentor', label: 'Mentor' },
    { value: 'coach', label: 'Coach' },
];

export default function MemberManager({ teamId, teamMembers, onMembersChange }: MemberManagerProps) {
    const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
    /*
     * Which managed requests the admin has ticked the COPPA box for, this sitting.
     *
     * Per member rather than one box for the panel: they are separate children and separate
     * attestations, and a single box would let one tick approve three.
     */
    const [coppaAttested, setCoppaAttested] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    // Member awaiting the remove confirmation (null when the dialog is closed).
    const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
    const { profile, isOffline } = useAuth();
    /*
     * Seat capacity, for the approval decision.
     *
     * Read here rather than passed in: this is the only screen that approves anybody, and the
     * store copy is the same one `EntitlementPanel` renders, so the two cannot disagree about
     * how many seats are left.
     */
    const { isKnown, seatsUsed, seatsTotal, seatsUnlimited, seatsRemaining, isAtCapacity } =
        useEntitlement();

    /**
     * Seats are the admin's alone — `enforce_seat_capacity` refuses them to anyone else, so
     * a coach shown this control would only ever get an error back. This is UX for a rule the
     * database owns, not the rule itself.
     */
    const viewerIsAdmin =
        teamMembers.find((m) => m.userId === profile?.id)?.role === 'admin';

    // Fetch pending members for this team
    const fetchPendingMembers = async () => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        if (isOffline) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timed out')), 10000)
            );

            const fetchPromise = supabaseSync
                .from('team_members')
                .select(`
                    id,
                    team_id,
                    user_id,
                    full_name,
                    email,
                    status,
                    joined_at,
                    managed_profile_id
                `)
                .eq('team_id', teamId)
                .eq('status', 'pending')
                .order('joined_at', { ascending: false });

            // Race the fetch against the timeout
            const { data, error: fetchError } = await Promise.race([fetchPromise, timeoutPromise]) as any;

            if (fetchError) throw fetchError;
            setPendingMembers((data as PendingMember[]) || []);
        } catch (err: any) {
            console.error('Error fetching pending members:', err);
            if (err.message === 'Request timed out') {
                setError('Request timed out');
            } else {
                setError('Failed to load pending members');
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void fetchPendingMembers();
    }, [teamId]);

    /*
     * Approve a pending member — WHICH IS WHAT CONSUMES A SEAT.
     *
     * `status` and `seat_assigned` move in ONE statement, deliberately. Seats are purchased team
     * capacity and approval is the gate: `enforce_seat_capacity` counts approved seat-holders
     * before allowing another, so setting both columns together means the trigger refuses the
     * whole approval atomically when the team is full. Two separate updates would let a member
     * be approved into a team with no seat for them, which is the state the model exists to
     * prevent.
     *
     * The trigger's message names the numbers ("No licensed seats available for this team (10 of
     * 10 in use)"), so it is shown verbatim rather than replaced with something vaguer. Two
     * admins approving at once from different devices is a real race, and this is where it
     * surfaces — which is why the console handles the refusal even when the seat count said
     * there was room.
     */
    const approveMember = async (memberId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        const member = pendingMembers.find(m => m.id === memberId);

        setProcessingIds(prev => new Set(prev).add(memberId));
        setError(null);

        try {
            /*
             * THE COPPA ATTESTATION IS RECORDED BEFORE THE APPROVAL, NOT AFTER.
             *
             * Plan section 3 splits COPPA responsibility three ways, and this is the admin's
             * layer: "the team admin attests at approval that they will not roster a child
             * without the guardian — a single checkbox recorded as an attestation, not a
             * workflow."
             *
             * RECORDED is the operative word. `coppa_responsibility` has existed in
             * `AttestationType` and in the database's CHECK constraint since Sprint 3 with NO
             * WRITER ANYWHERE — a value with readers and no writer, which is
             * `docs/failure-modes.md` §7 and the exact shape that left this product's COPPA
             * posture resting on an attestation record nothing created for four sprints. This
             * is the writer.
             *
             * Ordered first on purpose: if the attestation write fails, the approval does not
             * happen, and the admin sees why. The reverse order would leave a rostered child
             * with no record of the attestation that permitted it — which is precisely the
             * artefact somebody will ask for later.
             */
            if (member?.managed_profile_id) {
                const { success, error: attestError } = await recordAttestation('coppa_responsibility');
                if (!success) {
                    throw new Error(
                        attestError
                            ? `Could not record your confirmation: ${attestError}`
                            : 'Could not record your confirmation.',
                    );
                }
            }

            const { error: updateError } = await supabaseSync
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true })
                .eq('id', memberId);

            if (updateError) throw updateError;

            setPendingMembers(prev => prev.filter(m => m.id !== memberId));
            onMembersChange();
        } catch (err: any) {
            console.error('Error approving member:', err);
            setError(err?.message || 'Failed to approve member');
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(memberId);
                return next;
            });
        }
    };

    // Reject a pending member
    const rejectMember = async (memberId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setProcessingIds(prev => new Set(prev).add(memberId));

        try {
            const { error: deleteError } = await supabaseSync
                .from('team_members')
                .delete()
                .eq('id', memberId);

            if (deleteError) throw deleteError;

            setPendingMembers(prev => prev.filter(m => m.id !== memberId));
        } catch (err: any) {
            console.error('Error rejecting member:', err);
            setError('Failed to reject member');
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(memberId);
                return next;
            });
        }
    };

    // Update member role
    const updateMemberRole = async (memberId: string, newRole: MemberRole) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setProcessingIds(prev => new Set(prev).add(memberId));

        try {
            const { error: updateError } = await supabaseSync
                .from('team_members')
                .update({ role: newRole })
                .eq('id', memberId);

            if (updateError) throw updateError;
            onMembersChange();
        } catch (err: any) {
            console.error('Error updating role:', err);
            setError('Failed to update role');
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(memberId);
                return next;
            });
        }
    };

    // Remove member from team (confirmation handled by the ConfirmDialog below)
    const removeMember = async (memberId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setProcessingIds(prev => new Set(prev).add(memberId));

        try {
            const { error: deleteError } = await supabaseSync
                .from('team_members')
                .delete()
                .eq('id', memberId);

            if (deleteError) throw deleteError;
            onMembersChange();
        } catch (err: any) {
            console.error('Error removing member:', err);
            setError('Failed to remove member');
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(memberId);
                return next;
            });
        }
    };

    // Get role icon
    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'admin': return <Crown size={14} className="text-amber-500" />;
            case 'coach': return <Shield size={14} className="text-blue-500" />;
            case 'mentor': return <Shield size={14} className="text-emerald-500" />;
            default: return <GraduationCap size={14} className="text-slate-400" />;
        }
    };

    // Get display name
    // Pending rows come straight off the wire in snake_case, so normalise before naming.
    const getDisplayName = (member: TeamMember | PendingMember): string =>
        getMemberDisplayName(
            'fullName' in member
                ? member
                : { fullName: member.full_name, email: member.email }
        );

    if (!isSupabaseConfigured()) {
        return (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                <AlertCircle size={16} className="inline mr-2" />
                Member management requires Supabase to be configured.
            </div>
        );
    }

    const approvedMembers = teamMembers.filter(m => m.status === 'approved' || !m.status);

    return (
        <div className="space-y-6">
            {/* Error display */}
            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle size={16} />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 transition-colors" title="Dismiss">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Pending Approvals Section */}
            {pendingMembers.length > 0 && (
                <div className="border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
                    <div className="bg-amber-50 dark:bg-amber-900/30 p-3 border-b border-amber-200 dark:border-amber-800">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <Clock size={18} className="text-amber-600 dark:text-amber-400" />
                                <h4 className="font-semibold text-amber-800 dark:text-amber-300">
                                    Pending Approvals ({pendingMembers.length})
                                </h4>
                            </div>
                            {/*
                              * THE SEAT MATH, WHERE THE DECISION IS MADE.
                              *
                              * The brief's scenario: an admin shares the code with 20 people and
                              * has 10 seats. Ten of those requests cannot be approved, and an
                              * admin who only finds that out by clicking Approve ten times and
                              * reading a database error on the eleventh has been failed by this
                              * screen. `seatsRemaining` is null for an unlimited grant, which is
                              * not a number and is not rendered as one.
                              */}
                            {isKnown && !seatsUnlimited && (
                                <span
                                    data-testid="pending-seat-math"
                                    className={`text-xs font-semibold ${isAtCapacity
                                        ? 'text-red-700 dark:text-red-400'
                                        : 'text-amber-800 dark:text-amber-300'
                                        }`}
                                >
                                    {isAtCapacity
                                        ? `No seats left — ${seatsUsed} of ${seatsTotal ?? 0} in use`
                                        : `${seatsRemaining} of ${seatsTotal ?? 0} seats free`}
                                </span>
                            )}
                        </div>
                        {isAtCapacity && (
                            <p
                                data-testid="pending-capacity-warning"
                                className="mt-2 text-xs text-amber-800/90 dark:text-amber-300/90"
                            >
                                Approving anyone needs a free seat. Remove a member, or add seats,
                                and these requests will still be here.
                            </p>
                        )}
                    </div>
                    <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
                        {pendingMembers.map((member) => (
                            <li key={member.id} className="p-3 bg-white dark:bg-slate-800 flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {getDisplayName(member)}
                                    </p>
                                    {/*
                                     * For a managed child the email shown is the GUARDIAN's —
                                     * the child has no account and no address we hold — so it
                                     * is labelled rather than left to look like the child's.
                                     */}
                                    <p className="text-xs text-slate-400 truncate">
                                        {member.managed_profile_id ? 'Guardian: ' : ''}
                                        {member.email}
                                    </p>
                                    {member.managed_profile_id && (
                                        <label className="mt-1.5 flex items-start gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="mt-0.5"
                                                checked={coppaAttested.has(member.id)}
                                                onChange={(e) =>
                                                    setCoppaAttested((prev) => {
                                                        const next = new Set(prev);
                                                        if (e.target.checked) next.add(member.id);
                                                        else next.delete(member.id);
                                                        return next;
                                                    })
                                                }
                                                data-testid={`coppa-attest-${member.id}`}
                                            />
                                            <span className="text-xs text-slate-500 dark:text-slate-400">
                                                This member is a child joining through their parent
                                                or guardian. I confirm I will not add a child to
                                                this team without their guardian.
                                            </span>
                                        </label>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => approveMember(member.id)}
                                        busy={processingIds.has(member.id)}
                                        /*
                                         * Disabled on capacity and on offline, each with its own
                                         * reason. Approval is a direct Supabase write, not a
                                         * queued one, so offline genuinely means "not now" —
                                         * the same distinction `isOffline` draws elsewhere on
                                         * this screen.
                                         */
                                        disabled={
                                            !viewerIsAdmin ||
                                            isOffline ||
                                            isAtCapacity ||
                                            // A managed child cannot be approved until the
                                            // admin has attested. Disabled with a reason rather
                                            // than enabled with an early return (§8).
                                            (!!member.managed_profile_id && !coppaAttested.has(member.id))
                                        }
                                        title={
                                            !viewerIsAdmin
                                                ? 'Only the team admin can approve members'
                                                : isOffline
                                                    ? 'Approving needs a connection'
                                                    : isAtCapacity
                                                        ? 'No licensed seats left — remove a member or add seats first'
                                                        : member.managed_profile_id && !coppaAttested.has(member.id)
                                                            ? 'Confirm the guardian statement first'
                                                            : 'Approve'
                                        }
                                        aria-label="Approve"
                                    >
                                        {!processingIds.has(member.id) && <UserCheck size={16} />}
                                    </Button>
                                    <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={() => rejectMember(member.id)}
                                        busy={processingIds.has(member.id)}
                                        title="Reject"
                                        aria-label="Reject"
                                    >
                                        {!processingIds.has(member.id) && <UserX size={16} />}
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Active Members Section */}
            <div>
                <SectionHeader
                    icon={UserCheck}
                    title={`Active Members (${approvedMembers.length})`}
                    action={isLoading ? <RefreshCw size={14} className="animate-spin text-slate-400" /> : undefined}
                />

                {approvedMembers.length === 0 ? (
                    <EmptyState title="No active members yet." />
                ) : (
                    <ul className="space-y-2">
                        {approvedMembers.map((member) => (
                            <li
                                key={member.id}
                                className="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"
                            >
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-600 flex items-center justify-center">
                                            {getRoleIcon(member.role)}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="font-medium text-slate-700 dark:text-slate-200 truncate">
                                                {getDisplayName(member)}
                                            </p>
                                            <p className="text-xs text-slate-400 truncate">{member.email}</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 flex-wrap">
                                        {/* Role Selector */}
                                        <select
                                            value={member.role}
                                            onChange={(e) => updateMemberRole(member.id, e.target.value as MemberRole)}
                                            disabled={processingIds.has(member.id) || member.role === 'admin'}
                                            title={member.role === 'admin' ? 'Transfer the admin role instead (Admin Settings)' : undefined}
                                            className="field w-auto text-xs p-1.5 disabled:opacity-50"
                                        >
                                            {ASSIGNABLE_ROLES.map((role) => (
                                                <option key={role.value} value={role.value}>{role.label}</option>
                                            ))}
                                            {/* The admin's own row shows their role rather than
                                                silently rendering as whatever sorts first. */}
                                            {member.role === 'admin' && (
                                                <option value="admin">Team Admin</option>
                                            )}
                                        </select>

                                        {/*
                                          * SEAT STATE, NOT A SEAT CONTROL.
                                          *
                                          * Sprint 5 shipped a per-row toggle here, and Sprint 6
                                          * deleted it. Under the model this sprint settled on,
                                          * a seat is not a thing an admin hands out separately:
                                          * an APPROVED member holds one and a removed member
                                          * does not, so approval and removal are the only two
                                          * actions that change the count. A toggle offered a
                                          * third, contradictory answer — an approved member
                                          * with no seat, which billed for nobody and granted
                                          * everything, since no policy consults `seat_assigned`.
                                          *
                                          * Kept as a badge because "does this person cost a
                                          * seat" is still worth seeing on the row.
                                          */}
                                        <span
                                            className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded ${member.seatAssigned
                                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                                : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
                                                }`}
                                            title={
                                                member.seatAssigned
                                                    ? 'Holds one of the team’s licensed seats. Removing this member frees it.'
                                                    : 'Not using a seat. Approved members use one — this row predates that rule.'
                                            }
                                        >
                                            <DollarSign size={12} />
                                            {member.seatAssigned ? 'Seated' : 'No seat'}
                                        </span>

                                        {/* Remove Button */}
                                        <IconButton
                                            danger
                                            onClick={() => setRemoveConfirmId(member.id)}
                                            disabled={processingIds.has(member.id) || member.role === 'admin'}
                                            title={member.role === 'admin' ? 'Transfer the admin role before removing this member' : 'Remove from team'}
                                        >
                                            <X size={16} />
                                        </IconButton>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {removeConfirmId && (
                <ConfirmDialog
                    title="Remove Member?"
                    message="Are you sure you want to remove this member from the team?"
                    confirmLabel="Remove"
                    onConfirm={() => {
                        void removeMember(removeConfirmId);
                        setRemoveConfirmId(null);
                    }}
                    onCancel={() => setRemoveConfirmId(null)}
                />
            )}
        </div>
    );
}
