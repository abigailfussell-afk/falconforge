/**
 * Dates and times for the schedule, formatted once.
 *
 * ALL OF THIS IS LOCAL TIME, DELIBERATELY AND CONSISTENTLY.
 *
 * A meeting is stored as a real instant (`timestamptz`), so `new Date(ts).getHours()` is the
 * hour the meeting happens in the reader's own zone, which is what "six o'clock" means to
 * everybody involved. That is worth stating because the app already has the opposite bug
 * elsewhere: task due dates are stored as UTC midnight and rendered with local getters, so a
 * date picked as the 19th displays as the 18th anywhere west of Greenwich (in the plan's
 * parking lot since Sprint 5.5). Nothing here shares that shape — every value below comes from
 * a genuine instant, and every input is composed back into one from local parts.
 */

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

/** `6:04 PM` — a check-in timestamp, or one end of a range. */
export function formatClock(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, TIME);
}

/**
 * `6:00–8:30 PM`, collapsing the meridiem when both ends share one.
 *
 * A meeting with no end time is just its start. The en dash is the typographic one the
 * mockups use, not a hyphen.
 */
export function formatTimeRange(startsAt: number, endsAt?: number): string {
    const start = new Date(startsAt);
    if (endsAt === undefined) return formatClock(startsAt);

    const end = new Date(endsAt);
    const sameHalf = start.getHours() < 12 === end.getHours() < 12;
    const startText = sameHalf
        ? start.toLocaleTimeString(undefined, TIME).replace(/\s*[AP]M$/i, '')
        : formatClock(startsAt);

    return `${startText}–${formatClock(endsAt)}`;
}

/** `MON` / `17` / `AUG` — the date block down the left of a schedule row. */
export function formatDayBadge(ts: number): { weekday: string; day: string; month: string } {
    const date = new Date(ts);
    return {
        weekday: date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
        day: String(date.getDate()),
        month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
    };
}

/** `Mon Aug 17, 2026` — a full date, for a detail header. */
export function formatFullDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

/** `Monday, August 17` — the poster's line, which has room to be spelled out. */
export function formatLongDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });
}

/**
 * `in 26 hours`, `in 12 minutes`, `2 days ago` — how far off something is.
 *
 * Used for "check-in opens in …" and the schedule's next-up card. Coarse on purpose: nobody
 * needs "in 1 hour and 47 minutes", and a value that changes every second is a value that
 * makes a screen feel broken when it does not re-render.
 */
export function formatRelative(ts: number, now: number = Date.now()): string {
    const seconds = Math.round((ts - now) / 1000);
    const absolute = Math.abs(seconds);

    const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
        absolute < 60 ? [seconds, 'second']
        : absolute < 3600 ? [Math.round(seconds / 60), 'minute']
        : absolute < 86_400 ? [Math.round(seconds / 3600), 'hour']
        : [Math.round(seconds / 86_400), 'day'];

    return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(amount, unit);
}

/** True when the instant falls on today's date, locally. */
export function isToday(ts: number, now: number = Date.now()): boolean {
    return isSameDay(ts, now);
}

export function isSameDay(a: number, b: number): boolean {
    const first = new Date(a);
    const second = new Date(b);
    return (
        first.getFullYear() === second.getFullYear() &&
        first.getMonth() === second.getMonth() &&
        first.getDate() === second.getDate()
    );
}

/** Midnight at the start of this instant's local day. */
export function startOfDay(ts: number): number {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

// ---------------------------------------------------------------------------
// Form inputs
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM-DD` for an `<input type="date">`, built from LOCAL parts.
 *
 * `toISOString().slice(0, 10)` is the tempting one-liner and it is wrong: it converts to UTC
 * first, so an evening meeting anywhere west of Greenwich shows tomorrow's date in the form
 * that is supposed to be showing its own.
 */
export function toDateInput(ts: number): string {
    const date = new Date(ts);
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

/** `HH:MM` for an `<input type="time">`, also local. */
export function toTimeInput(ts: number): string {
    const date = new Date(ts);
    return [
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
    ].join(':');
}

/**
 * A date field and a time field back into one instant.
 *
 * Composed with the `Date(y, m, d, h, min)` constructor, which reads its arguments as local
 * time — the round trip with the two functions above is exact, which is the property that
 * stops a meeting drifting an hour every time somebody opens the form and saves it.
 */
export function fromDateTimeInputs(dateValue: string, timeValue: string): number | null {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(timeValue);
    if (!dateMatch || !timeMatch) return null;

    return new Date(
        Number(dateMatch[1]),
        Number(dateMatch[2]) - 1,
        Number(dateMatch[3]),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
        0,
        0,
    ).getTime();
}
