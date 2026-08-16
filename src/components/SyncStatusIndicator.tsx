import { Cloud, CloudOff, RefreshCw, AlertCircle, Check, Radio } from 'lucide-react';
import { useSync } from '../lib/sync';
import { isSupabaseConfigured } from '../lib/supabase';
import { useState, useEffect } from 'react';
import { getRealtimeStatus, onRealtimeStatusChange, type RealtimeStatus } from '../lib/realtime';
import ParkedChangesDialog from './ParkedChangesDialog';

interface SyncStatusIndicatorProps {
    variant?: 'full' | 'icon';
}

export default function SyncStatusIndicator({ variant = 'full' }: SyncStatusIndicatorProps) {
    const {
        isOnline, syncStatus, pendingChanges, failedChanges, failureReasons,
        lastSyncTime, sync, retryFailedChanges, error,
    } = useSync();
    const isConfigured = isSupabaseConfigured();

    const [reviewing, setReviewing] = useState(false);

    // Track Realtime connection status
    const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>(getRealtimeStatus());
    useEffect(() => {
        return onRealtimeStatusChange(setRealtimeStatus);
    }, []);

    // Don't show anything in demo mode - just a subtle indicator
    if (!isConfigured) {
        return null;
    }

    const getStatusIcon = () => {
        if (!isOnline) {
            return <CloudOff className="w-4 h-4 text-slate-400" />;
        }
        switch (syncStatus) {
            case 'syncing':
                return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
            case 'error':
                return <AlertCircle className="w-4 h-4 text-red-400" />;
            case 'idle':
                if (pendingChanges > 0) {
                    return <Cloud className="w-4 h-4 text-amber-400" />;
                }
                return realtimeStatus === 'connected'
                    ? <Radio className="w-4 h-4 text-green-400" />
                    : <Check className="w-4 h-4 text-green-400" />;
            default:
                return <CloudOff className="w-4 h-4 text-slate-400" />;
        }
    };

    const getStatusText = () => {
        /*
         * Offline still says HOW MUCH is waiting.
         *
         * This returned a bare 'Offline' and threw the pending count away, so a team that had
         * worked through an entire session at a venue -- three tasks, a scouting report, a
         * checklist -- saw exactly what a team that had done nothing saw. The one number that
         * answers "is my afternoon actually saved?" went silent at precisely the moment it was
         * worth reading, and the count reappeared only once the connection came back, which is
         * when it stops mattering.
         *
         * Found by running the venue simulation and looking at the sidebar.
         */
        if (!isOnline) return pendingChanges > 0 ? `Offline · ${pendingChanges} queued` : 'Offline';
        switch (syncStatus) {
            case 'syncing':
                return 'Syncing...';
            case 'error':
                return 'Sync Error';
            case 'idle':
                if (pendingChanges > 0) {
                    return `${pendingChanges} pending`;
                }
                return realtimeStatus === 'connected' ? 'Live' : 'Synced';
            default:
                return 'Offline';
        }
    };

    const getStatusColor = () => {
        if (!isOnline) return 'bg-slate-500/10 border-slate-500/20';
        switch (syncStatus) {
            case 'syncing':
                return 'bg-blue-500/10 border-blue-500/20';
            case 'error':
                return 'bg-red-500/10 border-red-500/20';
            case 'idle':
                return pendingChanges > 0
                    ? 'bg-amber-500/10 border-amber-500/20'
                    : 'bg-green-500/10 border-green-500/20';
            default:
                return 'bg-slate-500/10 border-slate-500/20';
        }
    };

    // Changes that ran out of retries are parked, not lost (B2). This must stay visible --
    // the whole point is that a failed save is never silent. It clears only when the parked
    // changes are successfully re-synced.
    const failureNotice = failedChanges > 0 && (
        <div
            role="alert"
            className="flex flex-col gap-1.5 px-3 py-2 rounded-lg border bg-red-500/10 border-red-500/30 text-xs"
        >
            <div className="flex items-center gap-2 font-semibold text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                    {failedChanges} {failedChanges === 1 ? 'change' : 'changes'} didn&apos;t save
                </span>
            </div>
            {/*
              * WHY, when the server told us (B24).
              *
              * A change refused by a policy used to arrive here after nine minutes with only
              * "didn't save" to show for it, because PostgREST reports every policy refusal as
              * the same sentence about row-level security. The reason is worked out at
              * classification time and stored with the parked change, so this is the only place
              * it can be said — and it is what turns "retry when you have a connection", which
              * is wrong for a lapsed licence, into something actionable.
              */}
            {failureReasons.length > 0 ? (
                <ul className="flex flex-col gap-1 text-red-200/90 leading-snug">
                    {failureReasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                    ))}
                </ul>
            ) : (
                <p className="text-red-200/80 leading-snug">
                    They&apos;re still stored on this device. Retry when you have a connection.
                </p>
            )}
            <div className="flex flex-wrap gap-1.5">
                <button
                    onClick={() => retryFailedChanges().then(() => sync())}
                    disabled={!isOnline || syncStatus === 'syncing'}
                    className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-red-100 transition-colors"
                >
                    Retry {failedChanges === 1 ? 'it' : 'them'}
                </button>
                {/*
                  * The way OUT of a permanent badge.
                  *
                  * "Retry them" is all-or-nothing, so one genuinely dead change -- a write
                  * belonging to an archived season, say -- re-parks on every attempt and the
                  * badge never clears. Before this the only escape was discarding everything,
                  * which throws away the good with the bad.
                  */}
                <button
                    onClick={() => setReviewing(true)}
                    data-testid="review-parked-changes"
                    className="px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 font-medium text-red-100 transition-colors"
                >
                    Review
                </button>
            </div>
        </div>
    );

    const statusButton = (
        /* The one control that invites a manual sync: it now looks pressable (hover
           brightens the tint) and looks dead when it is (offline/syncing dims it) —
           it used to render pixel-identical in all three states. */
        <button
            onClick={() => sync()}
            disabled={syncStatus === 'syncing' || !isOnline}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all w-full enabled:hover:brightness-125 disabled:opacity-60 disabled:cursor-not-allowed ${getStatusColor()} ${variant === 'icon' ? 'aspect-square justify-center' : ''}`}
            title={
                error ||
                (!isOnline
                    ? 'Offline — will sync when the connection returns'
                    : syncStatus === 'syncing'
                        ? 'Sync in progress'
                        : lastSyncTime
                            ? `Last synced: ${lastSyncTime.toLocaleTimeString()}`
                            : 'Click to sync')
            }
        >
            <span className={syncStatus === 'syncing' ? 'animate-spin' : ''}>
                {getStatusIcon()}
            </span>
            {variant === 'full' && (
                <span>{getStatusText()}</span>
            )}
        </button>
    );

    // In icon mode there is no room for the notice, so fold it into the badge instead.
    const reviewDialog = reviewing && (
        <ParkedChangesDialog
            onClose={() => setReviewing(false)}
            /*
             * A drain, NOT `retryFailedChanges()` -- that one requeues every parked change, which
             * is exactly what this dialog exists to avoid doing on the user's behalf. A single
             * item has already been requeued by the dialog itself; this just pushes it. The
             * badge's own count refreshes on `useSync`'s five-second poll.
             */
            onChanged={() => void sync()}
        />
    );

    if (variant === 'icon') {
        return (
            <div className="relative" title={failedChanges > 0 ? `${failedChanges} changes didn't save` : undefined}>
                {statusButton}
                {failedChanges > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-2xs font-bold text-white">
                        {failedChanges}
                    </span>
                )}
                {reviewDialog}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 w-full" data-testid="sync-status">
            {statusButton}
            {failureNotice}
            {reviewDialog}
        </div>
    );
}
