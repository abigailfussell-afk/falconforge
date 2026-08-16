import { BadgeCheck, ShieldAlert, Users, Infinity as InfinityIcon, HelpCircle } from 'lucide-react';
import SectionHeader from '../ui/SectionHeader';
import { useEntitlement } from '../../lib/entitlement';

/**
 * "12 of 15 seats, gifted until 2027-02-15" — the sprint brief's sentence, rendered.
 *
 * Reads `team_entitlement` through the store. That view is the server's own answer to "is this
 * team active and how many seats has it", so this panel never computes licensing from anything
 * else; `pullEntitlement` has filled the store since Sprint 3 and `SeasonManager` was the only
 * thing reading it.
 *
 * THE FOUR STATES ARE ALL DISTINCT AND ALL RENDERED, because collapsing any two of them
 * produces a number that lies:
 *
 *   unknown    — never read on this device. Shows "—", not "0 of 0". A device that could not
 *                ask must not be told it has no seats.
 *   unlimited  — a NULL seat count. Shows the infinity mark, not a large integer.
 *   counted    — "12 of 15", with what is left.
 *   over       — more approved members than seats, which is a legitimate state: a customer may
 *                always reduce their bill, and nobody is removed for it.
 */
export default function EntitlementPanel() {
    const {
        isKnown,
        isReadOnly,
        seatsUsed,
        seatsTotal,
        seatsUnlimited,
        seatsRemaining,
        isAtCapacity,
        isOverCapacity,
        validUntil,
        lapsedAt,
        isExpiringSoon,
        daysUntilExpiry,
        entitlement,
    } = useEntitlement();

    const status = !isKnown
        ? { label: 'Not yet known', tone: 'slate' as const, Icon: HelpCircle }
        : isReadOnly
            ? { label: 'Read only', tone: 'red' as const, Icon: ShieldAlert }
            : { label: 'Active', tone: 'green' as const, Icon: BadgeCheck };

    const toneClasses = {
        slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
        red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
        green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    }[status.tone];

    return (
        <div data-testid="entitlement-panel">
            <SectionHeader
                icon={Users}
                title="Licence & seats"
                action={
                    <span
                        data-testid="entitlement-status"
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses}`}
                    >
                        <status.Icon size={13} aria-hidden="true" />
                        {status.label}
                    </span>
                }
            />

            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <dt className="text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Seats in use
                    </dt>
                    <dd
                        data-testid="seats-in-use"
                        className="mt-1 flex items-baseline gap-1 text-lg font-bold text-slate-800 dark:text-white"
                    >
                        {!isKnown ? (
                            '—'
                        ) : seatsUnlimited ? (
                            <>
                                {seatsUsed}
                                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                    {' '}
                                    of
                                </span>
                                <InfinityIcon size={18} aria-label="unlimited" className="text-slate-500" />
                            </>
                        ) : seatsTotal === null ? (
                            /*
                             * NO DENOMINATOR WHEN THERE IS NO LICENCE.
                             *
                             * A lapsed team has no in-force grant, so `seats_total` is NULL — and
                             * the first version rendered `?? 0`, producing "4 of 0". That reads
                             * like broken arithmetic rather than like a licence that has ended,
                             * and it was the one thing on the page a worried coach would fixate
                             * on. Found by looking at a team whose grant expired yesterday.
                             */
                            <>
                                {seatsUsed}
                                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                    {' '}
                                    {seatsUsed === 1 ? 'member' : 'members'}
                                </span>
                            </>
                        ) : (
                            <>
                                {seatsUsed}
                                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                    {' '}
                                    of {seatsTotal}
                                </span>
                            </>
                        )}
                    </dd>
                </div>

                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50">
                    <dt className="text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Available
                    </dt>
                    <dd
                        data-testid="seats-available"
                        className="mt-1 text-lg font-bold text-slate-800 dark:text-white"
                    >
                        {!isKnown
                            ? '—'
                            : seatsUnlimited
                                ? 'Unlimited'
                                // "0" is arithmetically right for a lapsed team and tells them
                                // nothing. There is no licence to have seats under.
                                : seatsTotal === null
                                    ? 'No licence'
                                    : seatsRemaining}
                    </dd>
                </div>

                <div className="col-span-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-700/50 sm:col-span-1">
                    <dt className="text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {isReadOnly ? 'Cover ended' : 'Cover until'}
                    </dt>
                    <dd
                        data-testid="cover-until"
                        className="mt-1 text-sm font-semibold text-slate-800 dark:text-white"
                    >
                        {!isKnown
                            ? '—'
                            : isReadOnly
                                ? lapsedAt?.toLocaleDateString() ?? 'Never licensed'
                                : validUntil
                                    ? validUntil.toLocaleDateString()
                                    : 'Open-ended'}
                    </dd>
                    {entitlement && entitlement.seatsUnlimited && !isReadOnly && (
                        <p className="mt-1 text-2xs text-slate-500 dark:text-slate-400">
                            Gifted licence
                        </p>
                    )}
                </div>
            </dl>

            {/*
              * OVER CAPACITY IS EXPLAINED, NOT ALARMED ABOUT.
              *
              * Reachable by reducing a grant below the current headcount, which is deliberately
              * allowed: refusing a billing decision in order to protect a roster decision is
              * hostile, and a customer must always be able to lower their bill. Nobody is
              * removed. The team just cannot approve anyone new until it is back under, so the
              * message names the number rather than implying something has broken.
              */}
            {isOverCapacity && (
                <p
                    data-testid="over-capacity-notice"
                    className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
                >
                    This team has <strong>{seatsUsed - (seatsTotal ?? 0)} more approved members than
                    seats</strong>. Everyone keeps their access — but no new member can be approved
                    until the team is back within {seatsTotal ?? 0} seats, either by removing
                    members or by adding seats.
                </p>
            )}

            {isAtCapacity && !isOverCapacity && !isReadOnly && (
                <p
                    data-testid="at-capacity-notice"
                    className="mt-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
                >
                    Every seat is in use. Requests to join can still be received, but approving one
                    needs a seat — remove a member or add seats first.
                </p>
            )}

            {isExpiringSoon && daysUntilExpiry !== null && !isReadOnly && (
                <p
                    data-testid="expiring-notice"
                    className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200"
                >
                    Cover ends in {daysUntilExpiry} {daysUntilExpiry === 1 ? 'day' : 'days'}. After
                    that the team becomes read-only — everything stays readable and nothing is
                    deleted.
                </p>
            )}

            {!isKnown && (
                <p
                    data-testid="entitlement-unknown-notice"
                    className="mt-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-700/50 dark:text-slate-300"
                >
                    This device has not been able to read the team&apos;s licence yet. Nothing is
                    blocked — the numbers appear once you are back online.
                </p>
            )}
        </div>
    );
}
