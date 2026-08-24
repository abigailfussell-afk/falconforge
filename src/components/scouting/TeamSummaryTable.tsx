import { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { GameDefinition } from '../../lib/game-definition';
import type { ScoutingReport } from '../../types';
import { summariseByTeam, sortSummaries, type TeamSummary } from '../../lib/scouting-metrics';
import EmptyState from '../ui/EmptyState';

/**
 * One row per team, one column per metric the season's game declares (P-02 / FEAT-15).
 *
 * This is the thing scouting existed to produce and did not. Forty cards from a qualifier
 * answered "what did we write down"; this answers "who is good at what", which is the question a
 * scouting lead has and the reason they currently leave the app for a spreadsheet.
 *
 * COMPUTED ON THE DEVICE, from the store, every render. No server aggregate, no cached table, no
 * new column — which is what makes it work at a venue with no signal, where it is most needed.
 * The cost is a pass over the season's reports per sort, on a list measured in hundreds.
 *
 * THE COLUMNS ARE DATA. `scoring.metrics` in the game definition names them, so next September's
 * game is a JSON file. Nothing in this component knows what DECODE is.
 */
interface TeamSummaryTableProps {
    reports: ScoutingReport[];
    game: GameDefinition;
    /** Opens the team detail. Null closes it. */
    onSelectTeam: (teamNumber: string | null) => void;
    selectedTeam: string | null;
}

/** A number a person can read: one decimal, and no trailing `.0` on a whole one. */
const show = (value: number | null): string => {
    if (value === null) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

export default function TeamSummaryTable({
    reports,
    game,
    onSelectTeam,
    selectedTeam,
}: TeamSummaryTableProps) {
    /**
     * Team number ascending, which is the order a pit board is in.
     *
     * Not "best first": which metric is "best" is a judgement the app does not get to make, and
     * a table that opens sorted by one of them is quietly asserting that it matters most.
     */
    const [sortColumn, setSortColumn] = useState<string>('teamNumber');
    const [direction, setDirection] = useState<'asc' | 'desc'>('asc');

    const rows: TeamSummary[] = useMemo(
        () => sortSummaries(summariseByTeam(reports, game), sortColumn, direction),
        [reports, game, sortColumn, direction],
    );

    /**
     * Clicking the sorted column flips it; clicking another switches to it.
     *
     * A metric column starts DESCENDING, because "who scores most" is what somebody clicking
     * "Auto score" is asking, and making them click twice for it is the kind of small
     * indignity that sends people back to the spreadsheet. Team number starts ascending, for
     * the same reason the default does.
     */
    const toggle = (column: string) => {
        if (column === sortColumn) {
            setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
            return;
        }
        setSortColumn(column);
        setDirection(column === 'teamNumber' ? 'asc' : 'desc');
    };

    const SortIcon = ({ column }: { column: string }) => {
        if (column !== sortColumn) return <ArrowUpDown size={12} className="opacity-30" />;
        return direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
    };

    if (rows.length === 0) {
        return (
            <EmptyState
                icon={Users}
                title="Nothing to summarise yet"
                body="Scout a match and this becomes a table: one row per team, one column per metric, sortable. It is computed on this device, so it works at a venue with no signal."
            />
        );
    }

    const columns = [
        { key: 'teamNumber', label: 'Team' },
        ...game.scoring.metrics.map((m) => ({ key: m.key, label: m.label })),
        { key: 'reports', label: 'Reports' },
    ];

    return (
        // `overflow-x-auto` on the WRAPPER, not the page: a game with eight metrics is wider than
        // a phone and the table has to scroll inside itself rather than making the whole app
        // scroll sideways. Asserted at 375px in the e2e pack, because jsdom cannot see it.
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table data-testid="team-summary-table" className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/50">
                    <tr>
                        {columns.map((c) => (
                            <th key={c.key} scope="col" className="text-left">
                                <button
                                    type="button"
                                    data-testid={`sort-${c.key}`}
                                    onClick={() => toggle(c.key)}
                                    // The whole header is the control, so the tap target is the
                                    // cell rather than a 12px icon inside it (WALK-A-10).
                                    className="w-full flex items-center gap-1 px-3 py-2 text-2xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                                    aria-sort={
                                        c.key === sortColumn
                                            ? direction === 'asc' ? 'ascending' : 'descending'
                                            : 'none'
                                    }
                                >
                                    <span className="whitespace-nowrap">{c.label}</span>
                                    <SortIcon column={c.key} />
                                </button>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr
                            key={row.teamNumber}
                            data-testid="team-summary-row"
                            className={`border-t border-slate-100 dark:border-slate-700 ${row.teamNumber === selectedTeam ? 'bg-forge-50 dark:bg-forge-900/20' : ''}`}
                        >
                            <td className="px-3 py-2">
                                <button
                                    type="button"
                                    data-testid={`team-row-${row.teamNumber}`}
                                    onClick={() =>
                                        onSelectTeam(row.teamNumber === selectedTeam ? null : row.teamNumber)
                                    }
                                    className="font-bold text-forge-600 dark:text-forge-400 hover:underline tabular-nums"
                                >
                                    #{row.teamNumber}
                                </button>
                            </td>
                            {game.scoring.metrics.map((metric) => {
                                const m = row.metrics.find((x) => x.key === metric.key);
                                return (
                                    <td
                                        key={metric.key}
                                        data-testid={`cell-${row.teamNumber}-${metric.key}`}
                                        className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300"
                                    >
                                        {show(m?.value ?? null)}
                                        {/*
                                          * The spread, where there is one to show.
                                          *
                                          * A team averaging 30 across four matches with σ = 2 is
                                          * a different pick from one averaging 30 with σ = 25,
                                          * and the mean alone cannot tell them apart. Hidden at
                                          * a single report, where σ is 0 by definition and the
                                          * number would only look like precision.
                                          */}
                                        {m && m.aggregate === 'mean' && m.stdDev !== null && m.count > 1 && (
                                            <span className="ml-1 text-2xs text-slate-400">
                                                ±{m.stdDev.toFixed(1)}
                                            </span>
                                        )}
                                    </td>
                                );
                            })}
                            <td className="px-3 py-2 tabular-nums text-slate-500 dark:text-slate-400">
                                {row.reports.length}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
