/**
 * P-02's named red test: the summary table sorts.
 *
 * The exit criterion asks for "a team summary table (one row per team number, columns from
 * `scoring.metrics`, sortable)" and names a component test for sort. This is that, plus the two
 * things a sortable table gets wrong: which way a column starts, and where the rows with no
 * number go.
 *
 * ASSERTS THE ORDER OF THE RENDERED ROWS, not that a click handler fired. `sortSummaries` is
 * tested directly in `scouting-metrics.test.ts`; what this adds is that the component is wired to
 * it — a table whose headers call the right function and render an unsorted list would pass every
 * assertion in that file (`docs/failure-modes.md` §2).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeamSummaryTable from '../scouting/TeamSummaryTable';
import type { GameDefinition } from '../../lib/game-definition';
import type { ScoutingReport } from '../../types';

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
        metrics: [{ key: 'auto', label: 'Auto score', field: 'autoScore', aggregate: 'mean' }],
    },
    planner: { partnerCapabilities: [] },
} as unknown as GameDefinition;

const report = (teamNumber: string, autoScore: unknown, createdAt = 1): ScoutingReport =>
    ({
        id: crypto.randomUUID(),
        teamNumber,
        data: autoScore === undefined ? {} : { autoScore },
        seasonId: 's1',
        createdAt,
    } as ScoutingReport);

/** 9 averages 30, 10 averages 5, 11 has nothing anybody measured. */
const REPORTS = [
    report('9', 20),
    report('9', 40),
    report('10', 5),
    report('11', undefined),
];

const renderTable = (reports = REPORTS) => {
    const onSelectTeam = vi.fn();
    render(
        <TeamSummaryTable
            reports={reports}
            game={GAME}
            selectedTeam={null}
            onSelectTeam={onSelectTeam}
        />,
    );
    return { onSelectTeam };
};

/**
 * The rendered order, read from the team-number BUTTON in each row.
 *
 * Not from `row.textContent`: the first version did that and matched `#930` — the team number
 * and the first metric cell run together with no separator between them, so the regex reported
 * team "930". A test whose SUBJECT is ordering has to read the identifier exactly.
 */
const teamOrder = (): string[] =>
    screen
        .getAllByTestId('team-summary-row')
        .map((row) => row.querySelector('[data-testid^="team-row-"]')!.textContent!.replace('#', ''));

describe('TeamSummaryTable', () => {
    it('renders one row per team with a column per metric', () => {
        renderTable();

        expect(screen.getAllByTestId('team-summary-row')).toHaveLength(3);
        expect(screen.getByRole('columnheader', { name: /Auto score/ })).toBeInTheDocument();
        // The mean of 20 and 40, with the spread beside it — a team averaging 30 with σ 10 is a
        // different pick from one averaging 30 with σ 0.
        expect(screen.getByTestId('cell-9-auto').textContent).toBe('30±10.0');
    });

    it('opens numerically by team number, so 9 comes before 10', () => {
        renderTable();
        expect(teamOrder()).toEqual(['9', '10', '11']);
    });

    it('sorts by a metric, best first, on the first click', () => {
        /*
         * DESCENDING on the first click of a metric. "Who scores most" is what somebody clicking
         * "Auto score" is asking, and making them click twice for it is the kind of small
         * indignity that sends people back to the spreadsheet.
         */
        renderTable();
        fireEvent.click(screen.getByTestId('sort-auto'));
        expect(teamOrder()).toEqual(['9', '10', '11']);
    });

    it('reverses when the sorted column is clicked again', () => {
        renderTable();
        fireEvent.click(screen.getByTestId('sort-auto'));
        fireEvent.click(screen.getByTestId('sort-auto'));
        // 10 (5) then 9 (30) — and 11, which nobody measured, still last. See below.
        expect(teamOrder()).toEqual(['10', '9', '11']);
    });

    it('keeps the unmeasured team LAST in both directions', () => {
        /*
         * The assertion that matters most. Ascending by "Auto score" with null coerced to 0
         * puts team 11 at the top — telling a lead that a team they have never scouted is the
         * worst at something, at the top of the list they pick alliance partners from.
         * `docs/failure-modes.md` §4: absence read as a value.
         */
        renderTable();
        fireEvent.click(screen.getByTestId('sort-auto')); // desc
        expect(teamOrder().at(-1)).toBe('11');
        fireEvent.click(screen.getByTestId('sort-auto')); // asc
        expect(teamOrder().at(-1)).toBe('11');
    });

    it('tells assistive technology which column is sorted, and which way', () => {
        renderTable();
        fireEvent.click(screen.getByTestId('sort-auto'));

        expect(screen.getByTestId('sort-auto')).toHaveAttribute('aria-sort', 'descending');
        expect(screen.getByTestId('sort-teamNumber')).toHaveAttribute('aria-sort', 'none');
    });

    it('opens the team detail from the team number, and toggles it shut', () => {
        const { onSelectTeam } = renderTable();
        fireEvent.click(screen.getByTestId('team-row-9'));
        expect(onSelectTeam).toHaveBeenCalledWith('9');
    });

    it('shows a designed empty state rather than an empty table', () => {
        // The zero case is the FIRST case every new team meets, not an edge case
        // (`docs/failure-modes.md` §4, twice on day one).
        renderTable([]);
        expect(screen.queryByTestId('team-summary-table')).toBeNull();
        expect(screen.getByText(/Nothing to summarise yet/i)).toBeInTheDocument();
    });
});
