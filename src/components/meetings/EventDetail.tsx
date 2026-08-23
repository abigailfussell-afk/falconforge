import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Printer } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { supabaseSync } from '../../lib/supabase';
import { useAppShell } from '../AppShell';
import {
    METHOD_LABELS,
    attendanceStateMeta,
    checkinState,
    checkinWindow,
    eventTypeMeta,
    formatCode,
    tracksAttendance,
} from '../../lib/meetings';
import { useMeeting, useRoster } from './useSchedule';
import { formatClock, formatFullDate, formatTimeRange } from './format';
import QrCode, { checkinUrl } from './QrCode';
import { AttendanceBar } from './EventManager';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';

/**
 * The event, live (1c) — what a coach has open on a laptop while the meeting is running.
 *
 * THE FEED TICKS BECAUSE REALTIME MAKES IT TICK. `meeting_attendance` is in the entity
 * registry, so it is in the realtime subscription, so a student's scan on their phone appears
 * in this list without anybody refreshing anything. That is the whole reason the migration
 * gave the table REPLICA IDENTITY FULL rather than leaving it out of the subscription.
 *
 * "Close check-in" is an RPC rather than a local edit, for the same reason the check-in itself
 * is: `now()` has to be the server's. A tablet with a wrong clock closing the window in the
 * future would leave the code live after the coach believed they had shut it.
 */
export default function EventDetail() {
    const { meetingId } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const { status, meeting } = useMeeting(meetingId);
    const { canManageMeetings } = useAppShell();
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const { rows, tally } = useRoster(meetingId);

    // A minute is the right resolution for a window that is measured in minutes, and it keeps
    // "check-in open" from lying for up to an hour after it closes.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);

    const [closing, setClosing] = useState(false);
    const [closeError, setCloseError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    if (status === 'loading') return <LoadingEvent />;

    if (!meeting) {
        return (
            <EmptyState
                title="That event is not on this device"
                body="It may have been deleted, or it may belong to a team or season you are not looking at."
                action={
                    <Button variant="secondary" onClick={() => navigate('/app/meetings')}>
                        Back to meetings
                    </Button>
                }
            />
        );
    }

    const type = eventTypeMeta(meeting.eventType);
    const tracked = tracksAttendance(meeting);
    const state = checkinState(meeting, now);
    const { closesAt } = checkinWindow(meeting);

    // Newest first: the coach cares about who just walked in.
    const feed = rows
        .filter((row) => row.record)
        .sort((a, b) => (b.record!.attestedAt ?? 0) - (a.record!.attestedAt ?? 0));

    async function closeCheckin() {
        if (!supabaseSync || !currentTeamId || !meeting) return;
        setClosing(true);
        setCloseError(null);
        try {
            const { data, error } = await supabaseSync.rpc('close_meeting_checkin', {
                p_team_id: currentTeamId,
                p_meeting_id: meeting.id,
            });
            const result = data as unknown as { success: boolean; error?: string } | null;
            if (error || !result?.success) {
                setCloseError(error?.message ?? result?.error ?? 'Could not close check-in.');
                return;
            }
            // Reflect it locally rather than waiting for the next pull, so the button and the
            // badge agree with each other immediately.
            useAppStore.setState((s) => ({
                meetings: s.meetings.map((m) =>
                    m.id === meeting.id ? { ...m, checkinClosesAt: Date.now() } : m,
                ),
            }));
        } catch (err) {
            // The one action on this screen that genuinely needs the network. Say so.
            setCloseError(
                err instanceof Error && !navigator.onLine
                    ? 'You are offline. Check-in closes on its own at the end of the event.'
                    : 'Could not close check-in.',
            );
        } finally {
            setClosing(false);
        }
    }

    return (
        <div data-testid="event-detail" className="space-y-4">
            <Link
                to="/app/meetings"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-forge-600 dark:hover:text-forge-400"
            >
                <ArrowLeft size={14} />
                Meetings &amp; Events
            </Link>

            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/*
                          * `break-words` (WALK-A-11). A 165-character title with no spaces in it
                          * ran off the right edge of this header and was simply gone — the
                          * `min-w-0` on the wrapper lets the flex item shrink, but nothing told
                          * the TEXT it was allowed to break mid-word, so it overflowed instead.
                          * The cap on the input stops new ones; this renders the ones already
                          * stored, which is the half a length limit cannot do retroactively.
                          *
                          * `min-w-0` IS HALF THE FIX and `break-words` alone did nothing — the
                          * probe measured the h1 at 1331px inside a 375px viewport with the class
                          * already applied. A flex item defaults to `min-width: auto`, meaning
                          * "never shrink below your content", so the box simply grew to fit the
                          * unbroken word and `overflow-wrap` was never consulted: it breaks text
                          * that has run out of room, and this text never did. Both the h1 and the
                          * flex row above it need it.
                          */}
                        <h1 className="min-w-0 break-words text-2xl font-bold text-slate-800 dark:text-white">
                            {meeting.title}
                        </h1>
                        <span className={`rounded border px-1.5 py-0.5 text-2xs font-bold ${type.chip}`}>
                            {type.tag}
                        </span>
                        {tracked && <CheckinBadge state={state} />}
                    </div>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {[
                            formatFullDate(meeting.startsAt),
                            formatTimeRange(meeting.startsAt, meeting.endsAt),
                            meeting.location,
                            meeting.seriesId ? 'Repeating series' : null,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                    {meeting.description && (
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {meeting.description}
                        </p>
                    )}
                </div>

                {canManageMeetings && tracked && (
                    <div className="flex flex-wrap items-center gap-2">
                        <Link
                            to={`/app/meetings/${meeting.id}/roster`}
                            className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            Open roster
                        </Link>
                        {state === 'open' && (
                            <Button variant="danger" busy={closing} onClick={closeCheckin}>
                                Close check-in
                            </Button>
                        )}
                    </div>
                )}
            </header>

            {closeError && (
                <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                    {closeError}
                </p>
            )}

            {!tracked ? (
                <EmptyState
                    title="This event takes no attendance"
                    body={
                        meeting.eventType === 'deadline'
                            ? 'Deadlines are dates on the schedule — there is no check-in and no QR code.'
                            : 'Attendance tracking is turned off for this event.'
                    }
                />
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-event-detail gap-4 items-start">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <Stat label="Checked in" value={tally.present} tone="text-green-500" />
                            <Stat
                                label={state === 'closed' ? 'Check-in closed' : 'Check-in closes'}
                                value={formatClock(closesAt)}
                                small
                            />
                            <Stat label="Excused" value={tally.excused} tone="text-sky-400" />
                            <Stat label="No record" value={tally.unrecorded} tone="text-slate-400" />
                        </div>

                        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                            <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-slate-700">
                                <h2 className="inline-flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-white">
                                    <span
                                        className={`h-2 w-2 rounded-full ${
                                            state === 'open' ? 'bg-green-500 animate-pulse' : 'bg-slate-400'
                                        }`}
                                        aria-hidden="true"
                                    />
                                    {state === 'open' ? 'Live check-ins' : 'Check-ins'}
                                </h2>
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                    {tally.present + tally.excused + tally.absent} of {tally.total} recorded
                                </span>
                            </header>

                            {feed.length === 0 ? (
                                <EmptyState
                                    title="Nobody has checked in yet"
                                    body={
                                        state === 'not_open'
                                            ? `Check-in opens at ${formatClock(checkinWindow(meeting).opensAt)}.`
                                            : 'Scans and typed codes appear here as they arrive.'
                                    }
                                />
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
                                    {feed.slice(0, 8).map((row) => {
                                        const status = attendanceStateMeta(row.record!.status);
                                        return (
                                            <li key={row.member.id} className="flex items-center gap-3 px-4 py-2.5">
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-2xs font-bold text-slate-500 dark:text-slate-300">
                                                    {row.initials}
                                                </span>
                                                <span className="flex-1 truncate text-sm font-semibold text-slate-800 dark:text-white">
                                                    {row.name}
                                                </span>
                                                <span className="hidden sm:inline rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                    {METHOD_LABELS[row.record!.method]}
                                                </span>
                                                <span className="w-16 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                                                    {row.record!.attestedAt
                                                        ? formatClock(row.record!.attestedAt)
                                                        : '—'}
                                                </span>
                                                <span className={`w-16 text-right text-xs font-semibold ${status.text}`}>
                                                    {status.label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}

                            {canManageMeetings && (
                                <Link
                                    to={`/app/meetings/${meeting.id}/roster`}
                                    className="block border-t border-slate-100 dark:border-slate-700 px-4 py-2.5 text-center text-sm font-semibold text-forge-600 dark:text-forge-400 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                                >
                                    View full roster ({tally.total})
                                </Link>
                            )}
                        </section>
                    </div>

                    <aside className="space-y-4">
                        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                            <header className="mb-3 flex items-baseline justify-between gap-2">
                                <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                                    Check-in code
                                </h2>
                                <span className="font-mono text-2xs text-slate-400">
                                    Event {formatCode(meeting.publicCode)}
                                </span>
                            </header>

                            <div className="flex justify-center">
                                <QrCode code={meeting.publicCode} size={216} />
                            </div>

                            <p className="mt-3 text-center text-2xs font-bold uppercase tracking-wider text-slate-400">
                                Or enter code
                            </p>
                            <p className="text-center font-mono text-2xl font-bold tracking-code text-slate-800 dark:text-white">
                                {formatCode(meeting.publicCode)}
                            </p>
                            <p className="mt-1 text-center text-2xs text-slate-500 dark:text-slate-400">
                                Unique to this occurrence · valid{' '}
                                {formatClock(checkinWindow(meeting).opensAt)}–{formatClock(closesAt)}
                            </p>

                            <div className="mt-3 grid grid-cols-1 gap-2">
                                <Link
                                    to={`/app/meetings/${meeting.id}/poster`}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-forge-600 px-3 py-2 text-sm font-semibold text-white shadow-card hover:bg-forge-700"
                                >
                                    <Printer size={15} />
                                    Print poster
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard
                                            ?.writeText(checkinUrl(meeting.publicCode))
                                            .then(() => {
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            })
                                            .catch(() => setCopied(false));
                                    }}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                >
                                    {copied ? <Check size={15} /> : <Copy size={15} />}
                                    {copied ? 'Link copied' : 'Copy check-in link'}
                                </button>
                            </div>
                        </section>

                        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                            <h2 className="mb-2 text-sm font-bold text-slate-800 dark:text-white">
                                Attendance
                            </h2>
                            <AttendanceBar tally={tally} />
                            <dl className="mt-3 space-y-1.5 text-xs">
                                <Legend dot="bg-green-500" label="Present" value={tally.present} />
                                <Legend dot="bg-sky-400" label="Excused" value={tally.excused} />
                                <Legend dot="bg-red-500" label="Absent" value={tally.absent} />
                                <Legend
                                    dot="bg-slate-300 dark:bg-slate-600"
                                    label="No record"
                                    value={tally.unrecorded}
                                />
                            </dl>
                        </section>
                    </aside>
                </div>
            )}
        </div>
    );
}

/** Rehydration is asynchronous; a deep link can arrive before it finishes. */
function LoadingEvent() {
    return (
        <div className="flex items-center justify-center py-20" role="status" aria-label="Loading event">
            <div className="w-6 h-6 border-2 border-forge-500 border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

function CheckinBadge({ state }: { state: ReturnType<typeof checkinState> }) {
    const look =
        state === 'open'
            ? 'border-green-500/40 bg-green-500/15 text-green-600 dark:text-green-300'
            : 'border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400';
    const label =
        state === 'open' ? 'Check-in open' : state === 'not_open' ? 'Check-in not open yet' : 'Check-in closed';

    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-bold ${look}`}>
            {state === 'open' && <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />}
            {label}
        </span>
    );
}

function Stat({
    label,
    value,
    tone = 'text-slate-800 dark:text-white',
    small = false,
}: {
    label: string;
    value: string | number;
    tone?: string;
    small?: boolean;
}) {
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5">
            <p className="text-2xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p className={`${small ? 'text-lg' : 'text-2xl'} font-bold tabular-nums ${tone}`}>{value}</p>
        </div>
    );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-sm ${dot}`} aria-hidden="true" />
            <dt className="flex-1 text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{value}</dd>
        </div>
    );
}
