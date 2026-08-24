/**
 * P-02 — the export, which is not a nicety.
 *
 * Every FTC scouting workflow this product competes with ends in a Sheet. A lead who cannot get
 * their data out keeps the Sheet and uses the app for nothing, so the file has to be right the
 * first time — a CSV that opens looking fine and is wrong in one row is worse than no export at
 * all, because nobody checks it twice.
 *
 * The three assertions that are about correctness rather than shape: a value containing a comma
 * or a quote survives; the columns come from the GAME rather than a hardcoded list; and a hidden
 * field still exports, because hiding a column on the form is a statement about typing, not
 * about old data.
 */
import { describe, it, expect } from 'vitest';
import { scoutingReportsToCsv, scoutingCsvFilename } from '../scouting-csv';
import type { GameDefinition } from '../game-definition';
import type { ScoutingReport } from '../../types';

const GAME = {
    id: 'test-game',
    program: 'ftc',
    seasonKey: '2026-27',
    title: 'TESTGAME',
    version: 1,
    match: { allianceSize: 2, phases: [] },
    field: { image: 'x.png', width: 10, height: 10 },
    scouting: {
        match: {
            sections: [
                {
                    key: 'auto',
                    label: 'Autonomous',
                    fields: [
                        { key: 'autoScore', label: 'Auto score', type: 'number' },
                        { key: 'notes', label: 'Notes', type: 'textarea' },
                        { key: 'hidden', label: 'Hidden field', type: 'number', hidden: true },
                    ],
                },
            ],
        },
    },
    scoring: { metrics: [] },
    planner: { partnerCapabilities: [] },
} as unknown as GameDefinition;

const report = (over: Partial<ScoutingReport> = {}): ScoutingReport => ({
    id: 'r1',
    teamNumber: '12345',
    matchNumber: 7,
    eventName: 'League Meet 1',
    data: { autoScore: 30, notes: 'solid', hidden: 1 },
    seasonId: 's1',
    createdAt: Date.UTC(2026, 8, 12, 14, 30),
    ...over,
} as ScoutingReport);

const rows = (csv: string) => csv.split('\r\n');

describe('scoutingReportsToCsv', () => {
    it('writes a header of identity columns then the game’s own, by label', () => {
        const header = rows(scoutingReportsToCsv([report()], GAME))[0];
        expect(header).toBe(
            '"Team","Match","Alliance","Station","Event","Recorded","Auto score","Notes","Hidden field"',
        );
    });

    it('writes one row per report', () => {
        const csv = scoutingReportsToCsv([report({ id: 'a' }), report({ id: 'b' })], GAME);
        expect(rows(csv)).toHaveLength(3); // header + 2
    });

    it('carries alliance and station when they were noted, and blanks when they were not', () => {
        const withPos = rows(scoutingReportsToCsv([report({ alliance: 'blue', station: 2 })], GAME))[1];
        expect(withPos).toContain('"blue","2"');

        const without = rows(scoutingReportsToCsv([report({ alliance: undefined, station: undefined })], GAME))[1];
        // Empty, not "null" or "undefined" — a spreadsheet reads those as text.
        expect(without).toContain('"12345","7","","",');
    });

    it('survives a comma, a quote and a newline inside a value', () => {
        /*
         * The failure this prevents is the quiet one: an unescaped quote shifts every column
         * after it by one, for that row only, and the file still opens. Somebody reads a team's
         * auto score out of the notes column and never finds out.
         */
        const csv = scoutingReportsToCsv(
            [report({ data: { autoScore: 1, notes: 'fast, but "tippy"\nrecheck', hidden: 0 } })],
            GAME,
        );
        expect(csv).toContain('"fast, but ""tippy""\nrecheck"');
        // And the row still has the same number of top-level commas as the header.
        const header = csv.split('\r\n')[0];
        expect(header.split('","').length).toBe(9);
    });

    it('exports a HIDDEN field', () => {
        // Hiding a column on the form says "we do not type this", not "drop what we already
        // recorded" — and a team that hid a field then exported would otherwise lose the
        // history without being told.
        const row = rows(scoutingReportsToCsv([report()], GAME))[1];
        expect(row.endsWith('"1"')).toBe(true);
    });

    it('writes the timestamp as ISO rather than a localised date', () => {
        // A spreadsheet can format an ISO string and cannot un-format a localised one, and
        // `docs/failure-modes.md` §10 is four sprints of dates going wrong across offsets.
        expect(rows(scoutingReportsToCsv([report()], GAME))[1]).toContain('2026-09-12T14:30:00.000Z');
    });

    it('handles a report with no data bag at all', () => {
        // A row written before a field existed, or by a client that dropped it. Empty cells,
        // not `undefined` and not a throw.
        const row = rows(scoutingReportsToCsv([report({ data: {} })], GAME))[1];
        expect(row.endsWith('"","",""')).toBe(true);
    });
});

describe('scoutingCsvFilename', () => {
    it('names the event and the day', () => {
        expect(scoutingCsvFilename('League Meet 1', new Date(Date.UTC(2026, 8, 12)))).toBe(
            'scouting-league-meet-1-2026-09-12.csv',
        );
    });

    it('says so when the export is every event', () => {
        expect(scoutingCsvFilename(null, new Date(Date.UTC(2026, 8, 12)))).toBe(
            'scouting-all-events-2026-09-12.csv',
        );
    });

    it('produces a usable name from an event of pure punctuation', () => {
        // Otherwise the filename is `scouting--2026-09-12.csv`, or on some systems nothing at
        // all after the slug collapses to empty.
        expect(scoutingCsvFilename('!!!', new Date(Date.UTC(2026, 8, 12)))).toBe(
            'scouting-all-events-2026-09-12.csv',
        );
    });
});
