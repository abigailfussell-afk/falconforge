import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, LayoutGrid, List, Plus, X } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useAppShell } from '../AppShell';
import { useAccessState } from '../../lib/entitlement';
import {
    ATTENDANCE_STATES,
    METHOD_LABELS,
    attendanceStateMeta,
    formatCode,
    nextAttendanceStatus,
    tracksAttendance,
} from '../../lib/meetings';
import type { AttendanceStatus } from '../../types';
import { useMeeting, useRoster, type RosterRow } from './useSchedule';
import { formatClock, formatFullDate } from './format';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';

/**
 * The attendance roster — the table (1f) and the rapid-tap grid (1g).
 *
 * ONE COMPONENT, TWO LAYOUTS, and the layout is a CHOICE rather than a breakpoint. The
 * mockups show the table at 1280 and the card grid at 768, which reads as "the grid is the
 * tablet version" — but the grid is not a narrower table, it is a different tool: three taps
 * to set three states while walking a room, versus a scannable record with timestamps and
 * notes. A coach with a tablet propped on the pit wall wants the table; a coach carrying it
 * wants the grid. So the width picks the default and a toggle overrides it.
 *
 * THIS IS THE OFFLINE ATTENDANCE PATH. Self check-in needs the network, because only the
 * server's clock can judge a check-in window. Everything on this screen is an ordinary queued
 * write, which is what makes attendance work at a venue with no signal at all — the case the
 * whole application exists for.
 */
export default function AttendanceRoster() {
    const { meetingId } = useParams<{ meetingId: string }>();
    const navigate = useNavigate();
    const { status: lookup, meeting } = useMeeting(meetingId);
    const { canManageMeetings } = useAppShell();
    const { canEdit, editRefusalReason } = useAccessState();
    const setAttendance = useAppStore((s) => s.setAttendance);
    const clearAttendance = useAppStore((s) => s.clearAttendance);
    const { rows, tally } = useRoster(meetingId);

    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'unrecorded' | 'excused'>('all');
    // Default by width, then let the coach override it for the rest of the session.
    const [layout, setLayout] = useState<'table' | 'grid'>(() =>
        typeof window !== 'undefined' && window.innerWidth < 1024 ? 'grid' : 'table',
    );
    const [noteFor, setNoteFor] = useState<string | null>(null);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return rows.filter((row) => {
            if (needle && !row.name.toLowerCase().includes(needle)) return false;
            if (filter === 'unrecorded') return !row.record;
            if (filter === 'excused') return row.record?.status === 'excused';
            return true;
        });
    }, [rows, search, filter]);

    if (lookup === 'loading') return <LoadingEvent />;

    if (!meeting) {
        return (
            <EmptyState
                title="That event is not on this device"
                action={
                    <Button variant="secondary" onClick={() => navigate('/app/meetings')}>
                        Back to meetings
                    </Button>
                }
            />
        );
    }

    if (!canManageMeetings) {
        // Hiding the link is UX; this is what a bookmark from back when they were a mentor
        // reaches. The database refuses the writes either way.
        return (
            <EmptyState
                title="Only coaches and mentors take attendance"
                body="You can see your own attendance on your schedule."
                action={
                    <Button variant="secondary" onClick={() => navigate('/app/meetings')}>
                        My schedule
                    </Button>
                }
            />
        );
    }

    if (!tracksAttendance(meeting)) {
        return (
            <EmptyState
                title="This event takes no attendance"
                body="Deadlines are dates on the schedule — there is nobody to record."
                action={
                    <Button variant="secondary" onClick={() => navigate(`/app/meetings/${meeting.id}`)}>
                        Back to event
                    </Button>
                }
            />
        );
    }

    /*
     * WAS `isArchived` ALONE, and that made this the one attendance screen a lapsed team could
     * still tap through (WALK-B-12's class, on a page the walkthrough never reached). Meeting
     * and attendance writes are gated by `team_can_write` exactly like task and scouting
     * writes, so every tap here queued, was refused 42501, and dead-lettered — on the screen a
     * coach uses standing up, at a venue, with fifteen students in front of them.
     */
    const readOnly = !canEdit;
    const recorded = tally.present + tally.excused + tally.absent;
    const lastScan = rows
        .map((r) => r.record?.attestedAt ?? 0)
        .reduce((max, at) => Math.max(max, at), 0);

    const set = (row: RosterRow, status: AttendanceStatus) => {
        if (readOnly) return;
        setAttendance(meeting.id, row.member.id, status);
    };

    /**
     * "Mark rest absent" fills the unrecorded, and it is a DELIBERATE act.
     *
     * Nobody is ever auto-marked absent — the whole point of the unrecorded state is that a
     * roster nobody saved is a fact about the coach rather than about the students. This
     * button is the coach saying "I have looked, and these people are not here", which is a
     * claim they are entitled to make.
     */
    const markRestAbsent = () => {
        if (readOnly) return;
        for (const row of rows) {
            if (!row.record) setAttendance(meeting.id, row.member.id, 'absent');
        }
    };

    return (
        <div data-testid="attendance-roster" className="space-y-4">
            <Link
                to={`/app/meetings/${meeting.id}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-forge-600 dark:hover:text-forge-400"
            >
                <ArrowLeft size={14} />
                {meeting.title}
            </Link>

            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white">
                        Attendance roster
                    </h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {[
                            formatFullDate(meeting.startsAt),
                            meeting.publicCode ? formatCode(meeting.publicCode) : null,
                            `${recorded} of ${tally.total} recorded`,
                            lastScan ? `last scan ${formatClock(lastScan)}` : null,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                        <LayoutButton
                            active={layout === 'table'}
                            onClick={() => setLayout('table')}
                            icon={List}
                            label="Table view"
                        />
                        <LayoutButton
                            active={layout === 'grid'}
                            onClick={() => setLayout('grid')}
                            icon={LayoutGrid}
                            label="Rapid-tap view"
                        />
                    </div>
                    <Button
                        variant="secondary"
                        onClick={markRestAbsent}
                        disabled={readOnly || tally.unrecorded === 0}
                        title={
                            readOnly
                                ? editRefusalReason
                                : tally.unrecorded === 0
                                  ? 'Everyone already has a status'
                                  : `Mark the ${tally.unrecorded} unrecorded members absent`
                        }
                        className="border border-slate-200 dark:border-slate-700"
                    >
                        Mark rest absent
                    </Button>
                </div>
            </header>

            {/*
             * NO SAVE BUTTON, and that is not an omission.
             *
             * The mockups show one, because a mockup cannot show a sync queue. Every tap here
             * is already persisted locally and queued the instant it happens, so a "Save" would
             * either be a no-op that implies unsaved work exists, or a thing a coach could fail
             * to press before their tablet went flat. The sync indicator in the sidebar is the
             * honest status display, and it already exists.
             */}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="field max-w-xs"
                    placeholder="Search roster..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search roster"
                />
                <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>
                    All {tally.total}
                </FilterPill>
                <FilterPill active={filter === 'unrecorded'} onClick={() => setFilter('unrecorded')}>
                    No record {tally.unrecorded}
                </FilterPill>
                <FilterPill active={filter === 'excused'} onClick={() => setFilter('excused')}>
                    Excused {tally.excused}
                </FilterPill>
                <span className="ml-auto text-xs text-slate-400">
                    {readOnly ? editRefusalReason : 'Changes save as you make them'}
                </span>
            </div>

            {visible.length === 0 ? (
                <EmptyState
                    title="Nobody matches"
                    body={rows.length === 0 ? 'This team has no approved members yet.' : 'Try a different filter.'}
                />
            ) : layout === 'grid' ? (
                <RapidTapGrid rows={visible} readOnly={readOnly} onCycle={(row) => set(row, nextAttendanceStatus(row.record?.status))} />
            ) : (
                <RosterTable
                    rows={visible}
                    readOnly={readOnly}
                    noteFor={noteFor}
                    onSet={set}
                    onNote={setNoteFor}
                    onSaveNote={(row, note) => {
                        if (row.record) setAttendance(meeting.id, row.member.id, row.record.status, note);
                        setNoteFor(null);
                    }}
                    onClear={(row) => clearAttendance(meeting.id, row.member.id)}
                />
            )}

            {/* The running totals, pinned where a coach walking the room can read them. */}
            <div className="sticky bottom-0 -mx-4 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-800/95 px-4 py-2.5 backdrop-blur safe-area-bottom">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold">
                    <span className="text-green-600 dark:text-green-400">{tally.present} present</span>
                    <span className="text-sky-500 dark:text-sky-400">{tally.excused} excused</span>
                    <span className="text-red-600 dark:text-red-400">{tally.absent} absent</span>
                    <span className="text-slate-400">{tally.unrecorded} open</span>
                </div>
            </div>
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

function LayoutButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof List;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            title={label}
            aria-label={label}
            className={`touch-target inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-colors ${
                active
                    ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-white'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
            }`}
        >
            <Icon size={15} />
        </button>
    );
}

function FilterPill({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
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
            {children}
        </button>
    );
}

/** 1f — the record, with an explicit three-way control and the evidence behind each row. */
function RosterTable({
    rows,
    readOnly,
    noteFor,
    onSet,
    onNote,
    onSaveNote,
    onClear,
}: {
    rows: RosterRow[];
    readOnly: boolean;
    noteFor: string | null;
    onSet: (row: RosterRow, status: AttendanceStatus) => void;
    onNote: (memberId: string | null) => void;
    onSaveNote: (row: RosterRow, note: string) => void;
    onClear: (row: RosterRow) => void;
}) {
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <table className="w-full min-w-table text-sm">
                <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/40 text-2xs font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-4 py-2 text-left">Member</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-left">Checked in</th>
                        <th className="px-4 py-2 text-left">Method</th>
                        <th className="px-4 py-2 text-right">Note</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {rows.map((row) => (
                        <tr key={row.member.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/30">
                            <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2.5">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-2xs font-bold text-slate-500 dark:text-slate-300">
                                        {row.initials}
                                    </span>
                                    <span className="font-semibold text-slate-800 dark:text-white">
                                        {row.name}
                                    </span>
                                </div>
                            </td>
                            <td className="px-4 py-2.5">
                                <div
                                    role="group"
                                    aria-label={`Attendance for ${row.name}`}
                                    className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5"
                                >
                                    {ATTENDANCE_STATES.map((state) => {
                                        const active = row.record?.status === state.status;
                                        return (
                                            <button
                                                key={state.status}
                                                type="button"
                                                disabled={readOnly}
                                                aria-pressed={active}
                                                onClick={() => onSet(row, state.status)}
                                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                                    active
                                                        ? state.selected
                                                        : 'text-slate-500 dark:text-slate-400 enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-700'
                                                }`}
                                            >
                                                {state.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                                {row.record?.attestedAt && row.record.method !== 'coach'
                                    ? formatClock(row.record.attestedAt)
                                    : '–'}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                                {row.record ? (
                                    METHOD_LABELS[row.record.method]
                                ) : (
                                    <span className="text-slate-300 dark:text-slate-600">No record</span>
                                )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                                {noteFor === row.member.id ? (
                                    <NoteEditor
                                        initial={row.record?.notes ?? ''}
                                        onCancel={() => onNote(null)}
                                        onSave={(note) => onSaveNote(row, note)}
                                    />
                                ) : row.record?.notes ? (
                                    <button
                                        type="button"
                                        disabled={readOnly}
                                        onClick={() => onNote(row.member.id)}
                                        className="text-xs font-semibold text-sky-500 hover:underline disabled:no-underline"
                                    >
                                        {row.record.notes}
                                    </button>
                                ) : (
                                    <div className="inline-flex items-center gap-1">
                                        <button
                                            type="button"
                                            disabled={readOnly || !row.record}
                                            onClick={() => onNote(row.member.id)}
                                            title={row.record ? 'Add a note' : 'Set a status first'}
                                            aria-label={`Add a note for ${row.name}`}
                                            className="touch-target rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            <Plus size={14} />
                                        </button>
                                        {row.record && !readOnly && (
                                            <button
                                                type="button"
                                                onClick={() => onClear(row)}
                                                title="Clear this record — back to no record, which is not the same as absent"
                                                aria-label={`Clear the attendance record for ${row.name}`}
                                                className="touch-target rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function NoteEditor({
    initial,
    onCancel,
    onSave,
}: {
    initial: string;
    onCancel: () => void;
    onSave: (note: string) => void;
}) {
    const [value, setValue] = useState(initial);
    return (
        <div className="inline-flex items-center gap-1">
            <input
                className="field w-40 text-xs"
                autoFocus
                value={value}
                placeholder="Family trip"
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onSave(value.trim());
                    if (e.key === 'Escape') onCancel();
                }}
                aria-label="Attendance note"
            />
            <button
                type="button"
                onClick={() => onSave(value.trim())}
                aria-label="Save note"
                className="touch-target rounded-lg p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
            >
                <Check size={14} />
            </button>
        </div>
    );
}

/** 1g — one tap per member, cycling Present → Excused → Absent. */
function RapidTapGrid({
    rows,
    readOnly,
    onCycle,
}: {
    rows: RosterRow[];
    readOnly: boolean;
    onCycle: (row: RosterRow) => void;
}) {
    return (
        <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {rows.map((row) => {
                const status = row.record?.status;
                const meta = status ? attendanceStateMeta(status) : null;
                const look =
                    status === 'present'
                        ? 'border-green-500/40 bg-green-500/10'
                        : status === 'excused'
                          ? 'border-sky-400/50 bg-sky-400/10'
                          : status === 'absent'
                            ? 'border-red-500/40 bg-red-500/10'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800';

                return (
                    <li key={row.member.id}>
                        <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => onCycle(row)}
                            // The whole card is the target, which is the point of this layout:
                            // a coach walking a room is not aiming at a 24px segment.
                            className={`flex h-28 w-full flex-col justify-between rounded-xl border p-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${look}`}
                            aria-label={`${row.name}: ${meta?.label ?? 'no record'}. Tap to change.`}
                        >
                            <div className="flex w-full items-start justify-between">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-500 dark:text-slate-300">
                                    {row.initials}
                                </span>
                                {status === 'present' && <Check size={16} className="text-green-500" />}
                                {status === 'excused' && <Check size={16} className="text-sky-400" />}
                                {status === 'absent' && <X size={16} className="text-red-500" />}
                            </div>
                            <div className="w-full min-w-0">
                                <p className="truncate text-sm font-bold text-slate-800 dark:text-white">
                                    {row.name}
                                </p>
                                <p className={`truncate text-xs ${meta?.text ?? 'text-slate-400'}`}>
                                    {meta
                                        ? `${meta.label}${
                                              row.record?.attestedAt && row.record.method !== 'coach'
                                                  ? ` · ${formatClock(row.record.attestedAt)}`
                                                  : ''
                                          }`
                                        : 'Tap to record'}
                                </p>
                            </div>
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
