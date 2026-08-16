import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, QrCode as QrIcon } from 'lucide-react';
import { useAppShell } from '../AppShell';
import { useSeasonScope } from '../../lib/season-scope';
import {
    attendanceRate,
    attendanceStateMeta,
    checkinState,
    checkinWindow,
    eventTypeMeta,
    tracksAttendance,
} from '../../lib/meetings';
import type { Meeting } from '../../types';
import { useSchedule, useMemberAttendance } from './useSchedule';
import { formatClock, formatDayBadge, formatRelative, formatTimeRange, isToday } from './format';
import Toggle from './Toggle';
import EmptyState from '../ui/EmptyState';

/**
 * The student schedule (1i) — read-only, next up first.
 *
 * READ-ONLY IS THE WHOLE POINT, and it is a property of the database rather than of this
 * component: `can_manage_meetings` excludes students, so there is no edit control here
 * because there is no edit a student could make. What they get instead is the one action that
 * IS theirs — checking themselves in — and it is the largest thing on the screen when the
 * window is open, because that is the ten seconds of the day this screen exists for.
 *
 * Past events are hidden behind a toggle rather than a second page. A student opening this
 * wants to know what is next; the history is a thing they occasionally check.
 */
export default function StudentSchedule() {
    const { currentMember } = useAppShell();
    const { season } = useSeasonScope();
    const now = Date.now();
    const { upcoming, past, next } = useSchedule(now);
    const [showPast, setShowPast] = useState(false);

    const myRecords = useMemberAttendance(currentMember?.id, past);
    const rate = attendanceRate(myRecords);

    return (
        <div className="space-y-4">
            {next ? (
                <NextUpCard meeting={next} now={now} rate={rate} recordCount={myRecords.length} />
            ) : (
                <EmptyState
                    icon={CalendarDays}
                    title="Nothing scheduled"
                    body={
                        season
                            ? 'When a coach adds a practice or a build session it will appear here.'
                            : 'Pick a season to see its schedule.'
                    }
                />
            )}

            <div className="flex items-center justify-between gap-2">
                <h2 className="text-2xs font-bold uppercase tracking-wider text-slate-400">Upcoming</h2>
                <Toggle
                    checked={showPast}
                    onChange={setShowPast}
                    label="Show past events"
                    showLabel
                    data-testid="show-past-toggle"
                />
            </div>

            {upcoming.length === 0 && !showPast ? null : (
                <ul data-testid="student-schedule" className="space-y-2">
                    {upcoming.map((meeting) => (
                        <ScheduleRow key={meeting.id} meeting={meeting} now={now} />
                    ))}
                </ul>
            )}

            {showPast && (
                <>
                    <h2 className="text-2xs font-bold uppercase tracking-wider text-slate-400">Past</h2>
                    {past.length === 0 ? (
                        <EmptyState title="No past events this season" />
                    ) : (
                        <ul data-testid="past-events" className="space-y-2">
                            {past.map((meeting) => {
                                const record = myRecords.find((r) => r.meetingId === meeting.id);
                                return (
                                    <ScheduleRow
                                        key={meeting.id}
                                        meeting={meeting}
                                        now={now}
                                        myStatus={record?.status}
                                        muted
                                    />
                                );
                            })}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * The next event, and the check-in button when there is one to press.
 *
 * The button only appears while the window is genuinely open. Showing it early and refusing
 * the tap would teach students that the button lies, and they would stop trusting it at the
 * moment it matters.
 */
function NextUpCard({
    meeting,
    now,
    rate,
    recordCount,
}: {
    meeting: Meeting;
    now: number;
    rate: number | null;
    recordCount: number;
}) {
    const state = checkinState(meeting, now);
    const badge = isToday(meeting.startsAt, now)
        ? 'Today'
        : isToday(meeting.startsAt, now + 86_400_000)
          ? 'Tomorrow'
          : formatRelative(meeting.startsAt, now);

    return (
        <section
            data-testid="next-up"
            className="rounded-xl bg-gradient-to-r from-forge-500 to-forge-600 p-4 text-white shadow-card"
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-2xs font-bold uppercase tracking-wider text-white/80">
                        Next up · {badge}
                    </p>
                    <h2 className="mt-1 text-xl font-bold">{meeting.title}</h2>
                    <p className="text-sm text-white/90">
                        {[
                            formatTimeRange(meeting.startsAt, meeting.endsAt),
                            meeting.location,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>

                {rate !== null && (
                    <div className="text-right">
                        <p className="text-2xs font-bold uppercase tracking-wider text-white/80">
                            My attendance
                        </p>
                        <p className="text-2xl font-bold tabular-nums">{Math.round(rate * 100)}%</p>
                        <p className="text-2xs text-white/80">
                            {recordCount} {recordCount === 1 ? 'event' : 'events'} recorded
                        </p>
                    </div>
                )}
            </div>

            {tracksAttendance(meeting) && meeting.publicCode && (
                <div className="mt-3">
                    {state === 'open' ? (
                        <Link
                            to={`/app/checkin/${meeting.publicCode}`}
                            data-testid="check-in-cta"
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/15 px-4 py-2.5 text-sm font-bold text-white backdrop-blur transition-colors hover:bg-white/25"
                        >
                            <QrIcon size={16} />
                            Check in now
                        </Link>
                    ) : state === 'not_open' ? (
                        <p className="text-sm text-white/90">
                            Check-in opens at {formatClock(checkinWindow(meeting).opensAt)}.
                        </p>
                    ) : (
                        <p className="text-sm text-white/90">Check-in has closed for this event.</p>
                    )}
                </div>
            )}
        </section>
    );
}

function ScheduleRow({
    meeting,
    now,
    myStatus,
    muted = false,
}: {
    meeting: Meeting;
    now: number;
    myStatus?: 'present' | 'excused' | 'absent';
    muted?: boolean;
}) {
    const type = eventTypeMeta(meeting.eventType);
    const badge = formatDayBadge(meeting.startsAt);
    const tracked = tracksAttendance(meeting);
    const state = checkinState(meeting, now);

    return (
        <li
            className={`flex items-stretch gap-3 rounded-xl border border-l-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 ${type.accent} ${
                muted ? 'opacity-75' : ''
            }`}
        >
            <div className="w-11 shrink-0 text-center">
                <p className="text-2xs font-bold uppercase text-slate-400">{badge.weekday}</p>
                <p className="text-xl font-bold leading-tight text-slate-800 dark:text-white">
                    {badge.day}
                </p>
                <p className="text-2xs font-bold uppercase text-slate-400">{badge.month}</p>
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-bold text-slate-800 dark:text-white">
                        {meeting.title}
                    </h3>
                    <span className={`rounded border px-1.5 py-0.5 text-2xs font-bold ${type.chip}`}>
                        {type.tag}
                    </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {[
                        meeting.eventType === 'deadline'
                            ? `Due ${formatClock(meeting.startsAt)}`
                            : formatTimeRange(meeting.startsAt, meeting.endsAt),
                        meeting.location,
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
                {meeting.description && (
                    <p className="mt-0.5 truncate text-xs text-slate-400">{meeting.description}</p>
                )}
            </div>

            <div className="shrink-0 self-center text-right text-xs">
                {myStatus ? (
                    <span className={`font-semibold ${attendanceStateMeta(myStatus).text}`}>
                        {attendanceStateMeta(myStatus).label}
                    </span>
                ) : muted && tracked ? (
                    // "—" rather than "Absent". Nobody is auto-marked absent, and a student
                    // seeing "Absent" for a meeting the coach never took a roster for would be
                    // being told something untrue about themselves.
                    <span className="text-slate-300 dark:text-slate-600" title="No attendance recorded">
                        —
                    </span>
                ) : !tracked ? (
                    <span className="text-slate-400">No attendance</span>
                ) : state === 'open' && meeting.publicCode ? (
                    <Link
                        to={`/app/checkin/${meeting.publicCode}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-forge-600 px-2.5 py-1.5 font-semibold text-white hover:bg-forge-700"
                    >
                        <QrIcon size={13} />
                        Check in
                    </Link>
                ) : meeting.attendanceRequired ? (
                    <span className="font-medium text-slate-500 dark:text-slate-400">
                        Attendance required
                    </span>
                ) : (
                    <span className="text-slate-400">Optional</span>
                )}
            </div>
        </li>
    );
}
