-- FalconForge V2 schema — tables, constraints and indexes.
--
-- This is a SQUASH, not a diff. Everything the pre-V2 migrations built is restated here in
-- its final shape; those files are archived under `_archive/pre-v2/` with a README pointing
-- at what each one was for. The squash is allowed exactly once: the schema freezes at the
-- end of Sprint 3, and after beta teams onboard every change is a forward migration.
--
-- The V2 model, in one paragraph: a TEAM is the tenant. Exactly one ADMIN per team (18+,
-- attested), plus coaches, mentors and students. A team's right to write is an ENTITLEMENT
-- derived from `license_grants`; expiry makes a team read-only and never deletes anything.
-- A child under 13 has no login — a GUARDIAN's account holds a `managed_profile` and the
-- membership row for that child hangs off the guardian's login. Everything a season owns
-- (tasks, sub-teams, scouting, match plans, checklists, meetings) carries a NOT NULL
-- `season_id`, so "new season = fresh start" is a property of the schema rather than of
-- five duplicated client-side filters.
--
-- FILE ORDER (the CLI applies these by filename):
--   000000 tables      — this file
--   000100 authorization — role/capability/entitlement functions
--   000200 rls         — enable RLS, all policies
--   000300 rpcs        — client-callable functions and triggers
--   000400 realtime    — replica identity
--   000500 grants      — API role grants; MUST stay last (see its header)

-- ==========================================================================
-- IDENTITY
-- ==========================================================================

-- Profile mirror of auth.users. `handle_new_user` keeps it in step.
CREATE TABLE users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    age_classification text
        CHECK (age_classification IN ('under_13', '13_to_17', '18_plus')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Versioned legal acknowledgements. `version` is what makes a re-attestation possible when
-- a document changes (Sprint 6 rewrites the documents; the shape is already here).
CREATE TABLE user_attestations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attestation_type text NOT NULL CHECK (attestation_type IN (
        'terms', 'privacy', 'community_guidelines', 'age_18_plus',
        'coppa_responsibility', 'billing_acknowledgement', 'age_13_plus',
        'privacy_and_guidelines', 'coach_terms'
    )),
    version text NOT NULL DEFAULT '1.0',
    attested_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, attestation_type)
);

/*
 * A student profile a guardian holds on a child's behalf.
 *
 * COPPA: under-13s may not hold their own account, so the child has no row in auth.users
 * and no credentials at all. The guardian signs in; the child's team membership is a
 * `team_members` row whose `user_id` is the GUARDIAN and whose `managed_profile_id` points
 * here. That is what makes every existing `user_id = auth.uid()` policy do the right thing
 * for a managed child without a second access path.
 *
 * Schema only this sprint — the guardian UI is Sprint 9.
 */
CREATE TABLE managed_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guardian_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name text NOT NULL CHECK (char_length(trim(full_name)) > 0),
    -- Year only, deliberately: the app never needs a child's exact date of birth, and the
    -- less of it that is stored the better.
    birth_year integer CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2200)),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Lets dependent rows reference (id, guardian_user_id) so a consent can never be
    -- attached to a profile somebody else owns.
    UNIQUE (id, guardian_user_id)
);

-- The guardian's consent record for a managed profile. Separate from `user_attestations`
-- because the subject is the child, not the signer.
CREATE TABLE guardian_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    managed_profile_id uuid NOT NULL,
    guardian_user_id uuid NOT NULL,
    consent_type text NOT NULL CHECK (consent_type IN (
        'coppa_data_collection', 'terms', 'privacy', 'community_guidelines'
    )),
    version text NOT NULL DEFAULT '1.0',
    consented_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (managed_profile_id, consent_type),
    FOREIGN KEY (managed_profile_id, guardian_user_id)
        REFERENCES managed_profiles(id, guardian_user_id) ON DELETE CASCADE
);

-- ==========================================================================
-- TENANT
-- ==========================================================================

CREATE TABLE teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(trim(name)) > 0),
    team_number text,
    owner_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

/*
 * Membership. One row per (team, person), where "person" is either the signed-in user
 * themselves or a managed profile they are responsible for.
 *
 * `user_id` is always the LOGIN that acts for this row. For a managed profile that is the
 * guardian, not the child — the child has no login. `managed_profile_id IS NULL` therefore
 * means "this row is the user's own membership".
 *
 * `is_billing_active` from V1 is now `seat_assigned`: it was never about billing state, it
 * was about whether the admin has assigned this member one of the team's licensed seats.
 */
CREATE TABLE team_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    managed_profile_id uuid REFERENCES managed_profiles(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'student'
        CHECK (role IN ('admin', 'coach', 'mentor', 'student')),
    status text NOT NULL DEFAULT 'approved'
        CHECK (status IN ('pending', 'approved', 'removed')),
    seat_assigned boolean NOT NULL DEFAULT false,
    -- Denormalised display fields, kept in step by `sync_user_to_team_members`. They exist
    -- so the roster renders offline without a join the client cannot do.
    full_name text,
    email text,
    avatar_url text,
    joined_at timestamptz NOT NULL DEFAULT now(),
    -- New in V2. Without it this table can never take part in a delta pull, which is why
    -- the roster only refreshed on team switch.
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- A child is a student. Nothing else is available to somebody with no account of their
    -- own, and an 18+ role held by a managed profile would be nonsense.
    CONSTRAINT team_members_managed_is_student
        CHECK (managed_profile_id IS NULL OR role = 'student'),
    -- Referenced by (id, team_id) so a task can only be assigned to a member of its own team.
    UNIQUE (id, team_id)
);

-- EXACTLY ONE ADMIN PER TEAM.
--
-- The "at most one" half is this index. The "at least one" half is upheld by
-- `create_team_as_admin`, which is the only way a team comes into existence, and by
-- `transfer_team_admin` being the only supported way to move the role. A partial index
-- rather than a constraint because a removed member must not keep the slot occupied.
CREATE UNIQUE INDEX team_members_one_admin_per_team
    ON team_members (team_id)
    WHERE role = 'admin' AND status <> 'removed';

-- A user has at most one membership of their own per team...
CREATE UNIQUE INDEX team_members_unique_self
    ON team_members (team_id, user_id)
    WHERE managed_profile_id IS NULL;

-- ...and a managed profile appears at most once per team. Two partial indexes rather than
-- one UNIQUE (team_id, user_id, managed_profile_id): NULLs are distinct in a unique index,
-- so the single-column form would happily allow a user two own-memberships.
CREATE UNIQUE INDEX team_members_unique_managed
    ON team_members (team_id, managed_profile_id)
    WHERE managed_profile_id IS NOT NULL;

CREATE TABLE invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    code text NOT NULL UNIQUE CHECK (char_length(trim(code)) > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz DEFAULT (now() + interval '24 hours'),
    max_uses integer,
    use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================================
-- LICENSING
-- ==========================================================================

/*
 * Users who may gift licences — the platform operator, i.e. Kevin.
 *
 * Deliberately seeded EMPTY. There is no way to know the operator's auth.users id at
 * migration time, and hardcoding one would be a credential in the repo. Populate it once,
 * with the service key:
 *
 *     insert into platform_operators (user_id, notes)
 *     values ('<your auth.users id>', 'primary operator');
 *
 * No write policy exists for this table, so the only way in is the service role. That is
 * the point: privilege escalation to operator is not reachable through the API.
 */
CREATE TABLE platform_operators (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

/*
 * A team's right to write. Grants accumulate; the team is entitled if any one of them is
 * currently in force (see the `team_entitlement` view).
 *
 * `seats IS NULL` means unlimited. `valid_until IS NULL` means open-ended. `team_member_id`
 * set means the grant covers one named member rather than a pool of seats — the plan calls
 * for "seat count or per-member grants" and both shapes fit here.
 *
 * `source` is `gift` today and `stripe` from Sprint 10; the entitlement question the rest
 * of the schema asks does not change when billing arrives, only who inserts the row.
 */
CREATE TABLE license_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    source text NOT NULL CHECK (source IN ('gift', 'stripe')),
    seats integer CHECK (seats IS NULL OR seats > 0),
    team_member_id uuid,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    -- Revocation is a timestamp, not a DELETE: who granted what, and when it was withdrawn,
    -- is the audit trail behind every "why can't my team edit anything" support question.
    revoked_at timestamptz,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT license_grants_valid_range
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    FOREIGN KEY (team_member_id, team_id)
        REFERENCES team_members(id, team_id) ON DELETE CASCADE
);

-- ==========================================================================
-- SEASONS AND SEASON-SCOPED DATA
-- ==========================================================================

CREATE TABLE seasons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(trim(name)) > 0),
    -- Base64 field image, stored so the match planner works with no network at a venue.
    field_image_data text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id)
);

/*
 * Every season-scoped table below carries `season_id NOT NULL` and a COMPOSITE foreign key
 * `(season_id, team_id) -> seasons (id, team_id)`.
 *
 * The composite is what makes cross-tenant reference impossible rather than merely
 * unlikely: a plain `season_id` FK would happily let a row in team A point at team B's
 * season, and RLS would not notice because it only ever looks at `team_id`.
 *
 * NOT NULL is what makes "new season = fresh start" real. The client used to filter with
 * `!x.seasonId || x.seasonId === current`, spelled out in five places, so anything with a
 * null season leaked into EVERY season. Those filters are dead code against this schema.
 */

CREATE TABLE sub_teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    name text NOT NULL CHECK (char_length(trim(name)) > 0),
    -- Membership as an array rather than a join table: the client edits the whole sub-team
    -- as one record and syncs it as one row, so a join table would need per-row conflict
    -- resolution the offline queue does not have.
    member_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, team_id),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE
);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    sub_team_id uuid,
    title text NOT NULL CHECK (char_length(trim(title)) > 0),
    description text,
    status text NOT NULL DEFAULT 'Backlog' CHECK (status IN (
        'Backlog', 'To Do', 'In Progress', 'Testing', 'Done', 'Archived'
    )),
    type text NOT NULL DEFAULT 'Feature' CHECK (type IN ('Feature', 'Bug')),
    assigned_to uuid,
    tags text[] NOT NULL DEFAULT '{}'::text[],
    checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
    timeline jsonb NOT NULL DEFAULT '[]'::jsonb,
    due_date timestamptz,
    -- B17: the archive timestamp the sprint board sorts by, which used to be dropped on
    -- every round trip because no column existed.
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE,
    -- DEFERRABLE because the offline queue pushes a task and its sub-team in one drain and
    -- the order within a transaction is not guaranteed to satisfy both at every statement.
    FOREIGN KEY (sub_team_id, team_id)
        REFERENCES sub_teams(id, team_id) ON DELETE SET NULL DEFERRABLE,
    FOREIGN KEY (assigned_to, team_id)
        REFERENCES team_members(id, team_id) ON DELETE SET NULL DEFERRABLE
);

CREATE TABLE scouting_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    opponent_team_number text NOT NULL,
    -- B18: NULLABLE and never 0. Scouting happens in a hurry between matches; the form
    -- treats the match number as optional, so the schema does too. NULL means "not
    -- recorded" rather than the fabricated 0 the app used to send.
    match_number integer CHECK (match_number IS NULL OR match_number > 0),
    event_name text,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, team_id)
        REFERENCES team_members(id, team_id) ON DELETE SET NULL DEFERRABLE
);

CREATE TABLE match_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    title text,
    match_number integer CHECK (match_number IS NULL OR match_number > 0),
    alliance_team text,
    drawing_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    -- B9: set by the UI, held in local state, and dropped on the way to the server because
    -- these columns did not exist and the read hardcoded `false`.
    partner_autonomous boolean NOT NULL DEFAULT false,
    partner_park boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE
);

/*
 * The pre-match checklist. ONE ROW PER SEASON per team (C6).
 *
 * V1 had one row per TEAM, so every season shared a checklist and the "fresh start" a new
 * season is supposed to be did not include it. The column was already `season_id NOT NULL`
 * while the client wrote `seasonId || null`, so a push with no current season dead-lettered
 * on a not-null violation the user could do nothing about.
 *
 * Blob-synced: the whole item array lives in `items`, so there is no per-record identity to
 * merge on. The client makes the row id equal to the SEASON id, which is what lets two
 * offline devices in the same season converge on one row through an upsert instead of
 * creating two. The partial unique index below is the schema-side half of that promise.
 */
CREATE TABLE checklists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'Pre-Match Checklist'
        CHECK (char_length(trim(name)) > 0),
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Templates are a team-level library (Sprint 4 clones one into a new season). They are
    -- excluded from the working-checklist uniqueness rule and from the sync pull.
    is_template boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX checklists_one_per_season
    ON checklists (team_id, season_id)
    WHERE is_template = false;

-- ==========================================================================
-- MEETINGS AND ATTENDANCE  (schema only — UI is post-beta Sprint 8)
-- ==========================================================================

CREATE TABLE meetings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(trim(title)) > 0),
    description text,
    location text,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz,
    -- Set when this meeting was generated from a recurrence rule (Sprint 8). Kept here so
    -- the freeze does not force a forward migration for the first recurring meeting.
    recurrence_rule text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meetings_ends_after_start
        CHECK (ends_at IS NULL OR ends_at >= starts_at),
    UNIQUE (id, team_id),
    FOREIGN KEY (season_id, team_id) REFERENCES seasons(id, team_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by, team_id)
        REFERENCES team_members(id, team_id) ON DELETE SET NULL DEFERRABLE
);

/*
 * Attendance, with attestation.
 *
 * `attested_by` / `attested_at` are the point of the feature: an attendance record is a
 * claim somebody made, not a fact the system observed. `status` alone would not let a coach
 * answer "who says so?" three weeks later when a parent asks.
 *
 * `team_id` is denormalised from the meeting so RLS can scope this table the same way as
 * every other one, without a join into `meetings` inside a policy. The composite FK below
 * is what keeps the denormalised copy honest.
 */
CREATE TABLE meeting_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL,
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    team_member_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'present'
        CHECK (status IN ('present', 'absent', 'excused', 'late')),
    notes text,
    attested_by uuid,
    attested_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (meeting_id, team_member_id),
    FOREIGN KEY (meeting_id, team_id)
        REFERENCES meetings(id, team_id) ON DELETE CASCADE,
    FOREIGN KEY (team_member_id, team_id)
        REFERENCES team_members(id, team_id) ON DELETE CASCADE,
    FOREIGN KEY (attested_by, team_id)
        REFERENCES team_members(id, team_id) ON DELETE SET NULL DEFERRABLE
);

-- ==========================================================================
-- INDEXES
-- ==========================================================================
--
-- Two families, and both earn their keep:
--   * `team_id` on every tenant table — every RLS policy and every sync query filters on it.
--   * `updated_at` on every delta-synced table — `pullFromServer` filters `>= cursor`.

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_attestations_user_id ON user_attestations (user_id);
CREATE INDEX idx_managed_profiles_guardian ON managed_profiles (guardian_user_id);
CREATE INDEX idx_guardian_consents_profile ON guardian_consents (managed_profile_id);

CREATE INDEX idx_teams_owner_id ON teams (owner_id);
CREATE INDEX idx_team_members_team_id ON team_members (team_id);
CREATE INDEX idx_team_members_user_id ON team_members (user_id);
CREATE INDEX idx_team_members_managed_profile ON team_members (managed_profile_id)
    WHERE managed_profile_id IS NOT NULL;
CREATE INDEX idx_team_members_updated_at ON team_members (updated_at);

CREATE INDEX idx_invites_team_id ON invites (team_id);
CREATE INDEX idx_invites_code ON invites (code);

CREATE INDEX idx_license_grants_team_id ON license_grants (team_id);
-- The entitlement view asks "is anything in force for this team right now", which is a scan
-- of the unrevoked grants only.
CREATE INDEX idx_license_grants_active ON license_grants (team_id, valid_until)
    WHERE revoked_at IS NULL;

CREATE INDEX idx_seasons_team_id ON seasons (team_id);
CREATE INDEX idx_seasons_updated_at ON seasons (updated_at);

CREATE INDEX idx_sub_teams_team_id ON sub_teams (team_id);
CREATE INDEX idx_sub_teams_season_id ON sub_teams (season_id);
CREATE INDEX idx_sub_teams_updated_at ON sub_teams (updated_at);

CREATE INDEX idx_tasks_team_id ON tasks (team_id);
CREATE INDEX idx_tasks_season_id ON tasks (season_id);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_updated_at ON tasks (updated_at);
CREATE INDEX idx_tasks_archived_at ON tasks (archived_at) WHERE archived_at IS NOT NULL;

CREATE INDEX idx_scouting_reports_team_id ON scouting_reports (team_id);
CREATE INDEX idx_scouting_reports_season_id ON scouting_reports (season_id);
CREATE INDEX idx_scouting_reports_opponent ON scouting_reports (opponent_team_number);
CREATE INDEX idx_scouting_reports_updated_at ON scouting_reports (updated_at);

CREATE INDEX idx_match_plans_team_id ON match_plans (team_id);
CREATE INDEX idx_match_plans_season_id ON match_plans (season_id);
CREATE INDEX idx_match_plans_updated_at ON match_plans (updated_at);

CREATE INDEX idx_checklists_team_id ON checklists (team_id);
CREATE INDEX idx_checklists_season_id ON checklists (season_id);
CREATE INDEX idx_checklists_updated_at ON checklists (updated_at);

CREATE INDEX idx_meetings_team_id ON meetings (team_id);
CREATE INDEX idx_meetings_season_id ON meetings (season_id);
CREATE INDEX idx_meetings_starts_at ON meetings (starts_at);
CREATE INDEX idx_meetings_updated_at ON meetings (updated_at);

CREATE INDEX idx_meeting_attendance_team_id ON meeting_attendance (team_id);
CREATE INDEX idx_meeting_attendance_meeting ON meeting_attendance (meeting_id);
CREATE INDEX idx_meeting_attendance_member ON meeting_attendance (team_member_id);
CREATE INDEX idx_meeting_attendance_updated_at ON meeting_attendance (updated_at);
