/**
 * FEAT-12 — a due date is a day, and says the same day everywhere.
 *
 * MY DEFINITION OF DONE (this ID has no block in `exit-criteria.md`; the plan's §8 line and the
 * FEAT report are all there is, so this is written by me and stated as mine):
 *
 *  1. A task due on the 15th renders as the 15th on the board, the list, the calendar and the
 *     dashboard's deadlines panel, at a negative UTC offset — the case that is wrong today —
 *     and at a positive one.
 *  2. The date input round-trips: pick the 15th, reopen, still the 15th.
 *  3. "Overdue" compares two values in the same frame, so a task due today is not overdue at
 *     any hour of the day in any zone.
 *  4. The suite runs at a negative offset AND at UTC, because a test that only runs at one is
 *     how this project has produced defects in both directions (`docs/failure-modes.md` §10).
 *
 * CI already runs the unit suite twice, under `TZ=UTC` and `TZ=America/Chicago`, so (4) is
 * satisfied by these tests existing — but only if they are actually sensitive to the zone, so
 * the first block sets the offset explicitly rather than trusting the runner to vary.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    dateOnlyDay,
    dateOnlyMonthShort,
    dateOnlyParts,
    formatDateOnly,
    isOverdue,
    toDateInputValue,
    todayAsDateOnly,
} from '../date-only';

/** Exactly what `<input type="date">.valueAsNumber` produces for 2026-09-15. */
const SEP_15 = Date.UTC(2026, 8, 15);

/**
 * Run a function as if the browser were in a given zone.
 *
 * `process.env.TZ` is what Node reads, and it is re-read per `Date` operation, so setting it
 * around the call is enough. This is the only way to make a timezone bug visible from a suite
 * that would otherwise run in whatever zone the machine happens to be in.
 */
function inZone<T>(tz: string, fn: () => T): T {
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
        return fn();
    } finally {
        process.env.TZ = previous;
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe('a date-only value names the same day in every zone', () => {
    it.each([
        ['America/Chicago', 'the zone this project’s users are in, and where it was wrong'],
        ['America/Los_Angeles', 'a bigger negative offset'],
        ['UTC', 'the zone where the bug was invisible'],
        ['Europe/Berlin', 'a positive offset'],
        ['Pacific/Kiritimati', '+14, the largest there is'],
    ])('renders 2026-09-15 as the 15th in %s (%s)', (tz) => {
        inZone(tz, () => {
            expect(dateOnlyDay(SEP_15), 'the day number moved').toBe(15);
            expect(dateOnlyParts(SEP_15)).toEqual({ year: 2026, month: 8, day: 15 });
            expect(dateOnlyMonthShort(SEP_15, 'en-US'), 'the month moved').toBe('Sep');
            expect(formatDateOnly(SEP_15, 'en-US'), 'the full date moved').toBe('9/15/2026');
            expect(toDateInputValue(SEP_15), 'the input would reopen on another day').toBe('2026-09-15');
        });
    });

    it('is exactly what the old code got wrong — the demonstration', () => {
        // Kept as a test rather than a comment so the claim stays true: if `Date`'s local
        // getters ever stopped disagreeing with the UTC ones at a negative offset, the fix
        // would be unnecessary and this would say so.
        inZone('America/Chicago', () => {
            expect(new Date(SEP_15).getDate(), 'the old renderers read this').toBe(14);
            expect(dateOnlyDay(SEP_15), 'and this is what the day actually is').toBe(15);
        });
    });

    it('has no opinion about a missing date', () => {
        expect(toDateInputValue(undefined)).toBe('');
        expect(toDateInputValue(null)).toBe('');
        expect(toDateInputValue(Number.NaN)).toBe('');
    });
});

describe('"overdue" compares like with like', () => {
    /** A moment on 15 Sep 2026 in the given zone, as the browser's clock would report it. */
    const at = (iso: string) => new Date(iso);

    it('does not call a task due today overdue, at any hour', () => {
        inZone('America/Chicago', () => {
            // 00:30 local on the 15th is 05:30 UTC on the 15th.
            expect(isOverdue(SEP_15, at('2026-09-15T05:30:00Z'))).toBe(false);
            // 23:30 local on the 15th is 04:30 UTC on the 16th — still the 15th where the
            // user is, which is the whole point.
            expect(isOverdue(SEP_15, at('2026-09-16T04:30:00Z'))).toBe(false);
        });
    });

    it('calls yesterday overdue', () => {
        inZone('America/Chicago', () => {
            expect(isOverdue(SEP_15, at('2026-09-16T14:00:00Z'))).toBe(true);
        });
    });

    it('does not call tomorrow overdue', () => {
        inZone('America/Chicago', () => {
            expect(isOverdue(SEP_15, at('2026-09-14T14:00:00Z'))).toBe(false);
        });
    });

    it('has no opinion about a task with no due date', () => {
        expect(isOverdue(undefined)).toBe(false);
    });

    it('reads today from the LOCAL calendar, not the UTC one', () => {
        inZone('America/Chicago', () => {
            // 22:00 local on the 15th = 03:00 UTC on the 16th. "Today" is the 15th.
            expect(todayAsDateOnly(at('2026-09-16T03:00:00Z'))).toBe(SEP_15);
        });
    });
});
