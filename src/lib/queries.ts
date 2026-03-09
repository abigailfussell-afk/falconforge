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

            const transformed = (data || []).map((t: any) => ({
                id: t.id,
                title: t.title,
                description: t.description || '',
                status: t.status,
                type: t.type,
                assignedTo: t.assigned_to || '',
                department: t.sub_team_id || '',
                tags: t.tags || [],
                checklist: t.checklist || [],
                timeline: t.timeline || [],
                createdAt: new Date(t.created_at).getTime(),
                dueDate: t.due_date ? new Date(t.due_date).getTime() : undefined,
                seasonId: t.season_id,
            }));

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

            const transformed = (data || []).map((r: any) => ({
                id: r.id,
                teamNumber: r.opponent_team_number,
                matchNumber: r.match_number,
                eventName: r.event_name || '',
                hasAutonomous: r.data?.hasAutonomous ?? false,
                autoScore: r.data?.autoScore ?? 0,
                intakeType: r.data?.intakeType ?? 'No Intake',
                autoAim: r.data?.autoAim ?? false,
                farShooting: r.data?.farShooting ?? false,
                shotsTaken: r.data?.shotsTaken ?? 0,
                shotsMissed: r.data?.shotsMissed ?? 0,
                parking: r.data?.parking ?? 'No Park',
                rating: r.data?.rating ?? 0,
                endGameNotes: r.data?.endGameNotes ?? '',
                createdBy: r.created_by || '',
                seasonId: r.season_id,
                createdAt: r.created_at ? new Date(r.created_at).getTime() : undefined,
            }));

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

            const transformed = (data || []).map((p: any) => ({
                id: p.id,
                title: p.title || `Match ${p.match_number || '?'}`,
                drawingData: p.drawing_data,
                notes: p.notes || '',
                allianceTeam: p.alliance_team || '',
                partnerAutonomous: false,
                partnerPark: false,
                updatedAt: new Date(p.updated_at).getTime(),
                seasonId: p.season_id,
            }));

            setMatchPlans(transformed);
            return transformed;
        },
        enabled: !!teamId && isSupabaseConfigured() && navigator.onLine,
        staleTime: 30_000,
    });
}
