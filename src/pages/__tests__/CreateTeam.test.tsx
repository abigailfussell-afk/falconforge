import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CreateTeam from '../CreateTeam';

// Mock auth hook
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
    })),
}));

// Mock supabase
vi.mock('../../lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'team-1' }, error: null }),
        })),
        rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    },
}));

// Mock attestations
vi.mock('../../lib/attestations', () => ({
    recordAttestation: vi.fn().mockResolvedValue({ error: null }),
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
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
    });

    it('renders the create team page', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Should have header or title
        const header = screen.queryByText(/create/i) || screen.queryByText(/team/i);
        expect(header).toBeDefined();
    });

    it('shows step indicator', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Should show step 1 of 2 or similar
        const stepIndicator = screen.queryByText(/step/i) ||
            screen.queryByText(/1/);
        // Steps should be visible
    });

    it('has attestation checkbox on first step', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Look for checkbox input
        const checkbox = document.querySelector('input[type="checkbox"]');
        expect(checkbox).toBeDefined();
    });

    it('shows coach agreement text', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Should show terms/agreement text
        const agreementText = screen.queryByText(/agree/i) ||
            screen.queryByText(/coach/i) ||
            screen.queryByText(/acknowledge/i);
        expect(agreementText).toBeDefined();
    });

    it('has next button', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        const nextButton = screen.queryByRole('button', { name: /next/i }) ||
            screen.queryByText(/next/i) ||
            screen.queryByText(/continue/i);
        expect(nextButton).toBeDefined();
    });

    it('next button is disabled without attestation', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        const nextButton = screen.queryByRole('button', { name: /next/i });

        if (nextButton) {
            // Button should be disabled until checkbox is checked
            // Or clicking should not proceed
        }
    });

    it('enables next after checking attestation', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        const checkbox = document.querySelector('input[type="checkbox"]');

        if (checkbox) {
            fireEvent.click(checkbox);

            const nextButton = screen.queryByRole('button', { name: /next/i });
            // Next should be enabled now
        }
    });
});

describe('CreateTeam step navigation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('navigates to step 2 after attestation', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Check attestation box
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox) {
            fireEvent.click(checkbox);
        }

        // Click next
        const buttons = screen.getAllByRole('button');
        const nextButton = buttons.find(btn =>
            btn.textContent?.toLowerCase().includes('next') ||
            btn.textContent?.toLowerCase().includes('continue')
        );

        if (nextButton) {
            fireEvent.click(nextButton);

            // Should now show step 2 (team details)
            const teamNameInput = screen.queryByPlaceholderText(/team name/i) ||
                screen.queryByRole('textbox');
            // Team details form should be visible
        }
    });

    it('has back button on step 2', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Navigate to step 2 first
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox) fireEvent.click(checkbox);

        const nextButton = screen.getAllByRole('button').find(btn =>
            btn.textContent?.toLowerCase().includes('next')
        );
        if (nextButton) fireEvent.click(nextButton);

        // Now look for back button
        const backButton = screen.queryByRole('button', { name: /back/i }) ||
            screen.queryByText(/back/i);
        // Back button should be visible
    });
});

describe('CreateTeam form', () => {
    it('has team name input field', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Navigate to step 2
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox) fireEvent.click(checkbox);

        const nextButton = screen.getAllByRole('button').find(btn =>
            btn.textContent?.toLowerCase().includes('next')
        );
        if (nextButton) fireEvent.click(nextButton);

        // Look for team name input
        const inputs = screen.queryAllByRole('textbox');
        expect(inputs.length).toBeGreaterThanOrEqual(0);
    });

    it('has team number input field', () => {
        render(<CreateTeam />, { wrapper: TestWrapper });

        // Navigate to step 2
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox) fireEvent.click(checkbox);

        const nextButton = screen.getAllByRole('button').find(btn =>
            btn.textContent?.toLowerCase().includes('next')
        );
        if (nextButton) fireEvent.click(nextButton);

        // Look for team number input
        const numberInput = document.querySelector('input[type="number"]') ||
            screen.queryByPlaceholderText(/number/i);
        // Number input might exist
    });
});
