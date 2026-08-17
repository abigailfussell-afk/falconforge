import { useMemo, useState } from 'react';
import { Repeat, X } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import {
    EVENT_TYPES,
    CHECKIN_OPENS_BEFORE_MS,
    CHECKIN_FALLBACK_DURATION_MS,
    formatCode,
    tracksAttendance,
    parseRecurrenceRule,
    expandRecurrence,
    type RecurrenceFrequency,
} from '../../lib/meetings';
import type { Meeting } from '../../types';
import { fromDateTimeInputs, isSameDay, toDateInput, toTimeInput } from './format';
import Toggle from './Toggle';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

/**
 * Create and edit an event (1b), plus the recurring-series prompt.
 *
 * TWO CONTROLS FOR ATTENDANCE, NOT ONE. The mockup draws a single "Attendance tracking"
 * switch, but 1a and 1i both distinguish an event that is REQUIRED from one that is OPTIONAL
 * while still taking attendance — the outreach event is optional and still has a QR. Those are
 * two facts, so they are two controls. Kevin chose this over collapsing them at kickoff.
 *
 * THE SERIES PROMPT IS A SECOND STEP, NOT A CONFIRM DIALOG. It appears only when editing an
 * occurrence that belongs to a series, and it is the only place the three apply-modes exist.
 * Creating a series never asks: there is nothing to disambiguate yet.
 */
export interface EventFormModalProps {
    /** The occurrence being edited, or null to create. */
    meeting: Meeting | null;
    onClose: () => void;
    /** Navigate to the first event a save created. */
    onCreated?: (meetingId: string) => void;
}

type ApplyScope = 'occurrence' | 'future' | 'series';

const RECURRENCE_LABELS: { value: RecurrenceFrequency; label: (weekday: string) => string }[] = [
    { value: 'weekly', label: (day) => `Weekly on ${day}` },
    { value: 'biweekly', label: (day) => `Every 2 weeks on ${day}` },
    { value: 'monthly', label: () => 'Monthly on this date' },
];

export default function EventFormModal({ meeting, onClose, onCreated }: EventFormModalProps) {
    const addMeeting = useAppStore((s) => s.addMeeting);
    const updateMeeting = useAppStore((s) => s.updateMeeting);
    const deleteMeeting = useAppStore((s) => s.deleteMeeting);
    const allMeetings = useAppStore((s) => s.meetings);

    const existingRecurrence = meeting ? parseRecurrenceRule(meeting.recurrenceRule) : null;
    const defaultStart = useMemo(() => nextRoundHour(), []);

    const [title, setTitle] = useState(meeting?.title ?? '');
    const [eventType, setEventType] = useState<Meeting['eventType']>(meeting?.eventType ?? 'build');
    const [date, setDate] = useState(toDateInput(meeting?.startsAt ?? defaultStart));
    const [startTime, setStartTime] = useState(toTimeInput(meeting?.startsAt ?? defaultStart));
    /*
     * THE DEFAULT END MUST NOT CROSS MIDNIGHT.
     *
     * This form has ONE date field and two time fields, so it cannot express an event that
     * runs past midnight — and the default was `start + 2 hours`, which does exactly that from
     * 22:00 onwards. A coach opening "New event" at 22:15 got a 23:00 start and a 01:00 end,
     * which the form correctly reads as ending twenty-two hours before it begins: Save
     * disabled, "The end time is before the start", and nothing on screen explaining that the
     * form did it to itself. Every evening, for the last two hours of every day.
     *
     * Found by a smoke test that did not set the times at all — the case a coach hits by just
     * opening the form. Clamping to 23:59 keeps the default sane; an event that genuinely runs
     * past midnight is a second date field, and nobody has asked for one.
     */
    const [endTime, setEndTime] = useState(() => {
        const startsAtDefault = meeting?.startsAt ?? defaultStart;
        const endsAtDefault = meeting?.endsAt ?? startsAtDefault + 2 * 60 * 60_000;
        return isSameDay(endsAtDefault, startsAtDefault) ? toTimeInput(endsAtDefault) : '23:59';
    });
    const [location, setLocation] = useState(meeting?.location ?? '');
    const [description, setDescription] = useState(meeting?.description ?? '');

    const [repeats, setRepeats] = useState(!!existingRecurrence);
    const [frequency, setFrequency] = useState<RecurrenceFrequency>(
        existingRecurrence?.frequency ?? 'weekly',
    );
    const [until, setUntil] = useState(
        toDateInput(existingRecurrence?.until ?? (meeting?.startsAt ?? defaultStart) + 90 * 86_400_000),
    );

    const [tracked, setTracked] = useState(
        meeting ? tracksAttendance(meeting) && !!meeting.publicCode : true,
    );
    const [required, setRequired] = useState(meeting?.attendanceRequired ?? true);
    const [customWindow, setCustomWindow] = useState(
        !!meeting && (meeting.checkinOpensAt !== undefined || meeting.checkinClosesAt !== undefined),
    );
    /*
     * NULL MEANS DERIVED, exactly as it does in the column.
     *
     * These used to be plain strings seeded from `defaultStart` — the next round hour, computed
     * once when the modal mounted. So a coach who opened the form at 7:28pm and then set the
     * meeting to 3–5pm got a check-in window of 7:45pm–10:00pm: the default for a meeting they
     * were no longer creating. Reported by Kevin from the screenshot, and the numbers in it are
     * exactly the mount-time default.
     *
     * Keeping the override nullable and deriving the displayed value from the CURRENT start and
     * end means the window follows the times until somebody deliberately types over it — which
     * is the same rule `checkin_opens_at`/`checkin_closes_at` follow in the database, and the
     * same rule the help text under the checkbox promises.
     */
    const [opensOverride, setOpensOverride] = useState<string | null>(
        meeting?.checkinOpensAt !== undefined ? toTimeInput(meeting.checkinOpensAt) : null,
    );
    const [closesOverride, setClosesOverride] = useState<string | null>(
        meeting?.checkinClosesAt !== undefined ? toTimeInput(meeting.checkinClosesAt) : null,
    );

    const [scopePrompt, setScopePrompt] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(false);

    const startsAt = fromDateTimeInputs(date, startTime);
    const endsAt = fromDateTimeInputs(date, endTime);
    const isDeadline = eventType === 'deadline';
    const canTrack = !isDeadline;

    // What the window would be with nobody overriding it. Same arithmetic as `checkinWindow`,
    // applied to the times currently in the form rather than to a saved record.
    const derivedOpens = startsAt === null ? '' : toTimeInput(startsAt - CHECKIN_OPENS_BEFORE_MS);
    const derivedCloses =
        endsAt !== null
            ? toTimeInput(endsAt)
            : startsAt === null
              ? ''
              : toTimeInput(startsAt + CHECKIN_FALLBACK_DURATION_MS);

    const opensTime = opensOverride ?? derivedOpens;
    const closesTime = closesOverride ?? derivedCloses;

    // Disabled with a reason rather than a save that silently does nothing — the class of
    // defect Sprint 5.5 fixed on the scouting form.
    const problem =
        !title.trim() ? 'Give the event a title'
        : startsAt === null ? 'Pick a date and a start time'
        : endsAt !== null && endsAt < startsAt ? 'The end time is before the start'
        : null;

    const weekday = startsAt
        ? new Date(startsAt).toLocaleDateString(undefined, { weekday: 'long' })
        : 'Monday';

    /** How many rows this save would create, so the coach is told before it happens. */
    const occurrenceCount = useMemo(() => {
        if (!repeats || startsAt === null) return 1;
        const untilMs = fromDateTimeInputs(until, '23:59');
        if (untilMs === null) return 1;
        return expandRecurrence(startsAt, { frequency, until: untilMs }).length;
    }, [repeats, startsAt, until, frequency]);

    const siblings = meeting?.seriesId
        ? allMeetings.filter((m) => m.seriesId === meeting.seriesId && m.startsAt > meeting.startsAt)
        : [];

    function buildPatch(): Partial<Meeting> {
        const patch: Partial<Meeting> = {
            title: title.trim(),
            eventType,
            location: location.trim(),
            description: description.trim(),
            attendanceRequired: canTrack && tracked ? required : false,
        };
        if (startsAt !== null) patch.startsAt = startsAt;
        patch.endsAt = endsAt ?? undefined;

        /*
         * An untouched window stays undefined, which means "derive it".
         *
         * Writing the computed values here instead would pin every meeting's window the first
         * time anybody opened this form and pressed Save, so moving the meeting afterwards
         * would leave check-in opening at the old time.
         */
        if (customWindow && startsAt !== null) {
            patch.checkinOpensAt = fromDateTimeInputs(date, opensTime) ?? undefined;
            patch.checkinClosesAt = fromDateTimeInputs(date, closesTime) ?? undefined;
        } else {
            patch.checkinOpensAt = undefined;
            patch.checkinClosesAt = undefined;
        }
        return patch;
    }

    function save(scope: ApplyScope = 'occurrence') {
        if (problem || startsAt === null) return;

        if (meeting) {
            updateMeeting(meeting.id, buildPatch(), scope);
            onClose();
            return;
        }

        const untilMs = repeats ? fromDateTimeInputs(until, '23:59') : null;
        const created = addMeeting(
            {
                title: title.trim(),
                description: description.trim(),
                location: location.trim(),
                eventType,
                attendanceRequired: canTrack && tracked ? required : false,
                startsAt,
                endsAt: endsAt ?? undefined,
                checkinOpensAt: customWindow ? fromDateTimeInputs(date, opensTime) ?? undefined : undefined,
                checkinClosesAt: customWindow ? fromDateTimeInputs(date, closesTime) ?? undefined : undefined,
            },
            untilMs !== null ? { frequency, until: untilMs } : undefined,
        );

        onClose();
        if (created[0]) onCreated?.(created[0]);
    }

    function attemptSave() {
        // Only a member of a series has anything to disambiguate.
        if (meeting?.seriesId) setScopePrompt(true);
        else save();
    }

    if (scopePrompt && meeting) {
        return (
            <ApplyScopePrompt
                futureCount={siblings.length}
                onBack={() => setScopePrompt(false)}
                onApply={(scope) => save(scope)}
            />
        );
    }

    if (pendingDelete && meeting) {
        return (
            <DeletePrompt
                meeting={meeting}
                futureCount={siblings.length}
                onBack={() => setPendingDelete(false)}
                onDelete={(scope) => {
                    deleteMeeting(meeting.id, scope);
                    onClose();
                }}
            />
        );
    }

    return (
        <Modal
            label={meeting ? 'Edit event' : 'New event'}
            width="dialog"
            className="flex flex-col overflow-hidden"
        >
            <header className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 px-5 py-3">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                    {meeting ? 'Edit event' : 'New event'}
                </h2>
                <div className="flex items-center gap-3">
                    {meeting?.publicCode && (
                        <span className="font-mono text-xs font-semibold text-slate-400">
                            {formatCode(meeting.publicCode)}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="touch-target rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                        <X size={16} />
                    </button>
                </div>
            </header>

            <div className="scroll-region flex-1 space-y-4 px-5 py-4">
                <Field label="Title">
                    <input
                        className="field"
                        value={title}
                        autoFocus
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Build session — chassis rebuild"
                        data-testid="event-title"
                    />
                </Field>

                <Field label="Type">
                    <div className="flex flex-wrap gap-1.5">
                        {EVENT_TYPES.map((type) => (
                            <button
                                key={type.type}
                                type="button"
                                aria-pressed={eventType === type.type}
                                onClick={() => setEventType(type.type)}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                    eventType === type.type
                                        ? type.chip
                                        : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60'
                                }`}
                            >
                                <span className={`h-1.5 w-1.5 rounded-full ${type.dot}`} aria-hidden="true" />
                                {type.label}
                            </button>
                        ))}
                    </div>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Date">
                        <input
                            type="date"
                            className="field"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            data-testid="event-date"
                        />
                    </Field>
                    <Field label="Start">
                        <input
                            type="time"
                            className="field"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            data-testid="event-start"
                        />
                    </Field>
                    <Field label="End">
                        <input
                            type="time"
                            className="field"
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                            data-testid="event-end"
                        />
                    </Field>
                </div>

                <Field label="Location">
                    <input
                        className="field"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Room 214 — engineering lab"
                    />
                </Field>

                <Field label="Notes">
                    <textarea
                        className="field"
                        rows={2}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Bring the spare motors"
                    />
                </Field>

                {/* Repeats — creation only. Changing the RULE of an existing series would mean
                    regenerating occurrences that already have codes on posters, so the form
                    does not offer it; a coach edits or deletes the occurrences instead. */}
                {!meeting && (
                    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                <Repeat size={15} className="text-slate-400" />
                                Repeats
                            </span>
                            <Toggle
                                checked={repeats}
                                onChange={setRepeats}
                                label="Repeats"
                                tone="teal"
                                data-testid="repeats-toggle"
                            />
                        </div>

                        {repeats && (
                            <>
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Field label="Frequency">
                                        <select
                                            className="field"
                                            value={frequency}
                                            onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                                        >
                                            {RECURRENCE_LABELS.map((option) => (
                                                <option key={option.value} value={option.value}>
                                                    {option.label(weekday)}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="Until">
                                        <input
                                            type="date"
                                            className="field"
                                            value={until}
                                            onChange={(e) => setUntil(e.target.value)}
                                        />
                                    </Field>
                                </div>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    Creates {occurrenceCount} {occurrenceCount === 1 ? 'event' : 'events'}.
                                    Each one gets its own event ID and QR code, so a code saved from an
                                    earlier session will not check anybody in.
                                </p>
                            </>
                        )}
                    </section>
                )}

                <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                Attendance tracking
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                {isDeadline
                                    ? 'Deadlines do not take attendance.'
                                    : 'Generates a QR code and a typed check-in code for this event.'}
                            </p>
                        </div>
                        <Toggle
                            checked={canTrack && tracked}
                            onChange={setTracked}
                            disabled={!canTrack}
                            label="Attendance tracking"
                            data-testid="attendance-toggle"
                        />
                    </div>

                    {canTrack && tracked && (
                        <>
                            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={required}
                                    onChange={(e) => setRequired(e.target.checked)}
                                    className="h-4 w-4 rounded border-slate-300 text-forge-600 focus:ring-forge-500"
                                />
                                Required for all members
                                <span className="text-xs text-slate-400">
                                    {required ? '' : '— shows as Optional on the schedule'}
                                </span>
                            </label>

                            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={customWindow}
                                    onChange={(e) => {
                                        setCustomWindow(e.target.checked);
                                        // Unticking forgets the override, so ticking again
                                        // offers the derived window rather than a stale edit.
                                        if (!e.target.checked) {
                                            setOpensOverride(null);
                                            setClosesOverride(null);
                                        }
                                    }}
                                    className="h-4 w-4 rounded border-slate-300 text-forge-600 focus:ring-forge-500"
                                />
                                Set the check-in window by hand
                            </label>

                            {customWindow ? (
                                <div className="mt-2 grid grid-cols-2 gap-3">
                                    <Field label="Check-in opens">
                                        <input
                                            type="time"
                                            className="field"
                                            value={opensTime}
                                            onChange={(e) => setOpensOverride(e.target.value)}
                                            data-testid="checkin-opens"
                                        />
                                    </Field>
                                    <Field label="Check-in closes">
                                        <input
                                            type="time"
                                            className="field"
                                            value={closesTime}
                                            onChange={(e) => setClosesOverride(e.target.value)}
                                            data-testid="checkin-closes"
                                        />
                                    </Field>
                                </div>
                            ) : (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    Opens 15 minutes before the start and closes at the end. Move the
                                    event and the window moves with it.
                                </p>
                            )}
                        </>
                    )}
                </section>
            </div>

            <footer className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-700 px-5 py-3">
                {meeting ? (
                    <button
                        type="button"
                        onClick={() => setPendingDelete(true)}
                        className="rounded-lg px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                        Delete event
                    </button>
                ) : (
                    <span />
                )}
                <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        onClick={attemptSave}
                        disabled={!!problem}
                        title={problem ?? undefined}
                        data-testid="save-event"
                    >
                        Save event
                    </Button>
                </div>
            </footer>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-slate-400">
                {label}
            </span>
            {children}
        </label>
    );
}

/** The three-way prompt (1b). Shown on save, only for an occurrence that has siblings. */
function ApplyScopePrompt({
    futureCount,
    onBack,
    onApply,
}: {
    futureCount: number;
    onBack: () => void;
    onApply: (scope: ApplyScope) => void;
}) {
    const [scope, setScope] = useState<ApplyScope>('occurrence');

    return (
        <Modal label="Apply changes to" width="panel" stacked>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Apply changes to…</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                This event repeats.{' '}
                {futureCount > 0
                    ? `${futureCount} later ${futureCount === 1 ? 'occurrence exists' : 'occurrences exist'}.`
                    : 'It is the last occurrence in its series.'}
            </p>

            <div className="mt-4 space-y-2">
                {(
                    [
                        ['occurrence', 'This occurrence only'],
                        ['future', 'This and all future occurrences'],
                        ['series', 'Every occurrence in the series'],
                    ] as const
                ).map(([value, label]) => (
                    <label
                        key={value}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                            scope === value
                                ? 'border-forge-500 bg-forge-500/10 text-forge-700 dark:text-forge-300'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/40'
                        }`}
                    >
                        <input
                            type="radio"
                            name="apply-scope"
                            value={value}
                            checked={scope === value}
                            onChange={() => setScope(value)}
                            className="h-4 w-4 text-forge-600 focus:ring-forge-500"
                        />
                        {label}
                    </label>
                ))}
            </div>

            {/* Said here rather than only in a code comment, because it is the question a coach
                is actually asking when they hesitate over these three buttons. */}
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Event IDs never change. Posters already printed keep working.
            </p>

            <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={onBack}>
                    Back
                </Button>
                <Button onClick={() => onApply(scope)} data-testid="apply-scope">
                    Apply
                </Button>
            </div>
        </Modal>
    );
}

function DeletePrompt({
    meeting,
    futureCount,
    onBack,
    onDelete,
}: {
    meeting: Meeting;
    futureCount: number;
    onBack: () => void;
    onDelete: (scope: ApplyScope) => void;
}) {
    const [scope, setScope] = useState<ApplyScope>('occurrence');

    return (
        <Modal label="Delete event" width="panel" stacked>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Delete this event?</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                “{meeting.title}” and any attendance recorded for it will be removed. This cannot be
                undone.
            </p>

            {meeting.seriesId && (
                <div className="mt-4 space-y-2">
                    {(
                        [
                            ['occurrence', 'This occurrence only'],
                            ['future', `This and ${futureCount} later ${futureCount === 1 ? 'occurrence' : 'occurrences'}`],
                            ['series', 'Every occurrence in the series'],
                        ] as const
                    ).map(([value, label]) => (
                        <label
                            key={value}
                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                                scope === value
                                    ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-300'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                        >
                            <input
                                type="radio"
                                name="delete-scope"
                                value={value}
                                checked={scope === value}
                                onChange={() => setScope(value)}
                                className="h-4 w-4 text-red-600 focus:ring-red-500"
                            />
                            {label}
                        </label>
                    ))}
                </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={onBack}>
                    Cancel
                </Button>
                <Button variant="danger" onClick={() => onDelete(scope)} data-testid="confirm-delete">
                    Delete
                </Button>
            </div>
        </Modal>
    );
}

/** The next whole hour — a sane default start for a new event. */
function nextRoundHour(): number {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    date.setHours(date.getHours() + 1);
    return date.getTime();
}
