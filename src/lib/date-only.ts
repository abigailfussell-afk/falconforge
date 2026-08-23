/**
 * Dates that are a DAY, not an instant (FEAT-12).
 *
 * A task's due date is "the 15th", not "midnight UTC on the 15th". The two are the same thing
 * only at UTC+0, and this project's users are in US Central.
 *
 * WHAT WENT WRONG
 *
 * `<input type="date">.valueAsNumber` is UTC midnight of the day chosen, and the store keeps
 * that number. Every renderer then read it with LOCAL parts —
 * `new Date(ms).toLocaleDateString()`, `.getDate()`, `.toLocaleString('default', {month})` —
 * and at any negative offset local parts of UTC midnight are the previous day. So a task due
 * on the 15th said "9/14/2026" on the board, in the list, on the calendar and in the
 * dashboard's deadlines panel: four renderers, one wrong assumption, inherited faithfully by
 * each new one (`docs/failure-modes.md` §10, and §1 — four copies of the same read).
 *
 * WHY THE FIX IS HERE AND NOT AT THE FOUR CALL SITES
 *
 * Because there were four call sites. A fifth is the next screen somebody adds, and it will be
 * written by copying one of the others. The rule is now expressible in one place: a date-only
 * value is read with UTC getters, always, and never handed to a locale formatter that will
 * apply a timezone to it.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not change the storage format. `due_date` is a `timestamptz` holding UTC midnight and
 * every device already agrees on that number; migrating the column to `date` is a schema change
 * on a frozen schema for no behavioural gain. The bug was never the number — it was reading it.
 */

/** The calendar day a date-only value stands for, in UTC — which is the only frame it has. */
export function dateOnlyParts(ms: number): { year: number; month: number; day: number } {
    const d = new Date(ms);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

/**
 * `YYYY-MM-DD`, for `<input type="date">`.
 *
 * `toISOString().slice(0, 10)` gives the same answer and is what the modal used; this exists so
 * the input and the renderers are visibly reading the same clock, rather than agreeing by
 * accident.
 */
export function toDateInputValue(ms: number | undefined | null): string {
    if (ms === undefined || ms === null || Number.isNaN(ms)) return '';
    const { year, month, day } = dateOnlyParts(ms);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The day number, e.g. `15`. What the calendar and the dashboard tiles print big.
 */
export function dateOnlyDay(ms: number): number {
    return dateOnlyParts(ms).day;
}

/**
 * A short month name in the viewer's locale, e.g. `Sep`.
 *
 * Formatted with `timeZone: 'UTC'` rather than by indexing an English array: the month name is
 * a presentation choice the browser should make, and the previous code already asked it to —
 * it just asked about the wrong instant.
 */
export function dateOnlyMonthShort(ms: number, locale?: string): string {
    return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(new Date(ms));
}

/** The whole date in the viewer's locale, e.g. `9/15/2026`. */
export function formatDateOnly(ms: number, locale?: string): string {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC' }).format(new Date(ms));
}

/**
 * Today, as a date-only value — for comparing against one.
 *
 * `new Date().setHours(0,0,0,0)` is local midnight, which is a different NUMBER from the UTC
 * midnight a due date holds, so comparing the two made "overdue" wrong by up to a day in both
 * directions. Both sides of the comparison have to be in the same frame, and for a date-only
 * value that frame is UTC.
 *
 * `now` is injectable so a test can stand at a day boundary without waiting for one.
 */
export function todayAsDateOnly(now: Date = new Date()): number {
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Is this date-only value strictly before today? */
export function isOverdue(ms: number | undefined, now: Date = new Date()): boolean {
    if (ms === undefined) return false;
    return ms < todayAsDateOnly(now);
}
