import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import LoginPage, { SIGNUP_NEUTRAL_MESSAGE } from '../Login';
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

    /**
     * OPS-06 — the two failures that will happen on kickoff evening.
     *
     * Resend Free is 100 emails a day and a 20-member team costs ~23, so four teams onboarding
     * on the same evening exhausts it; Supabase's own cap is 100/hour. Both arrived as a bare
     * GoTrue sentence with no suggestion of what to do, in front of twenty students.
     */
    describe('email-ceiling failures say what to do (OPS-06)', () => {
        const submitSignIn = () => {
            render(<LoginPage />, { wrapper: TestWrapper });
            fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'coach@example.com' } });
            fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
            fireEvent.submit(document.querySelector('form')!);
        };

        it('explains Resend’s daily ceiling and says when to come back', async () => {
            mockSignInWithEmail.mockResolvedValueOnce({
                error: new Error('Error sending confirmation email'),
            });
            submitSignIn();

            const shown = await screen.findAllByText(/try again in an hour/i);
            expect(shown.length).toBeGreaterThan(0);
            // And it must say the failure is not the user's fault, because the raw string
            // reads exactly like a rejected email address.
            expect(document.body.textContent).toMatch(/not a problem with your details/i);
            expect(
                screen.queryByText('Error sending confirmation email'),
                'the raw GoTrue string reached the screen',
            ).toBeNull();
        });

        it('explains Supabase’s hourly cap', async () => {
            mockSignInWithEmail.mockResolvedValueOnce({
                error: new Error('email rate limit exceeded'),
            });
            submitSignIn();

            const shown = await screen.findAllByText(/Too many emails have been sent/i);
            expect(shown.length).toBeGreaterThan(0);
            expect(document.body.textContent).toMatch(/nothing has been lost/i);
        });

        it('leaves every other message alone — the control', async () => {
            // The mapping is a substring match on a string GoTrue could reword at any time.
            // Passing anything unrecognised straight through means a rewording costs the user
            // nothing they were not already getting, instead of a friendly sentence about the
            // wrong problem.
            mockSignInWithEmail.mockResolvedValueOnce({
                error: new Error('Invalid login credentials'),
            });
            submitSignIn();

            const shown = await screen.findAllByText('Invalid login credentials');
            expect(shown.length).toBeGreaterThan(0);
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
            expect(await screen.findByText(/Check your email/i)).toBeDefined();
            expect(screen.getByText('Sign in to your account')).toBeDefined();
        });

        /*
         * SEC-13. THIS TEST CHANGED, and the behaviour it used to assert is the finding.
         *
         * It required the words "An account with this email already exists" — a straight answer
         * to "does this person have an account here?", available to anyone with the signup form
         * and a list of addresses, on a product whose users are mostly minors. The test was
         * correct about what the code did; the code was the problem.
         *
         * It was also asserting a branch that cannot fire in either environment: with
         * `mailer_autoconfirm: false` GoTrue returns an obfuscated fake user rather than an
         * error (`docs/environment-divergences.md` §1). So the leak was dormant behind one
         * dashboard toggle, and the test would have gone on passing whichever way the toggle
         * went — green in the safe configuration and green in the unsafe one.
         */
        it('says exactly the same thing whether or not the address is already registered', async () => {
            const signUp = async () => {
                render(<LoginPage />, { wrapper: TestWrapper });
                fireEvent.click(screen.getByText('Sign up'));
                const inputs = screen.getAllByRole('textbox');
                fireEvent.change(inputs[0], { target: { value: 'John Doe' } });
                fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@example.com' } });
                fireEvent.change(screen.getByTestId('password-input'), { target: { value: 'password123' } });
                fireEvent.click(screen.getByTestId('continue-button'));
                await waitFor(() => expect(screen.getByText('Complete your profile')).toBeDefined());
                const adultRadio = document.querySelector('input[value="18_plus"]') as HTMLInputElement;
                fireEvent.click(adultRadio);
                fireEvent.click(screen.getByRole('checkbox'));
                fireEvent.click(screen.getByText('Create Account'));
                const node = await screen.findByText(/Check your email/i);
                return node.textContent ?? '';
            };

            // A new address: signup succeeds and a confirmation is genuinely on its way.
            mockSignUpWithEmail.mockResolvedValueOnce({ user: { id: 'new-user' }, error: null });
            const asNewAddress = await signUp();
            cleanup();

            // A known address, in the configuration where GoTrue DOES return the error.
            mockSignUpWithEmail.mockResolvedValueOnce({ error: new Error('User already registered') });
            const asKnownAddress = await signUp();

            /*
             * CHARACTER-IDENTICAL, not "both match /check your email/i".
             *
             * A pattern match is satisfied by two different strings, and the difference does not
             * have to be large to be an oracle — a trailing full stop is enough to diff across
             * two submissions. Comparing the rendered text is the only version of this assertion
             * that fails when the two branches drift apart, which is the way this regresses.
             */
            expect(asKnownAddress).toBe(asNewAddress);
            expect(asNewAddress).toContain(SIGNUP_NEUTRAL_MESSAGE);

            // And it must not answer the question in either direction.
            expect(asNewAddress.toLowerCase()).not.toMatch(/already (exists|registered)/);
            expect(asNewAddress.toLowerCase()).not.toMatch(/account created/);
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
