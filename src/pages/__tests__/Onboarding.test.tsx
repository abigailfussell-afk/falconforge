import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from '../Onboarding';

/**
 * Regression coverage for C2 — the "Complete Setup" path.
 *
 * `handleProfileComplete` used to call `useAuth()` inside the async submit handler
 * (Onboarding.tsx:180). That is an invalid hook call: React's dispatcher is null outside
 * render, so the call threw, the surrounding try/catch swallowed it, and the only thing a
 * user saw was a generic error where their profile should have been saved.
 *
 * The auth mock below is deliberately a *real hook* — it calls `useContext`, exactly like
 * the production `useAuth` does. A plain `vi.fn()` would happily return a value from an
 * async handler and this test would pass against the broken code, which is the whole
 * failure mode the rule exists to catch.
 */

const mocks = vi.hoisted(() => ({
    updateAgeClassification: vi.fn(),
    signOut: vi.fn(),
    ageClassification: null as string | null,
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
                user: { id: 'user-1', email: 'coach@example.com', user_metadata: { full_name: 'Coach Example' } },
                session: { access_token: 'token' },
                isLoading: false,
                isConfigured: true,
                ageClassification: mocks.ageClassification,
                signOut: mocks.signOut,
                updateAgeClassification: mocks.updateAgeClassification,
            };
        },
        AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    };
});

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return { ...actual, useNavigate: () => mocks.navigate };
});

const renderOnboarding = () =>
    render(
        <MemoryRouter>
            <Onboarding />
        </MemoryRouter>
    );

/** Drive the CompleteProfileForm to a submittable state and press Complete Setup. */
const completeSetupAs18Plus = async () => {
    const form = await screen.findByRole('button', { name: /complete setup/i });
    fireEvent.click(screen.getByRole('radio', { name: /18 or older/i }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(form);
};

describe('Onboarding — forced profile completion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // No age on the account yet, which is what forces the Complete Setup screen.
        mocks.ageClassification = null;
        mocks.updateAgeClassification.mockResolvedValue({ error: null, success: true });
    });

    it('shows the Complete Setup form when the account has no age classification', async () => {
        renderOnboarding();

        expect(await screen.findByRole('button', { name: /complete setup/i })).toBeInTheDocument();
        expect(screen.getByText(/complete your profile configuration/i)).toBeInTheDocument();
    });

    it('submits the selected age through the auth context and confirms success', async () => {
        renderOnboarding();
        await completeSetupAs18Plus();

        // Fails against the C2 bug: the invalid hook call throws before this ever runs.
        await waitFor(() => {
            expect(mocks.updateAgeClassification).toHaveBeenCalledWith('18_plus');
        });
        expect(await screen.findByText(/profile complete!/i)).toBeInTheDocument();
    });

    it('surfaces the API error message when the update fails', async () => {
        mocks.updateAgeClassification.mockResolvedValue({
            error: { message: 'Age update rejected' },
            success: false,
        });

        renderOnboarding();
        await completeSetupAs18Plus();

        expect(await screen.findByText('Age update rejected')).toBeInTheDocument();
        expect(screen.queryByText(/profile complete!/i)).toBeNull();
    });

    it('skips the Complete Setup screen once an age classification exists', async () => {
        mocks.ageClassification = '18_plus';

        renderOnboarding();

        expect(await screen.findByTestId('team-picker')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /complete setup/i })).toBeNull();
    });
});
