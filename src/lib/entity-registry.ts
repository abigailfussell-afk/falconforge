/**
 * One definition per synced entity.
 *
 * WHY THIS EXISTS
 *
 * The same four facts about each entity -- its store key, its Supabase table name, and the
 * two directions of its field mapping -- used to be spelled out in four different places:
 *
 *   - `transformXFromSupabase` in transformers.ts   (remote -> local)
 *   - a `switch` in sync.transformToSupabaseSchema  (local -> remote)
 *   - a `switch` in sync.updateLocalDatabase        (store writes, full pull)
 *   - a `switch` in sync.mergeIntoStore             (store writes, delta pull)
 *
 * plus SYNCED_TABLES and handleRealtimeDelete in realtime.ts.
 *
 * Nothing forced those to agree, and they didn't. `partnerAutonomous` and `partnerPark`
 * were read but never written. `match_number` was written from a property MatchPlan did
 * not have. `archivedAt` had no column at all. Three separate instances of the same
 * asymmetry, each invisible until someone noticed data reverting after a sync.
 *
 * With one definition per entity the asymmetry becomes expressible as a test:
 *
 *     fromRemote(toRemote(x)) deep-equals x
 *
 * which fails the moment a field is added to one direction and not the other. That test
 * catches the NEXT one of these for free, which is the actual point of the refactor.
 *
 * NOT IN HERE: checklists. They are blob-synced -- one row per team holding an array --
 * so they have no per-record identity and none of the array semantics below apply. They
 * stay special-cased in sync.ts, which is honest about what they are.
 */
import type { Task, ScoutingReport, MatchPlan, Season, SubTeam, TeamMember } from '../types';
import type { AppState } from './store';
import type { Database } from './database.types';

/** Table names that actually exist in the database, straight from the generated types. */
export type RemoteTable = keyof Database['public']['Tables'];

// ---------------------------------------------------------------------------
// Shared coercion
// ---------------------------------------------------------------------------

/**
 * Postgres timestamp -> epoch millis, or undefined.
 *
 * `new Date(null).getTime()` is NaN, and NaN sorts unpredictably and renders as
 * "Invalid Date". The old transformers guarded this inconsistently: scouting reports
 * checked for a missing value, tasks, seasons and match plans did not (B11).
 */
export function toEpochMillis(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const ms = new Date(value as string).getTime();
    return Number.isNaN(ms) ? undefined : ms;
}

/** Epoch millis -> ISO string for Postgres, or null. */
export function toISO(value: number | undefined | null): string | null {
    if (value === null || value === undefined || Number.isNaN(value)) return null;
    return new Date(value).toISOString();
}

/**
 * Local record plus the context the server needs but the local type does not carry.
 * The store slices attach these when queueing (see createTaskSlice).
 */
export type WithSyncContext<T> = T & { teamId?: string; seasonId?: string };

export interface EntityDefinition<TLocal extends { id: string }> {
    /** Key in the Zustand store, camelCase. */
    localKey: string;
    /** Supabase table, snake_case. Constrained to a real table by the generated types. */
    remoteTable: RemoteTable;
    /** Local -> Supabase row. */
    toRemote: (local: WithSyncContext<TLocal>) => Record<string, unknown>;
    /** Supabase row -> local. */
    fromRemote: (row: any) => TLocal;
    /**
     * Local fields written by the SERVER, not the client -- `created_at`/`updated_at`
     * column defaults and triggers. `toRemote` deliberately omits them: sending a
     * client-invented value would overwrite the authoritative one.
     *
     * Declared here so the round-trip property test knows they cannot survive a trip
     * through `toRemote`, rather than silently tolerating any field that fails to.
     */
    serverAssigned: readonly (keyof TLocal)[];
    /** Read this entity's collection out of the store. */
    getFromStore: (store: AppState) => TLocal[];
    /** Replace this entity's collection in the store. */
    setInStore: (store: AppState, items: TLocal[]) => void;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const tasks: EntityDefinition<Task> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'tasks',
    remoteTable: 'tasks',
    toRemote: (t) => ({
        id: t.id,
        team_id: t.teamId,
        season_id: t.seasonId,
        // `department` is the legacy name for the sub-team id; both are accepted on the
        // way out so older queued payloads still push correctly.
        sub_team_id: t.department || (t as any).subTeamId || null,
        title: t.title,
        description: t.description,
        status: t.status,
        type: t.type,
        assigned_to: t.assignedTo || null,
        tags: t.tags || [],
        checklist: t.checklist || [],
        timeline: t.timeline || [],
        due_date: toISO(t.dueDate),
        archived_at: toISO(t.archivedAt),
    }),
    fromRemote: (r) => ({
        id: r.id,
        title: r.title,
        description: r.description || '',
        status: r.status,
        type: r.type,
        assignedTo: r.assigned_to || '',
        department: r.sub_team_id || '',
        tags: r.tags || [],
        checklist: r.checklist || [],
        timeline: r.timeline || [],
        createdAt: toEpochMillis(r.created_at) ?? 0,
        dueDate: toEpochMillis(r.due_date),
        archivedAt: toEpochMillis(r.archived_at),
        seasonId: r.season_id,
    }),
    getFromStore: (s) => s.tasks,
    setInStore: (s, items) => s.setTasks(items),
};

const seasons: EntityDefinition<Season> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'seasons',
    remoteTable: 'seasons',
    toRemote: (s) => ({
        id: s.id,
        name: s.name,
        team_id: s.teamId,
        field_image_data: s.fieldImageData || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        teamId: r.team_id,
        fieldImageData: r.field_image_data || '',
        createdAt: toEpochMillis(r.created_at) ?? 0,
    }),
    getFromStore: (s) => s.seasons,
    setInStore: (s, items) => s.setSeasons(items),
};

const subTeams: EntityDefinition<SubTeam> = {
    serverAssigned: [] as const,
    localKey: 'subTeams',
    remoteTable: 'sub_teams',
    toRemote: (st) => ({
        id: st.id,
        team_id: st.teamId,
        name: st.name,
        member_ids: st.memberIds || [],
        season_id: st.seasonId || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        memberIds: r.member_ids || [],
        seasonId: r.season_id ?? undefined,
    }),
    getFromStore: (s) => s.subTeams,
    setInStore: (s, items) => s.setSubTeams(items),
};

const scoutingReports: EntityDefinition<ScoutingReport> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'scoutingReports',
    remoteTable: 'scouting_reports',
    toRemote: (r) => ({
        id: r.id,
        team_id: r.teamId,
        season_id: r.seasonId,
        opponent_team_number: r.teamNumber,
        // Undefined means "not recorded" -- never 0, which the CHECK constraint rejects (B18).
        match_number: r.matchNumber ?? null,
        event_name: r.eventName || null,
        created_by: r.createdBy || null,
        // The scouting payload lives in a jsonb column rather than as columns, so the
        // nesting is part of the mapping rather than an accident.
        data: {
            hasAutonomous: r.hasAutonomous,
            autoScore: r.autoScore,
            intakeType: r.intakeType,
            autoAim: r.autoAim,
            farShooting: r.farShooting,
            shotsTaken: r.shotsTaken,
            shotsMissed: r.shotsMissed,
            parking: r.parking,
            rating: r.rating,
            endGameNotes: r.endGameNotes,
        },
    }),
    fromRemote: (r) => ({
        id: r.id,
        teamNumber: r.opponent_team_number,
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
        createdAt: toEpochMillis(r.created_at),
    }),
    getFromStore: (s) => s.scoutingReports,
    setInStore: (s, items) => s.setScoutingReports(items),
};

const matchPlans: EntityDefinition<MatchPlan> = {
    serverAssigned: ['updatedAt'] as const,
    localKey: 'matchPlans',
    remoteTable: 'match_plans',
    toRemote: (p) => ({
        id: p.id,
        team_id: p.teamId,
        season_id: p.seasonId,
        title: p.title,
        match_number: p.matchNumber ?? null,
        alliance_team: p.allianceTeam || null,
        drawing_data: p.drawingData,
        notes: p.notes,
        // Previously never written, and hardcoded to false on read (B9).
        partner_autonomous: p.partnerAutonomous ?? false,
        partner_park: p.partnerPark ?? false,
    }),
    fromRemote: (r) => ({
        id: r.id,
        title: r.title || `Match ${r.match_number || '?'}`,
        matchNumber: r.match_number ?? undefined,
        drawingData: r.drawing_data,
        notes: r.notes || '',
        allianceTeam: r.alliance_team || '',
        partnerAutonomous: r.partner_autonomous ?? false,
        partnerPark: r.partner_park ?? false,
        updatedAt: toEpochMillis(r.updated_at) ?? 0,
        seasonId: r.season_id,
    }),
    getFromStore: (s) => s.matchPlans,
    setInStore: (s, items) => s.setMatchPlans(items),
};

/**
 * Roster rows.
 *
 * PULL-ONLY. The client never pushes team_members: membership is created and changed by
 * the `create_team_as_coach` / `join_team_with_invite` RPCs and by the coach UI writing
 * directly, never by the offline queue. It is registered here anyway because the mapping
 * existed regardless -- as an inline `(m: any) => ({...})` in `store.fetchTeamData` with
 * `role as any` / `status as any` casts, which is precisely the second read path this
 * registry exists to prevent. `toRemote` is what Sprint 6's admin console will write
 * through; until then its job is to keep the round-trip test honest about the mapping.
 */
const teamMembers: EntityDefinition<TeamMember> = {
    // joined_at is a column default, so a client-sent value would overwrite the real one.
    serverAssigned: ['joinedAt'] as const,
    localKey: 'teamMembers',
    remoteTable: 'team_members',
    toRemote: (m) => ({
        id: m.id,
        team_id: m.teamId,
        user_id: m.userId,
        role: m.role,
        status: m.status,
        is_billing_active: m.isBillingActive,
        full_name: m.fullName,
        email: m.email,
        avatar_url: m.avatarUrl,
    }),
    fromRemote: (r) => ({
        id: r.id,
        teamId: r.team_id,
        userId: r.user_id,
        role: toMemberRole(r.role),
        status: toMemberStatus(r.status),
        isBillingActive: r.is_billing_active ?? false,
        fullName: r.full_name ?? null,
        email: r.email,
        avatarUrl: r.avatar_url ?? null,
        joinedAt: toEpochMillis(r.joined_at) ?? 0,
    }),
    getFromStore: (s) => s.teamMembers,
    setInStore: (s, items) => s.setTeamMembers(items),
};

const MEMBER_ROLES: readonly string[] = ['coach', 'assistant_coach', 'mentor', 'student'];
const MEMBER_STATUSES: readonly string[] = ['pending', 'approved', 'removed'];

/**
 * Narrow a server string to the role union.
 *
 * The old inline transform wrote `role: m.role as any`, so a value outside the union --
 * from a schema change, or a role added server-side before the client knows about it --
 * flowed straight into code that compares against literals. Anything unrecognised falls
 * back to the least-privileged role rather than being trusted.
 */
function toMemberRole(value: unknown): TeamMember['role'] {
    return MEMBER_ROLES.includes(value as string) ? (value as TeamMember['role']) : 'student';
}

/** Same, for status. An unrecognised status is treated as not-yet-approved. */
function toMemberStatus(value: unknown): TeamMember['status'] {
    return MEMBER_STATUSES.includes(value as string) ? (value as TeamMember['status']) : 'pending';
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Entities the offline queue pushes to the server, in pull order: parents (seasons,
 * sub-teams) before the records that reference them, matching what the pull did when the
 * list was inline.
 *
 * `sync.ts` derives the set of tables the queue may touch from this list, so a pull-only
 * entity being absent here is what makes it pull-only.
 */
export const SYNCED_ENTITIES = [seasons, subTeams, tasks, scoutingReports, matchPlans] as const;

/** Read from the server, never pushed by the client. */
export const PULL_ONLY_ENTITIES = [teamMembers] as const;

/** Every registered entity, whichever direction it travels. */
export const ENTITIES = [...SYNCED_ENTITIES, ...PULL_ONLY_ENTITIES] as const;

/**
 * Resolve a definition from either naming convention.
 *
 * Callers used to pass camelCase in some places and snake_case in others -- realtime.ts
 * handed `localTable` to mergeIntoStore and `table` to handleRealtimeDelete in the same
 * loop (B16). Accepting both here removes the trap rather than documenting it.
 */
const BY_NAME = new Map<string, EntityDefinition<any>>();
for (const entity of ENTITIES) {
    BY_NAME.set(entity.localKey, entity);
    BY_NAME.set(entity.remoteTable, entity);
}

export function findEntity(name: string): EntityDefinition<any> | undefined {
    return BY_NAME.get(name);
}
