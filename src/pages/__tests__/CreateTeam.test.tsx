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
vi.mock('../../lib/attestations', () => ({
    recordAttestation: vi.fn().mockResolvedValue({ success: true, error: null }),
}));

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
            
            expect(screen.getByText('Coach Agreement')).toBeDefined();
            
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
            expect(screen.getByText('Coach Agreement')).toBeDefined();
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
            fireEvent.change(screen.getByPlaceholderText('e.g., 12345'), { target: { value: '9999' } });
            fireEvent.click(screen.getByRole('button', { name: /create team/i }));
            
            await waitFor(() => {
                expect(recordAttestation).toHaveBeenCalledWith('coach_terms');
                expect(supabase!.rpc).toHaveBeenCalledWith('create_team_as_coach', {
                    team_name: 'Valid Team',
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
});
