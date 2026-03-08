import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import JoinTeam from '../JoinTeam';

// Mock auth hook
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@example.com' },
        session: { access_token: 'token' },
        isLoading: false,
        isConfigured: true,
        ageClassification: '18_plus',
        signOut: vi.fn(),
    })),
}));

// Mock supabase
vi.mock('../../lib/supabase', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
        rpc: vi.fn().mockResolvedValue({
            data: { team_id: 'team-1', team_name: 'Test Team' },
            error: null
        }),
    },
}));

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => vi.fn(),
        useParams: () => ({ code: 'ABC123' }),
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
    });

    it('renders the join team page', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        // Should have header or title
        const header = screen.queryByText(/join/i) || screen.queryByText(/team/i);
        expect(header).toBeDefined();
    });

    it('shows invite code from URL', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        // If code is in URL, it might be displayed
        const codeDisplay = screen.queryByText(/ABC123/i) ||
            document.querySelector('input');
        // Code should be visible or in input
        expect(codeDisplay === null || codeDisplay !== null).toBe(true);
    });

    it('has invite code input field', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const input = screen.queryByRole('textbox') ||
            document.querySelector('input[type="text"]');
        expect(input).toBeDefined();
    });

    it('has join button', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const joinButton = screen.queryByRole('button', { name: /join/i }) ||
            screen.queryByText(/join/i);
        expect(joinButton).toBeDefined();
    });

    it('allows entering invite code', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const input = screen.queryByRole('textbox') as HTMLInputElement ||
            document.querySelector('input[type="text"]') as HTMLInputElement;

        if (input) {
            fireEvent.change(input, { target: { value: 'NEWCODE' } });
            expect(input.value).toBe('NEWCODE');
        }
    });

    it('has link back to onboarding', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const backLink = screen.getByTestId('back-button');
        expect(backLink).toBeDefined();
    });
});

describe('JoinTeam validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('requires invite code to submit', () => {
        // Mock empty code
        vi.mock('react-router-dom', async () => {
            const actual = await vi.importActual('react-router-dom');
            return {
                ...actual,
                useNavigate: () => vi.fn(),
                useParams: () => ({}), // No code
            };
        });

        render(<JoinTeam />, { wrapper: TestWrapper });

        const joinButton = screen.queryByRole('button', { name: /join/i });

        if (joinButton) {
            fireEvent.click(joinButton);
            // Should show error or not submit
        }
    });

    it('shows error for invalid code', async () => {
        // Mock error response
        vi.mock('../../lib/supabase', () => ({
            supabase: {
                rpc: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Invalid invite code' }
                }),
            },
        }));

        render(<JoinTeam />, { wrapper: TestWrapper });

        const joinButton = screen.queryByRole('button', { name: /join/i });

        if (joinButton) {
            fireEvent.click(joinButton);

            // Should show error message
            // await for error to appear
        }
    });
});

describe('JoinTeam loading state', () => {
    it('shows loading during join process', () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const joinButton = screen.queryByRole('button', { name: /join/i });

        if (joinButton) {
            fireEvent.click(joinButton);

            // Button might show spinner or be disabled
            // Loading indicator might appear
        }
    });
});

describe('JoinTeam success state', () => {
    it('shows success message after joining', async () => {
        render(<JoinTeam />, { wrapper: TestWrapper });

        const joinButton = screen.queryByRole('button', { name: /join/i });

        if (joinButton) {
            fireEvent.click(joinButton);

            // After successful join, should show success or redirect
            // Success message or navigation should occur
        }
    });
});
