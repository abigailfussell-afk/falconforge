/**
 * React Query hooks for per-page background data refresh.
 *
 * These hooks complement the existing `fetchTeamData()` in store.ts.
 * `fetchTeamData` loads ALL entities on team switch (for offline cache fill).
 * These hooks add stale-while-revalidate freshness: when a user navigates to
 * a page, the hook triggers a background refresh for that page's data.
 *
 * Data flows:  Supabase → query hook → store setter → Zustand store → component
 * Components still read from the Zustand store — React Query only manages the refresh.
 */

import { useQuery } from '@tanstack/react-query';
import { supabaseSync, isSupabaseConfigured } from './supabase';
import { useAppStore } from './store';
import {
    transformTaskFromSupabase,
    transformScoutingReportFromSupabase,
    transformMatchPlanFromSupabase,
} from './transformers';

// ---------------------------------------------------------------------------
// Tasks — SprintPlanning page
// ---------------------------------------------------------------------------

export function useTasksQuery(teamId: string | null) {
    const setTasks = useAppStore((s) => s.setTasks);

    return useQuery({
        queryKey: ['tasks', teamId],
        queryFn: async () => {
            if (!supabaseSync || !teamId) return null;

            const { data, error } = await supabaseSync
                .from('tasks')
                .select('*')
                .eq('team_id', teamId);

            if (error) throw error;

            const transformed = (data || []).map(transformTaskFromSupabase);
            setTasks(transformed);
            return transformed;
        },
        enabled: !!teamId && isSupabaseConfigured() && navigator.onLine,
        staleTime: 30_000,
    });
}

// ---------------------------------------------------------------------------
// Scouting Reports — ScoutingReports page
// ---------------------------------------------------------------------------

export function useScoutingQuery(teamId: string | null) {
    const setScoutingReports = useAppStore((s) => s.setScoutingReports);

    return useQuery({
        queryKey: ['scouting_reports', teamId],
        queryFn: async () => {
            if (!supabaseSync || !teamId) return null;

            const { data, error } = await supabaseSync
                .from('scouting_reports')
                .select('*')
                .eq('team_id', teamId);

            if (error) throw error;

            const transformed = (data || []).map(transformScoutingReportFromSupabase);
            setScoutingReports(transformed);
            return transformed;
        },
        enabled: !!teamId && isSupabaseConfigured() && navigator.onLine,
        staleTime: 30_000,
    });
}

// ---------------------------------------------------------------------------
// Match Plans — MatchPlanner page
// ---------------------------------------------------------------------------

export function useMatchPlansQuery(teamId: string | null) {
    const setMatchPlans = useAppStore((s) => s.setMatchPlans);

    return useQuery({
        queryKey: ['match_plans', teamId],
        queryFn: async () => {
            if (!supabaseSync || !teamId) return null;

            const { data, error } = await supabaseSync
                .from('match_plans')
                .select('*')
                .eq('team_id', teamId);

            if (error) throw error;

            const transformed = (data || []).map(transformMatchPlanFromSupabase);
            setMatchPlans(transformed);
            return transformed;
        },
        enabled: !!teamId && isSupabaseConfigured() && navigator.onLine,
        staleTime: 30_000,
    });
}
