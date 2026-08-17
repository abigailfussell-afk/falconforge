import { useState, useEffect, useCallback } from 'react';
import { Gift, ShieldAlert, Crown, AlertCircle, CheckCircle } from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import Button from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';
import EmptyState from '../ui/EmptyState';

interface OperatorTeam {
    team_id: string;
    status: string;
    seats_total: number | null;
    seats_unlimited: boolean;
    seats_used: number;
    valid_until: string | null;
}

/**
 * The platform operator's console — gifting licences, and rescuing a stranded team.
 *
 * GATED TWICE, AND BOTH GATES ARE DELIBERATE.
 *
 * `is_platform_operator()` decides in the database: `grant_team_license` and
 * `operator_transfer_team_admin` both refuse a caller with no operator identity, and
 * `platform_operators` ships EMPTY with no API path that can write it, so there is no way to
 * grant yourself the role from a browser. What this component adds is only that a non-operator
 * is not shown a page of controls that would all fail — the "operator page seen by somebody who
 * is not an operator" case the hand-off asked to be constructed. Hiding it is UX; the refusal is
 * the database's.
 *
 * The team list comes from `team_entitlement`, which is `security_invoker`, so an operator sees
 * exactly the teams their own RLS lets them read. That is a real limitation rather than an
 * oversight: cross-tenant visibility for the operator would need its own policy and its own
 * isolation tests, and gifting works from a team id, which is what a support conversation
 * produces. Recorded in the parking lot.
 */
export default function OperatorConsole() {
    const { isOffline } = useAuth();
    const [isOperator, setIsOperator] = useState<boolean | null>(null);
    const [teams, setTeams] = useState<OperatorTeam[]>([]);
    const [teamId, setTeamId] = useState('');
    const [seats, setSeats] = useState('');
    const [months, setMonths] = useState('6');
    const [notes, setNotes] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Cold-path transfer.
    const [transferTeamId, setTransferTeamId] = useState('');
    const [transferMemberId, setTransferMemberId] = useState('');
    const [transferNotes, setTransferNotes] = useState('');

    const checkOperator = useCallback(async () => {
        if (!supabaseSync || isOffline) {
            setIsOperator(false);
            return;
        }
        // `is_platform_operator` is the same function the RPCs gate on, so the UI and the
        // database cannot disagree about who this is.
        const { data, error: rpcError } = await supabaseSync.rpc('is_platform_operator');
        setIsOperator(rpcError ? false : data === true);
    }, [isOffline]);

    const loadTeams = useCallback(async () => {
        if (!supabaseSync || isOffline) return;
        const { data } = await supabaseSync
            .from('team_entitlement')
            .select('team_id, status, seats_total, seats_unlimited, seats_used, valid_until');
        setTeams((data as OperatorTeam[]) ?? []);
    }, [isOffline]);

    useEffect(() => {
        void checkOperator();
    }, [checkOperator]);

    useEffect(() => {
        if (isOperator) void loadTeams();
    }, [isOperator, loadTeams]);

    const grant = async () => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const monthCount = Number(months);
            const validUntil =
                monthCount > 0
                    ? new Date(new Date().setMonth(new Date().getMonth() + monthCount)).toISOString()
                    : undefined;

            const { data, error: rpcError } = await supabaseSync.rpc('grant_team_license', {
                p_team_id: teamId.trim(),
                // An empty seat count means an UNLIMITED grant, which is what `seats IS NULL`
                // means in `license_grants`. Passing 0 would violate the table's own check.
                p_seats: seats.trim() ? Number(seats) : undefined,
                p_valid_until: validUntil,
                p_notes: notes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as { success: boolean; error?: string };
            if (!result.success) {
                setError(result.error ?? 'Could not issue the grant');
                return;
            }
            setSuccess(
                `Licence granted${seats.trim() ? ` — ${seats} seats` : ' — unlimited seats'}${monthCount > 0 ? ` for ${monthCount} months` : ', open-ended'}.`,
            );
            setNotes('');
            await loadTeams();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not issue the grant');
        } finally {
            setIsBusy(false);
        }
    };

    const transferAdmin = async () => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('operator_transfer_team_admin', {
                p_team_id: transferTeamId.trim(),
                p_new_member_id: transferMemberId.trim(),
                p_notes: transferNotes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as { success: boolean; error?: string; team_was_stranded?: boolean };
            if (!result.success) {
                setError(result.error ?? 'Could not reassign the admin role');
                return;
            }
            setSuccess('Admin role reassigned. The action is recorded in the operator audit log.');
            setTransferNotes('');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not reassign the admin role');
        } finally {
            setIsBusy(false);
        }
    };

    if (!isSupabaseConfigured()) return null;

    if (isOperator === null) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <p className="text-sm text-slate-500 dark:text-slate-400">Checking access…</p>
            </div>
        );
    }

    /*
     * Not an operator. Says so plainly rather than pretending the page does not exist: the route
     * is reachable by typing the URL, and an unexplained blank screen is the failure mode Sprint
     * 4 spent time removing elsewhere. Nothing here leaks — the refusal is the same one the
     * database would give.
     */
    if (!isOperator) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-700 dark:bg-slate-800">
                <EmptyState
                    icon={ShieldAlert}
                    title="This page is for the FalconForge operator."
                    body={
                        isOffline
                            ? 'It also needs a connection to confirm who you are, and this device is offline.'
                            : 'Your account does not have platform-operator access, so there is nothing here for you. Your team’s own settings are on the Admin Settings page.'
                    }
                />
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="operator-console">
            {error && (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
                >
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{error}</span>
                </div>
            )}
            {success && (
                <div
                    role="status"
                    className="flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
                >
                    <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="min-w-0">{success}</span>
                </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Gift} title="Gift a licence" />
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Team ID
                        </span>
                        <input
                            type="text"
                            value={teamId}
                            onChange={(e) => setTeamId(e.target.value)}
                            placeholder="uuid of the team"
                            className="field font-mono"
                        />
                    </label>
                    <label>
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Seats
                        </span>
                        <input
                            type="number"
                            min="1"
                            value={seats}
                            onChange={(e) => setSeats(e.target.value)}
                            placeholder="blank = unlimited"
                            className="field"
                        />
                    </label>
                    <label>
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Months
                        </span>
                        <input
                            type="number"
                            min="0"
                            value={months}
                            onChange={(e) => setMonths(e.target.value)}
                            placeholder="0 = open-ended"
                            className="field"
                        />
                    </label>
                    <label className="sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Notes (kept as the audit trail)
                        </span>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. beta team, free 6 months"
                            className="field"
                        />
                    </label>
                </div>
                <div className="mt-3">
                    <Button
                        onClick={grant}
                        busy={isBusy}
                        disabled={!teamId.trim() || isOffline}
                        title={isOffline ? 'Gifting needs a connection' : 'Issue this grant'}
                    >
                        <Gift size={16} />
                        Issue grant
                    </Button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Grants accumulate — issuing one never revokes another, so a team on a trial
                    keeps it. Leave seats blank for an unlimited grant.
                </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Crown} title="Reassign a stranded team's admin" />
                {/*
                  * WHY THIS CONTROL EXISTS AT ALL, in the words the next person will need.
                  *
                  * Every ordinary handover path runs through `can_manage_billing`, which only the
                  * departing admin satisfied. A coach who retires WITHOUT handing over leaves a
                  * team whose data is intact and which no API call can give an admin — the
                  * one-admin partial index blocks promoting anybody while their row still holds
                  * the role. This is the only way out, which is why it is operator-gated and
                  * written to an audit table nobody can edit.
                  */}
                <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                    For a team whose admin has left without handing over. Every other route to the
                    admin role needs the outgoing admin to act, so without this the team keeps all
                    its data and nobody can manage it. The successor still has to be an approved
                    18+ member who has accepted the admin terms — this chooses who, it does not
                    waive what the role requires.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Team ID
                        </span>
                        <input
                            type="text"
                            value={transferTeamId}
                            onChange={(e) => setTransferTeamId(e.target.value)}
                            className="field font-mono"
                        />
                    </label>
                    <label>
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            New admin&apos;s member ID
                        </span>
                        <input
                            type="text"
                            value={transferMemberId}
                            onChange={(e) => setTransferMemberId(e.target.value)}
                            className="field font-mono"
                        />
                    </label>
                    <label className="sm:col-span-2">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Why the operator is stepping in (recorded)
                        </span>
                        <input
                            type="text"
                            value={transferNotes}
                            onChange={(e) => setTransferNotes(e.target.value)}
                            placeholder="e.g. coach retired; successor confirmed by email"
                            className="field"
                        />
                    </label>
                </div>
                <div className="mt-3">
                    <Button
                        variant="danger"
                        onClick={transferAdmin}
                        busy={isBusy}
                        disabled={!transferTeamId.trim() || !transferMemberId.trim() || isOffline}
                        title={isOffline ? 'Reassigning needs a connection' : 'Reassign the admin role'}
                    >
                        Reassign admin role
                    </Button>
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Gift} title="Teams you can see" />
                {teams.length === 0 ? (
                    <EmptyState
                        title="No teams visible."
                        body="team_entitlement is security_invoker, so this lists only teams your own account can read. Gifting works from a team ID regardless."
                    />
                ) : (
                    <ul className="space-y-2">
                        {teams.map((team) => (
                            <li
                                key={team.team_id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50"
                            >
                                <code className="text-2xs font-mono text-slate-500 dark:text-slate-400">
                                    {team.team_id}
                                </code>
                                <span className="text-xs text-slate-700 dark:text-slate-300">
                                    {team.status} ·{' '}
                                    {team.seats_unlimited
                                        ? `${team.seats_used} of unlimited`
                                        : `${team.seats_used} of ${team.seats_total ?? 0}`}{' '}
                                    seats ·{' '}
                                    {team.valid_until
                                        ? new Date(team.valid_until).toLocaleDateString()
                                        : 'open-ended'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
