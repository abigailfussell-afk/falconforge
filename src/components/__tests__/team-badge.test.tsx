/**
 * WALK-B-07 — the team-number badge shows the team's number.
 *
 * There were two badges and they truncated differently: `Sidebar.tsx` rendered
 * `#${teamNumber.slice(0, 2)}` and the onboarding team picker rendered
 * `#${teamNumber.slice(-3)}`, so team 30727 was "#30" in the rail and "#727" on the screen a
 * coach reaches from it. Both are valid-looking FTC numbers belonging to other teams.
 *
 * WHAT WOULD MAKE THESE FAIL — the question `docs/failure-modes.md` asks of every check. Putting
 * either `slice` back turns the first two tests red immediately, and they assert the rendered
 * STRING rather than "a badge exists", which is the difference between this and the
 * `toHaveBeenCalledTimes(1)` assertions Sprint 5 found could not see which columns were
 * requested. The third test is the principle-9 half: it renders both call sites and requires
 * them to agree, which no assertion about a single component can do.
 *
 * NOT TESTED HERE: that the pill is wide enough to hold five digits. jsdom applies no
 * stylesheet, so it renders the overflowing and fitting versions identically
 * (`docs/environment-divergences.md` §3). That measurement is in `e2e/team-badge.spec.ts`.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TeamBadge, { teamBadgeLabel } from '../ui/TeamBadge';
import Sidebar from '../Sidebar';
import { useAppStore } from '@/lib/store';

vi.mock('@/lib/auth');
vi.mock('@/lib/queries');
vi.mock('@/lib/realtime');
vi.mock('@/lib/sync');

describe('TeamBadge', () => {
    it('renders the whole team number, whatever its length', () => {
        // 30727 is a real production team number and the one WALK-B-07 was reported against;
        // 5 digits is the maximum FTC issues, so this is the case both old badges got wrong.
        for (const number of ['1', '99', '4321', '30727']) {
            const { unmount } = render(<TeamBadge teamNumber={number} />);
            expect(screen.getByTestId('team-badge').textContent).toBe(`#${number}`);
            unmount();
        }
    });

    it('falls back to the team name, then to a letter, when there is no number', () => {
        const { unmount } = render(<TeamBadge teamNumber={null} teamName="iron falcons" />);
        expect(screen.getByTestId('team-badge').textContent).toBe('I');
        unmount();

        render(<TeamBadge teamNumber="   " teamName={null} />);
        expect(screen.getByTestId('team-badge').textContent).toBe('T');
    });

    it('trims a number that arrived with whitespace rather than rendering the space', () => {
        render(<TeamBadge teamNumber=" 30727 " />);
        expect(screen.getByTestId('team-badge').textContent).toBe('#30727');
    });

    it('exports the same label logic the component renders', () => {
        // The helper exists so nothing re-derives the rule beside a `<TeamBadge>`; if it and the
        // component ever disagreed, principle 9 would have been reintroduced inside the fix for it.
        expect(teamBadgeLabel('30727')).toBe('#30727');
        expect(teamBadgeLabel(null, 'Iron Falcons')).toBe('I');
        expect(teamBadgeLabel(null, null)).toBe('T');
    });
});

describe('the two call sites agree (principle 9)', () => {
    beforeEach(() => {
        useAppStore.setState({
            teams: [
                { id: 'team-1', name: 'Iron Falcons', teamNumber: '30727', ownerId: 'u1', createdAt: 1 },
            ],
            currentTeamId: 'team-1',
            tasks: [],
            seasons: [{ id: 'season-1', name: '2025-26', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1 }],
            currentSeasonId: 'season-1',
        });
    });

    it('shows #30727 in the sidebar, not #30', () => {
        render(
            <MemoryRouter>
                <Sidebar canManageTeam onSignOut={() => { }} onSwitchTeam={() => { }} />
            </MemoryRouter>,
        );

        const badge = screen.getByTestId('team-badge');
        expect(badge.textContent).toBe('#30727');
        // The specific wrong answers, named. A regression that truncated to some OTHER length
        // would be caught by the equality above; these two say which failures happened.
        expect(badge.textContent).not.toBe('#30');
        expect(badge.textContent).not.toBe('#727');
    });

    it('renders the same string in a picker row as in the sidebar', () => {
        // The onboarding picker is a page behind auth and a server fetch; the badge it renders is
        // this component with different colours, so the agreement is asserted at the component.
        const { container } = render(
            <div>
                <TeamBadge teamNumber="30727" teamName="Iron Falcons" size="sm" />
                <TeamBadge teamNumber="30727" teamName="Iron Falcons" size="md" />
            </div>,
        );
        const labels = within(container).getAllByTestId('team-badge').map((n) => n.textContent);
        expect(labels).toEqual(['#30727', '#30727']);
    });
});
