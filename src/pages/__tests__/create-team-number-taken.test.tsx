/**
 * D3 — what happens when the team number is already registered.
 *
 * Kevin's decision calls this the case that is CERTAIN rather than defensive: *"it fixes two
 * coaches from the same team both registering, and typo'd numbers"*. So the two things this
 * screen has to get right are not really about abuse at all — they are about a coach who has
 * done nothing wrong and needs to end up on the right roster.
 *
 * The server half is `onboarding-gate.db.test.ts`. This is what the coach sees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CreateTeam from '../CreateTeam';
import * as authObj from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { recordAttestation } from '../../lib/attestations';
import { useAppStore } from '../../lib/store';

vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
    })),
}));

vi.mock('../../lib/supabase', () => ({
    supabase: { rpc: vi.fn() },
}));

vi.mock('../../lib/attestations', async () => {
    const actual = await vi.importActual<typeof import('../../lib/attestations')>(
        '../../lib/attestations',
    );
    return { ...actual, recordAttestation: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
            <a href={to}>{children}</a>
        ),
    };
});

const rpc = () => supabase!.rpc as unknown as ReturnType<typeof vi.fn>;
const attest = () => recordAttestation as unknown as ReturnType<typeof vi.fn>;

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>{children}</BrowserRouter>
);

/** Walk the wizard to the point of submission with a name and a number. */
const submitWith = (number: string) => {
    render(<CreateTeam />, { wrapper: TestWrapper });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), {
        target: { value: 'Iron Falcons' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g., 12345'), { target: { value: number } });
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
};

beforeEach(() => {
    vi.clearAllMocks();
    (authObj.useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
    });
    attest().mockResolvedValue({ success: true, error: null });
    useAppStore.setState({ currentTeamId: null });
});

describe('somebody else already has this number', () => {
    /*
     * THE RED TEST. Without the `team_number_taken` branch, the RPC's `error` lands in the
     * generic red sentence under the form — leaving the coach on a screen whose Create button
     * will refuse them again for the same reason, with no route to the team that exists.
     * `docs/failure-modes.md` §14, at a moment every team passes through exactly once.
     */
    it('shows the team that has it, by name', async () => {
        rpc().mockResolvedValue({
            data: {
                success: false,
                error_code: 'team_number_taken',
                error: '#12345 Iron Falcons is already registered…',
                team_name: 'Iron Falcons',
                team_number: '12345',
            },
            error: null,
        });

        submitWith('12345');

        const screenEl = await screen.findByTestId('team-number-taken');
        // The NAME is the load-bearing detail: "#12345 is taken" reads like a bug in
        // FalconForge; "#12345 Iron Falcons is already here" is a coach recognising their own
        // team, which per D3 is the commonest reason anybody sees this.
        expect(screenEl.textContent).toContain('Iron Falcons');
        expect(screenEl.textContent).toContain('12345');
    });

    it('offers the join page, which is the only way onto that roster', async () => {
        rpc().mockResolvedValue({
            data: {
                success: false,
                error_code: 'team_number_taken',
                team_name: 'Iron Falcons',
                team_number: '12345',
            },
            error: null,
        });

        submitWith('12345');
        fireEvent.click(await screen.findByTestId('taken-go-join'));

        expect(mockNavigate).toHaveBeenCalledWith('/join');
    });

    /*
     * THE WAY BACK. The other real cause of a collision is a typo, and a screen with one exit
     * is a trap for the coach who typed 1234 instead of 12345.
     */
    it('lets them go back and fix a typo', async () => {
        rpc().mockResolvedValue({
            data: { success: false, error_code: 'team_number_taken', team_name: 'X', team_number: '1234' },
            error: null,
        });

        submitWith('1234');
        fireEvent.click(await screen.findByTestId('taken-back'));

        expect(screen.queryByTestId('team-number-taken')).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('e.g., Falcon Force')).toBeInTheDocument();
    });
});

describe('it is their own team', () => {
    /*
     * A team's own admin must not be sent into a request-to-join queue for their own team.
     * This is the one branch that gets the team id back from the server, because the caller is
     * already on it.
     */
    it('switches straight into it', async () => {
        rpc().mockResolvedValue({
            data: {
                success: false,
                error_code: 'already_on_team',
                error: 'You are already on Iron Falcons (#12345)…',
                team_id: 'team-existing',
                team_name: 'Iron Falcons',
            },
            error: null,
        });

        submitWith('12345');

        await screen.findByRole('button', { name: /create team/i });
        expect(useAppStore.getState().currentTeamId).toBe('team-existing');
        expect(mockNavigate).toHaveBeenCalledWith('/app/dashboard');
        expect(screen.queryByTestId('team-number-taken')).not.toBeInTheDocument();
    });
});

describe('the account already registered a team', () => {
    /*
     * SEC-08's refusal, which is an ordinary error rather than a destination — there is
     * nowhere to send them. What matters is that it reaches somebody who can act on it, which
     * is `docs/failure-modes.md` §8: the refusal names the door.
     */
    it('shows the refusal and how to ask', async () => {
        rpc().mockResolvedValue({
            data: {
                success: false,
                error_code: 'one_team_per_account',
                error: 'This account already registered a team. If you genuinely run a second team, ask support@falcon-forge.com to enable it — it takes a minute.',
            },
            error: null,
        });

        submitWith('54321');

        expect(await screen.findByText(/support@falcon-forge\.com/)).toBeInTheDocument();
        expect(screen.queryByTestId('team-number-taken')).not.toBeInTheDocument();
    });
});
