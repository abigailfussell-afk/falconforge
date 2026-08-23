/**
 * The paste parser (D2), and the ways it can be wrong.
 *
 * D2 calls the preview-and-confirm step **load-bearing** — *"the parser is heuristic (pasted
 * text has no table structure, and team names contain digits), so the preview-and-confirm step
 * is load-bearing and an import must never write silently."* These tests are the other half of
 * that sentence: they pin what the parser gets right, and — more usefully — what it says it is
 * unsure about.
 *
 * THE REAL ROW, verified 2026-08-23 against `ftc-events.firstinspires.org/<year>/<code>/
 * qualifications`, is the fixture everything else varies from:
 *
 *     Qualification 1 Sat 2/21 - 11:42 AM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas 108 11
 *
 * A parser test that only ever sees that row is a parser test that proves nothing, so most of
 * this file is the cases that row does not contain: names with digits in them, surrogates,
 * missing times, an unplayed match with no scores, and the paste that is not a schedule at all.
 */
import { describe, it, expect } from 'vitest';
import { parseSchedule, summarise } from '@/lib/schedule-parse';

const REAL_ROW =
    'Qualification 1 Sat 2/21 - 11:42 AM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas 108 11';

describe('the row from the actual FIRST page', () => {
    it('reads four teams, red then blue, in station order', () => {
        const { matches } = parseSchedule(REAL_ROW, 2);

        expect(matches).toHaveLength(1);
        expect(matches[0].matchNumber).toBe(1);
        expect(matches[0].phase).toBe('qualification');
        expect(matches[0].participants).toEqual([
            { alliance: 'red', station: 1, teamNumber: '22857', teamName: 'Mechanical Mustangs', isSurrogate: false },
            { alliance: 'red', station: 2, teamNumber: '8424', teamName: 'Cyber Eagles', isSurrogate: false },
            { alliance: 'blue', station: 1, teamNumber: '15654', teamName: 'Nanoknights', isSurrogate: false },
            { alliance: 'blue', station: 2, teamNumber: '25756', teamName: 'Nano Ninjas', isSurrogate: false },
        ]);
    });

    it('keeps the time as text rather than parsing it', () => {
        const { matches } = parseSchedule(REAL_ROW, 2);
        expect(matches[0].scheduledText).toBe('Sat 2/21 - 11:42 AM');
    });

    /*
     * THE MOST DANGEROUS AMBIGUITY ON THE PAGE, and the reason this file exists.
     *
     * `108` and `11` are the red and blue SCORES, and both are valid FTC team numbers. A parser
     * that read them as teams would put six robots in a 2v2 match — or, worse, drop the last
     * real team and substitute a score. Position is what resolves it: red then blue, in station
     * order, before any scores.
     */
    it('does not mistake the trailing scores for teams, and says it saw them', () => {
        const { matches } = parseSchedule(REAL_ROW, 2);

        expect(matches[0].participants.map((p) => p.teamNumber)).not.toContain('108');
        expect(matches[0].participants.map((p) => p.teamNumber)).not.toContain('11');
        expect(matches[0].warnings.join(' ')).toContain('108');
        expect(matches[0].warnings.join(' ')).toContain('usually the scores');
    });

    /*
     * The time column contains 2, 21, 11 and 42 — three of them valid FTC team numbers. Removing
     * the fragment is what makes the parser's correctness independent of which teams happen to
     * be at the event, and this asserts it on the row where it matters.
     */
    it('does not read the date and time as team numbers', () => {
        const { matches } = parseSchedule(REAL_ROW, 2);
        const numbers = matches[0].participants.map((p) => p.teamNumber);
        expect(numbers).not.toContain('2');
        expect(numbers).not.toContain('21');
        expect(numbers).not.toContain('42');
    });
});

describe('the cases the real row does not contain', () => {
    /*
     * THE ONE D2 NAMES: "team names contain digits". Every name here is plausible and three of
     * them are real FTC team names in spirit. This is where a "read words until the next
     * number" parser silently produces the wrong alliance.
     */
    it('names with digits in them do not become extra teams', () => {
        const line =
            'Qualification 7 Sat 2/21 - 1:05 PM 4321 Team 5 Robotics 9999 RoboHawks 2.0 1234 24 Karat 5678 Circuit Breakers 0 0';
        const { matches } = parseSchedule(line, 2);

        expect(matches).toHaveLength(1);
        const numbers = matches[0].participants.map((p) => p.teamNumber);
        expect(numbers).toEqual(['4321', '5', '9999', '2']);
        /*
         * ...and that is WRONG, deliberately asserted as wrong.
         *
         * There is no rule that separates "5" in "Team 5 Robotics" from a real team 5, because
         * team 5 exists. The parser cannot get this right and does not claim to; what it must
         * do is notice that something is off and say so, which is what the coach acts on. If a
         * later change makes this case parse correctly, this assertion SHOULD fail — and
         * whoever changes it should read D2 first and make sure the preview still leads.
         */
        expect(matches[0].warnings.length).toBeGreaterThan(0);
    });

    it('a surrogate is flagged rather than imported as an ordinary team', () => {
        const line =
            'Qualification 12 Sat 2/21 - 2:30 PM 22857 Mechanical Mustangs 8424 *Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas';
        const { matches } = parseSchedule(line, 2);

        const flagged = matches[0].participants.find((p) => p.teamNumber === '8424');
        expect(flagged!.isSurrogate).toBe(true);
        expect(flagged!.teamName).toBe('Cyber Eagles');
        expect(matches[0].warnings.join(' ')).toContain('surrogate');
    });

    it('an unplayed match with no scores parses without a spurious warning', () => {
        const line =
            'Qualification 30 Sun 2/22 - 9:00 AM 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas';
        const { matches } = parseSchedule(line, 2);

        expect(matches[0].participants).toHaveLength(4);
        expect(matches[0].warnings.join(' ')).not.toContain('usually the scores');
    });

    it('a line with too few teams is skipped, with the reason', () => {
        const line = 'Qualification 3 Sat 2/21 - 12:00 PM 22857 Mechanical Mustangs';
        const { matches, skipped } = parseSchedule(line, 2);

        expect(matches).toHaveLength(0);
        expect(skipped).toHaveLength(1);
        expect(skipped[0].reason).toContain('expected 4');
    });

    it('a missing time is a warning, not a refusal', () => {
        const line =
            'Qualification 4 22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas';
        const { matches } = parseSchedule(line, 2);

        expect(matches).toHaveLength(1);
        expect(matches[0].scheduledText).toBe('');
        expect(matches[0].warnings.join(' ')).toContain('No time');
    });

    /*
     * FRC IS 3v3 (D3's knock-on, and the reason participants are rows rather than four
     * columns). No FRC behaviour is built, but the parser is where the assumption would
     * otherwise be baked in, so it takes the alliance size from the game definition.
     */
    it('reads three per alliance when told to', () => {
        const line =
            'Qualification 1 Sat 2/21 - 11:42 AM 254 Cheesy Poofs 1114 Simbotics 971 Spartan Robotics 118 Robonauts 1678 Citrus Circuits 2056 OP Robotics';
        const { matches } = parseSchedule(line, 3);

        expect(matches[0].participants.filter((p) => p.alliance === 'red')).toHaveLength(3);
        expect(matches[0].participants.filter((p) => p.alliance === 'blue')).toHaveLength(3);
        expect(matches[0].participants.map((p) => p.station)).toEqual([1, 2, 3, 1, 2, 3]);
    });

    it('the same team twice in one match is called out', () => {
        const line =
            'Qualification 9 Sat 2/21 - 3:00 PM 22857 Mechanical Mustangs 22857 Mechanical Mustangs 15654 Nanoknights 25756 Nano Ninjas';
        const { matches } = parseSchedule(line, 2);

        expect(matches[0].warnings.join(' ')).toContain('twice');
    });
});

describe('what is not a schedule', () => {
    /*
     * "Nothing was recognised" and "nothing was found" are different sentences to a coach who
     * has just pasted the wrong tab — `docs/failure-modes.md` §4, the zero case being the first
     * case rather than an edge one.
     */
    it('an unrelated paste reports that nothing was recognised', () => {
        const result = parseSchedule('Team rankings\n1  22857  Mechanical Mustangs  36  12-0-0', 2);

        expect(result.matches).toHaveLength(0);
        expect(result.unrecognised).toBe(true);
    });

    it('an empty paste is unrecognised rather than an error', () => {
        const result = parseSchedule('   \n\n  ', 2);
        expect(result.matches).toHaveLength(0);
        expect(result.unrecognised).toBe(true);
    });

    it('a schedule with one unusable row is recognised, not rejected wholesale', () => {
        const text = [REAL_ROW, 'Qualification 2 Sat 2/21 - 11:55 AM 22857 Only One Team'].join('\n');
        const result = parseSchedule(text, 2);

        expect(result.unrecognised).toBe(false);
        expect(result.matches).toHaveLength(1);
        expect(result.skipped).toHaveLength(1);
    });
});

describe('phases and multiple rows', () => {
    it('reads practice, qualification and playoff labels', () => {
        const rows = ['Practice 1', 'Qualification 2', 'Playoff 3', 'Elimination 4', 'Final 5'].map(
            (label) =>
                `${label} Sat 2/21 - 11:42 AM 22857 A Team 8424 B Team 15654 C Team 25756 D Team`,
        );
        const { matches } = parseSchedule(rows.join('\n'), 2);

        expect(matches.map((m) => m.phase)).toEqual([
            'practice',
            'qualification',
            'playoff',
            'playoff',
            'playoff',
        ]);
    });

    it('keeps every row of a real multi-match paste', () => {
        const text = Array.from(
            { length: 12 },
            (_, i) =>
                `Qualification ${i + 1} Sat 2/21 - 11:${String(10 + i).padStart(2, '0')} AM ` +
                '22857 Mechanical Mustangs 8424 Cyber Eagles 15654 Nanoknights 25756 Nano Ninjas',
        ).join('\n');
        const { matches } = parseSchedule(text, 2);

        expect(matches).toHaveLength(12);
        expect(matches.map((m) => m.matchNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
});

describe('the line above the Import button', () => {
    it('counts our own matches, which is the number the coach came for', () => {
        const text = [
            REAL_ROW,
            'Qualification 2 Sat 2/21 - 11:55 AM 111 Alpha 222 Beta 333 Gamma 444 Delta',
        ].join('\n');

        const s = summarise(parseSchedule(text, 2), '22857');
        expect(s.matchCount).toBe(2);
        expect(s.ourMatchCount).toBe(1);
    });

    it('reports zero of ours without pretending the paste was empty', () => {
        const s = summarise(parseSchedule(REAL_ROW, 2), '99999');
        expect(s.matchCount).toBe(1);
        expect(s.ourMatchCount).toBe(0);
    });
});
