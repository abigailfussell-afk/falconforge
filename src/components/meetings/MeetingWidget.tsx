import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { CalendarDays, QrCode as QrIcon } from 'lucide-react';
import { useAppShell, type AppShellContext } from '../AppShell';
import { attendanceRate, checkinState, checkinWindow, tracksAttendance } from '../../lib/meetings';
import { useSchedule, useRoster, useMemberAttendance } from './useSchedule';
import { formatClock, formatFullDate, formatTimeRange, isToday } from './format';
import { AttendanceBar } from './EventManager';

/**
 * The dashboard card (1k) — two versions of "what is happening with meetings".
 *
 * A coach mid-meeting wants a live count and one tap to the QR; a student wants to know what
 * is next and, if check-in is open, to be one tap from it. Those are different cards, so this
 * is two components behind one entry point rather than one card with conditionals threaded
 * through it.
 *
 * RENDERS NOTHING WHEN THERE IS NOTHING. Sprint 7 found the Upcoming Deadlines panel
 * disappearing when empty and restoring the dead space it was added to fill — but that panel
 * is a permanent fixture of the dashboard, whereas this one is an insert. A team that has not
 * scheduled anything should not be shown an empty box about meetings on the screen they open
 * every day; the Meetings nav item is how they find the feature.
 */
export default function MeetingWidget() {
    /*
     * Read the shell context DEFENSIVELY rather than through `useAppShell()`.
     *
     * This card is an insert into somebody else's page, and `useOutletContext()` is null
     * wherever there is no outlet — which is not hypothetical: `DashboardHome.test.tsx`
     * renders the dashboard inside a bare `MemoryRouter`, and destructuring the null took the
     * whole dashboard down with a TypeError rather than dropping one card. A widget that can
     * break the screen it decorates is a bad trade for a component nobody has to have.
     */
    const shell = useOutletContext<AppShellContext | null>();

    // The live count and the "check-in open" badge both go stale silently, so the card keeps
    // its own slow clock rather than trusting whatever mounted it.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);

    const { next, past } = useSchedule(now);
    if (!shell || !next) return null;
    const { canManageMeetings } = shell;

    return canManageMeetings ? (
        <CoachCard meetingId={next.id} now={now} />
    ) : (
        <StudentCard meetingId={next.id} now={now} past={past} />
    );
}

function CoachCard({ meetingId, now }: { meetingId: string; now: number }) {
    const { rows, tally } = useRoster(meetingId);
    const { next } = useSchedule(now);
    if (!next) return null;

    const state = checkinState(next, now);
    const live = state === 'open';
    const recorded = tally.present + tally.excused + tally.absent;

    return (
        <section
            data-testid="meeting-widget"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 shadow-card"
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                    <CalendarDays size={15} className="text-forge-500" />
                    {live ? 'Happening now' : 'Next meeting'}
                </h3>
                {live && (
                    <span className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                        Check-in open
                    </span>
                )}
            </header>

            <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">{next.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                {[
                    isToday(next.startsAt, now) ? 'Today' : formatFullDate(next.startsAt),
                    formatTimeRange(next.startsAt, next.endsAt),
                    next.location,
                ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>

            {tracksAttendance(next) && (
                <>
                    <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                        {recorded}
                        <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                            of {rows.length} recorded
                        </span>
                    </p>
                    <AttendanceBar tally={tally} />

                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <Link
                            to={`/app/meetings/${next.id}`}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-forge-600 px-3 py-2 text-sm font-semibold text-white shadow-card hover:bg-forge-700"
                        >
                            <QrIcon size={14} />
                            Show QR
                        </Link>
                        <Link
                            to={`/app/meetings/${next.id}/roster`}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                            Open roster
                        </Link>
                    </div>
                </>
            )}
        </section>
    );
}

function StudentCard({
    meetingId,
    now,
    past,
}: {
    meetingId: string;
    now: number;
    past: ReturnType<typeof useSchedule>['past'];
}) {
    const { currentMember } = useAppShell();
    const { next } = useSchedule(now);
    const myRecords = useMemberAttendance(currentMember?.id, past);
    const rate = attendanceRate(myRecords);
    if (!next || next.id !== meetingId) return null;

    const state = checkinState(next, now);

    return (
        <section
            data-testid="meeting-widget"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3.5 shadow-card"
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
                    <CalendarDays size={15} className="text-forge-500" />
                    Next meeting
                </h3>
                {isToday(next.startsAt, now) ? (
                    <span className="rounded bg-forge-500/15 px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-forge-600 dark:text-forge-300">
                        Today
                    </span>
                ) : isToday(next.startsAt, now + 86_400_000) ? (
                    <span className="rounded bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300">
                        Tomorrow
                    </span>
                ) : null}
            </header>

            <p className="mt-2 text-base font-bold text-slate-900 dark:text-white">{next.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
                {formatFullDate(next.startsAt)} · {formatTimeRange(next.startsAt, next.endsAt)}
            </p>
            {next.location && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{next.location}</p>
            )}

            {rate !== null && (
                <div className="mt-2.5 flex items-center justify-between rounded-lg bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                    <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            My attendance
                        </p>
                        <p className="text-2xs text-slate-500 dark:text-slate-400">
                            {myRecords.length} of {past.length} events
                        </p>
                    </div>
                    <p className="text-xl font-bold tabular-nums text-green-600 dark:text-green-400">
                        {Math.round(rate * 100)}%
                    </p>
                </div>
            )}

            {tracksAttendance(next) && next.publicCode && (
                <div className="mt-3">
                    {state === 'open' ? (
                        // No code in the link — see StudentSchedule. The dashboard's
                        // `OpenCheckIns` card is the fast path, and it asks for the code.
                        <Link
                            to="/app/checkin"
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-forge-600 px-3 py-2 text-sm font-semibold text-white shadow-card hover:bg-forge-700"
                        >
                            <QrIcon size={14} />
                            Enter code to check in
                        </Link>
                    ) : (
                        // A disabled-looking button that does nothing would be worse than a
                        // sentence: this says when to come back.
                        <p className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-center text-xs text-slate-500 dark:text-slate-400">
                            {state === 'not_open'
                                ? `Check in from ${formatClock(checkinWindow(next).opensAt)}`
                                : 'Check-in has closed'}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}
