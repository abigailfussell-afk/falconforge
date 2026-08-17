import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import JoinTeam from '../JoinTeam';
import * as authObj from '../../lib/auth';
import { supabase } from '../../lib/supabase';

/**
 * Typed accessor for the stubbed client and hook.
 *
 * `(authObj.useAuth as any).mockReturnValue(...)` was written ten times in this file. This
 * is the same helper `auth.test.tsx` uses and it keeps the mock API typed while the returned
 * values stay deliberately partial — building a complete `AuthContextType` for every stub
 * would be pages of fields no test reads.
 */
const asMock = (fn: unknown): Mock => fn as Mock;

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

/*
 * The store, mocked as what it actually is: a SELECTOR-CALLABLE hook that also carries
 * `getState`.
 *
 * It used to be mocked as a bare object with `getState` only, which was enough while this page
 * read the store solely through `performSignOut`. Sprint 9 has it read `managedProfiles`
 * through the hook, and a mock that cannot represent the property under test is
 * `docs/failure-modes.md` §2 — so it is fixed here rather than worked around in the component.
 */
const mockStoreState = {
    resetToDefaults: vi.fn(),
    managedProfiles: [] as { id: string; fullName: string }[],
};
vi.mock('../../lib/store', () => ({
    useAppStore: Object.assign(
        (selector?: (s: typeof mockStoreState) => unknown) =>
            selector ? selector(mockStoreState) : mockStoreState,
        { getState: () => mockStoreState },
    ),
}));

// The page loads the guardian's children on mount; it has no team context of its own.
vi.mock('../../lib/server-pull', () => ({
    fetchGuardianData: vi.fn().mockResolvedValue(undefined),
}));

// Mock offline DB clear functions
vi.mock('../../lib/offline-db', () => ({
    clearLocalDatabase: vi.fn().mockResolvedValue(undefined),
    clearAppState: vi.fn().mockResolvedValue(undefined),
}));

// The shared sign-out helper, observable. It calls through to the auth `signOut` it is
// handed, so the behavioural assertions below still exercise the real path.
const mockPerformSignOut = vi.fn(async (signOut: () => Promise<void>) => {
    await signOut();
});
vi.mock('../../lib/sign-out', () => ({
    performSignOut: (signOut: () => Promise<void>) => mockPerformSignOut(signOut),
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
        
        asMock(authObj.useAuth).mockReturnValue({
            user: { id: 'user-1', email: 'test@example.com' },
            session: { access_token: 'token' },
            isLoading: false,
            isConfigured: true,
            ageClassification: '18_plus',
            signOut: mockSignOut,
            updateAgeClassification: mockUpdateAgeClassification,
        });

        asMock(supabase!.rpc).mockResolvedValue({ 
            data: { success: true, team_name: 'Test Team', status: 'pending' }, 
            error: null 
        });
    });

    describe('State Variations', () => {
        it('shows configuration required when Supabase is not configured', () => {
            asMock(authObj.useAuth).mockReturnValue({
                isConfigured: false,
                signOut: mockSignOut
            });
            render(<JoinTeam />, { wrapper: TestWrapper });
            expect(screen.getByText('Configuration Required')).toBeDefined();
            expect(screen.getByText(/Supabase is not configured/i)).toBeDefined();
            expect(screen.getByRole('button', { name: /Log Out/i })).toBeDefined();
        });

        it('shows sign in prompt if not authenticated', () => {
            asMock(authObj.useAuth).mockReturnValue({
                user: null,
                isConfigured: true,
            });
            render(<JoinTeam />, { wrapper: TestWrapper });
            expect(screen.getByText('Join a Team')).toBeDefined();
            expect(screen.getByText('Sign In / Create Account')).toBeDefined();
        });

        it('shows complete profile form if age classification is missing', () => {
            asMock(authObj.useAuth).mockReturnValue({
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
            asMock(supabase!.rpc).mockResolvedValueOnce({ data: null, error: { message: 'Invalid code provided' } });
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            expect(await screen.findByText('Invalid code provided')).toBeDefined();
        });

        it('handles fail flag from RPC response', async () => {
            asMock(supabase!.rpc).mockResolvedValueOnce({ data: { success: false, error: 'Team is full' }, error: null });
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            expect(await screen.findByText('Team is full')).toBeDefined();
        });

        it('submits successfully and shows success state', async () => {
            render(<JoinTeam />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByRole('button', { name: /Join Team/i }));
            
            await waitFor(() => {
                expect(supabase!.rpc).toHaveBeenCalledWith('join_team_with_invite', { invite_code: 'ABC12345' });
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
            asMock(authObj.useAuth).mockReturnValue({
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
            
            asMock(authObj.useAuth).mockReturnValue({
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
            asMock(authObj.useAuth).mockReturnValue({
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

        /*
         * REGRESSION: JoinTeam had its own sign-out.
         *
         * Sprint 1 collapsed two verbatim copies (App.tsx, Onboarding.tsx) into
         * `performSignOut` because a step missed in one copy leaks the previous user's data
         * into the next session on a shared team laptop. This third copy was missed, and it
         * had drifted exactly as predicted: it reset the store and cleared IndexedDB, but
         * never called `teardownRealtimeSubscription()` (so a live subscription could
         * repopulate the store after the reset) and never swept the `sb-*-auth-token` keys
         * (so the session survived in localStorage whenever the network call did not land).
         *
         * The test above cannot catch that — it asserts the auth `signOut` was called, and
         * BOTH implementations do that. What distinguishes them is which one runs the full
         * teardown, so that is what this asserts.
         */
        it('signs out through the shared helper, not its own copy of the teardown', async () => {
            asMock(authObj.useAuth).mockReturnValue({
                isConfigured: false,
                signOut: mockSignOut,
            });

            render(<JoinTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));

            await waitFor(() => {
                expect(mockPerformSignOut).toHaveBeenCalledTimes(1);
            });
            // Handed the auth signOut, so the helper's timeout handling wraps the real call.
            expect(mockPerformSignOut).toHaveBeenCalledWith(mockSignOut);
        });
    });
});
