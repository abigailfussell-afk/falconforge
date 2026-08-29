/**
 * P-02 — the arithmetic behind the summary table.
 *
 * The scouting feature recorded and could not summarise, which the assessment rates as the thing
 * that will decide whether beta teams use it at their first meet. These are the numbers the table
 * shows, tested away from the rendering, because a wrong mean is wrong whatever it looks like.
 *
 * THE THREE THAT ARE NOT ARITHMETIC and are the reason this file is worth reading:
 *
 *   - a non-number is NULL, never 0. B18 put five fabricated zeroes into production scouting
 *     data by coercing an empty input, and a mean with a phantom zero in it is a team's rating
 *     halved by a field somebody did not fill in.
 *   - nulls sort LAST in both directions. A team with no usable number has not scored badly —
 *     nobody measured — and sorting them to the top of a descending "best auto" list is
 *     `docs/failure-modes.md` §4, absence read as a value.
 *   - team numbers compare NUMERICALLY. `localeCompare` puts 10 before 9, and a scouting lead
 *     reading a list of team numbers notices that immediately.
 */
import { describe, it, expect } from 'vitest';
import {
    aggregate,
    compareTeamNumbers,
    eventKeyOf,
    eventsIn,
    metricValue,
    sortSummaries,
    stdDev,
    summariseByTeam,
} from '../scouting-metrics';
import type { GameDefinition } from '../game-definition';
import type { ScoutingReport } from '../../types';

/** A two-metric game: one mean, one max. Enough to prove the aggregate is read per metric. */
const GAME = {
    id: 'test-game',
    program: 'ftc',
    seasonKey: '2026-27',
    title: 'TESTGAME',
    version: 1,
    match: { allianceSize: 2, phases: [] },
    field: { image: 'x.png', width: 10, height: 10 },
    scouting: { match: { sections: [] } },
    scoring: {
        metrics: [
            { key: 'auto', label: 'Auto', field: 'autoScore', aggregate: 'mean' },
            { key: 'best', label: 'Best', field: 'autoScore', aggregate: 'max' },
        ],
    },
    planner: { partnerCapabilities: [] },
} as unknown as GameDefinition;

const report = (over: Partial<ScoutingReport> = {}): ScoutingReport => ({
    id: crypto.randomUUID(),
    teamNumber: '1',
    data: {},
    seasonId: 's1',
    createdAt: 1,
    ...over,
} as ScoutingReport);

describe('metricValue', () => {
    it('reads a finite number', () => {
        expect(metricValue(report({ data: { autoScore: 12 } }), 'autoScore')).toBe(12);
        expect(metricValue(report({ data: { autoScore: 0 } }), 'autoScore')).toBe(0);
    });

    it('is NULL for anything that is not a number, never 0', () => {
        // Each of these is a real shape from the jsonb bag: a missing key, a text field, a
        // checkbox, and the NaN an emptied numeric input produces. B18 is what coercion costs.
        for (const value of [undefined, null, 'twelve', true, NaN]) {
            expect(metricValue(report({ data: { autoScore: value } }), 'autoScore')).toBeNull();
        }
    });
});

describe('aggregate and stdDev', () => {
    it('means, maxes and sums', () => {
        expect(aggregate([2, 4, 6], 'mean')).toBe(4);
        expect(aggregate([2, 9, 6], 'max')).toBe(9);
        expect(aggregate([2, 4, 6], 'sum')).toBe(12);
    });

    it('is null for an empty set rather than 0', () => {
        expect(aggregate([], 'mean')).toBeNull();
        expect(aggregate([], 'max')).toBeNull();
        expect(aggregate([], 'sum')).toBeNull();
        expect(stdDev([])).toBeNull();
    });

    it('computes the POPULATION standard deviation', () => {
        /*
         * Population, not sample: these are all the matches that were scouted, not a sample
         * drawn from them, and the sample form is undefined at n = 1 — which is the first
         * event of every season. σ of [2,4,4,4,5,5,7,9] is exactly 2 by the population formula
         * and ≈2.14 by the sample one, so this number distinguishes them.
         */
        expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
        expect(stdDev([5])).toBe(0);
    });
});

describe('summariseByTeam', () => {
    const reports = [
        report({ teamNumber: '9', data: { autoScore: 10 }, createdAt: 3 }),
        report({ teamNumber: '9', data: { autoScore: 20 }, createdAt: 1 }),
        report({ teamNumber: '10', data: { autoScore: 5 }, createdAt: 2 }),
    ];

    it('gives one row per team with every metric the game declares', () => {
        const rows = summariseByTeam(reports, GAME);

        expect(rows.map((r) => r.teamNumber)).toEqual(['9', '10']);
        const nine = rows[0];
        expect(nine.metrics.map((m) => m.key)).toEqual(['auto', 'best']);
        expect(nine.metrics[0].value).toBe(15);
        expect(nine.metrics[1].value).toBe(20);
        expect(nine.metrics[0].stdDev).toBe(5);
        // σ is for means only — a max has no spread to report.
        expect(nine.metrics[1].stdDev).toBeNull();
    });

    it('orders team numbers numerically, so 9 comes before 10', () => {
        // `localeCompare` gives ['10', '9'], which is the version a scouting lead spots at once.
        expect(summariseByTeam(reports, GAME).map((r) => r.teamNumber)).toEqual(['9', '10']);
    });

    it('lists a team’s reports newest first', () => {
        const nine = summariseByTeam(reports, GAME)[0];
        expect(nine.reports.map((r) => r.createdAt)).toEqual([3, 1]);
    });

    it('counts only the reports that carried a usable number', () => {
        const rows = summariseByTeam(
            [
                report({ teamNumber: '7', data: { autoScore: 10 } }),
                report({ teamNumber: '7', data: {} }),
                report({ teamNumber: '7', data: { autoScore: 'n/a' } }),
            ],
            GAME,
        );
        expect(rows[0].reports).toHaveLength(3);
        // The mean is 10, not 3.33: two reports had nothing to average.
        expect(rows[0].metrics[0].count).toBe(1);
        expect(rows[0].metrics[0].value).toBe(10);
    });

    it('skips reports with no team number rather than inventing a row for them', () => {
        const rows = summariseByTeam(
            [report({ teamNumber: '', data: { autoScore: 1 } }), report({ teamNumber: '  ' })],
            GAME,
        );
        expect(rows).toEqual([]);
    });
});

describe('sortSummaries', () => {
    const rows = summariseByTeam(
        [
            report({ teamNumber: '11', data: { autoScore: 30 } }),
            report({ teamNumber: '22', data: { autoScore: 10 } }),
            report({ teamNumber: '33', data: {} }), // nothing to measure
        ],
        GAME,
    );

    it('sorts by a metric, descending', () => {
        expect(sortSummaries(rows, 'auto', 'desc').map((r) => r.teamNumber)).toEqual(['11', '22', '33']);
    });

    it('puts the unmeasured team LAST in both directions', () => {
        /*
         * The assertion this file exists for. Ascending by "auto", a naive `a - b` with null
         * coerced to 0 puts team 33 first — reading "we have never scouted them" as "they
         * scored zero", at the top of the list a lead uses to choose alliance partners.
         */
        expect(sortSummaries(rows, 'auto', 'asc').map((r) => r.teamNumber)).toEqual(['22', '11', '33']);
        expect(sortSummaries(rows, 'auto', 'desc').map((r) => r.teamNumber)).toEqual(['11', '22', '33']);
    });

    it('sorts by team number and by report count', () => {
        expect(sortSummaries(rows, 'teamNumber', 'desc').map((r) => r.teamNumber)).toEqual(['33', '22', '11']);
        expect(sortSummaries(rows, 'reports', 'asc')).toHaveLength(3);
    });

    it('does not mutate the array it was given', () => {
        const before = rows.map((r) => r.teamNumber);
        sortSummaries(rows, 'auto', 'desc');
        expect(rows.map((r) => r.teamNumber)).toEqual(before);
    });
});

describe('compareTeamNumbers', () => {
    it('is numeric when both sides are numbers', () => {
        expect(compareTeamNumbers('9', '10')).toBeLessThan(0);
        expect(compareTeamNumbers('30727', '4321')).toBeGreaterThan(0);
    });

    it('falls back to string order when either side is not', () => {
        // Team numbers are TEXT on purpose — `0123` and `123` are two teams on a pit board —
        // so this has to have an answer rather than a NaN.
        expect(compareTeamNumbers('12A', '12B')).toBeLessThan(0);
    });
});

describe('eventsIn', () => {
    it('lists each event once with its report count, ignoring blanks', () => {
        expect(
            eventsIn([
                report({ eventName: 'Regional' }),
                report({ eventName: 'Regional' }),
                report({ eventName: 'League Meet 1' }),
                report({ eventName: '  ' }),
                report({}),
            ]),
        ).toEqual([
            { key: 'name:league meet 1', name: 'League Meet 1', count: 1, linked: false },
            { key: 'name:regional', name: 'Regional', count: 2, linked: false },
        ]);
    });

    /*
     * THE DEFECT THIS WAS WRITTEN FOR. Two scouts at one competition, one of whom did not hold
     * shift. The old implementation keyed a case-sensitive Map on the trimmed label, so this
     * produced TWO events in the filter and TWO summaries of the same competition, and nothing
     * anywhere said so — scouting silently cut in half, with numbers that still look plausible.
     */
    it('does not split one event because two scouts typed it differently', () => {
        const events = eventsIn([
            report({ eventName: 'League Meet 1' }),
            report({ eventName: 'League meet 1' }),
            report({ eventName: '  league  meet 1 ' }),
        ]);

        expect(events).toHaveLength(1);
        expect(events[0].count).toBe(3);
    });

    it('shows the spelling the most reports used', () => {
        // Not "whichever arrived first": the label a lead recognises is the common one.
        const events = eventsIn([
            report({ eventName: 'league meet 1' }),
            report({ eventName: 'League Meet 1' }),
            report({ eventName: 'League Meet 1' }),
        ]);

        expect(events[0].name).toBe('League Meet 1');
    });

    it('breaks a tie on spelling deterministically rather than by arrival order', () => {
        // An even split must not let the label flip between renders — failure-modes section 13
        // is three instances of relying on an ordering nothing promised.
        const a = eventsIn([report({ eventName: 'B Event' }), report({ eventName: 'A Event' })]);
        const b = eventsIn([report({ eventName: 'A Event' }), report({ eventName: 'B Event' })]);

        expect(a[0].name).toBe(b[0].name);
    });

    /*
     * IDENTITY BEATS SPELLING. Two reports linked to the same `competition_events` row are one
     * event however they are labelled — which is the half normalising cannot do, because
     * "MI State" and "Michigan State Championship" are different strings by any measure.
     */
    it('groups by the linked event id even when the labels disagree entirely', () => {
        const events = eventsIn([
            report({ seasonEventId: 'evt-1', eventName: 'MI State' }),
            report({ seasonEventId: 'evt-1', eventName: 'Michigan State Championship' }),
            report({ seasonEventId: 'evt-1', eventName: 'Michigan State Championship' }),
        ]);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ key: 'id:evt-1', count: 3, linked: true });
        expect(events[0].name).toBe('Michigan State Championship');
    });

    it('keeps a linked event separate from a free-text one that happens to share a name', () => {
        // They are different events as far as the data is concerned, and merging them would
        // invent a fact. The dropdown can show the same label twice; the KEY is what differs.
        const events = eventsIn([
            report({ seasonEventId: 'evt-1', eventName: 'Regional' }),
            report({ eventName: 'Regional' }),
        ]);

        expect(events).toHaveLength(2);
        expect(events.map((e) => e.linked).sort()).toEqual([false, true]);
    });

    it('a linked report with no label still groups, and sorts last rather than first', () => {
        // An empty name would sort to the front alphabetically, putting the least identifiable
        // row where the eye lands first.
        const events = eventsIn([
            report({ seasonEventId: 'evt-1' }),
            report({ eventName: 'Regional' }),
        ]);

        expect(events.map((e) => e.name)).toEqual(['Regional', '']);
    });
});

describe('eventKeyOf', () => {
    it('prefers the linked id over the label', () => {
        expect(eventKeyOf(report({ seasonEventId: 'evt-1', eventName: 'Regional' }))).toBe('id:evt-1');
    });

    it('normalises a free-text label so case and spacing cannot split it', () => {
        expect(eventKeyOf(report({ eventName: '  League  MEET 1 ' }))).toBe('name:league meet 1');
    });

    it('returns null for a report with no event at all, so it is not grouped under a blank', () => {
        expect(eventKeyOf(report({}))).toBeNull();
        expect(eventKeyOf(report({ eventName: '   ' }))).toBeNull();
    });
});
