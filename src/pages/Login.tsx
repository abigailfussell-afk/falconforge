import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Mail, Lock, User, ArrowRight, Loader2 } from 'lucide-react'; // Removed Bot, added nothing from the instruction's import list that was relevant to LoginPage

type AuthMode = 'login' | 'signup' | 'forgot';

export default function LoginPage() {
    const { signInWithEmail, signUpWithEmail, resetPassword, isConfigured } = useAuth();
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

                    {/* SSO Buttons - Hidden until implemented */}

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
