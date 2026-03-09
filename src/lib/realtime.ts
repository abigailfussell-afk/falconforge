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
import { mergeIntoStore, updateLocalDatabase } from './sync';

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

// Tables we subscribe to + their local (camelCase) store key
const SYNCED_TABLES = [
    { table: 'tasks', localTable: 'tasks' },
    { table: 'scouting_reports', localTable: 'scoutingReports' },
    { table: 'match_plans', localTable: 'matchPlans' },
    { table: 'checklists', localTable: 'checklists' },
    { table: 'sub_teams', localTable: 'subTeams' },
] as const;

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
 */
export function handleRealtimeDelete(tableName: string, recordId: string): void {
    const store = useAppStore.getState();

    switch (tableName) {
        case 'tasks':
            store.setTasks(store.tasks.filter((t) => t.id !== recordId));
            break;
        case 'scouting_reports':
            store.setScoutingReports(store.scoutingReports.filter((r) => r.id !== recordId));
            break;
        case 'match_plans':
            store.setMatchPlans(store.matchPlans.filter((p) => p.id !== recordId));
            break;
        case 'sub_teams':
            store.setSubTeams(store.subTeams.filter((st) => st.id !== recordId));
            break;
        case 'checklists':
            // Checklists are blob-synced; a delete means the checklist was removed
            store.setChecklist([]);
            break;
        default:
            break;
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
            (payload: any) => {
                if (payload.new) {
                    // Wrap in an array — mergeIntoStore expects an array of raw Supabase rows
                    mergeIntoStore(localTable, [payload.new]);
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
            (payload: any) => {
                if (payload.new) {
                    // For checklists, the blob is the entire record — use updateLocalDatabase
                    if (table === 'checklists') {
                        updateLocalDatabase(localTable, [payload.new]);
                    } else {
                        mergeIntoStore(localTable, [payload.new]);
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
            (payload: any) => {
                if (payload.old?.id) {
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
        supabase.removeChannel(channel);
    }
    channel = null;
    currentTeamId = null;
    setStatus('disconnected');
}
