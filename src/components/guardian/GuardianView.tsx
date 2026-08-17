import { useState, useMemo } from 'react';
import { Baby, Plus, ShieldCheck, CalendarDays, KeyRound, Copy, X, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useAppStore } from '../../lib/store';
import { supabaseSync } from '../../lib/supabase';
import { fetchGuardianData } from '../../lib/server-pull';
import { attendanceStateMeta } from '../../lib/meetings';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import AddChildDialog from './AddChildDialog';
import type { ManagedProfile, TeamMember } from '../../types';

/**
 * What a guardian sees: their children, the consents they gave, and what is coming up.
 *
 * NO ACT-AS MODE. Plan section 3 is explicit — "a guardian sees their children ... and never
 * renders the team as the child. Switching INTO the child would let a guardian account act as
 * a team member, which is a far larger surface to get right in RLS and the shape that quietly
 * becomes 'a guardian could do X as their child'." So there is nothing on this screen that
 * enters the team. It reads three tables the database lets a guardian read (`teams`,
 * `meetings`, `meeting_attendance`, narrowly) and nothing else — no roster, no invite codes,
 * no tasks. The boundary is `is_team_guardian` in
 * `20260822000200_guardian_access.sql`, asserted in `guardian-access.rls.db.test.ts`.
 *
 * The screen is deliberately readable by a parent rather than by a coach: no jargon, no
 * abbreviations, and every state says what to do next.
 */
export default function GuardianView() {
    const { user } = useAuth();
    const managedProfiles = useAppStore((s) => s.managedProfiles);
    const guardianConsents = useAppStore((s) => s.guardianConsents);
    const teamMembers = useAppStore((s) => s.teamMembers);
    const teams = useAppStore((s) => s.teams);
    const meetings = useAppStore((s) => s.meetings);
    const attendance = useAppStore((s) => s.meetingAttendance);

    const [isAdding, setIsAdding] = useState(false);

    /** The roster rows this guardian holds — one per child per team. */
    const childMemberships = useMemo(
        () => teamMembers.filter((m) => m.userId === user?.id && !!m.managedProfileId),
        [teamMembers, user?.id],
    );

    /*
     * A STABLE ORDER, because the store does not have one.
     *
     * `pullFromServer` issues `.select('*')` with no `ORDER BY`, so Postgres returns the rows
     * in whatever order it likes — and it does not keep to one. Observed in the browser:
     * issuing a promotion code re-runs the pull, and the two children swapped places on screen
     * underneath the click. `docs/failure-modes.md` §13 names this exactly ("no implicit
     * ordering, ever"), and B12 was the same accident deciding which checklist was active.
     *
     * Sorted here rather than in the pull because the ordering that matters is this screen's,
     * not the wire's: oldest first, so a new child is added at the bottom and nobody's list
     * rearranges itself when they add one. `createdAt` is server-assigned and may be absent on
     * a child added offline and not yet pushed, which sorts last — where it was just typed.
     */
    const orderedChildren = useMemo(
        () =>
            [...managedProfiles].sort(
                (a, b) =>
                    (a.createdAt ?? Number.MAX_SAFE_INTEGER) -
                        (b.createdAt ?? Number.MAX_SAFE_INTEGER) ||
                    a.fullName.localeCompare(b.fullName),
            ),
        [managedProfiles],
    );

    if (managedProfiles.length === 0) {
        return (
            <div className="space-y-4">
                <Header onAdd={() => setIsAdding(true)} />
                <div className="card">
                    {/*
                     * The zero case is the FIRST case every guardian meets, not an edge case
                     * (`docs/failure-modes.md` §4 — two missing empty states, both hitting a
                     * brand-new team on day one). It carries the action that fills it.
                     */}
                    <EmptyState
                        icon={Baby}
                        title="No children added yet"
                        body="Add your child here, then join their team with the code their coach gave you. They will not need a login of their own."
                        action={<Button onClick={() => setIsAdding(true)}>Add a child</Button>}
                    />
                </div>
                {isAdding && <AddChildDialog onClose={() => setIsAdding(false)} />}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <Header onAdd={() => setIsAdding(true)} />

            <ul className="space-y-4" data-testid="guardian-children">
                {orderedChildren.map((profile) => (
                    <ChildCard
                        key={profile.id}
                        profile={profile}
                        memberships={childMemberships.filter((m) => m.managedProfileId === profile.id)}
                        consents={guardianConsents.filter((c) => c.managedProfileId === profile.id)}
                        teams={teams}
                        meetings={meetings}
                        attendance={attendance}
                        guardianUserId={user?.id ?? ''}
                    />
                ))}
            </ul>

            {isAdding && <AddChildDialog onClose={() => setIsAdding(false)} />}
        </div>
    );
}

function Header({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div>
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    My children
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    You sign in; they take part.
                </p>
            </div>
            <Button onClick={onAdd} data-testid="add-child">
                <Plus size={16} aria-hidden /> Add a child
            </Button>
        </div>
    );
}

function ChildCard({
    profile,
    memberships,
    consents,
    teams,
    meetings,
    attendance,
    guardianUserId,
}: {
    profile: ManagedProfile;
    memberships: TeamMember[];
    consents: { id: string; consentType: string; version: string; consentedAt?: number }[];
    teams: { id: string; name: string }[];
    meetings: { id: string; title: string; startsAt: number; teamId?: string }[];
    attendance: { id: string; meetingId: string; teamMemberId: string; status: string }[];
    guardianUserId: string;
}) {
    const memberIds = new Set(memberships.map((m) => m.id));
    const teamNames = memberships
        .map((m) => teams.find((t) => t.id === m.teamId)?.name)
        .filter(Boolean) as string[];

    const now = Date.now();
    const upcoming = meetings
        .filter((m) => m.startsAt >= now)
        .sort((a, b) => a.startsAt - b.startsAt)
        .slice(0, 3);

    const theirAttendance = attendance.filter((a) => memberIds.has(a.teamMemberId));
    const present = theirAttendance.filter((a) => a.status === 'present').length;

    const pending = memberships.filter((m) => m.status === 'pending');

    return (
        <li className="card space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        {profile.fullName}
                    </h2>
                    {teamNames.length > 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {teamNames.join(', ')}
                        </p>
                    ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Not on a team yet — join with the code their coach gave you.
                        </p>
                    )}
                    {profile.notes && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                            {profile.notes}
                        </p>
                    )}
                </div>
            </div>

            {pending.length > 0 && (
                /*
                 * "Waiting for approval" is a real state and it says whose move it is. Sprint 6
                 * shipped a refusal that reached the one person who could not act on it
                 * (failure-modes §8); the fix is to name who can.
                 */
                <p className="text-sm rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 px-3 py-2">
                    Waiting for the team admin to approve {profile.fullName}. Nothing for you to
                    do — they will appear on the roster once it is done.
                </p>
            )}

            <section>
                <SectionLabel icon={ShieldCheck}>Consent you gave</SectionLabel>
                {consents.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        No consent on record. A child cannot join a team without it.
                    </p>
                ) : (
                    <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-0.5">
                        {consents.map((c) => (
                            <li key={c.id} className="flex justify-between gap-3">
                                <span>{consentLabel(c.consentType)}</span>
                                <span className="text-slate-400 tabular-nums">
                                    v{c.version}
                                    {c.consentedAt
                                        ? ` · ${new Date(c.consentedAt).toLocaleDateString()}`
                                        : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {memberships.length > 0 && (
                <section>
                    <SectionLabel icon={CalendarDays}>Coming up</SectionLabel>
                    {upcoming.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            Nothing scheduled yet.
                        </p>
                    ) : (
                        <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-0.5">
                            {upcoming.map((m) => (
                                <li key={m.id} className="flex justify-between gap-3">
                                    <span className="truncate">{m.title}</span>
                                    <span className="text-slate-400 whitespace-nowrap">
                                        {new Date(m.startsAt).toLocaleDateString(undefined, {
                                            weekday: 'short',
                                            day: 'numeric',
                                            month: 'short',
                                        })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {theirAttendance.length > 0 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                            Attended {present} of {theirAttendance.length} recorded so far.
                            {theirAttendance.length > 0 && (
                                <span className="text-slate-400">
                                    {' '}
                                    Most recent:{' '}
                                    {attendanceStateMeta(
                                        theirAttendance[theirAttendance.length - 1].status as never,
                                    )?.label ?? '—'}
                                    .
                                </span>
                            )}
                        </p>
                    )}
                </section>
            )}

            <PromotionSection profile={profile} guardianUserId={guardianUserId} />
        </li>
    );
}

/**
 * "Give this child their own login."
 *
 * Guardian-initiated, at any time, and never automatic — section 3. It graduates IN PLACE: the
 * `team_members` row keeps its id, so attendance and task history survive and there is no
 * re-approval and no seat churn. That is done by `claim_managed_profile`, server-side; this is
 * only the half that offers the code.
 *
 * A CODE RATHER THAN AN EMAIL ADDRESS. Asking the guardian for the child's email and looking it
 * up would be fewer steps, and it would make the RPC an account-enumeration oracle — ask about
 * any address and the error tells you whether that person has an account. It would also have
 * the guardian asserting the child's identity rather than the child. So the child signs up in
 * their own name, accepts the documents themselves, and redeems this.
 */
function PromotionSection({
    profile,
    guardianUserId,
}: {
    profile: ManagedProfile;
    guardianUserId: string;
}) {
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const call = async (fn: 'offer' | 'withdraw') => {
        if (!supabaseSync) return;
        setIsBusy(true);
        setError(null);

        const rpc =
            fn === 'offer'
                ? 'offer_managed_profile_promotion'
                : 'withdraw_managed_profile_promotion';

        const { data, error: rpcError } = await supabaseSync.rpc(rpc, {
            p_managed_profile_id: profile.id,
        });

        setIsBusy(false);

        // Every failure path says something. A control that silently does nothing is
        // indistinguishable from a broken app (failure-modes §8).
        if (rpcError) {
            setError(rpcError.message);
            return;
        }
        const result = data as { success?: boolean; error?: string } | null;
        if (!result?.success) {
            setError(result?.error ?? 'That did not work. Try again in a moment.');
            return;
        }

        // Re-read rather than trusting the RPC's echo: the code lives on the profile row and
        // the store is the thing the rest of this screen renders from.
        await fetchGuardianData(guardianUserId).catch(console.error);
    };

    return (
        <section className="border-t border-slate-100 dark:border-slate-700 pt-3">
            <SectionLabel icon={KeyRound}>Their own login</SectionLabel>

            {profile.promotionCode ? (
                <div className="space-y-2">
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Give {profile.fullName} this code. They sign up with their own email,
                        then enter it. They keep their place on the team and everything recorded
                        so far.
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                        <code
                            className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 font-mono text-base tracking-code text-slate-900 dark:text-slate-100"
                            data-testid="promotion-code"
                        >
                            {profile.promotionCode}
                        </code>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                navigator.clipboard
                                    ?.writeText(profile.promotionCode)
                                    .then(() => setCopied(true))
                                    .catch(() => setError('Could not copy — write it down instead.'));
                            }}
                        >
                            <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            busy={isBusy}
                            onClick={() => call('withdraw')}
                        >
                            <X size={14} aria-hidden /> Cancel this code
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        When {profile.fullName} is old enough to have their own account, you can
                        hand over. Nothing is lost: they keep their place on the team and their
                        whole attendance history.
                    </p>
                    <Button
                        variant="secondary"
                        size="sm"
                        busy={isBusy}
                        onClick={() => call('offer')}
                        data-testid="offer-promotion"
                    >
                        {isBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
                        Give them their own login
                    </Button>
                </div>
            )}

            {error && (
                <p role="alert" className="text-sm text-rose-600 dark:text-rose-400 mt-2">
                    {error}
                </p>
            )}
        </section>
    );
}

function SectionLabel({
    icon: Icon,
    children,
}: {
    icon: typeof ShieldCheck;
    children: React.ReactNode;
}) {
    return (
        <h3 className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
            <Icon size={12} aria-hidden />
            {children}
        </h3>
    );
}

/** Plain English for a parent, rather than the column value. */
function consentLabel(type: string): string {
    switch (type) {
        case 'coppa_data_collection':
            return 'Holding my child’s information';
        case 'terms':
            return 'Terms';
        case 'privacy':
            return 'Privacy Policy';
        case 'community_guidelines':
            return 'Community Guidelines';
        default:
            return type;
    }
}
