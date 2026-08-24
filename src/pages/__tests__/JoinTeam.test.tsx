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
/*
 * `supabaseSync` is here because `useApprovalWatch` (WALK-B-05) reads `team_members` through
 * it. It answers with no rows, which is the "nothing has changed" case — these tests are about
 * the join form and must not be advanced into a team by a background poll.
 */
vi.mock('../../lib/supabase', () => ({
    supabase: {
        rpc: vi.fn().mockResolvedValue({ 
            data: { success: true, team_name: 'Test Team', status: 'pending' }, 
            error: null 
        }),
    },
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: () => ({ is: async () => ({ data: [], error: null }) }),
            }),
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

/*
 * Mock offline DB.
 *
 * `getPendingSyncItems` is here because SEC-15's pre-join check reads the queue. A factory mock
 * throws when an omitted export is ACCESSED rather than when it is imported, so leaving it out
 * would have been invisible until a test set `joiningForProfileId` — which is exactly the drift
 * `mock-drift.test.ts` exists for, in the one place that file cannot see (an inline factory).
 */
const mockQueue = vi.fn().mockResolvedValue([] as unknown[]);
vi.mock('../../lib/offline-db', () => ({
    clearLocalDatabase: vi.fn().mockResolvedValue(undefined),
    clearAppState: vi.fn().mockResolvedValue(undefined),
    getPendingSyncItems: () => mockQueue(),
}));

/** The drain, observable and inert. Its real behaviour is covered by the sync suites. */
const mockDrain = vi.fn().mockResolvedValue({
    pushed: 0, retried: 0, deadLettered: 0, terminal: 0, cancelled: false,
});
vi.mock('../../lib/sync', () => ({
    drainSyncQueue: () => mockDrain(),
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

    /**
     * SEC-15 — a guardian who adds a child and joins in the same sitting.
     *
     * `join_team_with_invite_for_child` refuses unless the profile exists SERVER-side and carries
     * a `coppa_data_collection` consent. Both rows go through the sync queue, so the flow plan
     * section 3 describes — add the child, then enter the code, in one sitting — races the drain,
     * and the refusal a parent got was "This child has no consent on record" ten seconds after
     * they ticked the box. `docs/failure-modes.md` §4: not-yet-arrived read as an answer, and the
     * answer was about a legal record.
     */
    describe('Joining on behalf of a child whose profile has not synced yet (SEC-15)', () => {
        const CHILD = { id: 'profile-1', fullName: 'Zoë' };

        /** A queue holding this child's two rows, in the shape `queueForSync` writes. */
        const queuedForChild = () => [
            { id: 'q1', tableName: 'managed_profiles', recordId: CHILD.id, operation: 'create', data: {}, timestamp: 1, retryCount: 0 },
            { id: 'q2', tableName: 'guardian_consents', recordId: 'c1', operation: 'create', data: { managedProfileId: CHILD.id }, timestamp: 2, retryCount: 0 },
        ];

        /** Render, choose the child in the "Who is joining?" select, and submit. */
        const joinAsChild = async () => {
            render(<JoinTeam />, { wrapper: TestWrapper });
            fireEvent.change(screen.getByTestId('joining-for'), { target: { value: CHILD.id } });
            fireEvent.click(screen.getByTestId('join-submit'));
        };

        beforeEach(() => {
            mockStoreState.managedProfiles = [CHILD];
            mockDrain.mockClear();
        });

        it('drains the queue BEFORE asking the server about the child', async () => {
            // Queued on the first read, gone on the second: the drain worked.
            mockQueue.mockResolvedValueOnce(queuedForChild()).mockResolvedValueOnce([]);

            await joinAsChild();

            await waitFor(() => expect(mockDrain).toHaveBeenCalledTimes(1));
            expect(supabase!.rpc).toHaveBeenCalledWith('join_team_with_invite_for_child', {
                invite_code: 'ABC12345',
                p_managed_profile_id: CHILD.id,
            });
            /*
             * ORDER, not just "both happened". A drain that ran after the RPC would satisfy two
             * separate `toHaveBeenCalled` assertions and fix nothing — `docs/failure-modes.md`
             * §2's commonest shape.
             */
            expect(mockDrain.mock.invocationCallOrder[0]).toBeLessThan(
                asMock(supabase!.rpc).mock.invocationCallOrder[0],
            );
        });

        it('does not call the RPC at all when the rows are still queued afterwards', async () => {
            // Still queued after the drain — the server genuinely does not have the child, and
            // asking it would produce a refusal that blames the guardian for something they did
            // correctly.
            mockQueue.mockResolvedValue(queuedForChild());

            await joinAsChild();

            expect(await screen.findByText(/could not save Zoë’s profile/i)).toBeDefined();
            expect(supabase!.rpc).not.toHaveBeenCalled();
        });

        it('names the child and says nothing was lost', async () => {
            mockQueue.mockResolvedValue(queuedForChild());

            await joinAsChild();

            const message = (await screen.findByText(/could not save/i)).textContent ?? '';
            expect(message).toContain('Zoë');
            expect(message).toMatch(/nothing you entered has been lost/i);
        });

        it('does not drain at all for a child whose rows are already on the server', async () => {
            // A guardian joining with a child added last week pays nothing for this.
            mockQueue.mockResolvedValue([]);

            await joinAsChild();

            await waitFor(() => expect(supabase!.rpc).toHaveBeenCalled());
            expect(mockDrain).not.toHaveBeenCalled();
        });

        it('does not drain when the guardian is joining as themselves', async () => {
            // The queue may hold anything at all; none of it gates a join that names no child.
            mockQueue.mockResolvedValue(queuedForChild());

            render(<JoinTeam />, { wrapper: TestWrapper });
            fireEvent.click(screen.getByTestId('join-submit'));

            await waitFor(() =>
                expect(supabase!.rpc).toHaveBeenCalledWith('join_team_with_invite', {
                    invite_code: 'ABC12345',
                }),
            );
            expect(mockDrain).not.toHaveBeenCalled();
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
