import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JoinTeam from '../JoinTeam';

/**
 * Regression coverage for B26 — C2's invalid hook call, still live in JoinTeam.
 *
 * Sprint 1 fixed `useAuth()`-inside-an-async-handler in `Onboarding.tsx` and did not check
 * whether the same shape existed anywhere else. It did: `JoinTeam.tsx:100` called
 * `useAuth().updateAgeClassification(...)` from inside `handleProfileComplete`. React's
 * dispatcher is null outside render, so the call threw, the `catch (err: any)` two lines
 * below swallowed it, and a student completing the age profile that the join flow *forces*
 * on them saw "An unexpected error occurred" with no way forward. Found in Sprint 8's
 * retrospective by `react-hooks/rules-of-hooks`, which the repo had never run.
 *
 * This file exists separately from `JoinTeam.test.tsx` on purpose. That file mocks `useAuth`
 * as a plain `vi.fn(() => ({ ... }))`, which returns happily from an async handler and so
 * **passes against the bug** — the exact trap documented on the Onboarding C2 test. The mock
 * here is a genuine hook: it calls `useContext`, so it throws anywhere but a render.
 *
 * See docs/failure-modes.md §1 (tests structurally incapable of failing) and §12.
 */

const mocks = vi.hoisted(() => ({
    updateAgeClassification: vi.fn(),
    signOut: vi.fn(),
    navigate: vi.fn(),
}));

vi.mock('../../lib/auth', async () => {
    const { createContext, useContext } = await import('react');
    const ProbeContext = createContext<null>(null);

    return {
        useAuth: () => {
            // Genuine hook usage: throws if this runs anywhere but a component render.
            useContext(ProbeContext);
            return {
                user: { id: 'user-1', email: 'student@example.com' },
                session: { access_token: 'token' },
                isLoading: false,
                isConfigured: true,
                // Null is what forces the Complete Your Profile screen in the join flow.
                ageClassification: null,
                signOut: mocks.signOut,
                updateAgeClassification: mocks.updateAgeClassification,
            };
        },
        AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

/*
 * `supabaseSync` is here because `useApprovalWatch` (WALK-B-05) reads `team_members` through
 * it. It answers with no rows, which is the "nothing has changed" case — these tests are about
 * the join form and must not be advanced into a team by a background poll.
 */
vi.mock('../../lib/supabase', () => ({
    supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: () => ({ is: async () => ({ data: [], error: null }) }),
            }),
        }),
    },
}));

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => mocks.navigate };
});

const renderJoinTeam = () =>
    render(
        <MemoryRouter>
            <JoinTeam />
        </MemoryRouter>
    );

describe('JoinTeam — forced profile completion (B26)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateAgeClassification.mockResolvedValue({ error: null, success: true });
    });

    it('submits the selected age through the auth context rather than a hook call in the handler', async () => {
        renderJoinTeam();

        fireEvent.click(await screen.findByRole('radio', { name: /18 or older/i }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

        // Fails against B26: the invalid hook call throws before this ever runs, and the
        // handler's own catch turns it into a generic on-screen error.
        await waitFor(() => {
            expect(mocks.updateAgeClassification).toHaveBeenCalledWith('18_plus');
        });
        expect(screen.queryByText(/an unexpected error occurred/i)).not.toBeInTheDocument();
    });

    it('surfaces the API error message when the update genuinely fails', async () => {
        mocks.updateAgeClassification.mockResolvedValue({
            error: { message: 'Age update refused' },
            success: false,
        });
        renderJoinTeam();

        fireEvent.click(await screen.findByRole('radio', { name: /18 or older/i }));
        fireEvent.click(screen.getByRole('checkbox'));
        fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

        expect(await screen.findByText(/age update refused/i)).toBeInTheDocument();
    });
});
