/**
 * One definition per synced entity.
 *
 * WHY THIS EXISTS
 *
 * The same four facts about each entity -- its store key, its Supabase table name, and the
 * two directions of its field mapping -- used to be spelled out in four different places:
 *
 *   - `transformXFromSupabase` in transformers.ts   (remote -> local)  [deleted, Sprint 5]
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
import type {
    Task,
    ScoutingReport,
    MatchPlan,
    Season,
    SubTeam,
    Team,
    TeamMember,
    Meeting,
    MeetingAttendance,
    MeetingEventType,
    AttendanceStatus,
    AttendanceMethod,
    ManagedProfile,
    TeamGameOverride,
    CompetitionEvent,
    EventMatch,
    MatchParticipant,
    GuardianConsent,
    GuardianConsentType,
} from '../types';
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

/**
 * What a row belongs to, and therefore which column a pull filters on.
 *
 * `'team'` — `team_id = <the open team>`. Everything the app had until Sprint 9.
 *
 * `'guardian'` — `guardian_user_id = <the signed-in user>`. `managed_profiles` and
 * `guardian_consents` have no `team_id` and never will: a child's profile belongs to their
 * guardian, not to whichever team they happen to be rostered on this season, and a consent
 * is between the guardian and the platform.
 *
 * REQUIRED, not defaulted, and that is the whole point. `pullFromServer` filtered every table
 * on `team_id` unconditionally, so a guardian entity added without this field would have been
 * pulled with `.eq('team_id', ...)` against a table that has no such column — one warning per
 * pull in a `console.warn` nobody reads, and an empty children list that looks exactly like a
 * guardian who has not added a child yet. Making the field required means the question is
 * answered when an entity is registered rather than discovered when it is used.
 *
 * `'rls'` — NO CLIENT-SIDE FILTER AT ALL. The row set is whatever the caller's policies
 * return, and `teams` is the only entity of this shape: its policy is
 * `is_team_member(id) OR is_team_guardian(id)`, so one unfiltered select already returns a
 * member's own teams, a guardian's children's teams, and the union of both for a coach who
 * is also a parent — which is precisely what the hand-written `pullGuardianTeams` was
 * merging by hand.
 *
 * Read the name as a warning as much as a description: for the other two scopes a missing
 * filter still meets RLS on the way out, but here the client sends no predicate whatsoever,
 * so the policy is the only thing standing between this query and every team on the
 * platform. That is exactly the property `tenant-isolation.rls.db.test.ts` exists to assert
 * behaviourally, and `teams` is asserted there for both a member and a guardian.
 */
export type EntityScope = 'team' | 'guardian' | 'rls';

/**
 * How a row reaches the season it belongs to, or `null` when it is not season-scoped.
 *
 * `'column'` -- the row carries `season_id`, so the pull filters on it directly.
 *
 * `'meeting'` -- `meeting_attendance`, the one season-scoped table with no `season_id` of its
 * own. It reaches its season through `meetings.season_id`, which the pull expresses as a
 * PostgREST embedded inner join (`select=*,meetings!inner()` plus
 * `meetings.season_id=eq.<id>`). The EMPTY embed spec is load-bearing: it filters without
 * adding a nested object to every row, so the join costs nothing on the wire.
 *
 * `null` -- `seasons` itself (the picker needs all of them), `teams`, `team_members`, and the
 * guardian tables.
 *
 * Declared here rather than as a list in `server-pull.ts` for the reason the registry exists:
 * the season filter has already been six hand-written copies (`docs/failure-modes.md`
 * section 1), and a seventh in the pull would be the same mistake with a wider blast radius --
 * a table left out is a table whose entire history is downloaded on every app open.
 */
export type SeasonScope = 'column' | 'meeting' | null;

export interface EntityDefinition<TLocal extends { id: string }> {
    /** Key in the Zustand store, camelCase. */
    localKey: string;
    /** Supabase table, snake_case. Constrained to a real table by the generated types. */
    remoteTable: RemoteTable;
    /** Which column scopes this entity's rows. See {@link EntityScope}. */
    scope: EntityScope;
    /** How this entity reaches its season, if it has one. See {@link SeasonScope}. */
    seasonScope: SeasonScope;
    /**
     * Columns the pull selects, when `select('*')` is too much.
     *
     * `undefined` means `*`. Only `seasons` narrows it, to keep `field_image_data` -- up to
     * ~670 KB of base64 per season -- off the wire on every app open (SYNC-03).
     *
     * A hand-written column list is exactly the kind of second list that drifts from the
     * schema (`docs/failure-modes.md` section 12), so `season-columns.db.test.ts` compares it
     * to `information_schema.columns` and fails when a column is added to the table and not
     * to this list.
     */
    pullColumns?: readonly string[];
    /**
     * Local fields whose remote column {@link pullColumns} leaves out.
     *
     * When a pulled row does not carry the column, the value already on the device wins --
     * because an absent column is not an empty value (`docs/failure-modes.md` section 4).
     * Realtime rows DO carry it (REPLICA IDENTITY FULL) and overwrite as usual, so a field
     * image replaced on another device still arrives.
     */
    deferredFields?: readonly (keyof TLocal)[];
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
    scope: 'team',
    seasonScope: 'column',
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
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.tasks,
    setInStore: (s, items) => s.setTasks(items),
};

const seasons: EntityDefinition<Season> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'seasons',
    remoteTable: 'seasons',
    scope: 'team',
    seasonScope: null,
    // Every column except `field_image_data`. See EntityDefinition.pullColumns.
    pullColumns: [
        'id', 'name', 'team_id', 'game_title', 'game_definition_id', 'game_definition_version',
        'is_archived', 'created_at', 'updated_at',
    ],
    deferredFields: ['fieldImageData'] as const,
    toRemote: (s) => ({
        id: s.id,
        name: s.name,
        team_id: s.teamId,
        // Nullable with a not-blank CHECK, so whitespace-only has to become NULL rather
        // than reaching the constraint. Same shape as field_image_data below.
        game_title: s.gameTitle?.trim() || null,
        // P-01 phase S: which template, and which version of it. Null until a season is
        // created or edited by a build that knows about them.
        game_definition_id: s.gameDefinitionId || null,
        game_definition_version: s.gameDefinitionVersion ?? null,
        /*
         * OMITTED, not nulled, when this device has never fetched it.
         *
         * The pull leaves `field_image_data` out of its select (SYNC-03), so a season this
         * device has only ever read carries `undefined` here. Letting `|| null` spread over
         * that would blank a 670 KB image on the server the first time somebody renamed the
         * season -- the push sends the whole row, so every field it can express is a field it
         * can destroy. `''` still means "somebody pressed Remove Image" and still nulls the
         * column; only "we do not know" is left alone.
         */
        ...(s.fieldImageData === undefined ? {} : { field_image_data: s.fieldImageData || null }),
        // Sprint 4. Written as well as read: archiving the outgoing season is the second
        // half of a rollover, and a field carried in only one direction is exactly the
        // asymmetry this registry exists to make impossible (B9/B10/B17).
        is_archived: s.isArchived ?? false,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        teamId: r.team_id,
        gameTitle: r.game_title || '',
        gameDefinitionId: r.game_definition_id ?? null,
        gameDefinitionVersion: r.game_definition_version ?? null,
        // Absent column -> undefined ("not fetched"); present-and-null -> '' ("no image").
        fieldImageData: 'field_image_data' in r ? (r.field_image_data || '') : undefined,
        isArchived: r.is_archived ?? false,
        createdAt: toEpochMillis(r.created_at) ?? 0,
    }),
    getFromStore: (s) => s.seasons,
    setInStore: (s, items) => s.setSeasons(items),
};

const subTeams: EntityDefinition<SubTeam> = {
    serverAssigned: [] as const,
    localKey: 'subTeams',
    remoteTable: 'sub_teams',
    scope: 'team',
    seasonScope: 'column',
    toRemote: (st) => ({
        id: st.id,
        team_id: st.teamId,
        name: st.name,
        member_ids: st.memberIds || [],
        // NOT NULL in the schema, and required on the type. The `|| null` that used to be
        // here was the client half of C6: it turned "no season selected" into a push that
        // could only ever fail its not-null constraint.
        season_id: st.seasonId,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        memberIds: r.member_ids || [],
        seasonId: r.season_id,
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.subTeams,
    setInStore: (s, items) => s.setSubTeams(items),
};

const scoutingReports: EntityDefinition<ScoutingReport> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'scoutingReports',
    remoteTable: 'scouting_reports',
    scope: 'team',
    seasonScope: 'column',
    toRemote: (r) => ({
        id: r.id,
        team_id: r.teamId,
        season_id: r.seasonId,
        opponent_team_number: r.teamNumber,
        // Undefined means "not recorded" -- never 0, which the CHECK constraint rejects (B18).
        match_number: r.matchNumber ?? null,
        event_name: r.eventName || null,
        created_by: r.createdBy || null,
        /*
         * THE PAYLOAD PASSES THROUGH, UNREAD (P-01 phase S).
         *
         * This used to enumerate ten DECODE keys in each direction, which meant the sync layer
         * knew what game it was September. It also meant an UNKNOWN KEY WAS DROPPED: a report
         * written by a newer build, or carrying a field a team added under D4(b), lost that
         * field on the next round trip through an older client — silently, because the row
         * still saved.
         *
         * `data` is now opaque here and typed by the season's `GameDefinition` at render time.
         * The round-trip test asserts an unknown key survives, which is the property that
         * enumeration could not have.
         */
        data: r.data ?? {},
    }),
    fromRemote: (r) => ({
        id: r.id,
        teamNumber: r.opponent_team_number,
        matchNumber: r.match_number ?? undefined,
        eventName: r.event_name || '',
        /*
         * `?? {}` and no per-key defaults, which also retires P-01's named trap: the DECODE
         * form defaulted `rating` to 3 and this line defaulted it to 0, so a report saved
         * without touching the slider read back as a different number than it was saved with.
         * One default now, in the schema, applied by `blankReportData` when the form opens.
         */
        data: (r.data as Record<string, unknown>) ?? {},
        createdBy: r.created_by || '',
        seasonId: r.season_id,
        teamId: r.team_id,
        createdAt: toEpochMillis(r.created_at),
    }),
    getFromStore: (s) => s.scoutingReports,
    setInStore: (s, items) => s.setScoutingReports(items),
};

const matchPlans: EntityDefinition<MatchPlan> = {
    serverAssigned: ['updatedAt'] as const,
    localKey: 'matchPlans',
    remoteTable: 'match_plans',
    scope: 'team',
    seasonScope: 'column',
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
        teamId: r.team_id,
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
    scope: 'team',
    seasonScope: null,
    toRemote: (m) => ({
        id: m.id,
        team_id: m.teamId,
        user_id: m.userId,
        managed_profile_id: m.managedProfileId ?? null,
        role: m.role,
        status: m.status,
        seat_assigned: m.seatAssigned,
        full_name: m.fullName,
        email: m.email,
        avatar_url: m.avatarUrl,
    }),
    fromRemote: (r) => ({
        id: r.id,
        teamId: r.team_id,
        userId: r.user_id,
        managedProfileId: r.managed_profile_id ?? null,
        role: toMemberRole(r.role),
        status: toMemberStatus(r.status),
        seatAssigned: r.seat_assigned ?? false,
        fullName: r.full_name ?? null,
        email: r.email,
        avatarUrl: r.avatar_url ?? null,
        joinedAt: toEpochMillis(r.joined_at) ?? 0,
    }),
    getFromStore: (s) => s.teamMembers,
    setInStore: (s, items) => s.setTeamMembers(items),
};

/**
 * The schedule.
 *
 * Sprint 3 left `meetings` and `meeting_attendance` out of the registry deliberately — "a
 * registry entry with nothing reading it is dead code" — and put them in the parking lot for
 * whichever sprint built the UI. This is that sprint.
 *
 * Registering them does more than name the mapping: `SYNC_PULL_TABLES` and `realtime.ts` are
 * both derived from this list, so a meeting cancelled on the coach's laptop reaches every
 * student's phone, and the whole feature works offline through the same queue as everything
 * else. That is also why the migration gives both tables REPLICA IDENTITY FULL (B7/B22).
 */
const meetings: EntityDefinition<Meeting> = {
    serverAssigned: [] as const,
    localKey: 'meetings',
    remoteTable: 'meetings',
    scope: 'team',
    seasonScope: 'column',
    toRemote: (m) => ({
        id: m.id,
        team_id: m.teamId,
        season_id: m.seasonId,
        title: m.title,
        description: m.description || null,
        location: m.location || null,
        event_type: m.eventType,
        // Empty means "no check-in", which is NULL in a column with a four-digit CHECK and a
        // partial unique index that excludes NULLs. `''` would fail both.
        public_code: m.publicCode || null,
        attendance_required: m.attendanceRequired,
        starts_at: toISO(m.startsAt),
        ends_at: toISO(m.endsAt),
        // NULL means "the default window". Writing the derived value here instead would make
        // every meeting permanently overridden the first time it was saved.
        checkin_opens_at: toISO(m.checkinOpensAt),
        checkin_closes_at: toISO(m.checkinClosesAt),
        recurrence_rule: m.recurrenceRule || null,
        series_id: m.seriesId || null,
        created_by: m.createdBy || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        title: r.title,
        description: r.description || '',
        location: r.location || '',
        eventType: toEventType(r.event_type),
        publicCode: r.public_code || '',
        attendanceRequired: r.attendance_required ?? true,
        startsAt: toEpochMillis(r.starts_at) ?? 0,
        endsAt: toEpochMillis(r.ends_at),
        checkinOpensAt: toEpochMillis(r.checkin_opens_at),
        checkinClosesAt: toEpochMillis(r.checkin_closes_at),
        recurrenceRule: r.recurrence_rule || '',
        seriesId: r.series_id || '',
        createdBy: r.created_by || '',
        seasonId: r.season_id,
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.meetings,
    setInStore: (s, items) => s.setMeetings(items),
};

/**
 * Attendance.
 *
 * Pushed by the coach's roster save and pulled like anything else. A student's own check-in
 * does NOT come through here — it goes through `check_in_with_code`, because the window can
 * only be judged against the server's clock. See the migration's header.
 *
 * No `season_id`: this is the one season-scoped table without one, reaching its season
 * through its meeting. `team_id` is denormalised so RLS can scope it without a join, and the
 * composite foreign key is what keeps the copy honest.
 */
const meetingAttendance: EntityDefinition<MeetingAttendance> = {
    serverAssigned: [] as const,
    localKey: 'meetingAttendance',
    remoteTable: 'meeting_attendance',
    scope: 'team',
    seasonScope: 'meeting',
    toRemote: (a) => ({
        id: a.id,
        team_id: a.teamId,
        meeting_id: a.meetingId,
        team_member_id: a.teamMemberId,
        status: a.status,
        method: a.method,
        notes: a.notes || null,
        attested_by: a.attestedBy || null,
        attested_at: toISO(a.attestedAt),
    }),
    fromRemote: (r) => ({
        id: r.id,
        meetingId: r.meeting_id,
        teamMemberId: r.team_member_id,
        status: toAttendanceStatus(r.status),
        method: toAttendanceMethod(r.method),
        notes: r.notes || '',
        attestedBy: r.attested_by || '',
        attestedAt: toEpochMillis(r.attested_at),
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.meetingAttendance,
    setInStore: (s, items) => s.setMeetingAttendance(items),
};

/**
 * The children a guardian holds profiles for.
 *
 * GUARDIAN-SCOPED, NOT TEAM-SCOPED, and that is not a detail. A child's profile belongs to
 * their guardian; it outlives any one team and any one season, and it is retained even after
 * the child is promoted to their own login, as the record of why they were rostered. There is
 * no `team_id` here to filter on, which is what `scope` exists to express.
 *
 * Sprint 3 left both guardian tables out of the registry deliberately — "a registry entry with
 * nothing reading it is dead code" — and parked them for whichever sprint built the UI. This is
 * that sprint, and the same argument that enrolled `meetings` in Sprint 8 applies: registering
 * them is what puts them through the one read path that honours `getPendingRecordIds()`, and
 * what makes a child added on a phone with no signal survive to the next pull.
 *
 * NO `birth_year`. It was dropped in the same sprint; see `ManagedProfile`.
 */
const managedProfiles: EntityDefinition<ManagedProfile> = {
    /*
     * `promotionCode` is server-assigned in the strong sense: the client may READ it and is
     * refused permission to write it (column-level GRANTs in
     * `20260822000200_guardian_access.sql`), because a claim code is a credential and a
     * client-chosen credential is a guessable one. Declaring it here is what lets the
     * round-trip test know the asymmetry is intended, rather than it looking like the
     * read-but-never-written bugs the registry was built to catch (B9).
     */
    serverAssigned: ['createdAt', 'promotionCode', 'promotedToUserId', 'promotedAt'] as const,
    localKey: 'managedProfiles',
    remoteTable: 'managed_profiles',
    scope: 'guardian',
    seasonScope: null,
    toRemote: (p) => ({
        id: p.id,
        guardian_user_id: p.guardianUserId,
        full_name: p.fullName,
        // NULL rather than '' — `notes` is nullable and an empty string is not a note.
        notes: p.notes || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        guardianUserId: r.guardian_user_id,
        fullName: r.full_name,
        notes: r.notes || '',
        // '' means "no promotion offered", which is the normal state.
        promotionCode: r.promotion_code || '',
        /*
         * NULL PRESERVED AS NULL, not flattened to '' or 0 (WALK-B-03).
         *
         * `promotionCode` uses '' for "none" because a code is a string and the empty string
         * is unambiguous. These two cannot borrow that trick: `promotedAt` is a timestamp, and
         * `0` is 1 January 1970 rather than "never" -- B18's `parseInt('') -> NaN -> || 0`
         * corrupted five of nine live production rows through exactly this reflex. Three
         * states, not two: absent means the child still has no login of their own.
         */
        promotedToUserId: r.promoted_to_user_id ?? null,
        promotedAt: toEpochMillis(r.promoted_at) ?? null,
        createdAt: toEpochMillis(r.created_at),
    }),
    getFromStore: (s) => s.managedProfiles,
    setInStore: (s, items) => s.setManagedProfiles(items),
};

/**
 * The consents a guardian has given, one per (child, document).
 *
 * `version` is carried in BOTH directions and has no default at either end. That is the whole
 * point of the Sprint 9 migration: the client owns the number, so a consent records the version
 * of the document the guardian was actually shown. A `?? '1.0'` anywhere in this definition
 * would reintroduce exactly the defect the migration removed, one layer up.
 */
const guardianConsents: EntityDefinition<GuardianConsent> = {
    serverAssigned: ['consentedAt'] as const,
    localKey: 'guardianConsents',
    remoteTable: 'guardian_consents',
    scope: 'guardian',
    seasonScope: null,
    toRemote: (c) => ({
        id: c.id,
        managed_profile_id: c.managedProfileId,
        guardian_user_id: c.guardianUserId,
        consent_type: c.consentType,
        // No fallback, deliberately. See the type's doc comment and
        // `20260822000000_guardian_schema_cleanup.sql`.
        version: c.version,
    }),
    fromRemote: (r) => ({
        id: r.id,
        managedProfileId: r.managed_profile_id,
        guardianUserId: r.guardian_user_id,
        consentType: toConsentType(r.consent_type),
        version: r.version,
        consentedAt: toEpochMillis(r.consented_at),
    }),
    getFromStore: (s) => s.guardianConsents,
    setInStore: (s, items) => s.setGuardianConsents(items),
};

const CONSENT_TYPES: readonly string[] = [
    'coppa_data_collection', 'terms', 'privacy', 'community_guidelines',
];

/**
 * Narrow a server string to the consent-type union.
 *
 * Same rule as `toMemberRole`: a value the client was not built for must land on something
 * renderable rather than flow into code comparing against literals. `coppa_data_collection`
 * is the safe landing place — it is the consent whose absence blocks rostering, so an
 * unrecognised value degrades to "we hold the one that matters" rather than to a type whose
 * absence nothing checks.
 */
function toConsentType(value: unknown): GuardianConsentType {
    return CONSENT_TYPES.includes(value as string)
        ? (value as GuardianConsentType)
        : 'coppa_data_collection';
}

const EVENT_TYPES: readonly string[] = [
    'practice', 'team_meeting', 'build', 'competition', 'outreach', 'fundraiser', 'deadline',
];
const ATTENDANCE_STATUSES: readonly string[] = ['present', 'excused', 'absent'];
const ATTENDANCE_METHODS: readonly string[] = ['qr', 'code', 'coach'];

/**
 * Narrow a server string to the event-type union.
 *
 * Same rule as `toMemberRole` below and for the same reason: a value the client was not built
 * for must land on something renderable rather than flow into code comparing against
 * literals. `team_meeting` is the neutral choice — it is the only type with no special
 * behaviour attached to it.
 */
function toEventType(value: unknown): MeetingEventType {
    return EVENT_TYPES.includes(value as string) ? (value as MeetingEventType) : 'team_meeting';
}

/**
 * Same, for attendance status — but falling back to `absent` would be a LIE about a person,
 * so an unrecognised value becomes `excused`: the state that counts neither for nor against
 * anybody. (The only way to reach this is a schema change; 'late' was removed in Sprint 8 and
 * never had a row.)
 */
function toAttendanceStatus(value: unknown): AttendanceStatus {
    return ATTENDANCE_STATUSES.includes(value as string) ? (value as AttendanceStatus) : 'excused';
}

function toAttendanceMethod(value: unknown): AttendanceMethod {
    return ATTENDANCE_METHODS.includes(value as string) ? (value as AttendanceMethod) : 'coach';
}

const MEMBER_ROLES: readonly string[] = ['admin', 'coach', 'mentor', 'student'];
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
/**
 * The tenant itself — and the last collection in the app to have a definition.
 *
 * It was the one thing outside the registry, which the parking lot had said in red since
 * Sprint 7, and by Sprint 9 that had cost the usual price: THREE hand-written mappings of the
 * same four columns, each written correctly and none aware of the others.
 *
 *   - `Onboarding.tsx` built Team objects out of a nested `teams:team_id (...)` select;
 *   - `pullGuardianTeams` in server-pull.ts built them out of a direct select and merged by
 *     id, because a coach who is also a parent must not lose their own team list;
 *   - `CreateTeam.tsx` built one locally from the registration RPC's result.
 *
 * Two of the three invented `createdAt: Date.now()` for a column the server owns, so the
 * "created" date of a team was whenever that client happened to read it. `fromRemote` reads
 * the real column, and `createdAt` is declared `serverAssigned` so the round-trip test knows
 * it cannot survive a trip through `toRemote` rather than tolerating whatever comes back.
 *
 * PULL-ONLY, like `team_members`. A team is created by `create_team_as_admin` and renamed
 * through the admin panel's own RPC; nothing queues a `teams` row, and `toRemote` exists for
 * the round-trip property rather than for a caller. `owner_id` is deliberately absent from
 * `toRemote`: `teams_insert_owner` checks `owner_id = auth.uid()`, so a client-supplied value
 * is either redundant or an attempt, and neither is worth sending.
 */
const teams: EntityDefinition<Team> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'teams',
    remoteTable: 'teams',
    scope: 'rls',
    seasonScope: null,
    toRemote: (t) => ({
        id: t.id,
        name: t.name,
        team_number: t.teamNumber || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        teamNumber: r.team_number ?? null,
        ownerId: r.owner_id ?? '',
        createdAt: toEpochMillis(r.created_at) ?? 0,
    }),
    getFromStore: (s) => s.teams,
    setInStore: (s, items) => s.setTeams(items),
};

/**
 * A team's changes to the curated scouting template (D4(b)).
 *
 * One row per (team, season) — the table has a UNIQUE on that pair — so this is an entity with
 * a natural key as well as an id. The client still uses a uuid id, because the offline queue
 * merges on record id and a natural key it would have to derive is a second identity scheme
 * (`docs/failure-modes.md` §9, four sprints of that).
 */
const gameOverrides: EntityDefinition<TeamGameOverride> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'gameOverrides',
    remoteTable: 'team_game_overrides',
    scope: 'team',
    seasonScope: 'column',
    toRemote: (o) => ({
        id: o.id,
        team_id: o.teamId,
        season_id: o.seasonId,
        base_definition_id: o.baseDefinitionId,
        base_version: o.baseVersion ?? null,
        // Opaque, exactly like `scouting_reports.data`: the registry does not know what a
        // patch contains and must not start enumerating it, or adding an operation becomes a
        // sync-layer change.
        patch: (o.patch ?? {}) as never,
    }),
    fromRemote: (r) => ({
        id: r.id,
        seasonId: r.season_id,
        baseDefinitionId: r.base_definition_id,
        baseVersion: r.base_version ?? null,
        patch: (r.patch as TeamGameOverride['patch']) ?? {},
        teamId: r.team_id,
        createdAt: toEpochMillis(r.created_at),
    }),
    getFromStore: (s) => s.gameOverrides,
    setInStore: (s, items) => s.setGameOverrides(items),
};

/**
 * A competition, with the schedule hanging off it (D2).
 *
 * Season-scoped by column, like tasks and scouting reports: an event belongs to one season, and
 * a new season is a fresh start.
 */
const competitionEvents: EntityDefinition<CompetitionEvent> = {
    serverAssigned: ['createdAt'] as const,
    localKey: 'competitionEvents',
    remoteTable: 'competition_events',
    scope: 'team',
    seasonScope: 'column',
    toRemote: (e) => ({
        id: e.id,
        team_id: e.teamId,
        season_id: e.seasonId,
        name: e.name,
        event_code: e.eventCode?.trim() || null,
        /*
         * DATE STRINGS, PASSED THROUGH UNTOUCHED, and that is the whole point of the column
         * type. A competition date is a date; converting it to an instant and back renders it
         * one day early at negative UTC offsets, which this project has shipped twice
         * (`docs/failure-modes.md` §10) and which for "which day is the competition" is not a
         * cosmetic bug. `''` becomes null so a blank field is absent rather than an invalid
         * date the column would reject.
         */
        starts_on: e.startsOn?.trim() || null,
        ends_on: e.endsOn?.trim() || null,
        location: e.location?.trim() || null,
        notes: e.notes?.trim() || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        name: r.name,
        eventCode: r.event_code ?? '',
        startsOn: r.starts_on ?? '',
        endsOn: r.ends_on ?? '',
        location: r.location ?? '',
        notes: r.notes ?? '',
        seasonId: r.season_id,
        teamId: r.team_id,
        createdAt: toEpochMillis(r.created_at),
    }),
    getFromStore: (s) => s.competitionEvents,
    setInStore: (s, items) => s.setCompetitionEvents(items),
};

/**
 * One match at one event.
 *
 * NOT season-scoped, because it has no `season_id` column — it hangs off the event, which has
 * one. `seasonScope: null` is the registry's way of saying so, and the write policy checks the
 * season THROUGH the event so that the rule is enforced rather than merely implied.
 */
const eventMatches: EntityDefinition<EventMatch> = {
    serverAssigned: [] as const,
    localKey: 'eventMatches',
    remoteTable: 'event_matches',
    scope: 'team',
    seasonScope: null,
    toRemote: (m) => ({
        id: m.id,
        team_id: m.teamId,
        event_id: m.eventId,
        phase: m.phase,
        match_number: m.matchNumber,
        scheduled_at: toISO(m.scheduledAt),
        /*
         * `?? null`, NEVER `?? 0`. An unplayed match has no score, and 0 is a real score — a
         * 0-0 tie happens. B18 is this exact conflation, and it corrupted five of nine live
         * production scouting rows before anybody noticed.
         */
        red_score: m.redScore ?? null,
        blue_score: m.blueScore ?? null,
        notes: m.notes?.trim() || null,
    }),
    fromRemote: (r) => ({
        id: r.id,
        eventId: r.event_id,
        phase: (r.phase as EventMatch['phase']) ?? 'qualification',
        matchNumber: r.match_number,
        scheduledAt: toEpochMillis(r.scheduled_at),
        redScore: r.red_score ?? undefined,
        blueScore: r.blue_score ?? undefined,
        notes: r.notes ?? '',
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.eventMatches,
    setInStore: (s, items) => s.setEventMatches(items),
};

/** One team in one match. Rows, not columns — see the type's comment, and D3's knock-on. */
const matchParticipants: EntityDefinition<MatchParticipant> = {
    serverAssigned: [] as const,
    localKey: 'matchParticipants',
    remoteTable: 'match_participants',
    scope: 'team',
    seasonScope: null,
    toRemote: (p) => ({
        id: p.id,
        team_id: p.teamId,
        match_id: p.matchId,
        alliance: p.alliance,
        station: p.station,
        team_number: p.teamNumber,
        team_name: p.teamName?.trim() || null,
        is_surrogate: p.isSurrogate,
    }),
    fromRemote: (r) => ({
        id: r.id,
        matchId: r.match_id,
        alliance: (r.alliance as MatchParticipant['alliance']) ?? 'red',
        station: r.station,
        teamNumber: r.team_number,
        teamName: r.team_name ?? '',
        // `?? false` is right here and wrong two entities up, and the difference is worth
        // naming: `is_surrogate` is NOT NULL with a default, so absence means false. A score
        // is nullable, so absence means "not played".
        isSurrogate: r.is_surrogate ?? false,
        teamId: r.team_id,
    }),
    getFromStore: (s) => s.matchParticipants,
    setInStore: (s, items) => s.setMatchParticipants(items),
};

export const SYNCED_ENTITIES = [
    seasons,
    subTeams,
    tasks,
    scoutingReports,
    matchPlans,
    // Meetings before attendance: `meeting_attendance` carries a composite FK into
    // `meetings(id, team_id)`, so a roster saved in the same drain as the meeting it belongs
    // to must not be pushed first. Order in this array IS the push order.
    meetings,
    meetingAttendance,
    /*
     * Events before matches before participants, for the same reason meetings come before
     * attendance: each carries a composite foreign key into the one above it, so a child
     * pushed first is refused. Order in this array IS the pull order, and the push order is
     * whatever `queueForSync` timestamped (B1) — which is why the import writes them in this
     * order too, and `event-import.ts` says so.
     */
    gameOverrides,
    competitionEvents,
    eventMatches,
    matchParticipants,
] as const;

/**
 * Pushable entities scoped to the signed-in GUARDIAN rather than to a team.
 *
 * Kept as a separate list rather than mixed into {@link SYNCED_ENTITIES} because three
 * consumers derive team-scoped behaviour from that one:
 *
 *   - `SYNC_PULL_TABLES` — filters on `team_id`, which neither of these has;
 *   - `realtime.ts` — subscribes on a channel filtered by the open team, which a guardian
 *     with no membership of their own does not have;
 *   - `TEAM_DATA_TABLES` — what loading a team means.
 *
 * They ARE in `SYNCABLE_TABLES` (see sync.ts), because the offline queue pushes them like
 * anything else: a guardian who adds a child on a phone with no signal gets the same
 * queue -> retry -> dead-letter guarantees as a coach creating a task in a gym.
 *
 * Profiles before consents, because `guardian_consents` carries a composite foreign key into
 * `managed_profiles(id, guardian_user_id)` and a consent that arrives first is refused.
 *
 * Note precisely what this ordering does and does not buy, because it is easy to over-read:
 * it fixes the PULL order (`GUARDIAN_PULL_TABLES` is derived from this array in order). It
 * does NOT fix the push order — the drain reads the queue strictly by timestamp (B1), so what
 * makes the push safe is `createGuardianSlice` queueing the profile before its consents, and
 * `queueForSync` allocating each timestamp before entering its Dexie transaction (B1 again).
 * Both orderings are asserted in `guardian-sync.db.test.ts`.
 */
export const GUARDIAN_ENTITIES = [managedProfiles, guardianConsents] as const;

/** Read from the server, never pushed by the client. */
export const PULL_ONLY_ENTITIES = [teamMembers] as const;

/**
 * Entities whose row set is decided entirely by RLS — see {@link EntityScope}'s `'rls'`.
 *
 * Its own list rather than a member of the three above, for the same reason
 * {@link GUARDIAN_ENTITIES} is separate: `SYNC_PULL_TABLES` and `realtime.ts` are both
 * derived from {@link SYNCED_ENTITIES}, and both would be wrong here. The realtime channel
 * filters on `team_id=eq.<open team>` and `teams` has no `team_id` column, so subscribing
 * would produce a filter that matches nothing — the silent-empty shape B22 and Sprint 9's
 * `scope` field both exist to prevent.
 */
export const RLS_SCOPED_ENTITIES = [teams] as const;

/**
 * The `teams` mapping, by name, for the one caller whose rows do not arrive through the pull.
 *
 * `Onboarding` reads teams through a nested `team_members -> teams:team_id (...)` select,
 * because it needs the MEMBERSHIP STATUS alongside them and a pending membership's team is a
 * row RLS refuses. It still has a raw Supabase row in hand, so it uses this rather than
 * writing the fourth copy of the same four-column mapping.
 */
export const TEAMS_ENTITY = teams;

/** Every registered entity, whichever direction it travels. */
export const ENTITIES = [
    ...SYNCED_ENTITIES,
    ...GUARDIAN_ENTITIES,
    ...PULL_ONLY_ENTITIES,
    ...RLS_SCOPED_ENTITIES,
] as const;

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
