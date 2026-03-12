import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage from '../Login';
import * as authObj from '../../lib/auth';

// Mock the auth hook at the top level
const mockSignInWithEmail = vi.fn();
const mockSignUpWithEmail = vi.fn();
const mockResetPassword = vi.fn();

vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        signInWithEmail: mockSignInWithEmail,
        signUpWithEmail: mockSignUpWithEmail,
        resetPassword: mockResetPassword,
        isLoading: false,
        user: null,
        session: null,
        isConfigured: true,
        ageClassification: null,
    })),
}));

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>{children}</BrowserRouter>
);

describe('LoginPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSignInWithEmail.mockResolvedValue({ error: null });
        mockSignUpWithEmail.mockResolvedValue({ error: null, user: { id: 'u1' } });
        mockResetPassword.mockResolvedValue({ error: null });
        
        // Reset the hook implementation to default
        (authObj.useAuth as any).mockReturnValue({
            signInWithEmail: mockSignInWithEmail,
            signUpWithEmail: mockSignUpWithEmail,
            resetPassword: mockResetPassword,
            isLoading: false,
            user: null,
            session: null,
            isConfigured: true,
            ageClassification: null,
        });
    });

    describe('Unconfigured State', () => {
        it('shows configuration required when Supabase is not configured', () => {
            (authObj.useAuth as any).mockReturnValue({
                isConfigured: false,
            });
            render(<LoginPage />, { wrapper: TestWrapper });
            expect(screen.getByText('Configuration Required')).toBeDefined();
            expect(screen.getByText(/Supabase Not Configured/i)).toBeDefined();
        });
    });

    describe('Login Mode', () => {
        it('renders login form by default', () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            expect(screen.getByText('Sign in to your account')).toBeDefined();
            expect(screen.getByTestId('email-input')).toBeDefined();
            expect(screen.getByTestId('password-input')).toBeDefined();
            expect(screen.getByTestId('sign-in-button')).toBeDefined();
        });

        it('calls signInWithEmail with credentials', async () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
            fireEvent.submit(document.querySelector('form')!);
            
            await waitFor(() => {
                expect(mockSignInWithEmail).toHaveBeenCalledWith('test@example.com', 'password123');
            });
        });

        it('displays error on login failure', async () => {
            mockSignInWithEmail.mockResolvedValueOnce({ error: new Error('Invalid credentials') });
            render(<LoginPage />, { wrapper: TestWrapper });
            
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'wrong' } });
            fireEvent.submit(document.querySelector('form')!);
            
            const errorMessages = await screen.findAllByText('Invalid credentials');
            expect(errorMessages.length).toBeGreaterThan(0);
        });
    });

    describe('Signup Mode', () => {
        it('switches to signup mode and validates step 1', async () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            
            // Switch to signup
            fireEvent.click(screen.getByText('Sign up'));
            expect(screen.getByText('Create your account')).toBeDefined();
            
            // Try submitting empty
            fireEvent.submit(document.querySelector('form')!);
            const nameErrors = await screen.findAllByText('Please enter your full name');
            expect(nameErrors.length).toBeGreaterThan(0);
            
            // Fill name, invalid email
            const inputs = screen.getAllByRole('textbox');
            fireEvent.change(inputs[0], { target: { value: 'John Doe' } }); // Name
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'invalid' } });
            fireEvent.submit(document.querySelector('form')!);
            const emailErrors = await screen.findAllByText('Please enter a valid email address');
            expect(emailErrors.length).toBeGreaterThan(0);
            
            // Fill valid email, short password
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: '123' } });
            fireEvent.click(screen.getByTestId('continue-button'));
            const passErrors = await screen.findAllByText('Password must be at least 6 characters');
            expect(passErrors.length).toBeGreaterThan(0);
            
            // Fill valid everything and proceed to step 2
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
            fireEvent.click(screen.getByTestId('continue-button'));
            
            expect(await screen.findByText('Complete your profile')).toBeDefined();
        });

        it('completes signup in step 2', async () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            
            // Step 1
            fireEvent.click(screen.getByText('Sign up'));
            const inputs = screen.getAllByRole('textbox');
            fireEvent.change(inputs[0], { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
            fireEvent.click(screen.getByTestId('continue-button'));
            
            // Step 2 should be visible
            await waitFor(() => {
                expect(screen.getByText('Complete your profile')).toBeDefined();
            });
            
            // For Step 2, we need to click the student/age classification
            const adultRadio = document.querySelector('input[value="18_plus"]') as HTMLInputElement;
            fireEvent.click(adultRadio);
            
            // Accept privacy
            const checkbox = screen.getByRole('checkbox');
            fireEvent.click(checkbox);
            
            // Submit Step 2
            fireEvent.click(screen.getByText('Create Account'));
            
            await waitFor(() => {
                expect(mockSignUpWithEmail).toHaveBeenCalledWith('test@example.com', 'password123', 'John Doe', '18_plus');
            });
            
            // Should show success and switch back to login
            expect(await screen.findByText(/Account created! Please check your email/i)).toBeDefined();
            expect(screen.getByText('Sign in to your account')).toBeDefined();
        });

        it('handles duplicate email during signup step 2', async () => {
            mockSignUpWithEmail.mockResolvedValueOnce({ error: new Error('User already registered') });
            render(<LoginPage />, { wrapper: TestWrapper });
            
            // Step 1
            fireEvent.click(screen.getByText('Sign up'));
            const inputs = screen.getAllByRole('textbox');
            fireEvent.change(inputs[0], { target: { value: 'John Doe' } });
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
            fireEvent.click(screen.getByTestId('continue-button'));
            
            await waitFor(() => expect(screen.getByText('Complete your profile')).toBeDefined());
            
            // Step 2
            const adultRadio = document.querySelector('input[value="18_plus"]') as HTMLInputElement;
            fireEvent.click(adultRadio);
            fireEvent.click(screen.getByRole('checkbox'));
            fireEvent.click(screen.getByText('Create Account'));
            
            const errorMsgs = await screen.findAllByText(/An account with this email already exists/i);
            expect(errorMsgs.length).toBeGreaterThan(0);
        });
    });

    describe('Forgot Password Mode', () => {
        it('switches to forgot mode and sends reset link', async () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            
            fireEvent.click(screen.getByText('Forgot password?'));
            expect(screen.getByText('Reset your password')).toBeDefined();
            
            // Password input should not be there anymore
            expect(screen.queryByTestId('password-input')).toBeNull();
            
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
            fireEvent.click(screen.getByTestId('reset-button'));
            
            await waitFor(() => {
                expect(mockResetPassword).toHaveBeenCalledWith('test@example.com');
            });
            
            expect(await screen.findByText('Password reset email sent!')).toBeDefined();
        });
    });
});
