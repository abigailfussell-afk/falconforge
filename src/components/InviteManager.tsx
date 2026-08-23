import { useState, useEffect } from 'react';
import { Link2, Copy, Check, RefreshCw, Trash2, Clock, AlertCircle } from 'lucide-react';
import { supabaseSync, isSupabaseConfigured } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useEntitlement } from '../lib/entitlement';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

interface Invite {
    id: string;
    team_id: string;
    code: string;
    created_by: string;
    // created_at and expires_at are nullable in the schema (column DEFAULTs, not NOT NULL).
    // This interface had both as non-null, and the hand-written database.types.ts agreed
    // with it, so nothing ever contradicted the assumption. The generated types do.
    created_at: string | null;
    expires_at: string | null;
    max_uses: number | null;
    use_count: number;
}

interface InviteManagerProps {
    teamId: string;
}

export default function InviteManager({ teamId }: InviteManagerProps) {
    const [invites, setInvites] = useState<Invite[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const { user, isOffline } = useAuth();
    const { seatsRemaining, seatsUnlimited, isAtCapacity, isKnown } = useEntitlement();

    // Fetch active invites for this team
    const fetchInvites = async () => {
        if (!supabaseSync || !isSupabaseConfigured()) {
            setIsLoading(false);
            return;
        }

        if (!teamId) {
            setIsLoading(false);
            return;
        }

        if (isOffline) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Request timed out')), 10000)
            );

            // Explicitly select columns and remove the server-side date filter for now to be safe
            const fetchPromise = supabaseSync
                .from('invites')
                .select('id, team_id, code, created_by, created_at, expires_at, use_count, max_uses')
                .eq('team_id', teamId)
                .order('created_at', { ascending: false });

            // Race the fetch against the timeout
            const { data, error: fetchError } = await Promise.race([fetchPromise, timeoutPromise]) as any;

            if (fetchError) throw fetchError;

            // Client-side filter for expiration
            const validInvites = (data || []).filter((inv: any) => {
                if (!inv.expires_at) return true;
                return new Date(inv.expires_at) > new Date();
            });

            setInvites(validInvites);
        } catch (err: any) {
            console.error('Error fetching invites:', err);
            // Only set error if it's not a timeout or if we want to show it
            if (err.message === 'Request timed out') {
                setError('Request timed out. Please check your connection.');
            } else {
                setError('Failed to load invites');
            }
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void fetchInvites();
    }, [teamId]);

    // Create a new invite code
    const createInvite = async () => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        setIsCreating(true);
        setError(null);

        try {
            if (!user) throw new Error('Not authenticated');

            const { data, error: insertError } = await supabaseSync
                .from('invites')
                .insert({
                    team_id: teamId,
                    created_by: user.id,
                    /*
                     * NO `code`, and that is the fix for SEC-17.
                     *
                     * This component used to mint its own with `Math.random()` over a 32-symbol
                     * alphabet while `create_team_as_admin` minted a DIFFERENT one with
                     * `upper(substr(md5(random()::text), 1, 8))` -- 8 hex characters, a
                     * different alphabet and 8 fewer bits. One concept, two generators, exactly
                     * the shape SEC-09 had already found in this table's `expires_at`
                     * (`docs/failure-modes.md` §12, CLAUDE.md principle 9).
                     *
                     * Neither RNG was cryptographic, which is the part that mattered: an invite
                     * code is a bearer credential, and `Math.random()` in V8 is xorshift128+ --
                     * its state is recoverable from a handful of outputs. The column DEFAULT is
                     * now the only generator (`gen_random_bytes`), the INSERT privilege on
                     * `code` is revoked so this cannot come back, and `.select()` below reads
                     * back what the database chose.
                     */
                    /*
                     * NO `expires_at`, and that is the fix for SEC-09.
                     *
                     * This component used to hold `INVITE_LIFETIME_HOURS = 24 * 7` while the
                     * column DEFAULT said 24 hours, so the code an admin generated here and the
                     * code `create_team_as_admin` printed on the registration screen expired a
                     * week apart -- one concept written down twice, nothing comparing them
                     * (`docs/failure-modes.md` §12). The DEFAULT is now the only statement of it
                     * (7 days, `20260824000300_sec_09_invite_code_lifetime.sql`), and `.select()`
                     * below reads back what it chose, so the countdown on the row is the row's.
                     */
                    /*
                     * CAPPED AT THE SEATS ACTUALLY AVAILABLE.
                     *
                     * `max_uses` has been in the schema since Sprint 3 and nothing ever set it.
                     * The brief's scenario is an admin sharing one code with twenty people while
                     * holding ten seats: without a cap, ten of those people sign up, sit as
                     * pending requests that CANNOT be approved, and get no explanation — and the
                     * admin has a queue they cannot clear. Capping the code stops the limbo
                     * forming instead of managing it afterwards.
                     *
                     * Null for an unlimited grant, and null when this device has not read the
                     * entitlement — an uncapped code is the safe failure here, because the seat
                     * check still happens at approval where it always did.
                     */
                    max_uses: seatsRemaining,
                    /*
                     * NO `use_count` either. It was sent as an explicit `0` while the column
                     * DEFAULT already says 0 -- harmless until SEC-17 revoked the privilege, at
                     * which point sending it is a "permission denied for column" on a value the
                     * database was going to choose anyway. Same rule as `code` and `expires_at`:
                     * if the DEFAULT is the definition, the client does not restate it.
                     */
                } as never)
                .select()
                .single();

            if (insertError) throw insertError;

            setInvites([data, ...invites]);
        } catch (err: any) {
            console.error('Error creating invite:', err);
            setError('Failed to create invite');
        } finally {
            setIsCreating(false);
        }
    };

    // Revoke (delete) an invite
    const revokeInvite = async (inviteId: string) => {
        if (!supabaseSync || !isSupabaseConfigured()) return;

        try {
            const { error: deleteError } = await supabaseSync
                .from('invites')
                .delete()
                .eq('id', inviteId);

            if (deleteError) throw deleteError;

            setInvites(invites.filter(inv => inv.id !== inviteId));
        } catch (err: any) {
            console.error('Error revoking invite:', err);
            setError('Failed to revoke invite');
        }
    };

    // Copy invite link to clipboard
    const copyInviteLink = async (code: string) => {
        const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
        const inviteLink = `${baseUrl}#/join/${code}`;

        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopiedCode(code);
            setTimeout(() => setCopiedCode(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    // Generate a random invite code
    // Format remaining time
    const formatTimeRemaining = (expiresAt: string | null): string => {
        // expires_at is nullable. A null means the invite has no expiry -- previously this
        // reached `new Date(null)`, giving NaN, and every comparison below was false, so it
        // rendered as "0m remaining" rather than saying the invite never expires.
        if (!expiresAt) return 'No expiry';

        const now = new Date();
        const expires = new Date(expiresAt);
        const diffMs = expires.getTime() - now.getTime();

        if (Number.isNaN(diffMs)) return 'No expiry';
        if (diffMs <= 0) return 'Expired';

        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}m remaining`;
        }
        return `${minutes}m remaining`;
    };

    if (!isSupabaseConfigured()) {
        return (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
                <AlertCircle size={16} className="inline mr-2" />
                Invite links require Supabase to be configured.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header with create button */}
            <SectionHeader
                icon={Link2}
                title="Invite Links"
                action={
                    <Button
                        size="sm"
                        onClick={createInvite}
                        busy={isCreating}
                        disabled={isOffline || isAtCapacity}
                        title={
                            isOffline
                                ? 'Generating a link needs a connection'
                                : isAtCapacity
                                    ? 'Every seat is in use — a new code could not be approved by anyone'
                                    : 'Generate an invite link'
                        }
                    >
                        {!isCreating && <Link2 size={14} />}
                        Generate Link
                    </Button>
                }
            />

            {/* Error display */}
            {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-400 text-sm">
                    {error}
                </div>
            )}

            {/* Loading state */}
            {isLoading ? (
                <div className="p-4 text-center text-slate-400">
                    <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                    Loading invites...
                </div>
            ) : invites.length === 0 ? (
                <EmptyState
                    icon={Link2}
                    title="No active invite links."
                    body="Generate a link to invite members to your team."
                />
            ) : (
                <ul className="space-y-2">
                    {invites.map((invite) => (
                        <li
                            key={invite.id}
                            className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <code className="text-sm font-mono font-semibold text-forge-600 dark:text-forge-400">
                                        {invite.code}
                                    </code>
                                    {invite.use_count > 0 && (
                                        <span className="text-xs bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded">
                                            {invite.use_count} used
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                                    <Clock size={10} />
                                    {formatTimeRemaining(invite.expires_at)}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <IconButton
                                    onClick={() => copyInviteLink(invite.code)}
                                    title="Copy invite link"
                                >
                                    {copiedCode === invite.code ? (
                                        <Check size={16} className="text-green-500" />
                                    ) : (
                                        <Copy size={16} />
                                    )}
                                </IconButton>
                                <IconButton
                                    danger
                                    onClick={() => revokeInvite(invite.id)}
                                    title="Revoke invite"
                                >
                                    <Trash2 size={16} />
                                </IconButton>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Info note */}
            <p className="text-xs text-slate-400">
                Invite links last a week. Anyone who joins with one waits as a request until the
                team admin approves them, which is when they take up a licensed seat.
                {/*
                  * Suppressed at capacity, where "capped at the 0 seats you have free" is a
                  * sentence nobody should read. The Generate button is already disabled with its
                  * own reason, and the pending list says the same thing more usefully. Found by
                  * looking at a seeded 3-of-3 team rather than by any assertion.
                  */}
                {isKnown && !seatsUnlimited && !isAtCapacity && (
                    <>
                        {' '}
                        New links are capped at the{' '}
                        <strong>
                            {seatsRemaining} seat{seatsRemaining === 1 ? '' : 's'}
                        </strong>{' '}
                        you have free, so nobody signs up for a place that is not there.
                    </>
                )}
            </p>
        </div>
    );
}
