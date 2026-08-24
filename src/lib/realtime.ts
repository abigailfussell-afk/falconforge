/**
 * Supabase Realtime — Progressive Enhancement
 *
 * Subscribes to postgres_changes for the current team's tables so that
 * INSERT/UPDATE/DELETE events are reflected in the Zustand store instantly,
 * without polling.
 *
 * If the Realtime WebSocket disconnects or errors, the system silently falls
 * back to the existing polling-based sync in sync.ts.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useAppStore } from './store';
import { mergeIntoStore, updateLocalDatabase, fetchTeamData } from './server-pull';
import { getPendingRecordIds } from './offline-db';
import { findEntity, SYNCED_ENTITIES } from './entity-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected';

type StatusListener = (status: RealtimeStatus) => void;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let channel: RealtimeChannel | null = null;
let currentTeamId: string | null = null;
let status: RealtimeStatus = 'disconnected';
const statusListeners = new Set<StatusListener>();

// Derived from the entity registry rather than restated here. Seasons are included
// because the registry drives it; subscribing to one extra low-traffic table is cheaper
// than maintaining a second list that can drift out of step with the first.
const SYNCED_TABLES = [
    ...SYNCED_ENTITIES.map((e) => ({ table: e.remoteTable, localTable: e.localKey })),
    // Blob-synced, so not a registry entity, but still worth pushing live.
    { table: 'checklists', localTable: 'checklists' },
];

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function setStatus(next: RealtimeStatus) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((fn) => fn(next));
}

export function getRealtimeStatus(): RealtimeStatus {
    return status;
}

export function onRealtimeStatusChange(listener: StatusListener): () => void {
    statusListeners.add(listener);
    return () => { statusListeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Record removal for DELETE events
// ---------------------------------------------------------------------------

/**
 * Remove a single record by ID from the Zustand store.
 * Used exclusively by Realtime DELETE events.
 *
 * Accepts either the snake_case table or the camelCase store key. The loop below used to
 * hand `localTable` to mergeIntoStore and `table` to this function on adjacent lines --
 * correct at the time, and exactly the kind of thing that breaks on the next edit (B16).
 */
export function handleRealtimeDelete(tableName: string, recordId: string): void {
    const store = useAppStore.getState();

    const entity = findEntity(tableName);
    if (entity) {
        entity.setInStore(store, entity.getFromStore(store).filter((r: any) => r.id !== recordId));
        return;
    }

    if (tableName === 'checklists') {
        // A template deleted elsewhere. Checked FIRST, because a template carries its own
        // generated id rather than a season id — treating one as a season would file an
        // empty list under a key that is not a season and leave the template in the library.
        const templates = store.checklistTemplates;
        if (templates.some((t) => t.id === recordId)) {
            store.setChecklistTemplates(templates.filter((t) => t.id !== recordId));
            return;
        }

        // Otherwise: blob-synced, one row per season, and the row id IS the season id (see
        // `updateChecklist` in store.ts). So the deleted record's id names the season whose
        // checklist just went away, and no extra lookup is needed.
        store.setChecklistForSeason(recordId, []);
    }
}

// ---------------------------------------------------------------------------
// Subscription setup / teardown
// ---------------------------------------------------------------------------

export function setupRealtimeSubscription(teamId: string): void {
    if (!supabase) return;

    // Already subscribed to the same team — no-op
    if (channel && currentTeamId === teamId) return;

    // Tear down any existing subscription first
    teardownRealtimeSubscription();

    currentTeamId = teamId;
    setStatus('connecting');
    bindVisibility();

    const ch = supabase.channel(`team-${teamId}`);

    // Subscribe to each synced table filtered by team_id
    for (const { table, localTable } of SYNCED_TABLES) {
        ch.on(
            'postgres_changes' as any,
            {
                event: 'INSERT',
                schema: 'public',
                table,
                filter: `team_id=eq.${teamId}`,
            },
            async (payload: any) => {
                if (payload.new) {
                    // Wrap in an array — mergeIntoStore expects an array of raw Supabase rows.
                    // pendingIds keeps an unpushed local edit from being overwritten (B8).
                    mergeIntoStore(localTable, [payload.new], await getPendingRecordIds(table));
                }
            },
        );

        ch.on(
            'postgres_changes' as any,
            {
                event: 'UPDATE',
                schema: 'public',
                table,
                filter: `team_id=eq.${teamId}`,
            },
            async (payload: any) => {
                if (payload.new) {
                    // An edit the user has not pushed yet is newer than anything arriving
                    // from the server, so it wins until the queue drains (B8). Without this,
                    // a teammate's update overwrites what someone is actively typing.
                    const pendingIds = await getPendingRecordIds(table);

                    // For checklists, the blob is the entire record — use updateLocalDatabase
                    if (table === 'checklists') {
                        updateLocalDatabase(localTable, [payload.new], pendingIds);
                    } else {
                        mergeIntoStore(localTable, [payload.new], pendingIds);
                    }
                }
            },
        );

        ch.on(
            'postgres_changes' as any,
            {
                event: 'DELETE',
                schema: 'public',
                table,
                filter: `team_id=eq.${teamId}`,
            },
            async (payload: any) => {
                if (payload.old?.id) {
                    // Same rule for deletes: if the user has an unpushed change to this
                    // record, keep it and let the queue drain decide. Otherwise a remote
                    // delete removes a row whose local edit is still waiting to be sent.
                    const pendingIds = await getPendingRecordIds(table);
                    if (pendingIds.has(payload.old.id)) return;

                    handleRealtimeDelete(table, payload.old.id);
                }
            },
        );
    }

    // Subscribe and track connection status
    ch.subscribe((subscriptionStatus: string) => {
        switch (subscriptionStatus) {
            case 'SUBSCRIBED':
                setStatus('connected');
                break;
            case 'CHANNEL_ERROR':
            case 'TIMED_OUT':
            case 'CLOSED':
                setStatus('disconnected');
                break;
            default:
                // 'SUBSCRIBING' etc.
                break;
        }
    });

    channel = ch;
}

export function teardownRealtimeSubscription(): void {
    if (channel && supabase) {
        supabase.removeChannel(channel).catch(console.error);
    }
    channel = null;
    currentTeamId = null;
    setStatus('disconnected');
}

// ---------------------------------------------------------------------------
// Hidden tabs give up their socket (SYNC-04)
// ---------------------------------------------------------------------------

/**
 * How long a tab stays hidden before it releases its WebSocket.
 *
 * Two minutes, not two seconds: switching to another tab to look something up is the common
 * case and re-handshaking for it would cost more than it saves, on the connection least able to
 * afford it. Two minutes is long enough that ordinary tab-switching never triggers it and short
 * enough that a laptop left open in the pits for an afternoon is not holding a connection all
 * day.
 *
 * THE CONSTRAINT THIS IS ABOUT IS CONNECTIONS, NOT MESSAGES. Supabase's free tier allows 200
 * concurrent realtime connections; a team meeting is 8–15 devices, so 15–25 teams meeting on the
 * same weekday evening saturates it and later joiners get `CHANNEL_ERROR`. The app degrades to
 * the pull path, which works — and which is exactly the expensive path SYNC-03 exists to avoid.
 * A phone in a pocket with the app still open is a connection nobody is reading.
 */
export const HIDDEN_TEARDOWN_MS = 120_000;

let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
/** The team to reconnect to when the tab comes back. Set only by a visibility teardown. */
let suspendedTeamId: string | null = null;

function clearHiddenTimer() {
    if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
    }
}

/**
 * Called on `visibilitychange`. Exported so a test can drive it without a real document.
 *
 * RESUBSCRIBE FIRST, THEN PULL, and the order is the whole correctness of this. A change that
 * lands between the pull and the subscribe would be in neither: too late for the read, too early
 * for the socket. Subscribing first makes the overlap a duplicate rather than a hole, and a
 * duplicate is free — `mergeIntoStore` is idempotent and honours `getPendingRecordIds()`.
 */
export function handleVisibilityChange(hidden: boolean): void {
    if (hidden) {
        if (!channel || !currentTeamId) return;
        const teamId = currentTeamId;
        clearHiddenTimer();
        hiddenTimer = setTimeout(() => {
            hiddenTimer = null;
            // Re-checked at fire time, not captured: the tab may have come back and gone away
            // again, or signed out, in the two minutes since. `docs/failure-modes.md` §11 is
            // four sprints of timers bound to the wrong moment.
            if (typeof document !== 'undefined' && !document.hidden) return;
            if (!channel) return;
            suspendedTeamId = teamId;
            teardownRealtimeSubscription();
        }, HIDDEN_TEARDOWN_MS);
        return;
    }

    clearHiddenTimer();
    if (!suspendedTeamId) return;

    const teamId = suspendedTeamId;
    suspendedTeamId = null;
    setupRealtimeSubscription(teamId);
    /*
     * And close the gap the disconnection left. Nothing was listening while the socket was
     * down, so the store is as stale as the last pull — the periodic reconciliation would catch
     * up eventually, and "eventually" is not what somebody who has just come back to the tab is
     * looking at.
     */
    void fetchTeamData(teamId).catch(console.error);
}

let visibilityBound = false;

/** Bind the listener once. Idempotent, because `setupRealtimeSubscription` may run many times. */
function bindVisibility(): void {
    if (visibilityBound || typeof document === 'undefined') return;
    visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
        handleVisibilityChange(document.hidden);
    });
}

/**
 * Reset the visibility state. For tests only — module state outlives a test file otherwise, and
 * a suspended team id left behind makes the next test reconnect to a team it never chose.
 */
export function resetVisibilityStateForTests(): void {
    clearHiddenTimer();
    suspendedTeamId = null;
}
