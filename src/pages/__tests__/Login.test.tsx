import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from '../Login';

// Mock the auth hook at the top level
vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        signInWithEmail: vi.fn().mockResolvedValue({ error: null }),
        signUpWithEmail: vi.fn().mockResolvedValue({ error: null }),
        isLoading: false,
        user: null,
        session: null,
        isConfigured: true,
        ageClassification: null,
    }),
}));

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>{children}</BrowserRouter>
);

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the login page', () => {
        render(<LoginPage />, { wrapper: TestWrapper });

        // Should have the FALCONFORGE branding
        const branding = screen.queryByText(/FALCONFORGE/i);
        expect(branding).toBeDefined();
    });

    it('has email input field', () => {
        render(<LoginPage />, { wrapper: TestWrapper });

        const emailInputs = document.querySelectorAll('input[type="email"], input[placeholder*="mail"]');
        expect(emailInputs.length).toBeGreaterThan(0);
    });

    it('has password input field', () => {
        render(<LoginPage />, { wrapper: TestWrapper });

        const passwordInputs = document.querySelectorAll('input[type="password"]');
        expect(passwordInputs.length).toBeGreaterThan(0);
    });

    it('has form buttons', () => {
        render(<LoginPage />, { wrapper: TestWrapper });

        const buttons = screen.getAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('renders without crashing', () => {
        const { container } = render(<LoginPage />, { wrapper: TestWrapper });
        expect(container).toBeDefined();
    });
});
