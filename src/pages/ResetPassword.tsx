import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { APP_ROOT } from '../lib/navigation';
import Wordmark from '../components/Wordmark';

/**
 * Set a new password, having arrived from a recovery email.
 *
 * The route this page sits on did not exist until Sprint 9, which is half of why password
 * recovery was dead end to end in production: the redirect 404'd on GitHub Pages, and even
 * once it booted there was no `/auth/reset-password` route, so React Router's catch-all
 * redirected to `/` and silently discarded the token.
 *
 * By the time this renders the user already HAS a session — `detectSessionInUrl` consumed the
 * token from the origin root and `onAuthStateChange` fired `PASSWORD_RECOVERY`, which is what
 * navigated here. So this screen does not handle a token at all; it changes a password for the
 * signed-in user. That is worth stating plainly, because "reset password page" invites the
 * assumption that it parses something out of the URL, and a future edit that "restores" that
 * would break it again.
 *
 * WHY THIS MATTERS MORE FROM SPRINT 9 ON: the guardian owns the login for a child who has none.
 * A guardian who cannot reset their password loses their child's place on the roster too, not
 * just their own account.
 */
export default function ResetPassword() {
    const navigate = useNavigate();
    const { user, isConfigured } = useAuth();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isDone, setIsDone] = useState(false);

    // Supabase's own minimum. Stated here so the refusal arrives before the round trip.
    const MIN_LENGTH = 6;

    const tooShort = password.length > 0 && password.length < MIN_LENGTH;
    const mismatch = confirm.length > 0 && password !== confirm;
    const canSubmit =
        !isSaving && password.length >= MIN_LENGTH && password === confirm && isConfigured;

    /**
     * Why the button is disabled, in words, on the button itself.
     *
     * An enabled control whose handler early-returns is `docs/failure-modes.md` §8 — five
     * sprints, seven instances, and at a venue it is indistinguishable from lost work. A
     * disabled control with no explanation is the same dead end with better manners.
     */
    const disabledReason = (): string | undefined => {
        if (isSaving) return 'Saving your new password…';
        if (!isConfigured) return 'The app cannot reach its server right now.';
        if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`;
        if (password !== confirm) return 'The two passwords do not match yet.';
        return undefined;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit || !supabase) return;

        setIsSaving(true);
        setError(null);

        const { error: updateError } = await supabase.auth.updateUser({ password });

        setIsSaving(false);

        if (updateError) {
            // Never a silent failure. The most likely cause is an expired link, and saying so
            // is what lets the user act — the refusal has to reach the person who can satisfy it.
            setError(
                updateError.message ||
                    'That did not work. Recovery links expire — try requesting a new one.',
            );
            return;
        }

        setIsDone(true);
    };

    /*
     * NO SESSION MEANS THE LINK DID NOT WORK — say so, rather than rendering a form that
     * cannot succeed.
     *
     * Three states, not two (failure-modes §4): `useAuth` holds the splash while it is still
     * resolving, so reaching here with no user genuinely means "no recovery session", not
     * "not loaded yet".
     */
    if (!user) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
                <div className="w-full max-w-sm text-center space-y-4">
                    <Wordmark className="mx-auto h-8" />
                    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        This recovery link has expired
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        Recovery links can only be used once, and they time out. Request a new
                        one from the sign-in screen and it will arrive in a moment.
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="btn-primary w-full"
                    >
                        Back to sign in
                    </button>
                </div>
            </div>
        );
    }

    if (isDone) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
                <div className="w-full max-w-sm text-center space-y-4">
                    <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" aria-hidden />
                    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Password updated
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        You are signed in on this device. Use the new password next time.
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate(APP_ROOT)}
                        className="btn-primary w-full"
                    >
                        Continue
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
            <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
                <div className="text-center space-y-2">
                    <Wordmark className="mx-auto h-8" />
                    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Choose a new password
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                        for {user.email}
                    </p>
                </div>

                <div className="space-y-1">
                    <label htmlFor="new-password" className="label">
                        New password
                    </label>
                    <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        className="field w-full"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-describedby={tooShort ? 'password-hint' : undefined}
                        aria-invalid={tooShort || undefined}
                    />
                    {tooShort && (
                        <p id="password-hint" className="text-xs text-amber-600 dark:text-amber-400">
                            Use at least {MIN_LENGTH} characters.
                        </p>
                    )}
                </div>

                <div className="space-y-1">
                    <label htmlFor="confirm-password" className="label">
                        Confirm new password
                    </label>
                    <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        className="field w-full"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        aria-describedby={mismatch ? 'confirm-hint' : undefined}
                        aria-invalid={mismatch || undefined}
                    />
                    {mismatch && (
                        <p id="confirm-hint" className="text-xs text-amber-600 dark:text-amber-400">
                            These do not match yet.
                        </p>
                    )}
                </div>

                {error && (
                    <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={!canSubmit}
                    title={disabledReason()}
                    className="btn-primary w-full inline-flex items-center justify-center gap-2"
                >
                    {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                        <KeyRound className="h-4 w-4" aria-hidden />
                    )}
                    {isSaving ? 'Saving…' : 'Set new password'}
                </button>
            </form>
        </div>
    );
}
