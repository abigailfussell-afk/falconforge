import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CreateTeam from '../CreateTeam';
import * as authObj from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { recordAttestation } from '../../lib/attestations';

// Mock auth hook
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
    })),
}));

// Mock supabase
vi.mock('../../lib/supabase', () => ({
    supabase: {
        rpc: vi.fn().mockResolvedValue({ data: { success: true, team_id: 't1', invite_code: 'CODE123' }, error: null }),
    },
}));

// Mock attestations
/*
 * `COACH_REQUIRED_ATTESTATIONS` is spread from the real module rather than stubbed.
 *
 * CreateTeam iterates the constant instead of hardcoding `'coach_terms'` (Sprint 6), so a mock
 * that omitted it made the component throw rather than fail an assertion — which is a mock
 * disagreeing with the module it stands in for, the exact drift `mock-drift.test.ts` exists to
 * catch. Stubbing only the network call and importing the list keeps them in step.
 */
vi.mock('../../lib/attestations', async () => {
    const actual = await vi.importActual<typeof import('../../lib/attestations')>(
        '../../lib/attestations',
    );
    return {
        ...actual,
        recordAttestation: vi.fn().mockResolvedValue({ success: true, error: null }),
    };
});

// Mock react-router-dom
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

/**
 * The mocked `rpc`, typed.
 *
 * The rest of this file predates the type-escape ratchet in `harness-invariants.test.ts` and
 * casts inline; principle 7 says that count only goes down, so the cases added for SEC-09 go
 * through here rather than adding two more.
 */
const rpcMock = () => supabase!.rpc as unknown as ReturnType<typeof vi.fn>;

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>{children}</BrowserRouter>
);

describe('CreateTeam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        // Reset auth mock to default test state
        (authObj.useAuth as any).mockReturnValue({
            user: { id: 'user-1', email: 'test@example.com' },
            session: { access_token: 'token' },
            isLoading: false,
            isConfigured: true,
            ageClassification: '18_plus',
        });
        
        // Reset supabase mock
        (supabase!.rpc as any).mockResolvedValue({ data: { success: true, team_id: 't1', invite_code: 'CODE123' }, error: null });
        
        // Reset attestations mock
        (recordAttestation as any).mockResolvedValue({ success: true, error: null });
    });

    describe('Auth & Age Requirements', () => {
        it('redirects to login if user is not authenticated', () => {
            (authObj.useAuth as any).mockReturnValue({
                user: null,
                isLoading: false,
                ageClassification: null,
            });
            render(<CreateTeam />, { wrapper: TestWrapper });
            expect(mockNavigate).toHaveBeenCalledWith('/login');
        });

        it('shows age requirement block if user is not 18+', () => {
            (authObj.useAuth as any).mockReturnValue({
                user: { id: 'user-1' },
                isLoading: false,
                ageClassification: '13_to_17',
            });
            render(<CreateTeam />, { wrapper: TestWrapper });
            
            expect(screen.getByText('Age Requirement')).toBeDefined();
            expect(screen.getByText(/You must be 18 or older/i)).toBeDefined();
            
            fireEvent.click(screen.getByText('Back to Teams'));
            expect(mockNavigate).toHaveBeenCalledWith('/onboarding');
        });
    });

    describe('Step 1: Attestation', () => {
        it('renders attestation step and requires checkbox to proceed', () => {
            render(<CreateTeam />, { wrapper: TestWrapper });
            
            expect(screen.getByText('Admin Agreement')).toBeDefined();
            
            const nextButton = screen.getByRole('button', { name: /next/i }) as HTMLButtonElement;
            expect(nextButton.disabled).toBe(true);
            
            const checkbox = screen.getByRole('checkbox');
            fireEvent.click(checkbox);
            
            expect(nextButton.disabled).toBe(false);
            
            fireEvent.click(nextButton);
            
            // Should move to step 2
            expect(screen.getByText('Team Details')).toBeDefined();
        });
    });

    describe('Step 2: Team Details', () => {
        it('allows going back to step 1', () => {
            render(<CreateTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            expect(screen.getByText('Team Details')).toBeDefined();
            
            fireEvent.click(screen.getByRole('button', { name: /back/i }));
            expect(screen.getByText('Admin Agreement')).toBeDefined();
        });

        it('requires team name of at least 3 characters to submit', () => {
            render(<CreateTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            const createButton = screen.getByRole('button', { name: /create team/i }) as HTMLButtonElement;
            expect(createButton.disabled).toBe(true);
            
            const teamNameInput = screen.getByPlaceholderText('e.g., Falcon Force');
            fireEvent.change(teamNameInput, { target: { value: 'AB' } });
            expect(createButton.disabled).toBe(true);
            
            fireEvent.change(teamNameInput, { target: { value: 'Valid Team' } });
            expect(createButton.disabled).toBe(false);
        });
    });

    describe('Submission process', () => {
        it('handles attestation API error', async () => {
            (recordAttestation as any).mockResolvedValueOnce({ success: false, error: 'Attestation failed' });
            
            render(<CreateTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), { target: { value: 'Valid Team' } });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            
            expect(await screen.findByText('Attestation failed')).toBeDefined();
            expect(supabase!.rpc).not.toHaveBeenCalled();
        });

        it('handles RPC error', async () => {
            (supabase!.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'RPC Error' } });
            
            render(<CreateTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), { target: { value: 'Valid Team' } });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            
            expect(await screen.findByText('RPC Error')).toBeDefined();
        });

        it('handles missing success flag in RPC return', async () => {
            (supabase!.rpc as any).mockResolvedValueOnce({ data: { success: false, error: 'Creation failed' }, error: null });
            
            render(<CreateTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), { target: { value: 'Valid Team' } });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            
            expect(await screen.findByText('Creation failed')).toBeDefined();
        });

        it('submits successfully and navigates to complete step', async () => {
            render(<CreateTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            
            fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), { target: { value: 'Valid Team' } });
            fireEvent.change(screen.getByPlaceholderText('e.g., 2026-2027 Season'), { target: { value: '2026-2027 Season' } });
            fireEvent.change(screen.getByPlaceholderText('e.g., 12345'), { target: { value: '9999' } });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            
            await waitFor(() => {
                expect(recordAttestation).toHaveBeenCalledWith('coach_terms');
                // Renamed: the person who registers a team is the primary ADMIN, and the
                // season name is now an argument rather than a 'Demo Season' hardcode
                // inside the function.
                expect(supabase!.rpc).toHaveBeenCalledWith('create_team_as_admin', {
                    team_name: 'Valid Team',
                    season_name: '2026-2027 Season',
                    team_number: '9999'
                });
            });
            
            expect(screen.getByText('Team Created Successfully!')).toBeDefined();
            expect(screen.getByText('Valid Team', { exact: false })).toBeDefined();
            expect(screen.getByText('CODE123')).toBeDefined();
            
            // Go to dashboard
            fireEvent.click(screen.getByRole('button', { name: /go to dashboard/i }));
            expect(mockNavigate).toHaveBeenCalledWith('/');
        });
    });

    describe('SEC-09 — the success screen says when the code stops working', () => {
        /*
         * The code used to last 24 hours and this screen said only "Share this code with team
         * members to invite them". A coach who registered at home on Sunday and read it out at
         * Tuesday's meeting handed every student "Invalid or expired invite code" — a true
         * statement, indistinguishable from a typo, on the one flow every team runs exactly once.
         *
         * The date asserted here is DERIVED FROM THE RPC's ANSWER, not from a constant in the
         * component: `create_team_as_admin` reads `expires_at` back off the row it inserted, so
         * a server that changed the lifetime would change this screen without a client release.
         * Asserting a hardcoded "7 days" string instead would pass whatever the server said.
         */
        const reachComplete = async () => {
            render(<CreateTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByRole('button', { name: /next/i }));
            fireEvent.change(screen.getByPlaceholderText('e.g., Falcon Force'), {
                target: { value: 'Valid Team' },
            });
            fireEvent.change(screen.getByPlaceholderText('e.g., 2026-2027 Season'), {
                target: { value: '2026-2027 Season' },
            });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            await screen.findByText('Team Created Successfully!');
        };

        it('prints the expiry the server actually chose', async () => {
            const expires = new Date('2026-09-12T18:30:00.000Z');
            rpcMock().mockResolvedValue({
                data: {
                    success: true,
                    team_id: 't1',
                    invite_code: 'CODE123',
                    invite_expires_at: expires.toISOString(),
                },
                error: null,
            });

            await reachComplete();

            const expected = expires.toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
            });
            expect(screen.getByText(new RegExp(`Works until ${expected}`))).toBeDefined();
        });

        it('says nothing rather than inventing a deadline when the server gave none', async () => {
            // A client running against a server that predates the RPC change. "Absent" is not
            // "expires today" and must not render as one — failure-modes §4.
            rpcMock().mockResolvedValue({
                data: { success: true, team_id: 't1', invite_code: 'CODE123' },
                error: null,
            });

            await reachComplete();

            expect(screen.getByText('CODE123')).toBeDefined();
            expect(screen.queryByText(/Works until/)).toBeNull();
        });
    });
});
