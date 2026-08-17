import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Pencil, Plus, QrCode as QrIcon } from 'lucide-react';
import {
    EVENT_TYPES,
    eventTypeMeta,
    formatCode,
    checkinState,
    checkinWindow,
    tracksAttendance,
    tallyAttendance,
} from '../../lib/meetings';
import type { Meeting, MeetingEventType } from '../../types';
import { useSchedule, useRoster } from './useSchedule';
import { formatClock, formatDayBadge, formatRelative, formatTimeRange } from './format';
import Toggle from './Toggle';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';

/**
 * The event manager (1a) — what an admin, coach or mentor opens to run the schedule.
 *
 * THE EVENT ID IS ON EVERY ROW ON PURPOSE. It is the thing a coach reads out loud when a
 * student's camera will not focus, so burying it one click deep inside the event would make
 * the fallback slower than the thing it is a fallback for.
 *
 * The table is a CSS grid rather than a `<table>` so the same markup can become a stack of
 * cards below `lg` without a second copy of every cell — the app has been down the road of
 * two renderings of one thing before (Sprint 5 deleted a fully duplicated sidebar), and the
 * copies drift.
 */
export interface EventManagerProps {
    onCreate: () => void;
    onEdit: (meeting: Meeting) => void;
    canEdit: boolean;
}

export default function EventManager({ onCreate, onEdit, canEdit }: EventManagerProps) {
    const now = Date.now();
    const { upcoming, past } = useSchedule(now);
    const [typeFilter, setTypeFilter] = useState<MeetingEventType | 'all'>('all');
    const [showPast, setShowPast] = useState(false);

    /*
     * Only offer filters for types the team actually schedules.
     *
     * All seven chips would wrap onto a second row on a laptop and offer five filters that
     * match nothing. A team that only runs build sessions and competitions gets two chips.
     */
    const availableTypes = useMemo(() => {
        const present = new Set([...upcoming, ...past].map((m) => m.eventType));
        return EVENT_TYPES.filter((t) => present.has(t.type));
    }, [upcoming, past]);

    const matches = (m: Meeting) => typeFilter === 'all' || m.eventType === typeFilter;
    const visibleUpcoming = upcoming.filter(matches);
    const visiblePast = past.filter(matches);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                {availableTypes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        <FilterChip
                            label="All types"
                            active={typeFilter === 'all'}
                            onClick={() => setTypeFilter('all')}
                        />
                        {availableTypes.map((type) => (
                            <FilterChip
                                key={type.type}
                                label={type.label}
                                active={typeFilter === type.type}
                                onClick={() => setTypeFilter(type.type)}
                            />
                        ))}
                    </div>
                )}
                <div className="ml-auto">
                    <Toggle
                        checked={showPast}
                        onChange={setShowPast}
                        label="Show past events"
                        showLabel
                        data-testid="show-past-toggle"
                    />
                </div>
            </div>

            {visibleUpcoming.length === 0 && (visiblePast.length === 0 || !showPast) ? (
                <EmptyState
                    icon={CalendarDays}
                    title={typeFilter === 'all' ? 'Nothing scheduled yet' : 'Nothing of that type'}
                    body={
                        typeFilter === 'all'
                            ? 'Create a practice, build session or competition. Post the QR code at the door and attendance records itself.'
                            : 'Try another type, or turn on past events.'
                    }
                    action={
                        canEdit && typeFilter === 'all' ? (
                            <Button onClick={onCreate}>
                                <Plus size={15} />
                                New event
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-800">
                    <ColumnHeadings />
                    <ul data-testid="upcoming-events" className="divide-y divide-slate-100 dark:divide-slate-700/60">
                        {visibleUpcoming.map((meeting) => (
                            <EventRow
                                key={meeting.id}
                                meeting={meeting}
                                now={now}
                                canEdit={canEdit}
                                onEdit={onEdit}
                            />
                        ))}
                    </ul>

                    {showPast && visiblePast.length > 0 && (
                        <>
                            <h3 className="px-4 py-2 bg-slate-50 dark:bg-slate-900/40 text-2xs font-bold uppercase tracking-wider text-slate-400">
                                Past
                            </h3>
                            <ul
                                data-testid="past-events"
                                className="divide-y divide-slate-100 dark:divide-slate-700/60"
                            >
                                {visiblePast.map((meeting) => (
                                    <PastEventRow key={meeting.id} meeting={meeting} />
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function FilterChip({
    label,
    active,
    onClick,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                active
                    ? 'border-forge-500/40 bg-forge-500/15 text-forge-600 dark:text-forge-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
            }`}
        >
            {label}
        </button>
    );
}

/** Column headings, shown only where the rows are actually laid out in columns. */
function ColumnHeadings() {
    return (
        <div className="hidden lg:grid grid-cols-schedule gap-3 px-4 py-2 bg-slate-50 dark:bg-slate-900/40 text-2xs font-bold uppercase tracking-wider text-slate-400">
            <span>When</span>
            <span>Event</span>
            <span>Attendance</span>
            <span>Event ID</span>
            <span className="text-right">Actions</span>
        </div>
    );
}

function EventRow({
    meeting,
    now,
    canEdit,
    onEdit,
}: {
    meeting: Meeting;
    now: number;
    canEdit: boolean;
    onEdit: (meeting: Meeting) => void;
}) {
    const type = eventTypeMeta(meeting.eventType);
    const badge = formatDayBadge(meeting.startsAt);
    const state = checkinState(meeting, now);
    const tracked = tracksAttendance(meeting);
    const { rows, tally } = useRoster(meeting.id);
    const recorded = tally.present + tally.excused + tally.absent;
    const isNext = state === 'open';

    return (
        <li className="grid grid-cols-1 lg:grid-cols-schedule items-start gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <div className={isNext ? 'text-forge-600 dark:text-forge-400' : 'text-slate-500 dark:text-slate-400'}>
                <p className="text-xs font-bold uppercase tracking-wide">
                    {badge.weekday} {badge.month} {badge.day}
                </p>
                <p className="text-xs">{formatTimeRange(meeting.startsAt, meeting.endsAt)}</p>
            </div>

            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-sm ${type.dot}`} aria-hidden="true" />
                    <Link
                        to={`/app/meetings/${meeting.id}`}
                        className="truncate text-sm font-bold text-slate-800 dark:text-white hover:text-forge-600 dark:hover:text-forge-400"
                    >
                        {meeting.title}
                    </Link>
                    <span className={`rounded border px-1.5 py-0.5 text-2xs font-bold ${type.chip}`}>
                        {type.tag}
                    </span>
                    {meeting.seriesId && (
                        <span className="text-2xs font-medium text-slate-400">Repeats</span>
                    )}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {[
                        meeting.location,
                        !tracked
                            ? 'No attendance'
                            : !meeting.attendanceRequired
                              ? 'Optional'
                              : state === 'not_open'
                                ? `Check-in opens ${formatClock(checkinWindow(meeting).opensAt)}`
                                : state === 'open'
                                  ? 'Check-in open'
                                  : 'Attendance required',
                    ]
                        .filter(Boolean)
                        .join(' · ')}
                </p>
            </div>

            <div className="text-xs">
                {!tracked ? (
                    <span className="text-slate-400">—</span>
                ) : (
                    <>
                        <p className="font-semibold text-slate-700 dark:text-slate-200">
                            {recorded > 0
                                ? `${tally.present} of ${rows.length} present`
                                : state === 'not_open'
                                  ? `Opens ${formatRelative(checkinWindow(meeting).opensAt, now)}`
                                  : 'Not started'}
                        </p>
                        <AttendanceBar tally={tally} />
                    </>
                )}
            </div>

            <p className="font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                {tracked ? formatCode(meeting.publicCode) : <span className="text-slate-300 dark:text-slate-600">—</span>}
            </p>

            <div className="flex items-center justify-start gap-1 lg:justify-end">
                {tracked && meeting.publicCode && (
                    <Link
                        to={`/app/meetings/${meeting.id}`}
                        title="Show the check-in code"
                        aria-label={`Show the check-in code for ${meeting.title}`}
                        className={`touch-target inline-flex items-center justify-center rounded-lg border p-2 transition-colors ${
                            isNext
                                ? 'border-forge-500/40 bg-forge-500/15 text-forge-600 dark:text-forge-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                    >
                        <QrIcon size={15} />
                    </Link>
                )}
                {canEdit && (
                    <button
                        type="button"
                        onClick={() => onEdit(meeting)}
                        title="Edit event"
                        aria-label={`Edit ${meeting.title}`}
                        className="touch-target inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        {/* A pencil, not an ellipsis. The button does exactly one thing —
                            open the edit modal — and an ellipsis promises a menu of choices
                            that does not exist. */}
                        <Pencil size={15} />
                    </button>
                )}
            </div>
        </li>
    );
}

function PastEventRow({ meeting }: { meeting: Meeting }) {
    const type = eventTypeMeta(meeting.eventType);
    const badge = formatDayBadge(meeting.startsAt);
    const { rows, tally } = useRoster(meeting.id);
    const tracked = tracksAttendance(meeting);
    const recorded = tally.present + tally.excused + tally.absent;

    return (
        <li className="grid grid-cols-1 lg:grid-cols-schedule items-start gap-x-3 gap-y-2 px-4 py-3 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <div>
                <p className="text-xs font-bold uppercase tracking-wide">
                    {badge.weekday} {badge.month} {badge.day}
                </p>
                <p className="text-xs">{formatTimeRange(meeting.startsAt, meeting.endsAt)}</p>
            </div>

            <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-sm ${type.dot}`} aria-hidden="true" />
                <Link
                    to={`/app/meetings/${meeting.id}`}
                    className="truncate text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-forge-600 dark:hover:text-forge-400"
                >
                    {meeting.title}
                </Link>
            </div>

            <div className="text-xs">
                {tracked ? (
                    <>
                        <p className="font-semibold text-slate-600 dark:text-slate-300">
                            {/* "Roster never saved" rather than "0 present": nobody was marked
                                absent, so claiming a number here would invent one. */}
                            {recorded > 0
                                ? `${tally.present} of ${rows.length} present`
                                : 'Roster never saved'}
                        </p>
                        <AttendanceBar tally={tally} />
                    </>
                ) : (
                    <span className="text-slate-400">—</span>
                )}
            </div>

            <p className="font-mono text-xs">{tracked ? formatCode(meeting.publicCode) : '—'}</p>

            <div className="lg:text-right">
                {tracked && (
                    <Link
                        to={`/app/meetings/${meeting.id}/roster`}
                        className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        Roster
                    </Link>
                )}
            </div>
        </li>
    );
}

/**
 * Present / excused / absent as one bar, with the unrecorded remainder left empty.
 *
 * The empty remainder is the honest part: it is the difference between "six people were
 * absent" and "six people were never asked", and only one of those is a fact about students.
 */
export function AttendanceBar({ tally }: { tally: ReturnType<typeof tallyAttendance> }) {
    const width = (count: number) => (tally.total > 0 ? `${(count / tally.total) * 100}%` : '0%');

    return (
        <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <span className="bg-green-500" style={{ width: width(tally.present) }} />
            <span className="bg-sky-400" style={{ width: width(tally.excused) }} />
            <span className="bg-red-500" style={{ width: width(tally.absent) }} />
        </div>
    );
}
