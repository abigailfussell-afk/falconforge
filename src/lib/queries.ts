/**
 * Per-page background refresh.
 *
 * When a user opens a page, the hook for that page triggers a background refresh of its
 * data. Components still read from the Zustand store — React Query only decides *when* to
 * refresh, never *how* to read.
 *
 * These hooks used to contain their own copy of the read: `.from(table).select('*')`
 * followed by `setTasks(transformed)`, replacing the whole collection. That is a wholesale
 * overwrite with no knowledge of the sync queue, so a background refetch on a 30s stale
 * timer could discard tasks created offline and still waiting to be pushed (C3/B3).
 *
 * They now call `pullFromServer`, the single read path, which keeps pending records. The
 * hooks are left as separate named exports because each page imports its own, and because
 * the query keys keep React Query's per-page cache and stale timers distinct.
 */

import { useQuery } from '@tanstack/react-query';
import { isSupabaseConfigured } from './supabase';
import { pullFromServer, type PullResult } from './server-pull';

/** Page-level refreshes are full pulls: the user is looking at the screen and expects
 *  records deleted on another device to disappear. */
function useEntityRefresh(table: string, teamId: string | null) {
    return useQuery<PullResult | null>({
        queryKey: [table, teamId],
        queryFn: async () => {
            if (!teamId) return null;
            return pullFromServer({ teamId, tables: [table], mode: 'full' });
        },
        enabled: !!teamId && isSupabaseConfigured() && navigator.onLine,
        staleTime: 30_000,
    });
}

/** Tasks — SprintPlanning page. */
export function useTasksQuery(teamId: string | null) {
    return useEntityRefresh('tasks', teamId);
}

/** Scouting reports — ScoutingReports page. */
export function useScoutingQuery(teamId: string | null) {
    return useEntityRefresh('scouting_reports', teamId);
}

/** Match plans — MatchPlanner page. */
export function useMatchPlansQuery(teamId: string | null) {
    return useEntityRefresh('match_plans', teamId);
}
