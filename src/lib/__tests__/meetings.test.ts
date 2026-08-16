/**
 * Sprint 8 — the rules of the schedule, without a component in sight.
 *
 * The interesting assertions here are not "does the helper return a number". They are the
 * three properties the whole design rests on, each of which is easy to break with an edit
 * that looks like a simplification:
 *
 *   1. Every occurrence of a series gets its OWN code. A shared or derived code would let
 *      one photograph of one poster check somebody in for a whole term.
 *   2. A default check-in window is derived, never stored, so moving a meeting moves its
 *      window — and the client's copy of that derivation matches the database's, which is
 *      asserted by reading the numbers back out of the migration.
 *   3. An excused absence is not a miss. It leaves the denominator rather than counting
 *      against the student, which is the entire reason the state exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    CHECKIN_OPENS_BEFORE_MS,
    CHECKIN_FALLBACK_DURATION_MS,
    checkinWindow,
    checkinState,
    formatCode,
    parseCode,
    generatePublicCode,
    expandRecurrence,
    recurrenceRuleFor,
    parseRecurrenceRule,
    eventTypeMeta,
    tracksAttendance,
    nextAttendanceStatus,
    tallyAttendance,
    attendanceRate,
    MAX_OCCURRENCES,
    EVENT_TYPES,
} from '@/lib/meetings';
import type { Meeting, MeetingAttendance } from '@/types';

const HOUR = 60 * 60_000;

const meeting = (over: Partial<Meeting> = {}): Meeting => ({
    id: 'm1',
    title: 'Build session',
    description: '',
    location: 'Room 214',
    eventType: 'build',
    publicCode: '0842',
    attendanceRequired: true,
    startsAt: new Date('2026-08-17T18:00:00Z').getTime(),
    endsAt: new Date('2026-08-17T20:30:00Z').getTime(),
    recurrenceRule: '',
    seriesId: '',
    createdBy: 'member-1',
    seasonId: 'season-1',
    ...over,
});

const record = (over: Partial<MeetingAttendance> = {}): MeetingAttendance => ({
    id: crypto.randomUUID(),
    meetingId: 'm1',
    teamMemberId: 'member-1',
    status: 'present',
    method: 'coach',
    notes: '',
    attestedBy: 'member-2',
    ...over,
});

describe('the check-in window', () => {
    it('opens 15 minutes before the start and closes at the end, by default', () => {
        const m = meeting();
        const { opensAt, closesAt } = checkinWindow(m);

        expect(opensAt).toBe(m.startsAt - 15 * 60_000);
        expect(closesAt).toBe(m.endsAt);
    });

    it('bounds a meeting with no end time rather than leaving the code alive forever', () => {
        const m = meeting({ endsAt: undefined });
        expect(checkinWindow(m).closesAt).toBe(m.startsAt + 4 * HOUR);
    });

    it('uses an explicit override in preference to either default', () => {
        const m = meeting({
            checkinOpensAt: 1_000_000,
            checkinClosesAt: 2_000_000,
        });
        expect(checkinWindow(m)).toEqual({ opensAt: 1_000_000, closesAt: 2_000_000 });
    });

    it('moves the window when the meeting moves, unless it was overridden', () => {
        // The property that made NULL-means-default worth choosing over storing the derived
        // value plus an `is_overridden` flag.
        const original = meeting();
        const moved = meeting({ startsAt: original.startsAt + 2 * HOUR, endsAt: original.endsAt! + 2 * HOUR });
        expect(checkinWindow(moved).opensAt).toBe(checkinWindow(original).opensAt + 2 * HOUR);

        const pinned = meeting({
            startsAt: original.startsAt + 2 * HOUR,
            checkinOpensAt: checkinWindow(original).opensAt,
        });
        expect(checkinWindow(pinned).opensAt).toBe(checkinWindow(original).opensAt);
    });

    it('reports not-open, open and closed around the window', () => {
        const m = meeting();
        const { opensAt, closesAt } = checkinWindow(m);

        expect(checkinState(m, opensAt - 1)).toBe('not_open');
        expect(checkinState(m, opensAt)).toBe('open');
        expect(checkinState(m, m.startsAt)).toBe('open');
        expect(checkinState(m, closesAt)).toBe('open');
        expect(checkinState(m, closesAt + 1)).toBe('closed');
    });

    it('reports no check-in at all for a deadline or an untracked event', () => {
        expect(checkinState(meeting({ eventType: 'deadline', publicCode: '' }))).toBe('none');
        expect(checkinState(meeting({ publicCode: '' }))).toBe('none');
    });

    /**
     * THE ONE THAT STOPS THE TWO COPIES DRIFTING.
     *
     * `meeting_checkin_opens`/`meeting_checkin_closes` compute the same two numbers in SQL,
     * because the server is what DECIDES (it judges against `now()`) and the client is what
     * RENDERS "check-in opens 5:45 PM" offline hours earlier. Neither can be deleted, so the
     * only thing left to guarantee is that they agree — and a comment asking a future editor
     * to keep them in step is how they stop being in step.
     */
    it('agrees with the intervals the migration uses', () => {
        const sql = readFileSync(
            resolve(__dirname, '../../../supabase/migrations/20260820000000_v2_meetings.sql'),
            'utf8',
        );

        const opens = /meeting_checkin_opens[\s\S]*?starts_at - interval '(\d+) minutes'/.exec(sql);
        expect(opens, 'meeting_checkin_opens no longer subtracts an interval from starts_at')
            .not.toBeNull();
        expect(Number(opens![1]) * 60_000).toBe(CHECKIN_OPENS_BEFORE_MS);

        const closes = /meeting_checkin_closes[\s\S]*?starts_at \+ interval '(\d+) hours'/.exec(sql);
        expect(closes, 'meeting_checkin_closes no longer has a fallback duration').not.toBeNull();
        expect(Number(closes![1]) * HOUR).toBe(CHECKIN_FALLBACK_DURATION_MS);
    });
});

describe('codes', () => {
    it('formats and parses the way the poster prints it', () => {
        expect(formatCode('0842')).toBe('FF-0842');
        expect(formatCode('')).toBe('');
    });

    it('accepts whatever a student plausibly types', () => {
        // Forgiving on purpose, and no more forgiving than the RPC, which strips non-digits
        // the same way. A client that were stricter would refuse codes the server accepts.
        for (const input of ['0842', 'FF-0842', 'ff 0842', ' FF-0842 ', 'FF–0842']) {
            expect(parseCode(input), input).toBe('0842');
        }
    });

    it('rejects anything that is not exactly four digits', () => {
        for (const input of ['', '084', '08421', 'FFFF', 'FF-084']) {
            expect(parseCode(input), input).toBeNull();
        }
    });

    it('never returns a code the team already holds', () => {
        const taken = new Set(['0842', '0849', '0856']);
        for (let i = 0; i < 200; i++) {
            const code = generatePublicCode(taken)!;
            expect(taken.has(code)).toBe(false);
            expect(code).toMatch(/^\d{4}$/);
        }
    });

    it('still finds a code when random draws keep colliding', () => {
        // A rigged generator that always proposes a taken code: the bounded random phase
        // gives up and the scan finds the gap, rather than spinning on a phone forever.
        const taken = new Set(['0000']);
        expect(generatePublicCode(taken, () => 0)).toBe('0001');
    });

    it('returns null rather than looping when the space is exhausted', () => {
        const all = new Set(Array.from({ length: 10_000 }, (_, n) => String(n).padStart(4, '0')));
        expect(generatePublicCode(all)).toBeNull();
    });
});

describe('recurrence', () => {
    const start = new Date(2026, 7, 17, 18, 0).getTime(); // Mon 17 Aug 2026, 6pm local

    it('lands on the same weekday every week, first occurrence included', () => {
        const until = new Date(2026, 8, 14, 23, 59).getTime();
        const starts = expandRecurrence(start, { frequency: 'weekly', until });

        expect(starts).toHaveLength(5); // 17, 24, 31 Aug; 7, 14 Sep
        for (const s of starts) {
            expect(new Date(s).getDay()).toBe(1);
            expect(new Date(s).getHours()).toBe(18);
        }
    });

    it('steps a fortnight at a time when asked', () => {
        const until = new Date(2026, 8, 14, 23, 59).getTime();
        const starts = expandRecurrence(start, { frequency: 'biweekly', until });
        expect(starts).toHaveLength(3); // 17, 31 Aug; 14 Sep
    });

    it('keeps the local hour across a daylight-saving boundary', () => {
        /*
         * A series stepped by adding 7*24*60*60*1000 lands an hour out the moment the clocks
         * change, so a 6pm build session becomes a 5pm or 7pm one halfway through the term.
         * Stepping with `setDate` keeps the wall-clock time, which is what "six o'clock"
         * means to everybody involved.
         *
         * Asserted against whatever the test machine's zone does rather than a hardcoded
         * date, so it is meaningful in CI (UTC, no transition) and locally (US Central, two).
         */
        const october = new Date(2026, 9, 5, 18, 0).getTime();
        const starts = expandRecurrence(october, {
            frequency: 'weekly',
            until: new Date(2026, 10, 30, 23, 59).getTime(),
        });

        expect(starts.length).toBeGreaterThan(6);
        for (const s of starts) {
            expect(new Date(s).getHours(), new Date(s).toString()).toBe(18);
        }
    });

    it('skips the months that have no such date rather than sliding to the 1st', () => {
        const jan31 = new Date(2027, 0, 31, 18, 0).getTime();
        const starts = expandRecurrence(jan31, {
            frequency: 'monthly',
            until: new Date(2027, 5, 30, 23, 59).getTime(),
        });

        // Jan 31, Mar 31, May 31. February, April and June have no 31st, and a meeting
        // silently moved to the 1st or the 28th is worse than one that does not exist.
        expect(starts.map((s) => new Date(s).getMonth())).toEqual([0, 2, 4]);
        for (const s of starts) expect(new Date(s).getDate()).toBe(31);
    });

    it('caps how many rows one save can create', () => {
        // `until` comes from a date picker, so a mis-typed year would otherwise ask the queue
        // to push thousands of meetings, each with its own code, in a single drain.
        const starts = expandRecurrence(start, {
            frequency: 'weekly',
            until: new Date(2050, 0, 1).getTime(),
        });
        expect(starts).toHaveLength(MAX_OCCURRENCES);
    });

    it('round-trips a rule through the edit form', () => {
        const until = new Date(2026, 11, 14, 23, 59, 59).getTime();
        for (const frequency of ['weekly', 'biweekly', 'monthly'] as const) {
            const rule = recurrenceRuleFor({ frequency, until });
            const parsed = parseRecurrenceRule(rule)!;
            expect(parsed.frequency, rule).toBe(frequency);
            expect(new Date(parsed.until).getDate()).toBe(14);
            expect(new Date(parsed.until).getMonth()).toBe(11);
        }
    });

    it('returns null for a rule it did not write', () => {
        expect(parseRecurrenceRule('')).toBeNull();
        expect(parseRecurrenceRule('FREQ=YEARLY;UNTIL=20261214')).toBeNull();
        expect(parseRecurrenceRule('FREQ=WEEKLY')).toBeNull();
    });
});

describe('event types', () => {
    it('has one entry per value the database allows', () => {
        expect(EVENT_TYPES.map((t) => t.type)).toEqual([
            'practice', 'team_meeting', 'build', 'competition',
            'outreach', 'fundraiser', 'deadline',
        ]);
    });

    it('falls back to a renderable type rather than an undefined-shaped hole', () => {
        expect(eventTypeMeta('something_new' as never).type).toBe('team_meeting');
    });

    it('says a deadline takes no attendance', () => {
        expect(tracksAttendance({ eventType: 'deadline' })).toBe(false);
        for (const t of EVENT_TYPES.filter((t) => t.type !== 'deadline')) {
            expect(tracksAttendance({ eventType: t.type }), t.type).toBe(true);
        }
    });
});

describe('reading a roster', () => {
    it('cycles present -> excused -> absent -> present', () => {
        expect(nextAttendanceStatus(undefined)).toBe('present');
        expect(nextAttendanceStatus('present')).toBe('excused');
        expect(nextAttendanceStatus('excused')).toBe('absent');
        expect(nextAttendanceStatus('absent')).toBe('present');
    });

    it('counts the unrecorded rather than calling them absent', () => {
        const tally = tallyAttendance(
            [record(), record(), record({ status: 'excused' }), record({ status: 'absent' })],
            21,
        );

        expect(tally).toEqual({ present: 2, excused: 1, absent: 1, unrecorded: 17, total: 21 });
    });

    it('never reports a negative unrecorded count', () => {
        // More records than roster: somebody left the team after their attendance was taken.
        const tally = tallyAttendance([record(), record(), record()], 2);
        expect(tally.unrecorded).toBe(0);
    });

    it('leaves an excused absence out of the rate rather than counting it against anyone', () => {
        // Two of three attended, one excused: 2/2, not 2/3. Counting the excusal as a miss
        // would punish exactly the case the state exists to record.
        const rate = attendanceRate([record(), record(), record({ status: 'excused' })]);
        expect(rate).toBe(1);

        expect(attendanceRate([record(), record({ status: 'absent' })])).toBe(0.5);
    });

    it('reports no rate at all rather than 0% when there is nothing to count', () => {
        // A student with no records has not missed anything. "0%" would be a claim about
        // them; it is in fact a fact about the coach who never saved a roster.
        expect(attendanceRate([])).toBeNull();
        expect(attendanceRate([record({ status: 'excused' })])).toBeNull();
    });
});
