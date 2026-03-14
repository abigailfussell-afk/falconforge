import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';
import { CompleteProfileForm } from '../components/auth/CompleteProfileForm';
import type { AgeClassification } from '../types';

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
                if (error) setError(error.message);
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
                    setError(error.message);
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
    const handleStep2Submit = async (selectedAge: AgeClassification, _isPrivacyAccepted: boolean) => {
        setIsLoading(true);
        setError(null);

        try {
            // NOW create the account with Supabase Auth - include age in user metadata
            const { error: signupError, user } = await signUpWithEmail(email.trim(), password, fullName.trim(), selectedAge);

            if (signupError) {
                // Handle duplicate email error specifically
                if (signupError.message.toLowerCase().includes('already registered') ||
                    signupError.message.toLowerCase().includes('already exists')) {
                    setError('An account with this email already exists. Please sign in instead.');
                } else {
                    setError(signupError.message);
                }
                return;
            }

            if (!user) {
                setError('Failed to create account. Please try again.');
                return;
            }

            // Success! Show email verification message
            setMessage('Account created! Please check your email to verify your account, then sign in.');
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
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-500/25 mb-4 p-1">
                            <img
                                src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                className="w-full h-full object-contain"
                                alt="FalconForge Logo"
                            />
                        </div>
                        <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
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
                    <h1 className="text-3xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h1>
                    <p className="text-slate-400">
                        {mode === 'login' && 'Sign in to your account'}
                        {mode === 'signup' && signupStep === 1 && 'Create your account'}
                        {mode === 'signup' && signupStep === 2 && 'Complete your profile'}
                        {mode === 'forgot' && 'Reset your password'}
                    </p>

                    {/* Step indicator for signup - simple dashes */}
                    {mode === 'signup' && (
                        <div className="flex items-center justify-center gap-2 mt-3">
                            <div className={`h-1 w-12 rounded-full ${signupStep >= 1 ? 'bg-orange-500' : 'bg-slate-700'}`} />
                            <div className={`h-1 w-12 rounded-full ${signupStep >= 2 ? 'bg-orange-500' : 'bg-slate-700'}`} />
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
                                            className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                                        className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                                            className="w-full pl-10 pr-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
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
                                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50"
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
                                        className="text-slate-400 hover:text-orange-400 transition-colors"
                                    >
                                        Forgot password?
                                    </button>
                                    <p className="mt-4 text-slate-400">
                                        Don't have an account?{' '}
                                        <button
                                            onClick={() => handleModeChange('signup')}
                                            className="text-orange-400 hover:text-orange-300 font-medium"
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
                                        className="text-orange-400 hover:text-orange-300 font-medium"
                                    >
                                        Sign in
                                    </button>
                                </p>
                            )}
                            {mode === 'forgot' && (
                                <button
                                    onClick={() => handleModeChange('login')}
                                    className="text-orange-400 hover:text-orange-300 font-medium"
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
