import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/**
 * The child's half of promotion: redeem the code their guardian gave them.
 *
 * WHY THE CHILD DOES THIS, AND NOT THE GUARDIAN. Something has to connect a roster row to an
 * account that did not exist when the row was made. Having the guardian type the child's email
 * address would be fewer steps and would make the RPC an account-enumeration oracle — ask it
 * about any address and the error tells you whether that person has a FalconForge account. It
 * would also have the guardian asserting the child's identity rather than the child. So it is a
 * two-party handshake, the same shape plan section 3 reaches for elsewhere: the guardian issues
 * the code, the child signs up in their own name, accepts the documents themselves, and redeems
 * it here.
 *
 * WHAT REDEEMING DOES: `claim_managed_profile` repoints the EXISTING `team_members` row and
 * clears its `managed_profile_id`, keeping the row's id. That is what preserves attendance
 * (`meeting_attendance` is unique on `(meeting_id, team_member_id)`), task history, and the
 * approval already given — no re-approval, no seat released and reacquired.
 *
 * Collapsed by default. Nearly everybody on this screen is not doing this, and a form nobody
 * needs is noise on the one screen a new account cannot avoid.
 */
export default function ClaimCodeForm() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    const trimmed = code.trim().toUpperCase();
    const canSubmit = trimmed.length === 8 && !isBusy;

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!canSubmit || !supabase) return;

        setIsBusy(true);
        setError(null);

        const { data, error: rpcError } = await supabase.rpc('claim_managed_profile', {
            p_code: trimmed,
        });

        setIsBusy(false);

        if (rpcError) {
            setError(rpcError.message);
            return;
        }

        const result = data as { success?: boolean; error?: string } | null;
        if (!result?.success) {
            // The RPC's refusals are written for the person reading them — "that code is not
            // valid", "this code is for your child to use on their own account, not yours" —
            // so they are surfaced rather than replaced with a generic message.
            setError(result?.error ?? 'That did not work. Check the code and try again.');
            return;
        }

        // Their memberships moved to this account, so the team picker has something in it now.
        navigate(0);
    };

    if (!isOpen) {
        return (
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                data-testid="open-claim-code"
                className="w-full text-center text-sm text-slate-400 hover:text-slate-300 py-2 transition-colors"
            >
                Have a code from your parent or guardian?
            </button>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="bg-slate-700/50 rounded-xl p-4 space-y-3">
            <div>
                <label htmlFor="claim-code" className="block text-sm font-medium text-slate-300 mb-2">
                    Your code
                </label>
                <input
                    id="claim-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    maxLength={8}
                    autoComplete="off"
                    data-testid="claim-code"
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white text-center text-lg font-mono tracking-code placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-forge-500 uppercase"
                    placeholder="ABCD2345"
                />
                <p className="text-slate-400 text-xs mt-2 text-center">
                    Eight characters. You keep your place on the team and everything recorded so far.
                </p>
            </div>

            {error && (
                <p role="alert" className="text-red-400 text-sm">
                    {error}
                </p>
            )}

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    disabled={!canSubmit}
                    // Why it is disabled, on the control (failure-modes §8).
                    title={trimmed.length === 8 ? undefined : 'Enter all eight characters.'}
                    className="flex-1 inline-flex items-center justify-center gap-2 bg-gradient-to-r from-forge-500 to-forge-600 hover:from-forge-600 hover:to-forge-700 text-white font-semibold py-2.5 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isBusy ? (
                        <Loader2 size={16} className="animate-spin" aria-hidden />
                    ) : (
                        <KeyRound size={16} aria-hidden />
                    )}
                    Claim my place
                </button>
            </div>
        </form>
    );
}
