import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import JoinTeam from '../JoinTeam';
import * as authObj from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../lib/store';

const mockSignOut = vi.fn();
const mockUpdateAgeClassification = vi.fn();

// Mock auth hook
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
        signOut: mockSignOut,
        updateAgeClassification: mockUpdateAgeClassification,
    })),
}));

// Mock supabase
vi.mock('../../lib/supabase', () => ({
    supabase: {
        rpc: vi.fn().mockResolvedValue({ 
            data: { success: true, team_name: 'Test Team', status: 'pending' }, 
            error: null 
        }),
    },
}));

// Mock store
vi.mock('../../lib/store', () => ({
    useAppStore: {
        getState: vi.fn(() => ({
            resetToDefaults: vi.fn(),
        })),
    },
}));

// Mock offline DB clear functions
vi.mock('../../lib/offline-db', () => ({
    clearLocalDatabase: vi.fn().mockResolvedValue(undefined),
    clearAppState: vi.fn().mockResolvedValue(undefined),
}));

const mockNavigate = vi.fn();
let mockParams = { code: 'ABC12345' };

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
        useParams: () => mockParams,
        Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
            <a href={to}>{children}</a>
        ),
    };
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>{children}</BrowserRouter>
);

describe('JoinTeam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockParams = { code: 'ABC12345' };
        
        mockSignOut.mockResolvedValue({ error: null });
        mockUpdateAgeClassification.mockResolvedValue({ success: true, error: null });
        
        (authObj.useAuth as any).mockReturnValue({
            user: { id: 'user-1', email: 'test@example.com' },
            session: { access_token: 'token' },
            isLoading: false,
            isConfigured: true,
            ageClassification: '18_plus',
            signOut: mockSignOut,
            updateAgeClassification: mockUpdateAgeClassification,
        });

        (supabase.rpc as any).mockResolvedValue({ 
            data: { success: true, team_name: 'Test Team', status: 'pending' }, 
            error: null 
        });
    });

    describe('State Variations', () => {
        it('shows configuration required when Supabase is not configured', () => {
            (authObj.useAuth as any).mockReturnValue({
                isConfigured: false,
                signOut: mockSignOut
            });
            render(<JoinTeam />, { wrapper: TestWrapper });
            expect(screen.getByText('Configuration Required')).toBeDefined();
            expect(screen.getByText(/Supabase is not configured/i)).toBeDefined();
            expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
        });

        it('shows sign in prompt if not authenticated', () => {
            (authObj.useAuth as any).mockReturnValue({
                user: null,
                isConfigured: true,
            });
            render(<JoinTeam />, { wrapper: TestWrapper });
            expect(screen.getByText('Join a Team')).toBeDefined();
            expect(screen.getByText('Sign In / Create Account')).toBeDefined();
        });

        it('shows complete profile form if age classification is missing', () => {
            (authObj.useAuth as any).mockReturnValue({
                user: { id: 'user-1' },
                isConfigured: true,
                ageClassification: null,
                signOut: mockSignOut,
                updateAgeClassification: mockUpdateAgeClassification,
            });
            render(<JoinTeam />, { wrapper: TestWrapper });
            expect(screen.getByText('Complete Your Profile')).toBeDefined();
            expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
        });
    });

    describe('Main Form', () => {
        it('pre-fills invite code from URL parameters', () => {
            render(<JoinTeam />, { wrapper: TestWrapper });
            const input = screen.getByPlaceholderText('Enter invite code') as HTMLInputElement;
            expect(input.value).toBe('ABC12345');
        });

        it('disables join button if code is less than 6 characters', () => {
            mockParams = { code: '' }; // No code in URL
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            const joinButton = screen.getByRole('button', { name: /Join Team/i }) as HTMLButtonElement;
            expect(joinButton.disabled).toBe(true);
            
            const input = screen.getByPlaceholderText('Enter invite code');
            fireEvent.change(input, { target: { value: 'SHORT' } });
            
            expect(joinButton.disabled).toBe(true);
            
            fireEvent.change(input, { target: { value: 'EXACT6' } });
            expect(joinButton.disabled).toBe(false);
        });
    });

    describe('Submission', () => {
        it('handles RPC error correctly', async () => {
            (supabase.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'Invalid code provided' } });
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            expect(await screen.findByText('Invalid code provided')).toBeDefined();
        });

        it('handles fail flag from RPC response', async () => {
            (supabase.rpc as any).mockResolvedValueOnce({ data: { success: false, error: 'Team is full' }, error: null });
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            expect(await screen.findByText('Team is full')).toBeDefined();
        });

        it('submits successfully and shows success state', async () => {
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            await waitFor(() => {
                expect(supabase.rpc).toHaveBeenCalledWith('join_team_with_invite', { invite_code: 'ABC12345' });
            });
            
            expect(await screen.findByText('Request Submitted!')).toBeDefined();
            expect(screen.getByText('Test Team')).toBeDefined();
            expect(screen.getByText(/Pending Coach Approval/i)).toBeDefined();
            
            fireEvent.click(screen.getByRole('button', { name: /View My Teams/i }));
            expect(mockNavigate).toHaveBeenCalledWith('/onboarding');
        });
    });

    describe('Profile Completion', () => {
        it('updates age classification and advances on success', async () => {
            (authObj.useAuth as any).mockReturnValue({
                user: { id: 'user-1' },
                isConfigured: true,
                ageClassification: null,
                signOut: mockSignOut,
                updateAgeClassification: mockUpdateAgeClassification,
            });
            
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            // Should be on profile completion
            expect(screen.getByText('Complete Your Profile')).toBeDefined();
            
            const adultRadio = document.querySelector('input[value="18_plus"]') as HTMLInputElement;
            fireEvent.click(adultRadio);
            fireEvent.click(screen.getByRole('checkbox'));
            
            fireEvent.click(screen.getByRole('button', { name: /Save and Continue/i }));
            
            await waitFor(() => {
                expect(mockUpdateAgeClassification).toHaveBeenCalledWith('18_plus');
            });
        });

        it('shows error if age classification update fails', async () => {
            mockUpdateAgeClassification.mockResolvedValueOnce({ success: false, error: { message: 'Network down' } });
            
            (authObj.useAuth as any).mockReturnValue({
                user: { id: 'user-1' },
                isConfigured: true,
                ageClassification: null,
                signOut: mockSignOut,
                updateAgeClassification: mockUpdateAgeClassification,
            });
            
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            const adultRadio = document.querySelector('input[value="18_plus"]') as HTMLInputElement;
            fireEvent.click(adultRadio);
            fireEvent.click(screen.getByRole('checkbox'));
            
            fireEvent.click(screen.getByRole('button', { name: /Save and Continue/i }));
            
            expect(await screen.findByText('Network down')).toBeDefined();
        });
    });

    describe('Sign Out process', () => {
        it('handles sign out through the log out button', async () => {
            (authObj.useAuth as any).mockReturnValue({
                isConfigured: false,
                signOut: mockSignOut
            });
            
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
            
            await waitFor(() => {
                expect(mockSignOut).toHaveBeenCalled();
            });
            
            expect(screen.getByText('Signing out securely...')).toBeDefined();
        });
    });
});
