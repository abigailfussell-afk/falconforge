import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from '../Onboarding';
import { useAppStore } from '../../lib/store';

/**
 * "Unknown Team" on the screen that exists to tell you which team you are waiting for.
 *
 * A join leaves the member `pending`, and `teams_select_member` is
 * `is_team_member(id) OR is_team_guardian(id)` where `is_team_member` requires
 * `status = 'approved'`. So the nested `teams:team_id (...)` select in `loadTeams` returns
 * NULL for exactly the rows this list is built from — the team a pending member is waiting on
 * is the one row RLS refuses them. Confirmed against the local stack as a real pending user
 * (`teams: null` on the membership, `[]` from a direct select) before this was written.
 *
 * The fix keeps the name from the only moment the client legitimately holds it: the join RPC,
 * which returns `team_id` and `team_name` and whose result the client used to discard.
 *
 * THE MOCK RETURNS `teams: null` DELIBERATELY. Returning a joined team here would be a fixture
 * that does not resemble the database, and the test would pass with or without the fix — which
 * is the shape `docs/failure-modes.md` warns about and the reason this was checked against a
 * real Postgres first.
 */

/**
 * The shape `loadTeams` actually selects. Spelled out rather than left untyped, because
 * principle 7 holds the escape-hatch cast count on a downward ratchet -- and because writing
 * the shape down is what makes `teams: null` a stated fact about a pending row rather than an
 * untyped blank.
 *
 * (The prose here deliberately does not spell that cast out either: the ratchet counts the
 * literal token wherever it appears, and Sprint 6 already recorded a false increase because
 * privacy-policy prose tripped the same metric.)
 */
interface MembershipRow {
    team_id: string;
    status: 'pending' | 'approved' | 'removed';
    managed_profile_id: string | null;
    teams: { id: string; name: string; team_number: string | null; owner_id: string } | null;
}

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    memberships: [] as MembershipRow[],
    /*
     * ONE user object, hoisted, rather than a fresh literal per call.
     *
     * `loadTeams` runs in `useEffect(..., [user])`. In production `user` is auth context state
     * and is stable between renders; a mock that returns a new object literal each call makes
     * that effect re-run on EVERY render, and the first `setState` it performs then loops
     * forever. The first draft of this file did exactly that and took the worker out with a
     * JavaScript heap OOM after five minutes.
     *
     * Worth being clear about what that is and is not: an artefact of the mock, not a defect in
     * the component -- but it is the hazard `react-hooks/exhaustive-deps` names at
     * `Onboarding.tsx:35` in the plan's parking lot, which is why the fix is to make the mock
     * resemble production rather than to widen the deps array.
     */
    user: {
        id: 'user-1',
        email: 'student@example.com',
        user_metadata: { full_name: 'Student One' },
    },
}));

vi.mock('../../lib/auth', async () => {
    const { createContext, useContext } = await import('react');
    const ProbeContext = createContext<null>(null);
    return {
        useAuth: () => {
            useContext(ProbeContext);
            return {
                user: mocks.user,
                session: { access_token: 'token' },
                isLoading: false,
                isConfigured: true,
                ageClassification: '13_to_17',
                signOut: vi.fn(),
                updateAgeClassification: vi.fn(),
            };
        },
        AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: { auth: {} },
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    // The chain `loadTeams` awaits: .select(...).eq('user_id').is('managed_profile_id')
                    is: () => Promise.resolve({ data: mocks.memberships, error: null }),
                }),
            }),
        }),
    },
}));

const renderOnboarding = () =>
    render(
        <MemoryRouter>
            <Onboarding />
        </MemoryRouter>,
    );

describe('a pending member is told which team they are waiting for', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({ teams: [], currentTeamId: null, pendingTeamNames: {} });
        // What the database actually returns for a pending membership: no joined team.
        mocks.memberships = [
            { team_id: 'team-42', status: 'pending', managed_profile_id: null, teams: null },
        ];
    });

    it('names the team from what the join returned, not "Unknown Team"', async () => {
        useAppStore.getState().rememberPendingTeamName('team-42', 'Iron Falcons');

        renderOnboarding();

        expect(await screen.findByText('Iron Falcons')).toBeInTheDocument();
        expect(screen.queryByText('Unknown Team')).not.toBeInTheDocument();
    });

    it('still falls back to "Unknown Team" when nothing remembered the name', async () => {
        // The honest case: joined on another device, so this one never saw the name. The
        // fallback has to survive rather than be replaced by a blank or a crash.
        renderOnboarding();

        expect(await screen.findByText('Unknown Team')).toBeInTheDocument();
    });

    it('forgets the remembered name once the membership is approved', async () => {
        // Once approved the team is readable in its own right, so the remembered copy is dead
        // state — and a rename would make it a stale answer that outranks nothing.
        useAppStore.getState().rememberPendingTeamName('team-42', 'Iron Falcons');
        mocks.memberships = [
            {
                team_id: 'team-42',
                status: 'approved',
                managed_profile_id: null,
                teams: { id: 'team-42', name: 'Iron Falcons', team_number: '12345', owner_id: 'user-9' },
            },
        ];

        renderOnboarding();

        await screen.findByText('Iron Falcons');
        expect(useAppStore.getState().pendingTeamNames).toEqual({});
    });
});
