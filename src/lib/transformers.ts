/**
 * Shared data transformation functions.
 *
 * These convert between Supabase's snake_case schema and the app's camelCase
 * interfaces.  Every place that reads rows from Supabase (store.fetchTeamData,
 * sync.updateLocalDatabase, sync.mergeIntoStore, React Query hooks) should
 * call these instead of inlining the mapping.
 */

import type { Task, ScoutingReport, MatchPlan, Season, SubTeam } from '../types';

// ── Supabase → Local (snake_case → camelCase) ──────────────────────────────

export function transformTaskFromSupabase(t: any): Task {
    return {
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
    };
}

export function transformScoutingReportFromSupabase(r: any): ScoutingReport {
    return {
        id: r.id,
        teamNumber: r.opponent_team_number,
        // NULL means "not recorded" (B18); keep it undefined rather than coercing to 0.
        matchNumber: r.match_number ?? undefined,
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
    };
}

export function transformMatchPlanFromSupabase(p: any): MatchPlan {
    return {
        id: p.id,
        title: p.title || `Match ${p.match_number || '?'}`,
        drawingData: p.drawing_data,
        notes: p.notes || '',
        allianceTeam: p.alliance_team || '',
        partnerAutonomous: false,
        partnerPark: false,
        updatedAt: new Date(p.updated_at).getTime(),
        seasonId: p.season_id,
    };
}

export function transformSeasonFromSupabase(s: any): Season {
    return {
        id: s.id,
        name: s.name,
        teamId: s.team_id,
        fieldImageData: s.field_image_data || '',
        createdAt: new Date(s.created_at).getTime(),
    };
}

export function transformSubTeamFromSupabase(st: any): SubTeam {
    return {
        id: st.id,
        name: st.name,
        memberIds: st.member_ids || [],
        seasonId: st.season_id,
    };
}
