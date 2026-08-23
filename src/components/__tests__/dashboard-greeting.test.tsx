/**
 * WALK-B-06 — "Welcome back" is a claim about a previous visit.
 *
 * The dashboard header said `Welcome back, Pat! 👋` and `You have 0 open tasks for this sprint`
 * to every account unconditionally. On the very first screen a new coach ever reaches — a team
 * created ninety seconds earlier, four stat tiles reading zero — both halves of that are false,
 * and it is the first sentence the product says to the person paying for it.
 *
 * WHAT WOULD MAKE THESE FAIL. Putting the word back unconditionally turns the first test red;
 * removing the hydration gate turns the third red. Both assert the RENDERED STRING, not that a
 * heading exists — `docs/failure-modes.md` §2 is fourteen instances of a test satisfied by the
 * state the defect also produces, and "a greeting is on screen" is exactly that shape.
 *
 * THE THIRD TEST IS THE ONE WORTH READING. Before IndexedDB rehydrates, every collection is
 * empty, which is indistinguishable from a brand-new team (§4: absence conflated with a value).
 * Without the gate, every returning coach is told how to get started for the first few hundred
 * milliseconds of every cold open — a flicker, which is precisely the class of defect that
 * survives review.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardHome from '../DashboardHome';
import { useAppStore } from '@/lib/store';
import type { Task } from '@/types';

vi.mock('@/lib/auth');
vi.mock('@/lib/queries');
vi.mock('@/lib/realtime');

const SEASON = {
    id: 'season-1',
    name: '2026-27',
    gameTitle: '',
    fieldImageData: '',
    isArchived: false,
    createdAt: 1000,
};

const task = (over: Record<string, unknown> = {}): Task => ({
    id: 't-1',
    title: 'Rebuild the intake',
    description: '',
    assignedTo: '',
    status: 'To Do',
    department: 'Build',
    type: 'Feature',
    checklist: [],
    timeline: [],
    createdAt: 1000,
    tags: [],
    seasonId: 'season-1',
    ...over,
});

const renderDashboard = () =>
    render(
        <MemoryRouter>
            <DashboardHome />
        </MemoryRouter>,
    );

beforeEach(() => {
    useAppStore.setState({
        tasks: [],
        scoutingReports: [],
        matchPlans: [],
        meetings: [],
        checklistsBySeason: {},
        seasons: [SEASON],
        currentSeasonId: 'season-1',
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the dashboard greeting', () => {
    it('does not claim a previous visit to a team with nothing in it', async () => {
        renderDashboard();

        await waitFor(() =>
            expect(screen.getByTestId('dashboard-greeting').textContent).not.toMatch(/loading/i),
        );
        const greeting = await screen.findByTestId('dashboard-greeting');
        expect(greeting.textContent).toContain('Welcome,');
        expect(greeting.textContent).not.toContain('Welcome back');

        // And the sub-line stops claiming a sprint. "You have 0 open tasks for this sprint" over
        // four zero tiles was the other half of the same false sentence.
        const sub = screen.getByTestId('dashboard-greeting-sub');
        expect(sub.textContent).not.toMatch(/0 open tasks/);
        expect(screen.getByRole('button', { name: /getting-started guide/i })).toBeInTheDocument();
    });

    it('says "Welcome back" once the team has any work at all', async () => {
        useAppStore.setState({ tasks: [task()] });
        renderDashboard();

        await waitFor(() =>
            expect(screen.getByTestId('dashboard-greeting').textContent).toContain('Welcome back'),
        );
        expect(screen.getByTestId('dashboard-greeting-sub').textContent).toMatch(
            /1 open task for this sprint/,
        );
    });

    it.each([
        ['a scouting report', { scoutingReports: [{ id: 's-1', teamNumber: '30727', matchNumber: 1, data: {}, createdAt: 2000, seasonId: 'season-1' }] }],
        ['a match plan', { matchPlans: [{ id: 'm-1', title: 'Q12', seasonId: 'season-1', createdAt: 2000, updatedAt: 2000, drawing: '', notes: '', teamNumber: '', partnerCapabilities: [] }] }],
    ])('counts %s as work, not just tasks', async (_label, state) => {
        useAppStore.setState(state as never);
        renderDashboard();

        await waitFor(() =>
            expect(screen.getByTestId('dashboard-greeting').textContent).toContain('Welcome back'),
        );
    });

    it('says neither thing while the store is still rehydrating', async () => {
        /*
         * `hasHydrated()` false is the cold-open state: IndexedDB has not answered yet, so every
         * collection reads `[]` for reasons that have nothing to do with the team. Stubbing it is
         * the only way to hold that window open — in a test it closes in a microtask, which is
         * exactly why the flicker was never noticed in a browser either.
         */
        vi.spyOn(useAppStore.persist, 'hasHydrated').mockReturnValue(false);
        vi.spyOn(useAppStore.persist, 'onFinishHydration').mockReturnValue(() => { });

        renderDashboard();

        const greeting = screen.getByTestId('dashboard-greeting');
        expect(greeting.textContent).toContain('Welcome,');
        expect(greeting.textContent).not.toContain('Welcome back');
        // The distinguishing assertion: NOT the new-team copy either. Without the gate this is
        // the "here is how to start" line, shown to a coach who started months ago.
        expect(screen.getByTestId('dashboard-greeting-sub').textContent).not.toMatch(
            /getting-started/i,
        );
        expect(screen.queryByRole('button', { name: /getting-started guide/i })).toBeNull();
    });
});
