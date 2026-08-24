/**
 * FEAT-05 — Load → edit → Save updates the plan instead of duplicating it.
 *
 * `handleSave` always called `addMatchPlan`, and `handleLoad` kept no record of which plan it
 * had loaded, so the drive team's normal act between matches — open Match 3, redraw a line,
 * Save — produced a second "Match 3" and left the first one untouched. `updateMatchPlan` had
 * existed since Sprint 4 with no caller outside its own test: `docs/failure-modes.md` §7, a
 * value written by nothing / a gate with no door.
 *
 * The assertions are on the STORE CALL rather than on the rendered list, because what makes
 * this a duplicate is which row reaches `match_plans` — the list is a consequence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MatchPlan } from '../../types';

vi.mock('../../lib/store', () => {
    const storeState = { seasons: [] as unknown[] };
    const useAppStore = Object.assign(vi.fn(), { getState: () => storeState });
    return { useAppStore };
});

vi.mock('@/lib/queries');
vi.mock('../../lib/server-pull', () => ({
    ensureSeasonFieldImage: vi.fn().mockResolvedValue(undefined),
}));

// d3 draws on a real canvas; this suite is about which store action Save calls. The shape
// mirrors `MatchPlanner.test.tsx`'s mock — same component, same missing browser APIs.
// jsdom has no SVG geometry; the planner reads it on every pointer event.
Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    value: vi.fn(() => ({ inverse: vi.fn(() => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })) })),
    configurable: true,
});
Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {
    value: function () {
        return { x: 0, y: 0, matrixTransform: vi.fn(() => ({ x: 0, y: 0 })) };
    },
    configurable: true,
});

import MatchPlanner from '../MatchPlanner';
import { useAppStore } from '../../lib/store';

const SEASON = 'season-1';

const plan = (over: Partial<MatchPlan> = {}): MatchPlan => ({
    id: 'plan-3',
    title: 'Match 3',
    matchNumber: 3,
    drawingData: [{ d: 'M0 0', stroke: '#000', width: 2 }],
    notes: 'Cycle from the depot',
    allianceTeam: '4242',
    partnerAutonomous: true,
    partnerPark: false,
    updatedAt: 1000,
    seasonId: SEASON,
    ...over,
});

const addMatchPlan = vi.fn();
const updateMatchPlan = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    const state = {
        matchPlans: [plan()],
        addMatchPlan,
        updateMatchPlan,
        deleteMatchPlan: vi.fn(),
        currentTeamId: 'team-1',
        currentSeasonId: SEASON,
        seasons: [{ id: SEASON, name: '2026-2027', gameTitle: '', isArchived: false, createdAt: 0 }],
        getCurrentSeason: () => ({ id: SEASON, name: '2026-2027', gameTitle: '', isArchived: false, createdAt: 0 }),
    };
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector?: unknown) =>
        typeof selector === 'function' ? (selector as (s: unknown) => unknown)(state) : state,
    );
});

/** Open the Load list and pick the seeded plan. */
function loadTheSavedPlan() {
    fireEvent.click(screen.getByTitle('Load Plans'));
    fireEvent.click(screen.getByText('Match 3'));
}

function openSave() {
    // The toolbar button, which already owns `save-plan`; the modal's confirm is
    // `save-plan-confirm`.
    fireEvent.click(screen.getByTestId('save-plan'));
}

describe('saving a plan that was loaded (FEAT-05)', () => {
    it('updates the same row instead of creating a second one', () => {
        render(<MatchPlanner />);

        loadTheSavedPlan();
        openSave();
        fireEvent.click(screen.getByTestId('save-plan-confirm'));

        expect(updateMatchPlan, 'Save did not update the loaded plan').toHaveBeenCalledTimes(1);
        expect(updateMatchPlan.mock.calls[0][0]).toBe('plan-3');
        expect(addMatchPlan, 'Save created a duplicate of the loaded plan').not.toHaveBeenCalled();
    });

    it('says which plan it is about to overwrite', () => {
        render(<MatchPlanner />);

        loadTheSavedPlan();
        openSave();

        expect(screen.getByTestId('save-target').textContent).toContain('Match 3');
        expect(screen.getByText('Update')).toBeDefined();
    });

    it('offers "Save as copy", which creates a new row and leaves the original', () => {
        render(<MatchPlanner />);

        loadTheSavedPlan();
        openSave();
        fireEvent.click(screen.getByTestId('save-as-copy'));

        expect(addMatchPlan, 'Save as copy did not create a plan').toHaveBeenCalledTimes(1);
        expect(updateMatchPlan, 'Save as copy overwrote the original').not.toHaveBeenCalled();
    });

    it('creates a new plan when nothing was loaded — the control', () => {
        // A fix that always updated would pass the first case and break the ordinary one.
        render(<MatchPlanner />);

        openSave();
        fireEvent.change(screen.getByTestId('plan-title-input'), { target: { value: 'Match 7' } });
        fireEvent.click(screen.getByTestId('save-plan-confirm'));

        expect(addMatchPlan).toHaveBeenCalledTimes(1);
        expect(addMatchPlan.mock.calls[0][0].title).toBe('Match 7');
        expect(updateMatchPlan).not.toHaveBeenCalled();
    });
});

describe('the match number, which nothing could set (FEAT-05)', () => {
    it('writes what was typed', () => {
        render(<MatchPlanner />);

        openSave();
        fireEvent.change(screen.getByTestId('plan-match-number-input'), { target: { value: '12' } });
        fireEvent.click(screen.getByTestId('save-plan-confirm'));

        expect(addMatchPlan.mock.calls[0][0].matchNumber).toBe(12);
    });

    it('leaves it undefined when blank, never 0 (B18)', () => {
        // `parseInt('')` is NaN and `NaN || 0` is 0, which is how five of nine live
        // production scouting rows were corrupted. The column has a positive CHECK.
        render(<MatchPlanner />);

        openSave();
        fireEvent.change(screen.getByTestId('plan-match-number-input'), { target: { value: '' } });
        fireEvent.click(screen.getByTestId('save-plan-confirm'));

        expect(addMatchPlan.mock.calls[0][0].matchNumber).toBeUndefined();
    });

    it('titles an untitled plan from the match number', () => {
        render(<MatchPlanner />);

        openSave();
        fireEvent.change(screen.getByTestId('plan-match-number-input'), { target: { value: '5' } });
        fireEvent.click(screen.getByTestId('save-plan-confirm'));

        expect(addMatchPlan.mock.calls[0][0].title).toBe('Match 5');
    });

    it('comes back populated when a plan is loaded', () => {
        render(<MatchPlanner />);

        loadTheSavedPlan();
        openSave();

        expect((screen.getByTestId('plan-match-number-input') as HTMLInputElement).value).toBe('3');
        expect((screen.getByTestId('plan-title-input') as HTMLInputElement).value).toBe('Match 3');
    });
});
