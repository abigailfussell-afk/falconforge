import { Cloud, CloudOff, RefreshCw, AlertCircle, Check, Radio } from 'lucide-react';
import { useSync } from '../lib/sync';
import { isSupabaseConfigured } from '../lib/supabase';
import { useState, useEffect } from 'react';
import { getRealtimeStatus, onRealtimeStatusChange, type RealtimeStatus } from '../lib/realtime';
import {
    describeLastContact,
    getServerReachability,
    isContactStale,
    onServerReachabilityChange,
    type ServerReachability,
} from '../lib/server-reachability';
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

    /*
     * WHAT THE SERVER HAS ACTUALLY SAID (SYNC-07).
     *
     * Everything below used to hang off `navigator.onLine`, which answers "is there a network
     * interface with a route", not "is anything on the other end". The built app, cold-booted
     * with the network cut, showed a green tick and the word "Synced" while 37 requests failed
     * — `onLine` was true throughout. That is what a captive portal and venue WiFi look like,
     * and a coach reading "Synced" concludes the board reflects what everybody else has done.
     */
    const [reachability, setReachability] = useState<ServerReachability>(getServerReachability());
    useEffect(() => onServerReachabilityChange(setReachability), []);

    /*
     * A CLOCK THE LABEL CAN READ.
     *
     * "Synced · 3 min ago" has to keep being true a minute later. Without a tick the label
     * freezes at whatever it said when the last pull happened, which for a device sitting idle
     * at a venue is the most reassuring number it will ever show and the least accurate.
     */
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(timer);
    }, []);

    /**
     * True when the device believes it has a network but the server is not answering.
     *
     * Deliberately NOT "we have never contacted it": a cold start has no evidence either way,
     * and shouting "can't reach server" at somebody who has simply not asked anything yet is
     * the absence-as-a-value mistake pointed the other way (`docs/failure-modes.md` §4).
     */
    const unreachable = isOnline && reachability.reachable === false;
    const lastContact = describeLastContact(reachability, now);
    const stale = isContactStale(reachability, now);

    // Don't show anything in demo mode - just a subtle indicator
    if (!isConfigured) {
        return null;
    }

    const getStatusIcon = () => {
        if (!isOnline) {
            return <CloudOff className="w-4 h-4 text-slate-400" />;
        }
        // Before the queue's own state: a device that cannot reach the server has nothing
        // truthful to say about being synced.
        if (unreachable) {
            return <CloudOff className="w-4 h-4 text-amber-500" />;
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

        /*
         * "Can't reach server" is not the same sentence as "Offline", and the difference is
         * the whole point: the device thinks it is online. Saying `Offline` here would be a
         * second lie in place of the first, and would send a coach looking for a WiFi problem
         * that the WiFi icon says they do not have.
         */
        if (unreachable) {
            return pendingChanges > 0
                ? `Can't reach server · ${pendingChanges} queued`
                : "Can't reach server";
        }

        switch (syncStatus) {
            case 'syncing':
                return 'Syncing...';
            case 'error':
                return 'Sync Error';
            case 'idle':
                if (pendingChanges > 0) {
                    return `${pendingChanges} pending`;
                }
                if (realtimeStatus === 'connected') return 'Live';
                /*
                 * NEVER A BARE "Synced" (SYNC-07).
                 *
                 * Without the age, the word is a claim about right now made from evidence
                 * that may be an hour old. With it, a coach can tell the difference between
                 * a board that is current and one that stopped updating when the venue WiFi
                 * did. `lastContact` is null only before anything has been asked.
                 */
                if (lastContact === null) return 'Not synced yet';
                return stale ? `Last synced ${lastContact}` : `Synced · ${lastContact}`;
            default:
                return 'Offline';
        }
    };

    const getStatusColor = () => {
        if (!isOnline) return 'bg-slate-500/10 border-slate-500/20';
        if (unreachable) return 'bg-amber-500/10 border-amber-500/20';
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
                <span data-testid="sync-status-text">{getStatusText()}</span>
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
