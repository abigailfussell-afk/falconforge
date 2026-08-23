import React, { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Mail, Lock, User, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import { CompleteProfileForm } from '../components/auth/CompleteProfileForm';
import type { AgeClassification } from '../types';
import { recordAttestation, SIGNUP_REQUIRED_ATTESTATIONS } from '../lib/attestations';
import { friendlyAuthError } from '../lib/auth-error-copy';

/**
 * What a person is told after submitting the sign-up form — WHETHER OR NOT the address is
 * already registered (SEC-13).
 *
 * ONE CONSTANT, USED BY BOTH BRANCHES, and that is the whole mechanism. Two strings that happen
 * to read alike are one edit away from differing, and the difference does not have to be large
 * to be an oracle: a trailing full stop, a different verb tense, anything an attacker can
 * diff across two submissions tells them whether an address is in the database. Making it a
 * single reference means the paths cannot drift, and
 * `src/pages/__tests__/Login.test.tsx` asserts the two rendered messages are character-identical
 * rather than merely both matching a pattern.
 *
 * The wording has to be true in both cases at once, which is why it does not say "account
 * created": for a returning user nothing was created, no email is coming, and the old copy's
 * "check your email to verify your account" left them waiting for a message that never arrives.
 */
export const SIGNUP_NEUTRAL_MESSAGE =
    'Check your email. If this address is new, a confirmation link is on its way. ' +
    'If you already have an account, nothing has changed — sign in below, or reset your ' +
    'password if you have forgotten it.';

type AuthMode = 'login' | 'signup' | 'forgot';
type SignupStep = 1 | 2;

export default function LoginPage() {
    const { signInWithEmail, signUpWithEmail, resetPassword, isConfigured } = useAuth();
    const location = useLocation();
    
    // Check if we navigated here with ?mode=signup
    const searchParams = new URLSearchParams(location.search);
    const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';

    const [mode, setMode] = useState<AuthMode>(initialMode);
    const [signupStep, setSignupStep] = useState<SignupStep>(1);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    // Step 1: Just validate and move to step 2 (no account creation)
    const handleStep1Submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === 'login') {
                const { error } = await signInWithEmail(email, password);
                // Two of GoTrue's messages are email-ceiling failures a coach cannot act on
                // without being told to come back later (OPS-06). Everything else passes
                // through unchanged.
                if (error) setError(friendlyAuthError(error.message));
            } else if (mode === 'signup') {
                // Validate inputs locally
                if (!fullName.trim()) {
                    setError('Please enter your full name');
                    setIsLoading(false);
                    return;
                }
                if (!email.trim() || !email.includes('@')) {
                    setError('Please enter a valid email address');
                    setIsLoading(false);
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters');
                    setIsLoading(false);
                    return;
                }

                // Move to step 2 (no account created yet!)
                // Duplicate email check happens at final signup in Step 2
                setSignupStep(2);
            } else if (mode === 'forgot') {
                const { error } = await resetPassword(email);
                if (error) {
                    setError(friendlyAuthError(error.message));
                } else {
                    setMessage('Password reset email sent!');
                }
            }
        } catch (err) {
            setError('An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    // Step 2: Create the account with all information
    const handleStep2Submit = async (selectedAge: AgeClassification, isPrivacyAccepted: boolean) => {
        setIsLoading(true);
        setError(null);

        try {
            // NOW create the account with Supabase Auth - include age in user metadata
            const { error: signupError, user } = await signUpWithEmail(email.trim(), password, fullName.trim(), selectedAge);

            if (signupError) {
                /*
                 * SEC-17's sibling, SEC-13: THE SAME WORDS EITHER WAY.
                 *
                 * This branch used to say "An account with this email already exists" — which is
                 * a straight answer to "does this person have an account here?", asked by anyone
                 * with a signup form and a list of addresses. On a product whose users are
                 * mostly minors that is not an abstract concern.
                 *
                 * It is also a branch that CANNOT FIRE in either environment today. With
                 * `mailer_autoconfirm: false` (`docs/environment-divergences.md` §1) GoTrue
                 * deliberately returns an obfuscated fake user for an address it already knows,
                 * so signup "succeeds" and no email arrives. So the enumeration leak was
                 * dormant, waiting on one dashboard toggle nobody would connect to it —
                 * `SEC-14` is the finding about exactly that class of config.
                 *
                 * Collapsing it into `SIGNUP_NEUTRAL_MESSAGE` makes the app's answer independent
                 * of that setting instead of merely lucky. The user is not left stuck: the
                 * message tells them what to do if the account is theirs.
                 */
                if (signupError.message.toLowerCase().includes('already registered') ||
                    signupError.message.toLowerCase().includes('already exists')) {
                    setMessage(SIGNUP_NEUTRAL_MESSAGE);
                    setMode('login');
                } else {
                    setError(friendlyAuthError(signupError.message));
                }
                return;
            }

            if (!user) {
                setError('Failed to create account. Please try again.');
                return;
            }

            /*
             * Record the acceptance the form just collected.
             *
             * It was previously discarded -- the parameter was named `_isPrivacyAccepted` to
             * silence the unused-argument warning. `SIGNUP_REQUIRED_ATTESTATIONS` existed and
             * had exactly one consumer: `ReAttestationPrompt`, which CHECKS it. Nothing ever
             * WROTE it, so the checkbox on the sign-up form was consent the app asked for,
             * displayed a legal document for, and then did not keep.
             *
             * Two consequences, and the second is the one that gets noticed. A product whose
             * COPPA posture rests on attestation records was not recording the one every user
             * gives; and because the record was missing rather than merely old, every brand-new
             * account met "We've updated our legal documents ... since you last accepted them"
             * on its very first screen. Found by the registration smoke flow, on an account
             * thirty seconds old.
             *
             * Non-fatal by design: if confirmations are enabled there may be no session yet, and
             * an account that exists must not be lost to a failed audit write. ReAttestationPrompt
             * remains the backstop and will ask properly rather than spuriously.
             */
            if (isPrivacyAccepted) {
                for (const type of SIGNUP_REQUIRED_ATTESTATIONS) {
                    const result = await recordAttestation(type);
                    if (!result.success) {
                        console.warn(`Could not record ${type} at sign-up:`, result.error);
                    }
                }
            }

            /*
             * The same words the duplicate branch above uses, and it has to be exactly the same
             * string rather than a similar one — see SIGNUP_NEUTRAL_MESSAGE.
             *
             * The old text was "Account created! Please check your email to verify your account,
             * then sign in." For a returning user that is three claims and all three are false:
             * no account was created, no email is coming, and there is nothing to verify. They
             * wait, nothing arrives, and they write to support (SEC-13's actual cost). The new
             * wording is true in both cases without saying which one happened.
             */
            setMessage(SIGNUP_NEUTRAL_MESSAGE);
            setSignupStep(1);
            setMode('login');

            // Reset signup form
            setFullName('');
            setPassword('');

        } catch (err: any) {
            console.error('Exception during signup:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsLoading(false);
        }
    };

    const handleModeChange = (newMode: AuthMode) => {
        setMode(newMode);
        setSignupStep(1);
        setError(null);
        setMessage(null);
    };

    const handleBackToStep1 = () => {
        setSignupStep(1);
        setError(null);
    };

    // Supabase must be configured
    if (!isConfigured) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="max-w-md w-full">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-forge-500 to-forge-600 rounded-2xl shadow-lg shadow-forge-500/25 mb-4 p-1">
                            <img
                                src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                className="w-full h-full object-contain"
                                alt="FalconForge Logo"
                            />
                        </div>
                        <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                        <p className="text-slate-400">Configuration Required</p>
                    </div>

                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                            <p className="text-red-200 text-sm">
                                <strong>Supabase Not Configured:</strong> This app requires Supabase for authentication and data storage.
                                Please configure your Supabase credentials in <code className="bg-slate-700 px-1 rounded">.env.local</code>:
                            </p>
                            <ul className="text-red-300 text-xs mt-2 space-y-1 list-disc list-inside">
                                <li>VITE_SUPABASE_URL</li>
                                <li>VITE_SUPABASE_ANON_KEY</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4 relative">
            <Link 
                to="/"
                className="absolute top-4 left-4 sm:top-6 sm:left-6 p-2 text-slate-400 bg-slate-800/50 rounded-full border border-slate-700 hover:bg-slate-700/50 hover:text-white transition-all shadow-sm flex items-center gap-2"
                title="Back to Landing Page"
            >
                <ArrowLeft className="w-5 h-5" />
                <span className="font-medium hidden sm:block pr-2 text-sm">Return Home</span>
            </Link>

            <div className="max-w-md w-full">
                {/* Logo & Title */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 mb-4 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge Logo"
                        />
                    </div>
                    <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-forge-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                    <p className="text-slate-400">
                        {mode === 'login' && 'Sign in to your account'}
                        {mode === 'signup' && signupStep === 1 && 'Create your account'}
                        {mode === 'signup' && signupStep === 2 && 'Complete your profile'}
                        {mode === 'forgot' && 'Reset your password'}
                    </p>

                    {/* Step indicator for signup - simple dashes */}
                    {mode === 'signup' && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                            <div className={`h-1 w-12 rounded-full ${signupStep >= 1 ? 'bg-forge-500' : 'bg-slate-700'}`} />
                            <div className={`h-1 w-12 rounded-full ${signupStep >= 2 ? 'bg-forge-500' : 'bg-slate-700'}`} />
                        </div>
                    )}
                </div>

                {/* Auth Card */}
                <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                    {/* Error/Message Display */}
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-4">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}
                    {message && (
                        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 mb-4">
                            <p className="text-green-400 text-sm">{message}</p>
                        </div>
                    )}

                    {/* STEP 1: Login / Signup credentials / Forgot */}
                    {(mode !== 'signup' || signupStep === 1) && (
                        <form onSubmit={handleStep1Submit} className="space-y-4">
                            {mode === 'signup' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Full Name</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            type="text"
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500 focus:border-transparent"
                                            placeholder="John Smith"
                                            required
                                        />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500 focus:border-transparent"
                                        placeholder="you@team12345.org"
                                        required
                                        autoFocus={mode === 'login'}
                                        data-testid="email-input"
                                    />
                                </div>
                            </div>

                            {mode !== 'forgot' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                                        <input
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-forge-500 focus:border-transparent"
                                            placeholder="••••••••"
                                            required
                                            minLength={6}
                                            data-testid="password-input"
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-forge-500 to-forge-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-forge-600 hover:to-forge-700 transition-all shadow-lg shadow-forge-500/25 disabled:opacity-50"
                                data-testid={mode === 'login' ? 'sign-in-button' : mode === 'signup' ? 'continue-button' : 'reset-button'}
                            >
                                {isLoading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" data-testid="loading-spinner" />
                                ) : (
                                    <>
                                        {mode === 'login' && 'Sign In'}
                                        {mode === 'signup' && 'Continue'}
                                        {mode === 'forgot' && 'Send Reset Link'}
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    )}

                    {/* STEP 2: Age + Privacy/Guidelines */}
                    {mode === 'signup' && signupStep === 2 && (
                        <CompleteProfileForm
                            isLoading={isLoading}
                            error={error}
                            onSubmit={handleStep2Submit}
                            submitLabel="Create Account"
                            showBackButton={true}
                            onBack={handleBackToStep1}
                        />
                    )}

                    {/* Mode Switchers */}
                    {(mode !== 'signup' || signupStep === 1) && (
                        <div className="mt-6 text-center text-sm">
                            {mode === 'login' && (
                                <>
                                    <button
                                        onClick={() => handleModeChange('forgot')}
                                        className="text-slate-400 hover:text-forge-400 transition-colors"
                                    >
                                        Forgot password?
                                    </button>
                                    <p className="mt-4 text-slate-400">
                                        Don't have an account?{' '}
                                        <button
                                            onClick={() => handleModeChange('signup')}
                                            className="text-forge-400 hover:text-forge-300 font-medium"
                                        >
                                            Sign up
                                        </button>
                                    </p>
                                </>
                            )}
                            {mode === 'signup' && (
                                <p className="text-slate-400">
                                    Already have an account?{' '}
                                    <button
                                        onClick={() => handleModeChange('login')}
                                        className="text-forge-400 hover:text-forge-300 font-medium"
                                    >
                                        Sign in
                                    </button>
                                </p>
                            )}
                            {mode === 'forgot' && (
                                <button
                                    onClick={() => handleModeChange('login')}
                                    className="text-forge-400 hover:text-forge-300 font-medium"
                                >
                                    Back to sign in
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
