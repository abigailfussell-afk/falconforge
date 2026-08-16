/**
 * The rules of the schedule, in one place and away from any component.
 *
 * Everything here is pure: given a meeting and a clock it says what colour the event is, when
 * its check-in window opens, whether that window is open now, what code to give the next
 * occurrence and which dates a weekly series lands on. Components render the answers.
 *
 * WHY THE WINDOW MATH IS DUPLICATED IN SQL
 *
 * `meeting_checkin_opens`/`meeting_checkin_closes` in `20260820000000_v2_meetings.sql` compute
 * the same two numbers. That is not an oversight to be tidied away. The server's copy is the
 * one that DECIDES — it is what `check_in_with_code` judges against, using `now()` — and the
 * client's copy is what renders "check-in opens 5:45 PM" on a phone in a car park with no
 * signal, hours before anything asks the server anything. Neither can be deleted.
 *
 * What can be prevented is the two drifting, so `checkin-window.test.ts` reads the intervals
 * back out of the migration file and asserts they match the constants below. A comment saying
 * "keep these in step" is how they stop being in step.
 */
import type { Meeting, MeetingAttendance, MeetingEventType, AttendanceStatus } from '../types';

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface EventTypeMeta {
    type: MeetingEventType;
    /** Full name, as the create/edit form and the schedule row spell it. */
    label: string;
    /** The uppercase tag on a schedule row. */
    tag: string;
    /** Solid swatch — the dot beside a title, the bar down a card. */
    dot: string;
    /** The pill on a schedule row: tinted background, readable text, faint border. */
    chip: string;
    /** Left accent on a student schedule row and a calendar entry. */
    accent: string;
    /** Calendar entry fill. */
    calendar: string;
}

/**
 * The seven types, in the order the create form offers them.
 *
 * Class strings are written out in full rather than composed (`bg-${colour}-500`), because
 * Tailwind scans source text: a class assembled at runtime is a class that is not in the
 * stylesheet. Every value here is a literal for that reason, not for lack of trying.
 *
 * Colours are the design's: practice blue, team meeting purple, build teal, competition the
 * forge orange, outreach green, fundraiser pink, deadline slate.
 */
export const EVENT_TYPES: readonly EventTypeMeta[] = [
    {
        type: 'practice',
        label: 'Practice',
        tag: 'PRACTICE',
        dot: 'bg-blue-500',
        chip: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30',
        accent: 'border-l-blue-500',
        calendar: 'bg-blue-500/15 text-blue-700 dark:text-blue-200 border-l-2 border-blue-500',
    },
    {
        type: 'team_meeting',
        label: 'Team meeting',
        tag: 'MEETING',
        dot: 'bg-purple-500',
        chip: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30',
        accent: 'border-l-purple-500',
        calendar: 'bg-purple-500/15 text-purple-700 dark:text-purple-200 border-l-2 border-purple-500',
    },
    {
        type: 'build',
        label: 'Build session',
        tag: 'BUILD',
        dot: 'bg-teal-500',
        chip: 'bg-teal-500/15 text-teal-600 dark:text-teal-300 border-teal-500/30',
        accent: 'border-l-teal-500',
        calendar: 'bg-teal-500/15 text-teal-700 dark:text-teal-200 border-l-2 border-teal-500',
    },
    {
        type: 'competition',
        label: 'Competition',
        tag: 'COMPETITION',
        dot: 'bg-forge-500',
        chip: 'bg-forge-500/15 text-forge-600 dark:text-forge-300 border-forge-500/30',
        accent: 'border-l-forge-500',
        calendar: 'bg-forge-500/15 text-forge-700 dark:text-forge-200 border-l-2 border-forge-500',
    },
    {
        type: 'outreach',
        label: 'Outreach',
        tag: 'OUTREACH',
        dot: 'bg-green-500',
        chip: 'bg-green-500/15 text-green-600 dark:text-green-300 border-green-500/30',
        accent: 'border-l-green-500',
        calendar: 'bg-green-500/15 text-green-700 dark:text-green-200 border-l-2 border-green-500',
    },
    {
        type: 'fundraiser',
        label: 'Fundraiser',
        tag: 'FUNDRAISER',
        dot: 'bg-pink-500',
        chip: 'bg-pink-500/15 text-pink-600 dark:text-pink-300 border-pink-500/30',
        accent: 'border-l-pink-500',
        calendar: 'bg-pink-500/15 text-pink-700 dark:text-pink-200 border-l-2 border-pink-500',
    },
    {
        type: 'deadline',
        label: 'Deadline',
        tag: 'DEADLINE',
        dot: 'bg-slate-500',
        chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
        accent: 'border-l-slate-500',
        calendar: 'bg-slate-500/15 text-slate-700 dark:text-slate-200 border-l-2 border-slate-500',
    },
] as const;

const EVENT_TYPE_BY_NAME = new Map(EVENT_TYPES.map((t) => [t.type, t]));

/**
 * Metadata for a type, falling back to `team_meeting`.
 *
 * A value outside the union means a schema change the client has not been rebuilt for. The
 * fallback keeps the row rendering with a real colour and a real label rather than an
 * undefined-shaped hole, which is the same choice `toMemberRole` makes in the registry.
 */
export function eventTypeMeta(type: MeetingEventType | string): EventTypeMeta {
    return EVENT_TYPE_BY_NAME.get(type as MeetingEventType) ?? EVENT_TYPE_BY_NAME.get('team_meeting')!;
}

/** A deadline is a date on the schedule, not a gathering: no attendance, no code, no QR. */
export function tracksAttendance(meeting: Pick<Meeting, 'eventType'>): boolean {
    return meeting.eventType !== 'deadline';
}

// ---------------------------------------------------------------------------
// Attendance states
// ---------------------------------------------------------------------------

export interface AttendanceStateMeta {
    status: AttendanceStatus;
    label: string;
    dot: string;
    /** The selected segment of the three-way control in the roster. */
    selected: string;
    text: string;
}

/** Present green, Excused sky, Absent red — and nothing between them. */
export const ATTENDANCE_STATES: readonly AttendanceStateMeta[] = [
    {
        status: 'present',
        label: 'Present',
        dot: 'bg-green-500',
        selected: 'bg-green-500/20 text-green-600 dark:text-green-300 ring-1 ring-green-500/40',
        text: 'text-green-600 dark:text-green-400',
    },
    {
        status: 'excused',
        label: 'Excused',
        dot: 'bg-sky-400',
        selected: 'bg-sky-400/20 text-sky-600 dark:text-sky-300 ring-1 ring-sky-400/40',
        text: 'text-sky-600 dark:text-sky-400',
    },
    {
        status: 'absent',
        label: 'Absent',
        dot: 'bg-red-500',
        selected: 'bg-red-500/20 text-red-600 dark:text-red-300 ring-1 ring-red-500/40',
        text: 'text-red-600 dark:text-red-400',
    },
] as const;

const ATTENDANCE_STATE_BY_NAME = new Map(ATTENDANCE_STATES.map((s) => [s.status, s]));

export function attendanceStateMeta(status: AttendanceStatus): AttendanceStateMeta {
    return ATTENDANCE_STATE_BY_NAME.get(status) ?? ATTENDANCE_STATES[2];
}

/** Tapping a card in the rapid-tap grid cycles Present → Excused → Absent → Present. */
export function nextAttendanceStatus(current: AttendanceStatus | undefined): AttendanceStatus {
    if (current === 'present') return 'excused';
    if (current === 'excused') return 'absent';
    return 'present';
}

/** How a status was recorded, as the roster and the live feed label it. */
export const METHOD_LABELS: Record<string, string> = {
    qr: 'QR scan',
    code: 'Typed code',
    coach: 'Coach set',
};

// ---------------------------------------------------------------------------
// The check-in window
// ---------------------------------------------------------------------------

/** Check-in opens this long before the start when nobody has overridden it. */
export const CHECKIN_OPENS_BEFORE_MS = 15 * 60_000;

/**
 * How long after the start a meeting with no end time stays open for check-in.
 *
 * Something has to bound it. `ends_at` is nullable, and a code with no closing time is a code
 * that works forever, which is the one property this design exists to prevent.
 */
export const CHECKIN_FALLBACK_DURATION_MS = 4 * 60 * 60_000;

export interface CheckinWindow {
    opensAt: number;
    closesAt: number;
}

/** The effective window: the explicit values if set, the defaults if not. */
export function checkinWindow(meeting: Meeting): CheckinWindow {
    return {
        opensAt: meeting.checkinOpensAt ?? meeting.startsAt - CHECKIN_OPENS_BEFORE_MS,
        closesAt:
            meeting.checkinClosesAt ??
            meeting.endsAt ??
            meeting.startsAt + CHECKIN_FALLBACK_DURATION_MS,
    };
}

export type CheckinState = 'none' | 'not_open' | 'open' | 'closed';

/**
 * Whether this meeting is taking check-ins right now.
 *
 * `'none'` covers both a deadline and an event a coach turned tracking off for — from the
 * outside they are the same thing: there is no code to give anybody.
 */
export function checkinState(meeting: Meeting, now: number = Date.now()): CheckinState {
    if (!tracksAttendance(meeting) || !meeting.publicCode) return 'none';
    const { opensAt, closesAt } = checkinWindow(meeting);
    if (now < opensAt) return 'not_open';
    if (now > closesAt) return 'closed';
    return 'open';
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** The prefix the poster prints and nobody types. Purely presentational. */
export const CODE_PREFIX = 'FF';

/** `'0842'` → `'FF-0842'`. */
export function formatCode(code: string): string {
    return code ? `${CODE_PREFIX}-${code}` : '';
}

/**
 * Whatever somebody typed or scanned → the four digits, or null.
 *
 * Deliberately forgiving about everything except the digits: a student reading the poster may
 * type `ff-0842`, `FF 0842` or `0842`, and a phone's autocorrect may add a space. The server
 * strips non-digits the same way, so a code this function accepts is a code the RPC will
 * resolve — the client is not a second, stricter gate.
 */
export function parseCode(input: string): string | null {
    const digits = (input || '').replace(/\D/g, '');
    return digits.length === 4 ? digits : null;
}

/**
 * A four-digit code this team is not already using.
 *
 * Drawn at random rather than sequentially, and not because it is prettier: a sequential code
 * tells a student what next week's will be before it is issued, which is the same photograph
 * problem in a different form.
 *
 * `taken` can be every code the team has ever used, because the read path pulls whole tables
 * rather than the current season — so the client genuinely holds the full set rather than a
 * recent window of it. The unique index is still the guarantee; this is what stops it ever
 * being reached in normal use.
 *
 * Returns null if the space is exhausted, which a team would reach after ten thousand events.
 * Callers surface that rather than looping forever.
 */
export function generatePublicCode(
    taken: Iterable<string>,
    random: () => number = Math.random,
): string | null {
    const used = new Set(taken);
    if (used.size >= 10_000) return null;

    // Bounded rather than "until it finds one": with a full-ish set this could otherwise spin
    // for a long time on a phone. After the attempts, fall back to a scan, which always
    // terminates and is only ever reached when the space is nearly full.
    for (let attempt = 0; attempt < 50; attempt++) {
        const code = String(Math.floor(random() * 10_000)).padStart(4, '0');
        if (!used.has(code)) return code;
    }
    for (let n = 0; n < 10_000; n++) {
        const code = String(n).padStart(4, '0');
        if (!used.has(code)) return code;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface RecurrenceOptions {
    frequency: RecurrenceFrequency;
    /** Local date (ms) of the last day an occurrence may fall on, inclusive. */
    until: number;
}

/**
 * A cap on how many rows one save may create.
 *
 * A weekly series across a season is ~40. The cap exists because `until` comes from a date
 * picker and a mis-typed year would otherwise ask the client to generate — and the queue to
 * push — thousands of meetings, each with its own code, in one drain.
 */
export const MAX_OCCURRENCES = 60;

const FREQUENCY_RULE: Record<RecurrenceFrequency, string> = {
    weekly: 'FREQ=WEEKLY;INTERVAL=1',
    biweekly: 'FREQ=WEEKLY;INTERVAL=2',
    monthly: 'FREQ=MONTHLY;INTERVAL=1',
};

/** An iCalendar-flavoured rule string, stored on every occurrence it generated. */
export function recurrenceRuleFor(options: RecurrenceOptions): string {
    const until = new Date(options.until);
    const stamp = [
        until.getFullYear(),
        String(until.getMonth() + 1).padStart(2, '0'),
        String(until.getDate()).padStart(2, '0'),
    ].join('');
    return `${FREQUENCY_RULE[options.frequency]};UNTIL=${stamp}`;
}

/** Read a stored rule back, for the edit form. Null if it is not one of ours. */
export function parseRecurrenceRule(rule: string): RecurrenceOptions | null {
    if (!rule) return null;
    const parts = Object.fromEntries(
        rule.split(';').map((p) => {
            const [k, v] = p.split('=');
            return [k, v];
        }),
    );
    const untilMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(parts.UNTIL ?? '');
    if (!untilMatch) return null;

    const until = new Date(
        Number(untilMatch[1]),
        Number(untilMatch[2]) - 1,
        Number(untilMatch[3]),
        23,
        59,
        59,
    ).getTime();

    if (parts.FREQ === 'MONTHLY') return { frequency: 'monthly', until };
    if (parts.FREQ === 'WEEKLY') {
        return { frequency: parts.INTERVAL === '2' ? 'biweekly' : 'weekly', until };
    }
    return null;
}

/**
 * The start instants of every occurrence, first one included.
 *
 * Stepped with local-time date arithmetic (`setDate`/`setMonth`) rather than by adding
 * milliseconds, so a series that crosses a daylight-saving boundary still starts at 6pm on
 * the far side of it rather than at 5pm or 7pm. The whole app renders in local time; a build
 * session is at six o'clock, not at an instant.
 *
 * A monthly series on the 31st simply skips the months that have no 31st, rather than
 * silently landing on the 1st or the 28th — `setMonth` overflows, so the overflow is detected
 * and dropped.
 */
export function expandRecurrence(firstStart: number, options: RecurrenceOptions): number[] {
    const starts: number[] = [];
    const first = new Date(firstStart);
    const dayOfMonth = first.getDate();

    for (let index = 0; starts.length < MAX_OCCURRENCES; index++) {
        const next = new Date(firstStart);

        if (options.frequency === 'monthly') {
            next.setMonth(next.getMonth() + index);
            // February from a 31st: setMonth rolled it into March. Not this month's meeting.
            if (next.getDate() !== dayOfMonth) continue;
        } else {
            next.setDate(next.getDate() + index * (options.frequency === 'biweekly' ? 14 : 7));
        }

        if (next.getTime() > options.until) break;
        starts.push(next.getTime());

        // A monthly rule that keeps skipping (a 31st through a run of short months) must not
        // loop forever looking for the next one.
        if (options.frequency === 'monthly' && index > MAX_OCCURRENCES * 2) break;
    }

    return starts;
}

// ---------------------------------------------------------------------------
// Reading a roster
// ---------------------------------------------------------------------------

export interface AttendanceTally {
    present: number;
    excused: number;
    absent: number;
    /** On the roster and unrecorded. Never counted as absent. */
    unrecorded: number;
    /** Everyone the roster covers. */
    total: number;
}

/** Count a meeting's records against the size of the roster it was taken from. */
export function tallyAttendance(
    records: MeetingAttendance[],
    rosterSize: number,
): AttendanceTally {
    const tally: AttendanceTally = {
        present: 0,
        excused: 0,
        absent: 0,
        unrecorded: 0,
        total: rosterSize,
    };
    for (const record of records) tally[record.status]++;
    tally.unrecorded = Math.max(0, rosterSize - tally.present - tally.excused - tally.absent);
    return tally;
}

/**
 * A member's attendance rate across a set of meetings.
 *
 * Excused absences count as neither attended nor missed — they are removed from the
 * denominator. Counting them as misses would punish the exact case the state exists to
 * record, and counting them as attendance would make the number meaningless. Meetings with no
 * record for the member are not counted at all: a roster nobody saved is a fact about the
 * coach, not about the student.
 */
export function attendanceRate(records: MeetingAttendance[]): number | null {
    const counted = records.filter((r) => r.status !== 'excused');
    if (counted.length === 0) return null;
    return counted.filter((r) => r.status === 'present').length / counted.length;
}
