import { useState, useEffect } from 'react';
import { X, UserCheck, UserX, Crown, GraduationCap, DollarSign, Shield, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../lib/supabase';
import { TeamMember, MemberRole } from '../types';
import { useCurrentUser } from '../lib/user-context';
import { getMemberDisplayName } from '../lib/member-utils';

interface PendingMember {
    id: string;
    team_id: string;
    user_id: string;
    full_name: string | null;
    email: string;
    status: 'pending' | 'approved' | 'rejected';
    joined_at: string;
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
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
    const { isOffline } = useCurrentUser();

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
                    joined_at
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
        fetchPendingMembers();
    }, [teamId]);

    // Approve a pending member
    const approveMember = async (memberId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setProcessingIds(prev => new Set(prev).add(memberId));

        try {
            const { error: updateError } = await supabaseSync
                .from('team_members')
                .update({ status: 'approved' })
                .eq('id', memberId);

            if (updateError) throw updateError;

            setPendingMembers(prev => prev.filter(m => m.id !== memberId));
            onMembersChange();
        } catch (err: any) {
            console.error('Error approving member:', err);
            setError('Failed to approve member');
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

    // Assign or release one of the team's licensed seats.
    const toggleSeat = async (memberId: string, currentlyAssigned: boolean) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setProcessingIds(prev => new Set(prev).add(memberId));

        try {
            const { error: updateError } = await supabaseSync
                .from('team_members')
                .update({ seat_assigned: !currentlyAssigned })
                .eq('id', memberId);

            // `enforce_seat_capacity` refuses this when the team has no seat left, so the
            // message has to be the database's rather than a generic one.
            if (updateError) throw updateError;
            onMembersChange();
        } catch (err: any) {
            console.error('Error updating seat assignment:', err);
            setError(err?.message || 'Failed to update seat assignment');
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev);
                next.delete(memberId);
                return next;
            });
        }
    };

    // Remove member from team
    const removeMember = async (memberId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;
        if (!confirm('Are you sure you want to remove this member from the team?')) return;

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
                    <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Pending Approvals Section */}
            {pendingMembers.length > 0 && (
                <div className="border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
                    <div className="bg-amber-50 dark:bg-amber-900/30 p-3 border-b border-amber-200 dark:border-amber-800">
                        <div className="flex items-center gap-2">
                            <Clock size={18} className="text-amber-600 dark:text-amber-400" />
                            <h4 className="font-semibold text-amber-800 dark:text-amber-300">
                                Pending Approvals ({pendingMembers.length})
                            </h4>
                        </div>
                    </div>
                    <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
                        {pendingMembers.map((member) => (
                            <li key={member.id} className="p-3 bg-white dark:bg-slate-800 flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {getDisplayName(member)}
                                    </p>
                                    <p className="text-xs text-slate-400 truncate">{member.email}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => approveMember(member.id)}
                                        disabled={processingIds.has(member.id)}
                                        className="p-2 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition disabled:opacity-50"
                                        title="Approve"
                                    >
                                        {processingIds.has(member.id) ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <UserCheck size={16} />
                                        )}
                                    </button>
                                    <button
                                        onClick={() => rejectMember(member.id)}
                                        disabled={processingIds.has(member.id)}
                                        className="p-2 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition disabled:opacity-50"
                                        title="Reject"
                                    >
                                        <UserX size={16} />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Active Members Section */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        <UserCheck size={18} className="text-green-600" />
                        Active Members ({approvedMembers.length})
                    </h4>
                    {isLoading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
                </div>

                {approvedMembers.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                        <p className="text-sm">No active members yet.</p>
                    </div>
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
                                            className="text-xs p-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50"
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

                                        {/* Billing Toggle */}
                                        <button
                                            onClick={() => toggleSeat(member.id, member.seatAssigned)}
                                            disabled={processingIds.has(member.id)}
                                            className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded transition disabled:opacity-50 ${member.seatAssigned
                                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                                : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
                                                }`}
                                            title={member.seatAssigned ? 'Holds a licensed seat' : 'No seat assigned'}
                                        >
                                            <DollarSign size={12} />
                                            {member.seatAssigned ? 'Seated' : 'No seat'}
                                        </button>

                                        {/* Remove Button */}
                                        <button
                                            onClick={() => removeMember(member.id)}
                                            disabled={processingIds.has(member.id) || member.role === 'admin'}
                                            className="p-1.5 text-slate-400 hover:text-red-500 transition disabled:opacity-30 disabled:cursor-not-allowed"
                                            title={member.role === 'admin' ? 'Transfer the admin role before removing this member' : 'Remove from team'}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
