/**
 * WALK-B-04, the half the exit criterion names as the red test: *"Onboarding renders the
 * stored-code action."*
 *
 * The student followed `https://falcon-forge.com/#/join/GYSQ6VQS`, signed up, tapped the
 * confirmation link out of their mail app, and arrived here with an empty join form. The code
 * was in the URL they were sent, and on a phone that URL is gone the moment the mail app takes
 * over. At a kickoff meeting with twelve students that is twelve verbal instructions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from '../Onboarding';
import { useAppStore } from '../../lib/store';
import { rememberInviteCode } from '../../lib/pending-invite';

const mocks = vi.hoisted(() => ({
    navigate: vi.fn(),
    memberships: [] as unknown[],
    user: { id: 'student-1', email: 'sam@example.com', user_metadata: {} },
}));

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        user: mocks.user,
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '13_to_17',
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
        useLocation: () => ({
            pathname: '/onboarding', search: '', hash: '', state: null, key: 'k',
        }),
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

vi.mock('../../lib/server-pull', () => ({
    fetchGuardianData: vi.fn(async () => {}),
}));

const renderOnboarding = () =>
    render(
        <MemoryRouter>
            <Onboarding />
        </MemoryRouter>,
    );

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({
        teams: [], currentTeamId: null, pendingTeamNames: {}, managedProfiles: [],
    });
    mocks.memberships = [];
});

describe('the code they arrived with (WALK-B-04)', () => {
    /*
     * THE RED TEST the exit criteria name. With `rememberInviteCode` removed from `JoinTeam`,
     * or the action removed from `Onboarding`, this is absent — which is exactly the state the
     * walkthrough photographed: `walkB-student1-after-confirm-m.png`, an empty join form.
     */
    it('is offered as an action, with the code visible', async () => {
        rememberInviteCode('GYSQ6VQS');

        renderOnboarding();

        const action = await screen.findByTestId('stored-invite-action');
        expect(action.textContent).toContain('GYSQ6VQS');
    });

    /*
     * FIRST, because it is what they came to do. Asserted by DOM ORDER rather than by reading
     * the code back — a "first action" that renders below "Create a Team" has satisfied the
     * letter of the criterion and none of it, and a student who is going to scroll past it is
     * a student the coach still has to instruct.
     */
    it('comes before the create-a-team and generic-join actions', async () => {
        rememberInviteCode('GYSQ6VQS');
        renderOnboarding();

        const action = await screen.findByTestId('stored-invite-action');
        const generic = screen.getByText('Use a different code');

        expect(
            action.compareDocumentPosition(generic) & Node.DOCUMENT_POSITION_FOLLOWING,
            'the stored code was not offered before the generic join action',
        ).toBeTruthy();
    });

    it('takes them straight to the join page with the code in the URL', async () => {
        rememberInviteCode('GYSQ6VQS');
        renderOnboarding();

        fireEvent.click(await screen.findByTestId('stored-invite-action'));

        await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/join/GYSQ6VQS'));
    });

    /*
     * THE CONTROL, and the one that stops this becoming clutter for everybody else. A student
     * who arrived with no code — most of them — must not see an action about a code they do
     * not have, and the generic entry keeps its ordinary label.
     */
    it('is absent, and the generic action unchanged, when no code was stored', async () => {
        renderOnboarding();

        await waitFor(() => expect(screen.getByText('Join with Invite Code')).toBeInTheDocument());
        expect(screen.queryByTestId('stored-invite-action')).not.toBeInTheDocument();
        expect(screen.queryByText('Use a different code')).not.toBeInTheDocument();
    });

    /*
     * A hand-edited storage value is rendered on this screen, so it is untrusted content.
     * `pending-invite.ts` validates on the way out; this asserts the screen honours that
     * rather than falling back to showing it anyway.
     */
    it('ignores a code that does not look like one', async () => {
        localStorage.setItem('falconforge.pendingInviteCode', '<script>bad()</script>');

        renderOnboarding();

        await waitFor(() => expect(screen.getByText('Join with Invite Code')).toBeInTheDocument());
        expect(screen.queryByTestId('stored-invite-action')).not.toBeInTheDocument();
    });
});
