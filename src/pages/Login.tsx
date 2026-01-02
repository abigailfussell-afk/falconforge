import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Bot, Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react';

type AuthMode = 'login' | 'signup' | 'forgot';

export default function LoginPage() {
    const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithMicrosoft, resetPassword, isConfigured } = useAuth();
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (mode === 'login') {
                const { error } = await signInWithEmail(email, password);
                if (error) setError(error.message);
            } else if (mode === 'signup') {
                const { error } = await signUpWithEmail(email, password, fullName);
                if (error) {
                    setError(error.message);
                } else {
                    setMessage('Check your email for a confirmation link!');
                }
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

    const handleGoogleSignIn = async () => {
        setIsLoading(true);
        setError(null);
        const { error } = await signInWithGoogle();
        if (error) {
            setError(error.message);
            setIsLoading(false);
        }
    };

    const handleMicrosoftSignIn = async () => {
        setIsLoading(true);
        setError(null);
        const { error } = await signInWithMicrosoft();
        if (error) {
            setError(error.message);
            setIsLoading(false);
        }
    };

    // Demo mode notice
    if (!isConfigured) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="max-w-md w-full">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-500/25 mb-4">
                            <Bot className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-3xl font-bold text-white mb-2">FTC Team Manager</h1>
                        <p className="text-slate-400">Running in Demo Mode</p>
                    </div>

                    <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700 rounded-2xl p-6 shadow-xl">
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
                            <p className="text-amber-200 text-sm">
                                <strong>Demo Mode:</strong> Cloud sync is disabled. Your data will be saved locally in this browser.
                                To enable authentication and cloud sync, configure your Supabase credentials in <code className="bg-slate-700 px-1 rounded">.env.local</code>
                            </p>
                        </div>

                        <a
                            href="/"
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-500/25"
                        >
                            Continue to App
                            <ArrowRight className="w-4 h-4" />
                        </a>
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
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl shadow-lg shadow-orange-500/25 mb-4">
                        <Bot className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">FTC Team Manager</h1>
                    <p className="text-slate-400">
                        {mode === 'login' && 'Sign in to your account'}
                        {mode === 'signup' && 'Create your account'}
                        {mode === 'forgot' && 'Reset your password'}
                    </p>
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

                    {/* SSO Buttons */}
                    {mode !== 'forgot' && (
                        <>
                            <div className="space-y-3 mb-6">
                                <button
                                    onClick={handleGoogleSignIn}
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 font-medium py-3 px-4 rounded-xl hover:bg-slate-100 transition-all disabled:opacity-50"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                    </svg>
                                    Continue with Google
                                </button>

                                <button
                                    onClick={handleMicrosoftSignIn}
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-3 bg-slate-700 text-white font-medium py-3 px-4 rounded-xl hover:bg-slate-600 transition-all disabled:opacity-50"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                                        <path fill="#F25022" d="M1 1h10v10H1z" />
                                        <path fill="#00A4EF" d="M1 13h10v10H1z" />
                                        <path fill="#7FBA00" d="M13 1h10v10H13z" />
                                        <path fill="#FFB900" d="M13 13h10v10H13z" />
                                    </svg>
                                    Continue with Microsoft
                                </button>
                            </div>

                            <div className="relative mb-6">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-slate-600"></div>
                                </div>
                                <div className="relative flex justify-center text-sm">
                                    <span className="px-4 bg-slate-800/50 text-slate-400">or continue with email</span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Email Form */}
                    <form onSubmit={handleEmailAuth} className="space-y-4">
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
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold py-3 px-4 rounded-xl hover:from-orange-600 hover:to-orange-700 transition-all shadow-lg shadow-orange-500/25 disabled:opacity-50"
                        >
                            {isLoading ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <>
                                    {mode === 'login' && 'Sign In'}
                                    {mode === 'signup' && 'Create Account'}
                                    {mode === 'forgot' && 'Send Reset Link'}
                                    <ArrowRight className="w-4 h-4" />
                                </>
                            )}
                        </button>
                    </form>

                    {/* Mode Switchers */}
                    <div className="mt-6 text-center text-sm">
                        {mode === 'login' && (
                            <>
                                <button
                                    onClick={() => setMode('forgot')}
                                    className="text-slate-400 hover:text-orange-400 transition-colors"
                                >
                                    Forgot password?
                                </button>
                                <p className="mt-4 text-slate-400">
                                    Don't have an account?{' '}
                                    <button
                                        onClick={() => setMode('signup')}
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
                                    onClick={() => setMode('login')}
                                    className="text-orange-400 hover:text-orange-300 font-medium"
                                >
                                    Sign in
                                </button>
                            </p>
                        )}
                        {mode === 'forgot' && (
                            <button
                                onClick={() => setMode('login')}
                                className="text-orange-400 hover:text-orange-300 font-medium"
                            >
                                Back to sign in
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
