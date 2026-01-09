import { useState, useEffect } from 'react';
import { Link2, Copy, Check, RefreshCw, Trash2, Clock, AlertCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface Invite {
    id: string;
    team_id: string;
    code: string;
    created_by: string;
    created_at: string;
    expires_at: string;
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

    // Fetch active invites for this team
    const fetchInvites = async () => {
        if (!supabase || !isSupabaseConfigured()) {
            setIsLoading(false);
            return;
        }

        if (!teamId) {
            console.log('InviteManager: No teamId provided');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            console.log('InviteManager: Fetching invites for team', teamId);
            // Explicitly select columns and remove the server-side date filter for now to be safe
            // We can re-enable strict filtering if this works
            const { data, error: fetchError } = await supabase
                .from('invites')
                .select('id, team_id, code, created_by, created_at, expires_at, use_count, max_uses')
                .eq('team_id', teamId)
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;

            // Client-side filter for expiration
            const validInvites = (data || []).filter((inv: any) => {
                if (!inv.expires_at) return true;
                return new Date(inv.expires_at) > new Date();
            });

            setInvites(validInvites);
        } catch (err: any) {
            console.error('Error fetching invites:', err);
            setError('Failed to load invites');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchInvites();
    }, [teamId]);

    // Create a new invite code
    const createInvite = async () => {
        if (!supabase || !isSupabaseConfigured()) return;

        setIsCreating(true);
        setError(null);

        try {
            // Generate a random 8-character code
            const code = generateInviteCode();
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24); // 24-hour expiration

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data, error: insertError } = await supabase
                .from('invites')
                .insert({
                    team_id: teamId,
                    code: code,
                    created_by: user.id,
                    expires_at: expiresAt.toISOString(),
                    max_uses: null,
                    use_count: 0
                } as any)
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
        if (!supabase || !isSupabaseConfigured()) return;

        try {
            const { error: deleteError } = await supabase
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
    const generateInviteCode = (): string => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing characters
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    };

    // Format remaining time
    const formatTimeRemaining = (expiresAt: string): string => {
        const now = new Date();
        const expires = new Date(expiresAt);
        const diffMs = expires.getTime() - now.getTime();

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
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link2 className="text-orange-600" size={20} />
                    <h4 className="font-semibold text-slate-700 dark:text-slate-200">Invite Links</h4>
                </div>
                <button
                    onClick={createInvite}
                    disabled={isCreating}
                    className="flex items-center gap-2 px-3 py-1.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition disabled:opacity-50"
                >
                    {isCreating ? (
                        <RefreshCw size={14} className="animate-spin" />
                    ) : (
                        <Link2 size={14} />
                    )}
                    Generate Link
                </button>
            </div>

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
                <div className="p-4 text-center text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                    <Link2 size={24} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="text-sm">No active invite links.</p>
                    <p className="text-xs mt-1">Generate a link to invite members to your team.</p>
                </div>
            ) : (
                <ul className="space-y-2">
                    {invites.map((invite) => (
                        <li
                            key={invite.id}
                            className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <code className="text-sm font-mono font-semibold text-orange-600 dark:text-orange-400">
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
                                <button
                                    onClick={() => copyInviteLink(invite.code)}
                                    className="p-2 text-slate-400 hover:text-orange-600 dark:hover:text-orange-400 transition"
                                    title="Copy invite link"
                                >
                                    {copiedCode === invite.code ? (
                                        <Check size={16} className="text-green-500" />
                                    ) : (
                                        <Copy size={16} />
                                    )}
                                </button>
                                <button
                                    onClick={() => revokeInvite(invite.id)}
                                    className="p-2 text-slate-400 hover:text-red-500 transition"
                                    title="Revoke invite"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            {/* Info note */}
            <p className="text-xs text-slate-400 dark:text-slate-500">
                Invite links expire after 24 hours. Members who join via invite will need coach approval.
            </p>
        </div>
    );
}
