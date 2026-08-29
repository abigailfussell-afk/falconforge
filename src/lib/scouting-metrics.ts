/**
 * Turning a pile of scouting reports into an answer (P-02 / FEAT-15).
 *
 * The feature recorded and could not summarise. `ScoutingReports.tsx` was a flat card grid, so a
 * scouting lead with forty reports from a qualifier had forty cards and no way to ask "who
 * should we pick?" — which is the question the whole activity exists to answer, and the reason
 * the assessment rates this the thing that will decide whether beta teams use it at their first
 * meet.
 *
 * WHAT THIS IS NOT. Not a pick list, not a prediction, not a chart. One row per team, one column
 * per metric the season's `GameDefinition` declares, computed on the device from the store. A
 * table a lead can sort is what people currently leave the app to build in a spreadsheet.
 *
 * NOTHING GAME-SPECIFIC LIVES HERE. The columns come from `scoring.metrics`, which is data
 * (P-01 phase S), so next September's game needs a JSON file and no code. That is also why
 * `field` is looked up in the report's `data` bag rather than in a typed property: the bag is
 * the game's, and this module only knows how to average numbers.
 */
import type { GameDefinition, GameMetric } from './game-definition';
import type { ScoutingReport } from '../types';

/** One metric's value for one team, plus the spread that says how much to trust it. */
export interface MetricSummary {
    key: string;
    label: string;
    aggregate: GameMetric['aggregate'];
    /** The aggregate itself. Null when no report of this team carried a usable number. */
    value: number | null;
    /**
     * Population standard deviation, for `mean` metrics only.
     *
     * A team averaging 30 across four matches with σ = 2 is a different pick from one averaging
     * 30 with σ = 25, and the mean alone cannot tell them apart. POPULATION rather than sample:
     * these are all the matches that were scouted, not a sample drawn from them, and the sample
     * form is undefined at n = 1 — which is a very common case at the first event of a season.
     */
    stdDev: number | null;
    /** How many reports contributed a usable number. Not the team's report count. */
    count: number;
}

/** One row of the summary table. */
export interface TeamSummary {
    teamNumber: string;
    /** Every report for this team, newest first. */
    reports: ScoutingReport[];
    /** Reports, in the order `scoring.metrics` declares them. */
    metrics: MetricSummary[];
}

/**
 * Read one metric's number out of a report.
 *
 * Returns null for anything that is not a finite number — a missing key, a string a text field
 * produced, a boolean from a checkbox, or the `NaN` an empty numeric input yields. B18 is what
 * happens when a non-number is coerced instead of rejected: `parseInt('') || 0` put five
 * fabricated zeroes into production scouting data. A metric over a field that is not numeric is
 * a template mistake, and averaging in a zero for it would hide that mistake behind a plausible
 * number.
 */
export function metricValue(report: ScoutingReport, field: string): number | null {
    const raw = report.data?.[field];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    return null;
}

/** Population standard deviation. Null for an empty set; 0 for a single value. */
export function stdDev(values: number[]): number | null {
    if (values.length === 0) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}

/** Apply one metric's declared aggregate to a set of numbers. */
export function aggregate(values: number[], how: GameMetric['aggregate']): number | null {
    if (values.length === 0) return null;
    switch (how) {
        case 'mean':
            return values.reduce((a, b) => a + b, 0) / values.length;
        case 'max':
            return Math.max(...values);
        case 'sum':
            return values.reduce((a, b) => a + b, 0);
    }
}

/**
 * One row per team number, with every metric the game declares.
 *
 * Sorted by team number, NUMERICALLY where both are numbers. `localeCompare` puts 10 before 9,
 * and a scouting lead reading a list of team numbers will notice that immediately. Team numbers
 * are text on purpose (`0123` and `123` are two teams on a pit board), so the comparison falls
 * back to string order when either side is not a plain number.
 */
export function summariseByTeam(
    reports: ScoutingReport[],
    game: GameDefinition,
): TeamSummary[] {
    const byTeam = new Map<string, ScoutingReport[]>();
    for (const report of reports) {
        const team = report.teamNumber?.trim();
        if (!team) continue;
        byTeam.set(team, [...(byTeam.get(team) ?? []), report]);
    }

    const rows: TeamSummary[] = [];
    for (const [teamNumber, teamReports] of byTeam) {
        const ordered = [...teamReports].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        rows.push({
            teamNumber,
            reports: ordered,
            metrics: game.scoring.metrics.map((metric) => {
                const values = ordered
                    .map((r) => metricValue(r, metric.field))
                    .filter((v): v is number => v !== null);
                return {
                    key: metric.key,
                    label: metric.label,
                    aggregate: metric.aggregate,
                    value: aggregate(values, metric.aggregate),
                    stdDev: metric.aggregate === 'mean' ? stdDev(values) : null,
                    count: values.length,
                };
            }),
        });
    }

    return rows.sort((a, b) => compareTeamNumbers(a.teamNumber, b.teamNumber));
}

/** Numeric where both sides are numbers, lexical otherwise. See {@link summariseByTeam}. */
export function compareTeamNumbers(a: string, b: string): number {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b);
}

/**
 * Sort the summary rows by one column.
 *
 * NULLS ALWAYS LAST, whichever direction. A team with no usable number for a metric has not
 * scored badly at it — nobody measured — and sorting them to the top of a descending "best auto
 * score" list would be the same absence-read-as-a-value mistake `docs/failure-modes.md` §4
 * catalogues eleven times. They go to the bottom either way, so the rows a lead is looking for
 * are always at the end they are looking at.
 */
export function sortSummaries(
    rows: TeamSummary[],
    column: string,
    direction: 'asc' | 'desc',
): TeamSummary[] {
    const sign = direction === 'asc' ? 1 : -1;

    if (column === 'teamNumber') {
        return [...rows].sort((a, b) => sign * compareTeamNumbers(a.teamNumber, b.teamNumber));
    }
    if (column === 'reports') {
        return [...rows].sort((a, b) => sign * (a.reports.length - b.reports.length));
    }

    return [...rows].sort((a, b) => {
        const av = a.metrics.find((m) => m.key === column)?.value ?? null;
        const bv = b.metrics.find((m) => m.key === column)?.value ?? null;
        if (av === null && bv === null) return compareTeamNumbers(a.teamNumber, b.teamNumber);
        if (av === null) return 1;
        if (bv === null) return -1;
        if (av === bv) return compareTeamNumbers(a.teamNumber, b.teamNumber);
        return sign * (av - bv);
    });
}

/**
 * One event, as the filter understands it.
 *
 * `key` is what reports are grouped and filtered BY; `name` is what a person is shown. They are
 * different on purpose — the key may be an id the scout never sees, and the label may vary in
 * spelling between reports that belong together.
 */
export interface ScoutedEvent {
    key: string;
    name: string;
    count: number;
    /** True when the key is a `competition_events` id rather than a normalised label. */
    linked: boolean;
}

/**
 * Which event does this report belong to, for grouping?
 *
 * IDENTITY FIRST, SPELLING SECOND. A report linked to a `competition_events` row groups by that
 * id, so no amount of retyping the label can split it. A report with only free text groups by a
 * NORMALISED label — casefolded, with runs of whitespace collapsed — because the defect this
 * function exists for is two scouts at one competition typing "League Meet 1" and
 * "League meet 1" and getting two summaries with nothing to say so.
 *
 * Normalising is not the same as fixing it: "MI State" and "Michigan State Championship" are
 * still two events to this function, and no string comparison can know otherwise. That case is
 * what the event PICKER is for. This half stops the accidental split; the picker stops the
 * deliberate one.
 */
export function eventKeyOf(r: ScoutingReport): string | null {
    if (r.seasonEventId) return `id:${r.seasonEventId}`;
    const name = r.eventName?.trim();
    if (!name) return null;
    return `name:${name.toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Every distinct event in a set of reports, plus how many reports each has.
 *
 * The DISPLAYED name for a normalised group is the spelling the most reports used, with an
 * alphabetical tie-break so the label cannot flip between renders on an even split — this
 * project has been bitten three times by relying on an ordering nothing promised
 * (`docs/failure-modes.md` §13).
 */
export function eventsIn(reports: ScoutingReport[]): ScoutedEvent[] {
    const groups = new Map<string, { spellings: Map<string, number>; count: number; linked: boolean }>();

    for (const r of reports) {
        const key = eventKeyOf(r);
        if (!key) continue;
        const label = r.eventName?.trim() || '';
        let g = groups.get(key);
        if (!g) {
            g = { spellings: new Map(), count: 0, linked: key.startsWith('id:') };
            groups.set(key, g);
        }
        g.count += 1;
        if (label) g.spellings.set(label, (g.spellings.get(label) ?? 0) + 1);
    }

    return [...groups.entries()]
        .map(([key, g]) => {
            const name =
                [...g.spellings.entries()].sort(
                    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
                )[0]?.[0] ?? '';
            return { key, name, count: g.count, linked: g.linked };
        })
        /*
         * A linked event with no label at all would sort to the front on an empty string, which
         * puts the least identifiable row where the eye lands first. Nameless groups go last.
         */
        .sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || a.name.localeCompare(b.name));
}
