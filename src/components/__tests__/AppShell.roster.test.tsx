/**
 * SEC-03 — what the shell counts as "the roster".
 *
 * `AppShell` derives one member list and hands it to every route through the outlet context.
 * That is the only thing between the store and every assignee picker in the app, so it is where
 * "who is on this team" is decided — and it is decided ONCE, rather than in each of the four
 * components that render a member `<select>`. Four definitions of a roster is
 * `docs/failure-modes.md` §1 and this project's most frequent defect.
 *
 * WHY IT NEEDS A FILTER AT ALL, given `pullFromServer` already applies one
 *
 * The team pull filters `team_members` to `status = 'approved'`, so a member removed under
 * SEC-03 normally never reaches the client. `pullGuardianMemberships` bypasses that on purpose —
 * it merges a guardian's children in at EVERY status, because a guardian has to be able to see a
 * pending request for their own child. For a coach who is also a parent, both sets land in one
 * collection, so their own removed child would be offered in every picker in the app.
 *
 * The last test is the control. Without it, a filter that dropped everybody would pass the
 * first two, and the "roster" would be empty on every screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useOutletContext } from 'react-router-dom';
import AppShell from '../AppShell';
import { useAppStore } from '../../lib/store';
import type { TeamMember } from '../../types';

vi.mock('@/lib/auth');
vi.mock('@/lib/realtime');

/*
 * A local factory rather than `vi.mock('@/lib/supabase')`: the shared manual mock has no
 * `rpc`, and widening it would hand every other test that opts in a stub answering
 * `is_platform_operator` — the shared-stub problem `src/lib/__mocks__/README.md` warns about.
 */
vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    // `ReAttestationPrompt` reads attestations through this one; without `from` it logs
    // "Could not read attestations" and assumes they are current, which is a warning about the
    // mock rather than about the app.
    supabase: {
        auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
    supabaseSync: {
        rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
    },
}));

vi.mock('../../lib/server-pull', () => ({
    fetchTeamData: vi.fn().mockResolvedValue(undefined),
    fetchGuardianData: vi.fn().mockResolvedValue(undefined),
    // The shell loads the picked season on demand now (SYNC-01/03). Stubbed here even though
    // this suite renders with no season: a mock missing an export the component imports is
    // how a suite starts asserting about its own harness.
    fetchSeasonData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/sign-out', () => ({ performSignOut: vi.fn() }));

const TEAM = 'team-1';

const member = (over: Partial<TeamMember>): TeamMember =>
    ({
        id: 'm',
        teamId: TEAM,
        userId: 'u',
        managedProfileId: null,
        role: 'student',
        status: 'approved',
        seatAssigned: true,
        fullName: 'Someone',
        email: 'someone@falconforge.test',
        avatarUrl: null,
        joinedAt: 0,
        ...over,
    }) as TeamMember;

/** Renders the roster the shell handed down, one name per line. */
function RosterProbe() {
    const { teamMembers } = useOutletContext<{ teamMembers: TeamMember[] }>();
    return (
        <ul data-testid="roster">
            {teamMembers.map((m) => (
                <li key={m.id}>{m.fullName}</li>
            ))}
        </ul>
    );
}

function renderShell(members: TeamMember[]) {
    useAppStore.setState({
        currentTeamId: TEAM,
        teamMembers: members,
        subTeams: [],
        managedProfiles: [],
        seasons: [],
        currentSeasonId: null,
    } as never);

    render(
        <MemoryRouter initialEntries={['/app/board']}>
            <Routes>
                <Route path="/app" element={<AppShell />}>
                    <Route path="board" element={<RosterProbe />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

describe('AppShell — the roster handed to every route (SEC-03)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('leaves out a member who has been removed from the team', async () => {
        renderShell([
            member({ id: 'm-1', fullName: 'Still Here' }),
            member({ id: 'm-2', fullName: 'Departed Student', status: 'removed' }),
        ]);

        const roster = await screen.findByTestId('roster');
        expect(roster.textContent).toContain('Still Here');
        expect(
            roster.textContent,
            'a removed member is still offered to every assignee picker in the app',
        ).not.toContain('Departed Student');
    });

    it('leaves out a guardian’s removed child, which is the path that gets one here', async () => {
        // `pullGuardianMemberships` merges these in at every status; the team pull would not.
        renderShell([
            member({ id: 'm-1', fullName: 'Coach And Parent', role: 'coach' }),
            member({
                id: 'm-2',
                fullName: 'Their Removed Child',
                managedProfileId: 'profile-1',
                status: 'removed',
            }),
        ]);

        const roster = await screen.findByTestId('roster');
        expect(roster.textContent).not.toContain('Their Removed Child');
    });

    it('keeps everybody else, including a pending request — the control', async () => {
        /*
         * Pending members were on this list before SEC-03 and still are: narrowing that is a
         * separate product question, and a filter that quietly took them out would look exactly
         * like a filter that worked.
         */
        renderShell([
            member({ id: 'm-1', fullName: 'Approved Member' }),
            member({ id: 'm-2', fullName: 'Pending Member', status: 'pending' }),
            member({ id: 'm-3', fullName: 'Removed Member', status: 'removed' }),
        ]);

        const roster = await screen.findByTestId('roster');
        expect(roster.textContent).toContain('Approved Member');
        expect(roster.textContent, 'the filter took out more than it should').toContain(
            'Pending Member',
        );
        expect(roster.textContent).not.toContain('Removed Member');
    });
});
