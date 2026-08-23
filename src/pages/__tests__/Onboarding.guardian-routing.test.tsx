/**
 * WALK-B-02 — a guardian is not a new user.
 *
 * An account with children on a team and no membership of its own landed on
 * "Welcome! Let's get you set up." on every single sign-in, under three buttons about
 * creating a team, and had to work out for itself that "I'm a parent or guardian — add a
 * child who is too young for their own login" was the route to a child it had already added.
 * The code said otherwise: `Onboarding.tsx` carried a comment promising that "`GuardianOnly`
 * below routes them there", and `grep -rn GuardianOnly src` found only the comment. Half a
 * contract, documented as whole — `docs/failure-modes.md` §7.
 *
 * The distinction that has to be right is between a guardian and a genuinely new account,
 * because both have zero memberships. That is the second case here, and it is the one that
 * would break if the redirect were written as "no teams → guardian view".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from '../Onboarding';
import { useAppStore } from '../../lib/store';
import type { ManagedProfile } from '../../types';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    memberships: [] as unknown[],
    /** What `fetchGuardianData` puts in the store when it runs. */
    children: [] as ManagedProfile[],
    locationState: null as unknown,
    // One stable object: `loadTeams` runs in `useEffect(..., [user])`, and a fresh literal
    // per call re-runs it on every render.
    user: { id: 'guardian-1', email: 'parent@example.com', user_metadata: {} },
}));

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        user: mocks.user,
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
        signOut: vi.fn(),
        updateAgeClassification: vi.fn(),
    }),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mocks.navigate,
        useLocation: () => ({ pathname: '/onboarding', search: '', hash: '', state: mocks.locationState, key: 'k' }),
    };
});

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: { auth: {} },
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    is: () => Promise.resolve({ data: mocks.memberships, error: null }),
                }),
            }),
        }),
    },
}));

/**
 * The one read path for guardian records, stubbed to land its rows in the store — which is
 * what the real one does. Onboarding deliberately does not run its own
 * `.from('managed_profiles')`: four copies of the team read is how this project got here.
 */
vi.mock('../../lib/server-pull', () => ({
    fetchGuardianData: vi.fn(async () => {
        useAppStore.setState({ managedProfiles: mocks.children });
    }),
}));

const child: ManagedProfile = {
    id: 'profile-1',
    guardianUserId: 'guardian-1',
    fullName: 'Sam Lovelace',
    notes: '',
    promotionCode: '',
};

const renderOnboarding = () =>
    render(
        <MemoryRouter>
            <Onboarding />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ teams: [], currentTeamId: null, pendingTeamNames: {}, managedProfiles: [] });
    mocks.memberships = [];
    mocks.children = [];
    mocks.locationState = null;
});

describe('signing in as a guardian (WALK-B-02)', () => {
    it('goes to their own view instead of the Welcome screen', async () => {
        mocks.children = [child];

        renderOnboarding();

        await vi.waitFor(() =>
            expect(mocks.navigate, 'a guardian was greeted as a brand-new user').toHaveBeenCalledWith(
                '/app/guardian',
                { replace: true },
            ),
        );
    });

    it('leaves a genuinely new account on the picker — the control', async () => {
        // Zero memberships AND zero children. Both accounts look identical up to the point
        // this asks, so a redirect written as "no teams → guardian view" would strand every
        // new coach on a page about children they do not have.
        mocks.children = [];

        renderOnboarding();

        expect(await screen.findByText(/Create a Team/i)).toBeInTheDocument();
        expect(mocks.navigate).not.toHaveBeenCalledWith('/app/guardian', expect.anything());
    });

    it('leaves a member with a team on the picker — the other control', async () => {
        mocks.memberships = [
            {
                team_id: 'team-1',
                status: 'approved',
                managed_profile_id: null,
                teams: { id: 'team-1', name: 'Iron Falcons', team_number: '12345', owner_id: 'x' },
            },
        ];
        // A coach who is ALSO a parent: they have children, and they have their own team.
        mocks.children = [child];

        renderOnboarding();

        expect(await screen.findByText('Iron Falcons')).toBeInTheDocument();
        expect(mocks.navigate).not.toHaveBeenCalledWith('/app/guardian', expect.anything());
    });

    it('leaves a pending member waiting rather than redirecting them', async () => {
        mocks.memberships = [
            { team_id: 'team-1', status: 'pending', managed_profile_id: null, teams: null },
        ];
        mocks.children = [child];

        renderOnboarding();

        await screen.findByText('Unknown Team');
        expect(mocks.navigate).not.toHaveBeenCalledWith('/app/guardian', expect.anything());
    });

    it('stays on the picker when the guardian asked for it — "Switch team"', async () => {
        // Otherwise the button's only effect is to return you to where you already were,
        // and a guardian could never reach the screen that lets them join a team or add a
        // second child.
        mocks.children = [child];
        mocks.locationState = { picker: true };

        renderOnboarding();

        expect(await screen.findByText(/Create a Team/i)).toBeInTheDocument();
        expect(
            mocks.navigate,
            'pressing "Switch team" sent the guardian straight back',
        ).not.toHaveBeenCalledWith('/app/guardian', expect.anything());
    });
});
