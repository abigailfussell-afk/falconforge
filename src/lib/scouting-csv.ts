/**
 * One row per report, as a spreadsheet (P-02 / FEAT-15).
 *
 * The export is not a nicety. Every FTC scouting workflow this product competes with ends in a
 * Sheet, and a lead who cannot get their data out will keep the Sheet and use the app for
 * nothing. It is also the honest answer to the analytics the app does not have: the summary
 * table answers "who is good at what", and anything past that is a column somebody wants to add
 * themselves.
 *
 * COLUMNS COME FROM THE GAME (P-01 phase S). The fixed ones are the report's own identity —
 * team, match, alliance, station, event, when — and everything after them is
 * `allFields(game)` in schema order, so next September's game exports next September's columns
 * with no code change. A hidden field still exports: a team that hid a column on the FORM has
 * said it does not want to type it, not that it wants old data dropped from a file.
 */
import type { GameDefinition } from './game-definition';
import { allFields } from './game-definition';
import type { ScoutingReport } from '../types';

/**
 * RFC 4180 quoting.
 *
 * Every value is quoted rather than only the ones that need it. Deciding per value means a rule
 * about commas, quotes, newlines and leading zeros, and getting any one of them wrong produces a
 * file that opens looking fine and is wrong in one row — which is worse than no export. Quoting
 * everything is one rule, and a doubled `"` is the whole of the escaping.
 *
 * `\r\n` line endings, because that is what RFC 4180 says and what Excel expects; every other
 * consumer accepts it.
 */
function csvCell(value: unknown): string {
    if (value === null || value === undefined) return '""';
    const text =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

/** The fixed columns, before the game's own. */
const IDENTITY_COLUMNS = [
    'Team',
    'Match',
    'Alliance',
    'Station',
    'Event',
    'Recorded',
] as const;

/**
 * Build the whole file.
 *
 * Reports are emitted in the order given; the caller sorts. `Recorded` is an ISO timestamp
 * rather than a formatted date: a spreadsheet can format an ISO string and cannot un-format a
 * localised one, and `docs/failure-modes.md` §10 is four sprints of dates going wrong across
 * offsets. The one place a local rendering belongs is on screen.
 */
export function scoutingReportsToCsv(
    reports: ScoutingReport[],
    game: GameDefinition,
): string {
    const fields = allFields(game);
    const header = [...IDENTITY_COLUMNS, ...fields.map((f) => f.label)];

    const rows = reports.map((r) => [
        r.teamNumber ?? '',
        r.matchNumber ?? '',
        r.alliance ?? '',
        r.station ?? '',
        r.eventName ?? '',
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        ...fields.map((f) => r.data?.[f.key] ?? ''),
    ]);

    return [header, ...rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
}

/**
 * A filename somebody can find again.
 *
 * The event name is in it because the realistic case is one file per competition, and three
 * files called `scouting.csv` in a Downloads folder is a worse outcome than a long name. Spaces
 * and punctuation are collapsed, since a filename with a comma in it is a filename some tools
 * mangle.
 */
export function scoutingCsvFilename(eventName: string | null, at: Date): string {
    const slug = (eventName ?? 'all-events')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'all-events';
    const day = at.toISOString().slice(0, 10);
    return `scouting-${slug}-${day}.csv`;
}

/**
 * Hand the file to the browser.
 *
 * A Blob and an object URL rather than a `data:` URI: Safari caps a data URI at a couple of
 * megabytes and a season of scouting will pass that. The URL is revoked on the next tick — not
 * immediately, because Chrome cancels an in-flight download when its source is revoked in the
 * same task, which is a bug that shows up as "nothing happened" on exactly the click that was
 * supposed to produce a file.
 */
export function downloadCsv(filename: string, csv: string): void {
    if (typeof document === 'undefined') return;
    // The BOM is for Excel: without it, a team name with an accent in it opens as mojibake on a
    // Windows default install, and the person who sees that concludes the export is broken.
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
