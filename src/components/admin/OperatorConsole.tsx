import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Trash2,
    Gift,
    ShieldAlert,
    Crown,
    AlertCircle,
    CheckCircle,
    Search,
    Ban,
    Users,
    ScrollText,
    Clock,
    Sparkles,
    CalendarCheck,
} from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../../lib/supabase';
import { EXPIRY_WARNING_DAYS } from '../../lib/entitlement';
import { useAuth } from '../../lib/auth';
import { TITLE_MAX_LENGTH } from '../../lib/text-limits';
import Button from '../ui/Button';
import SectionHeader from '../ui/SectionHeader';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ConfirmDialog';

interface DirectoryRow {
    team_id: string;
    team_name: string;
    team_number: string | null;
    created_at: string;
    admin_member_id: string | null;
    admin_name: string | null;
    admin_email: string | null;
    members_approved: number;
    members_pending: number;
    entitlement_status: string;
    seats_total: number | null;
    seats_unlimited: boolean;
    seats_used: number;
    valid_until: string | null;
}

/**
 * A team registered recently enough to still be on its probation (D3).
 *
 * `has_been_used` is the field that carries the decision and the reason this list exists at
 * all: a fake team and a real one look identical on number, name and age. It is deliberately
 * generous — a second person on the roster, or any content row — because the question is "is
 * this real", not "is this active".
 */
interface NewTeamRow {
    team_id: string;
    team_name: string;
    program: string;
    team_number: string | null;
    created_at: string;
    age_days: number;
    admin_name: string | null;
    admin_email: string | null;
    members_total: number;
    content_rows: number;
    has_been_used: boolean;
    valid_until: string | null;
    is_probation: boolean;
}

interface DetailMember {
    id: string;
    /**
     * The ACCOUNT behind the membership, which erasure acts on — and for a managed child this is
     * the GUARDIAN's id, because a child has no login of their own. Every use of it below is
     * guarded by `is_managed` for that reason.
     */
    user_id: string | null;
    full_name: string | null;
    email: string | null;
    role: string;
    status: string;
    seat_assigned: boolean;
    is_managed: boolean;
}

interface DetailGrant {
    id: string;
    source: string;
    seats: number | null;
    valid_from: string;
    valid_until: string | null;
    revoked_at: string | null;
    notes: string | null;
    in_force: boolean;
}

interface DetailAction {
    id: string;
    action: string;
    detail: Record<string, unknown>;
    notes: string | null;
    created_at: string;
}

interface TeamDetail {
    success: boolean;
    error?: string;
    team: { id: string; name: string; team_number: string | null; created_at: string };
    members: DetailMember[];
    grants: DetailGrant[];
    actions: DetailAction[];
    seasons: { id: string; name: string; is_archived: boolean }[];
}

const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;

/**
 * Which teams the directory is showing (SEC-07).
 *
 * The console could find any team by name and could not answer the one question the operator
 * actually has to ask every week — "who is about to go read-only?". Under D3 that question
 * stops being weekly housekeeping and becomes the product's main loop: every new team gets
 * **30 days**, and the operator extending it to season length is the normal path, not an
 * exception. A directory that cannot sort by expiry makes the normal path a manual scan of
 * every row.
 */
type ExpiryFilter = 'all' | 'expiring' | 'lapsed';

const FILTER_LABEL: Record<ExpiryFilter, string> = {
    all: 'All teams',
    expiring: `Expiring in ${EXPIRY_WARNING_DAYS} days or fewer`,
    lapsed: 'Already read-only',
};

/**
 * Whole days from now until `iso`, rounded UP, or null for open-ended.
 *
 * Deliberately the same arithmetic as `deriveEntitlementState`, including the rounding
 * direction, and for the reason recorded there: `Math.floor` reports "0 days" for a licence
 * with eleven hours left. Sharing the arithmetic matters more than sharing the code here —
 * this reads a directory row (`valid_until` as a raw ISO string) rather than the store's
 * entitlement — but a comment is a weak guarantee, so `operator-console-expiry.test.ts`
 * asserts the two agree on the same instant.
 */
export function daysUntil(iso: string | null, now: number): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime() - now;
    if (Number.isNaN(ms)) return null;
    return Math.ceil(ms / 86_400_000);
}

/**
 * Sort and filter the directory by how soon each team needs the operator.
 *
 * ORDER: lapsed first, then soonest expiry, then open-ended, then name.
 *
 * "Sorted by `valid_until`" taken literally would put a team whose cover ended last week
 * LAST, because a lapsed team has no in-force grant and therefore a NULL `valid_until` — the
 * `?? 0` mistake from `docs/failure-modes.md` §4 in sorting form, where absence would be read
 * as a value. A list whose whole purpose is "who needs me" cannot bury the teams that already
 * do. Open-ended grants sort last for the mirror-image reason: they are the ones that never
 * need anybody.
 *
 * Pure, and takes `now` as an argument, so the boundary cases can be tested at a fixed
 * instant instead of "whenever the suite happens to run".
 */
export function orderDirectory<
    T extends { entitlement_status: string; valid_until: string | null; team_name: string },
>(rows: T[], filter: ExpiryFilter, now: number): T[] {
    const rank = (row: T) => {
        if (row.entitlement_status !== 'active') return 0;
        return row.valid_until ? 1 : 2;
    };

    return rows
        .filter((row) => {
            if (filter === 'all') return true;
            if (filter === 'lapsed') return row.entitlement_status !== 'active';
            const days = daysUntil(row.valid_until, now);
            return (
                row.entitlement_status === 'active' && days !== null && days <= EXPIRY_WARNING_DAYS
            );
        })
        .slice()
        .sort((a, b) => {
            const byRank = rank(a) - rank(b);
            if (byRank !== 0) return byRank;
            if (rank(a) === 1) {
                const diff =
                    new Date(a.valid_until as string).getTime() -
                    new Date(b.valid_until as string).getTime();
                if (diff !== 0) return diff;
            }
            // Ties broken by name so the list never reorders under the operator's click —
            // `docs/failure-modes.md` §13, which this project has shipped twice.
            return a.team_name.localeCompare(b.team_name);
        });
}

/**
 * The platform operator's console — finding a team, gifting, revoking, and rescuing.
 *
 * GATED TWICE, AND BOTH GATES ARE DELIBERATE. `is_platform_operator()` decides in the database:
 * every RPC below refuses a caller with no operator identity, and `platform_operators` ships
 * EMPTY with no API path that can write it, so there is no way to grant yourself the role from
 * a browser. What this component adds is only that a non-operator is not shown a page of
 * controls that would all fail. Hiding it is UX; the refusal is the database's.
 *
 * WHAT CHANGED, AND WHY THE OLD VERSION DID NOT WORK
 *
 * This used to list teams from `team_entitlement`, which is `security_invoker` — so it showed
 * the operator THEIR OWN teams and never the team that had just emailed for help. Both controls
 * then asked for a uuid typed by hand, including a `team_members.id` there was no way to
 * obtain. The console was correct and unusable.
 *
 * `operator_team_directory` replaces that list, and it is the only team list here now: one
 * concept, one implementation. Everything else on the page hangs off the SELECTED team, so no
 * uuid is ever typed — including the successor in the rescue panel, who is picked from the
 * roster the detail call already returned.
 */
export default function OperatorConsole() {
    const { isOffline } = useAuth();
    const [isOperator, setIsOperator] = useState<boolean | null>(null);

    const [search, setSearch] = useState('');
    const [rows, setRows] = useState<DirectoryRow[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('all');
    const [newTeams, setNewTeams] = useState<NewTeamRow[]>([]);
    /* Only teams still on the untouched automatic grant need the operator's eye. */
    const [onlyProbation, setOnlyProbation] = useState(true);
    const [extendingId, setExtendingId] = useState<string | null>(null);
    /*
     * Read ONCE per directory load, not per render. "Expiring in 30 days" recomputed on every
     * keystroke is a list that can reorder while it is being read, and a clock sampled at
     * render time is the mount-time-default defect of `docs/failure-modes.md` §10 wearing a
     * different hat. This is the browser's clock deliberately: the row it is compared against
     * came from the server, so the comparison is only as good as the device's time — which is
     * exactly why the DATABASE, not this list, decides whether a team may write.
     */
    const [directoryLoadedAt, setDirectoryLoadedAt] = useState(() => Date.now());

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<TeamDetail | null>(null);

    const [seats, setSeats] = useState('');
    const [months, setMonths] = useState('6');
    const [notes, setNotes] = useState('');

    const [transferMemberId, setTransferMemberId] = useState('');
    const [transferNotes, setTransferNotes] = useState('');

    const [revokeNotes, setRevokeNotes] = useState('');
    const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

    // SEC-11. `eraseTarget` holds the whole member rather than an id, so the confirmation can
    // name the person the operator is about to erase rather than a uuid they cannot check.
    const [eraseTarget, setEraseTarget] = useState<DetailMember | null>(null);
    const [eraseNotes, setEraseNotes] = useState('');
    const [deleteConfirmName, setDeleteConfirmName] = useState('');
    const [deleteNotes, setDeleteNotes] = useState('');

    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const checkOperator = useCallback(async () => {
        if (!supabaseSync || isOffline) {
            setIsOperator(false);
            return;
        }
        // The same function the RPCs gate on, so the UI and the database cannot disagree.
        const { data, error: rpcError } = await supabaseSync.rpc('is_platform_operator');
        setIsOperator(rpcError ? false : data === true);
    }, [isOffline]);

    const runSearch = useCallback(
        async (needle: string) => {
            if (!supabaseSync || isOffline) return;
            setIsSearching(true);
            try {
                const { data, error: rpcError } = await supabaseSync.rpc('operator_team_directory', {
                    p_search: needle.trim() || undefined,
                });
                if (rpcError) throw rpcError;
                setRows((data as DirectoryRow[]) ?? []);
                setDirectoryLoadedAt(Date.now());
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not load the team directory');
            } finally {
                setIsSearching(false);
            }
        },
        [isOffline],
    );

    const loadNewTeams = useCallback(async () => {
        if (!supabaseSync || isOffline) return;
        const { data, error: rpcError } = await supabaseSync.rpc('operator_new_teams', {
            p_limit: 100,
        });
        if (rpcError) {
            setError(rpcError.message);
            return;
        }
        setNewTeams((data as NewTeamRow[]) ?? []);
    }, [isOffline]);

    /**
     * One click: extend this team's probation to the end of the season.
     *
     * D3 makes this THE NORMAL PATH rather than an exception — "the operator console lists new
     * teams; one click extends to season length once the team number has been eyeballed" — so
     * it is a button on the row rather than a trip through the gift panel with a month count
     * typed by hand. Today that is SQL in `docs/v2-schema.md`.
     */
    const extendToSeason = useCallback(
        async (teamId: string) => {
            if (!supabaseSync) return;
            setExtendingId(teamId);
            setError(null);
            setSuccess(null);
            try {
                const { data, error: rpcError } = await supabaseSync.rpc(
                    'operator_extend_to_season',
                    { p_team_id: teamId },
                );
                if (rpcError) throw rpcError;
                const result = data as { success: boolean; error?: string; valid_until?: string };
                if (!result.success) {
                    setError(result.error ?? 'Could not extend that team');
                    return;
                }
                setSuccess(
                    `Extended to ${fmtDate(result.valid_until ?? null) ?? 'the end of the season'}. The probation row is kept, so the audit trail still shows one happened.`,
                );
                await loadNewTeams();
                await runSearch(search);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not extend that team');
            } finally {
                setExtendingId(null);
            }
        },
        [loadNewTeams, runSearch, search],
    );

    const loadDetail = useCallback(
        async (teamId: string) => {
            if (!supabaseSync || isOffline) return;
            const { data, error: rpcError } = await supabaseSync.rpc('operator_team_detail', {
                p_team_id: teamId,
            });
            if (rpcError) {
                setError(rpcError.message);
                return;
            }
            const result = data as unknown as TeamDetail;
            if (!result?.success) {
                setError(result?.error ?? 'Could not load that team');
                return;
            }
            setDetail(result);
        },
        [isOffline],
    );

    useEffect(() => {
        void checkOperator();
    }, [checkOperator]);

    useEffect(() => {
        if (isOperator) {
            void runSearch('');
            void loadNewTeams();
        }
    }, [isOperator, runSearch, loadNewTeams]);

    /** Re-read both the directory row and the detail, so a change shows in every place it appears. */
    const refresh = useCallback(async () => {
        await runSearch(search);
        if (selectedId) await loadDetail(selectedId);
    }, [runSearch, search, selectedId, loadDetail]);

    const select = async (teamId: string) => {
        setSelectedId(teamId);
        setDetail(null);
        setTransferMemberId('');
        setError(null);
        setSuccess(null);
        await loadDetail(teamId);
    };

    const grant = async () => {
        if (!supabaseSync || !selectedId) return;
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
                p_team_id: selectedId,
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
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not issue the grant');
        } finally {
            setIsBusy(false);
        }
    };

    const revoke = async (grantId: string | null, all: boolean) => {
        if (!supabaseSync || !selectedId) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('operator_revoke_license', {
                p_team_id: selectedId,
                p_grant_id: grantId ?? undefined,
                p_all: all,
                p_notes: revokeNotes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as { success: boolean; error?: string; revoked_count?: number };
            if (!result.success) {
                setError(result.error ?? 'Could not revoke');
                return;
            }
            setSuccess(
                `${result.revoked_count} grant${result.revoked_count === 1 ? '' : 's'} revoked. The team is read-only — nothing has been deleted.`,
            );
            setRevokeNotes('');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not revoke');
        } finally {
            setIsBusy(false);
        }
    };

    const transferAdmin = async () => {
        if (!supabaseSync || !selectedId) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('operator_transfer_team_admin', {
                p_team_id: selectedId,
                p_new_member_id: transferMemberId,
                p_notes: transferNotes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as { success: boolean; error?: string };
            if (!result.success) {
                setError(result.error ?? 'Could not reassign the admin role');
                return;
            }
            setSuccess('Admin role reassigned. The action is recorded in the operator audit log.');
            setTransferNotes('');
            setTransferMemberId('');
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not reassign the admin role');
        } finally {
            setIsBusy(false);
        }
    };

    /*
     * SEC-11 — erase a person.
     *
     * Deliberately NOT offered for a managed child: their `user_id` is their guardian's, so
     * "erase this child" would erase the parent and every other child they have. A guardian
     * removes one child from their own screen, which is the only place that can express it.
     */
    const eraseUser = async () => {
        const target = eraseTarget;
        if (!supabaseSync || !target?.user_id) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('operator_erase_user', {
                p_user_id: target.user_id,
                p_notes: eraseNotes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as unknown as {
                success: boolean;
                error?: string;
                memberships_removed?: number;
                children_removed?: number;
            };
            if (!result.success) {
                setError(result.error ?? 'Could not erase this person');
                return;
            }
            /*
             * Report what it DID, not that it worked. "Erased" alone leaves the operator to guess
             * whether a request that mentioned a child was fully honoured, and they are usually
             * answering an email that asked about exactly that.
             */
            const children = result.children_removed ?? 0;
            setSuccess(
                `Erased. ${result.memberships_removed ?? 0} membership` +
                    `${result.memberships_removed === 1 ? '' : 's'} removed` +
                    (children > 0 ? `, ${children} child profile${children === 1 ? '' : 's'} removed` : '') +
                    '. Their contributions stay with the team, and the action is in the audit log.',
            );
            setEraseNotes('');
            setEraseTarget(null);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not erase this person');
        } finally {
            setIsBusy(false);
        }
    };

    /*
     * SEC-11 — delete a team.
     *
     * The typed name goes to the SERVER, which compares it; the button below is only disabled as
     * a courtesy. A confirmation enforced solely in the browser is a confirmation that a stale
     * bundle or a direct call does not have — the same reason `operator_delete_team` refuses on
     * `name_mismatch` rather than trusting the caller.
     */
    const deleteTeam = async () => {
        if (!supabaseSync || !selectedId || !detail) return;
        setIsBusy(true);
        setError(null);
        setSuccess(null);
        try {
            const { data, error: rpcError } = await supabaseSync.rpc('operator_delete_team', {
                p_team_id: selectedId,
                p_confirm_name: deleteConfirmName,
                p_notes: deleteNotes.trim() || undefined,
            });
            if (rpcError) throw rpcError;

            const result = data as unknown as {
                success: boolean;
                error?: string;
                team_name?: string;
                members_removed?: number;
            };
            if (!result.success) {
                setError(result.error ?? 'Could not delete this team');
                return;
            }
            setSuccess(
                `${result.team_name} is gone, with ${result.members_removed ?? 0} membership` +
                    `${result.members_removed === 1 ? '' : 's'}. The people keep their accounts. ` +
                    'The deletion is recorded in the audit log, which outlives the team.',
            );
            setDeleteConfirmName('');
            setDeleteNotes('');
            // The selection now points at nothing: clear it before the directory reloads.
            setSelectedId(null);
            setDetail(null);
            await refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not delete this team');
        } finally {
            setIsBusy(false);
        }
    };

    const visibleRows = useMemo(
        () => orderDirectory(rows, expiryFilter, directoryLoadedAt),
        [rows, expiryFilter, directoryLoadedAt],
    );

    const visibleNewTeams = useMemo(
        () => (onlyProbation ? newTeams.filter((r) => r.is_probation) : newTeams),
        [newTeams, onlyProbation],
    );

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

    const inForce = detail?.grants.filter((g) => g.in_force) ?? [];
    /* A managed profile cannot hold the admin role, and neither can an unapproved member —
     * `operator_transfer_team_admin` refuses both. Filtering here puts that rule in front of
     * the operator instead of behind an error, which is the same fix Sprint 6 made when the
     * successor dropdown offered eleven under-18s. Age is NOT filterable: `team_members`
     * carries no age column, so the trigger remains the authority on that one. */
    const eligibleSuccessors =
        detail?.members.filter((m) => !m.is_managed && m.status === 'approved' && m.role !== 'admin') ?? [];

    return (
        <div className="space-y-4" data-testid="operator-console">
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

            {/* --------------------------------------------------------- new teams */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Sparkles} title="New teams" />
                <p className="mb-2 text-2xs text-slate-500 dark:text-slate-400">
                    Every team gets 30 days automatically (D3). Check the number against{' '}
                    <code className="font-mono">ftc-events.firstinspires.org/2026/team/&lt;number&gt;</code>{' '}
                    and extend it to the season — that is the normal path, not the exception.
                </p>

                <label className="mb-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={onlyProbation}
                        onChange={(e) => setOnlyProbation(e.target.checked)}
                        data-testid="operator-only-probation"
                        className="h-4 w-4 rounded border-slate-300 text-forge-600"
                    />
                    Only teams still on the automatic 30 days
                </label>

                {visibleNewTeams.length === 0 ? (
                    <EmptyState
                        title={
                            newTeams.length > 0
                                ? 'Every new team has been looked at.'
                                : 'No teams have registered yet.'
                        }
                        body={
                            newTeams.length > 0
                                ? `All ${newTeams.length} recent ${newTeams.length === 1 ? 'team is' : 'teams are'} past their probation. Untick the box above to see them anyway.`
                                : 'A team appears here the moment somebody registers one. Nothing to do until then.'
                        }
                    />
                ) : (
                    <ul className="space-y-2" data-testid="operator-new-teams">
                        {visibleNewTeams.map((row) => (
                            <li
                                key={row.team_id}
                                className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-700/50"
                            >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <span className="font-semibold text-slate-800 dark:text-white">
                                        {row.team_number
                                            ? `${row.program.toUpperCase()} ${row.team_number} `
                                            : ''}
                                        {row.team_name}
                                    </span>
                                    {/*
                                      * THE FIELD THAT CARRIES THE DECISION, so it gets the badge.
                                      * Number, name and age look identical on a fake team and a
                                      * real one; whether anybody has DONE anything does not.
                                      */}
                                    <span
                                        data-testid="new-team-used"
                                        className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${
                                            row.has_been_used
                                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                                : 'bg-slate-400/20 text-slate-600 dark:text-slate-300'
                                        }`}
                                    >
                                        {row.has_been_used ? 'In use' : 'Nobody has used it yet'}
                                    </span>
                                </div>
                                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                    {row.admin_email ? (
                                        <>
                                            {row.admin_name ?? 'Admin'} · {row.admin_email}
                                        </>
                                    ) : (
                                        <span className="font-semibold text-red-600 dark:text-red-400">
                                            No admin — this team is stranded
                                        </span>
                                    )}
                                </div>
                                <div className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                                    {/* Days, not a date: "registered 3 days ago" is the shape of
                                        the question, and a date makes the operator subtract. */}
                                    {row.age_days === 0
                                        ? 'Registered today'
                                        : `Registered ${row.age_days} day${row.age_days === 1 ? '' : 's'} ago`}
                                    {' · '}
                                    {row.members_total} member{row.members_total === 1 ? '' : 's'}
                                    {row.content_rows > 0 && ` · ${row.content_rows} things made`}
                                    {row.valid_until && ` · cover until ${fmtDate(row.valid_until)}`}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        busy={extendingId === row.team_id}
                                        disabled={isOffline || !row.is_probation}
                                        onClick={() => void extendToSeason(row.team_id)}
                                        data-testid="extend-to-season"
                                        title={
                                            row.is_probation
                                                ? 'Extend this team to the end of the season'
                                                : 'This team already has cover beyond its probation'
                                        }
                                    >
                                        <CalendarCheck size={14} />
                                        Extend to the season
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => void select(row.team_id)}
                                    >
                                        Open
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* ------------------------------------------------------------ directory */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                <SectionHeader icon={Search} title="Find a team" />
                <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void runSearch(search);
                    }}
                >
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Team name, number, or the admin's email"
                        className="field flex-1"
                        data-testid="operator-search"
                        aria-label="Search teams by name, number or admin email"
                    />
                    <Button type="submit" busy={isSearching} disabled={isOffline}>
                        Search
                    </Button>
                </form>

                {/*
                  * WHO IS ABOUT TO GO READ-ONLY — the question this console could not answer.
                  *
                  * A <select> and not a row of chips, because there are three states and the
                  * screen is already dense; and it is labelled rather than placeholder-only,
                  * because WALK-A-09 found unnamed selects on exactly this page.
                  */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label
                        htmlFor="operator-expiry-filter"
                        className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                        Licence
                    </label>
                    <select
                        id="operator-expiry-filter"
                        value={expiryFilter}
                        onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilter)}
                        className="field w-auto py-1 text-xs"
                        data-testid="operator-expiry-filter"
                    >
                        {(Object.keys(FILTER_LABEL) as ExpiryFilter[]).map((key) => (
                            <option key={key} value={key}>
                                {FILTER_LABEL[key]}
                            </option>
                        ))}
                    </select>
                    <span
                        className="text-2xs text-slate-500 dark:text-slate-400"
                        data-testid="operator-directory-count"
                    >
                        {/*
                          * Says what was hidden, not just what is shown. A filtered list that
                          * reports only its own length is how "we covered everything" gets
                          * believed about a subset.
                          */}
                        {visibleRows.length} of {rows.length} team
                        {rows.length === 1 ? '' : 's'}
                        {expiryFilter === 'all' ? '' : ' — soonest first'}
                    </span>
                </div>

                {visibleRows.length === 0 ? (
                    <div className="mt-3">
                        {/*
                          * THREE EMPTY STATES, NOT ONE. `docs/failure-modes.md` §4: "no teams
                          * exist", "your search matched nothing" and "nothing is expiring" are
                          * three different facts, and the third is GOOD NEWS. One shared
                          * "No teams matched" would have told an operator whose licences are
                          * all healthy that their search was broken.
                          */}
                        <EmptyState
                            title={
                                isSearching
                                    ? 'Searching…'
                                    : rows.length > 0
                                      ? expiryFilter === 'expiring'
                                          ? `Nothing expires in the next ${EXPIRY_WARNING_DAYS} days.`
                                          : 'No team is read-only.'
                                      : 'No teams matched.'
                            }
                            body={
                                rows.length > 0
                                    ? `All ${rows.length} team${rows.length === 1 ? '' : 's'} in this search are covered. Switch back to “${FILTER_LABEL.all}” to see them.`
                                    : "Search by team name, FTC number, or the primary admin's email address. An empty search lists every team."
                            }
                        />
                    </div>
                ) : (
                    <ul className="mt-3 space-y-2" data-testid="operator-directory">
                        {visibleRows.map((row) => (
                            <li key={row.team_id}>
                                <button
                                    type="button"
                                    onClick={() => void select(row.team_id)}
                                    aria-current={selectedId === row.team_id}
                                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                                        selectedId === row.team_id
                                            ? 'border-forge-500 bg-forge-500/10'
                                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-700/50'
                                    }`}
                                >
                                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                        <span className="font-semibold text-slate-800 dark:text-white">
                                            {row.team_number ? `#${row.team_number} ` : ''}
                                            {row.team_name}
                                        </span>
                                        <span
                                            className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${
                                                row.entitlement_status === 'active'
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                            }`}
                                        >
                                            {row.entitlement_status === 'active' ? 'Licensed' : 'Read-only'}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                                        {/* A team with no admin is the stranded case, and saying so here
                                            is the whole reason the directory left-joins the admin. */}
                                        {row.admin_email ? (
                                            <>
                                                {row.admin_name ?? 'Admin'} · {row.admin_email}
                                            </>
                                        ) : (
                                            <span className="font-semibold text-red-600 dark:text-red-400">
                                                No admin — this team is stranded
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">
                                        {row.members_approved} approved
                                        {row.members_pending > 0 && ` · ${row.members_pending} waiting`} ·{' '}
                                        {/*
                                          * NO DENOMINATOR WHEN THERE IS NO LICENCE, which is
                                          * `EntitlementPanel`'s rule and not a new one. A lapsed
                                          * team has no in-force grant, so `seats_total` is NULL,
                                          * and `?? 0` renders "4 of 0" -- broken arithmetic rather
                                          * than an ended licence. Sprint 6 found and fixed exactly
                                          * that on the admin panel; this row reintroduced it the
                                          * moment the same fact got a second renderer, and looking
                                          * at Lapsed Legends in the console is what caught it.
                                          * CLAUDE.md principle 9, in miniature, again.
                                          */}
                                        {row.seats_unlimited
                                            ? `${row.seats_used} of unlimited seats`
                                            : row.seats_total === null
                                              ? `${row.seats_used} seated, no licence`
                                              : `${row.seats_used} of ${row.seats_total} seats`}
                                        {row.entitlement_status === 'active' &&
                                            (row.valid_until
                                                ? ` · until ${fmtDate(row.valid_until)}`
                                                : ' · open-ended')}
                                    </div>
                                    {/*
                                      * THE COUNTDOWN, on the row, in words.
                                      *
                                      * "until Dec 5" is a date an operator has to subtract from
                                      * today in their head, once per row, and D3 makes that a
                                      * weekly job. The number is what the decision is made on,
                                      * so the number is what is rendered.
                                      */}
                                    {(() => {
                                        if (row.entitlement_status !== 'active') return null;
                                        const days = daysUntil(row.valid_until, directoryLoadedAt);
                                        if (days === null || days > EXPIRY_WARNING_DAYS) return null;
                                        return (
                                            <div
                                                data-testid="operator-expiry-flag"
                                                className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-2xs font-semibold text-amber-700 dark:text-amber-400"
                                            >
                                                <Clock size={11} />
                                                {days <= 0
                                                    ? 'Cover ends today'
                                                    : `${days} day${days === 1 ? '' : 's'} left`}
                                            </div>
                                        );
                                    })()}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* ------------------------------------------------------------ one team */}
            {selectedId && detail && (
                <>
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                        <SectionHeader icon={Users} title={`${detail.team.name} — roster`} />
                        <p className="mb-2 text-2xs text-slate-500 dark:text-slate-400">
                            Team id <code className="font-mono">{detail.team.id}</code> · created{' '}
                            {fmtDate(detail.team.created_at)} ·{' '}
                            {detail.seasons.length} season{detail.seasons.length === 1 ? '' : 's'}
                        </p>
                        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                            {detail.members.map((m) => (
                                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                                    <span className="text-sm text-slate-800 dark:text-slate-200">
                                        {m.full_name ?? 'Unnamed'}
                                        {m.is_managed && (
                                            <span className="ml-1 text-2xs text-slate-500">(child profile)</span>
                                        )}
                                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                                            {m.email}
                                        </span>
                                    </span>
                                    <span className="flex items-center gap-2 text-2xs text-slate-500 dark:text-slate-400">
                                        <span>
                                            {m.role} · {m.status}
                                            {m.seat_assigned ? ' · seated' : ''}
                                        </span>
                                        {/*
                                          * NOT offered for a child profile, and not merely
                                          * disabled: their `user_id` is the guardian's, so this
                                          * button would erase the parent. The guardian's own
                                          * screen is where one child is removed.
                                          */}
                                        {!m.is_managed && m.user_id && (
                                            <Button
                                                size="sm"
                                                variant="danger"
                                                disabled={isBusy}
                                                data-testid={`erase-user-${m.id}`}
                                                onClick={() => {
                                                    setEraseTarget(m);
                                                    setEraseNotes('');
                                                }}
                                            >
                                                Erase
                                            </Button>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                        <SectionHeader icon={Gift} title="Licences" />
                        <ul className="mb-3 divide-y divide-slate-200 dark:divide-slate-700">
                            {detail.grants.map((g) => (
                                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                                    <span className="text-sm text-slate-700 dark:text-slate-300">
                                        {g.source} · {g.seats === null ? 'unlimited' : `${g.seats} seats`} ·{' '}
                                        {g.valid_until ? `until ${fmtDate(g.valid_until)}` : 'open-ended'}
                                        {g.notes && (
                                            <span className="block text-2xs text-slate-500">{g.notes}</span>
                                        )}
                                    </span>
                                    {g.revoked_at ? (
                                        <span className="text-2xs text-slate-500">
                                            revoked {fmtDate(g.revoked_at)}
                                        </span>
                                    ) : g.in_force ? (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => void revoke(g.id, false)}
                                            busy={isBusy}
                                            disabled={isOffline}
                                        >
                                            Revoke
                                        </Button>
                                    ) : (
                                        <span className="text-2xs text-slate-500">expired</span>
                                    )}
                                </li>
                            ))}
                        </ul>

                        <div className="grid gap-3 sm:grid-cols-2">
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
                        <label className="mt-3 block">
                            <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                                Reason for revoking (recorded in the audit log)
                            </span>
                            {/*
                              * Its own field rather than sharing the grant's notes: a grant's note
                              * describes why access was GIVEN and lives on the grant for ever, while
                              * this describes why it was taken away and belongs on the operator
                              * action. Sharing one input would file each reason under the other.
                              *
                              * It was very nearly not here at all -- `revokeNotes` was read by the
                              * revoke call and written by nothing, so every revocation would have
                              * recorded a blank reason. That is failure-modes section 7 (a value
                              * with readers and no writer) and it is how `coppa_responsibility` sat
                              * unwritten for four sprints.
                              */}
                            <input
                                type="text"
                                value={revokeNotes}
                                onChange={(e) => setRevokeNotes(e.target.value)}
                                placeholder="e.g. gifted to the wrong team"
                                className="field"
                                data-testid="revoke-notes"
                            />
                        </label>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button onClick={grant} busy={isBusy} disabled={isOffline}>
                                <Gift size={16} />
                                Issue grant
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => setConfirmRevokeAll(true)}
                                busy={isBusy}
                                disabled={isOffline || inForce.length === 0}
                                title={
                                    inForce.length === 0
                                        ? 'This team has no licence in force'
                                        : 'Revoke every licence in force'
                                }
                                data-testid="revoke-all"
                            >
                                <Ban size={16} />
                                Revoke all access
                            </Button>
                        </div>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Grants accumulate — issuing one never revokes another, so a team on a trial
                            keeps it. That is also why &ldquo;Revoke all&rdquo; exists: revoking a single
                            grant can leave another in force and the team still writing.{' '}
                            <strong>Revoking never deletes anything</strong> — the team becomes read-only
                            and keeps every row.
                        </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                        <SectionHeader icon={Crown} title="Reassign a stranded team's admin" />
                        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                            For a team whose admin has left without handing over. Every other route to the
                            admin role needs the outgoing admin to act, so without this the team keeps all
                            its data and nobody can manage it. The successor still has to be 18+ and to
                            have accepted the admin terms — this chooses who, it does not waive what the
                            role requires.
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label>
                                <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                                    New admin
                                </span>
                                <select
                                    value={transferMemberId}
                                    onChange={(e) => setTransferMemberId(e.target.value)}
                                    className="field"
                                    data-testid="successor-select"
                                >
                                    <option value="">Choose a member…</option>
                                    {eligibleSuccessors.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.full_name ?? m.email} ({m.role})
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
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
                                disabled={!transferMemberId || isOffline}
                            >
                                Reassign admin role
                            </Button>
                        </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card dark:border-slate-700 dark:bg-slate-800 md:p-4">
                        <SectionHeader icon={ScrollText} title="What the platform has done to this team" />
                        {detail.actions.length === 0 ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                Nothing. No operator has acted on this team.
                            </p>
                        ) : (
                            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                                {detail.actions.map((a) => (
                                    <li key={a.id} className="py-2 text-sm">
                                        <span className="font-medium text-slate-800 dark:text-slate-200">
                                            {a.action.replace(/_/g, ' ')}
                                        </span>{' '}
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                            {fmtDate(a.created_at)}
                                        </span>
                                        {a.notes && (
                                            <span className="block text-xs text-slate-600 dark:text-slate-400">
                                                {a.notes}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            )}

            {detail && (
                <div className="rounded-xl border border-red-200 bg-white p-3 shadow-card dark:border-red-900/50 dark:bg-slate-800 md:p-4">
                    <SectionHeader icon={Trash2} title="Delete this team" />
                    <p className="mb-2 text-xs text-slate-600 dark:text-slate-300">
                        Everything the team has — roster, seasons, tasks, meetings, attendance,
                        scouting, plans — goes with it, and there is no undo short of a restore
                        from a nightly backup. The people keep their accounts; erasing a person is
                        the button on their roster row.
                    </p>
                    <label
                        htmlFor="delete-team-confirm"
                        className="mb-1 block text-2xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                    >
                        Type <span className="font-mono normal-case">{detail.team.name}</span> to confirm
                    </label>
                    <input
                        id="delete-team-confirm"
                        data-testid="delete-team-confirm"
                        className="field mb-2"
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        placeholder={detail.team.name}
                        autoComplete="off"
                    />
                    <input
                        data-testid="delete-team-notes"
                        className="field mb-2"
                        value={deleteNotes}
                        onChange={(e) => setDeleteNotes(e.target.value)}
                        placeholder="Why (optional, kept in the audit log)"
                        maxLength={TITLE_MAX_LENGTH}
                    />
                    <Button
                        variant="danger"
                        data-testid="delete-team"
                        busy={isBusy}
                        /*
                         * Disabled until the name matches, but the SERVER is what enforces it.
                         * This is a courtesy that stops a mis-click, not the control.
                         */
                        disabled={isBusy || deleteConfirmName.trim() !== detail.team.name}
                        onClick={() => void deleteTeam()}
                    >
                        Delete {detail.team.name}
                    </Button>
                </div>
            )}

            {eraseTarget && (
                <ConfirmDialog
                    title={`Erase ${eraseTarget.full_name ?? 'this person'}?`}
                    message={
                        `Their name, email address and every membership they hold will be removed, ` +
                        `across every team — not just this one. Anything they contributed stays with ` +
                        `the team it belongs to, with their name taken off it. Their sign-in stops ` +
                        `working. This cannot be undone.`
                    }
                    confirmLabel="Erase this person"
                    confirmTestId="confirm-erase-user"
                    onConfirm={() => void eraseUser()}
                    onCancel={() => {
                        setEraseTarget(null);
                        setEraseNotes('');
                    }}
                />
            )}

            {confirmRevokeAll && detail && (
                <ConfirmDialog
                    title={`Revoke every licence for ${detail.team.name}?`}
                    message={`${inForce.length} grant${inForce.length === 1 ? '' : 's'} in force will be withdrawn. The team becomes read-only immediately — everything they have ever written stays exactly where it is, and you can issue a new grant at any time.`}
                    confirmLabel="Revoke all access"
                    confirmTestId="confirm-revoke-all"
                    onConfirm={() => {
                        setConfirmRevokeAll(false);
                        void revoke(null, true);
                    }}
                    onCancel={() => setConfirmRevokeAll(false)}
                />
            )}
        </div>
    );
}
