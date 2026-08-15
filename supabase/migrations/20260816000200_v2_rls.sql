-- FalconForge V2 — Row Level Security.
--
-- RLS is THE security boundary. The anon key ships inside the client bundle, every client
-- role holds ordinary SQL privileges on every table (see the grants migration), and role
-- checks in React are UX. If a rule is not expressed here, it is not enforced.
--
-- Default deny: RLS is enabled on every table in `public`, and a table with no policy for a
-- verb permits nobody that verb. Two tables below have no write policy at all, and that is
-- the intent rather than an omission — see `platform_operators` and `license_grants`.
--
-- ==========================================================================
-- B21 — THE HOLE THIS MIGRATION CLOSES
-- ==========================================================================
--
-- V1's policy was:
--
--     CREATE POLICY team_members_insert_policy ON team_members FOR INSERT
--       WITH CHECK ((user_id = auth.uid()) OR is_team_coach(team_id, auth.uid()));
--
-- The first branch let ANY authenticated user insert a row naming THEMSELVES, into ANY
-- team, with any role and `status = 'approved'`. Knowing a team's uuid was the whole
-- attack. Verified against the V1 schema before it was replaced: a student of team A
-- inserted themselves into team B as an approved coach and immediately read team B's tasks,
-- which had been invisible a statement earlier.
--
-- The C7 suite missed it because every cross-tenant INSERT case it tried named the VICTIM's
-- user id — which the policy correctly refused. Nobody thought to try naming their own.
--
-- V2 has no self-insert branch. Joining a team goes through `join_team_with_invite`, which
-- is SECURITY DEFINER, requires a valid unexpired code, and creates a PENDING member that a
-- coach must approve. The regression test is named `B21` in the RLS suite.

ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_attestations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE managed_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian_consents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites             ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_operators  ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_teams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouting_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists          ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendance  ENABLE ROW LEVEL SECURITY;

-- ==========================================================================
-- IDENTITY
-- ==========================================================================

CREATE POLICY users_select_own ON users
    FOR SELECT USING (id = auth.uid());

-- Teammates are visible to each other: the roster needs names and avatars. Scoped through
-- `get_user_team_ids`, so it is teams the reader is actually in, not "any team in common
-- with anyone".
CREATE POLICY users_select_teammates ON users
    FOR SELECT USING (
        id IN (
            SELECT tm.user_id FROM team_members tm
            WHERE tm.team_id IN (SELECT get_user_team_ids(auth.uid()))
        )
    );

CREATE POLICY users_insert_own ON users
    FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY users_update_own ON users
    FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY attestations_select_own ON user_attestations
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY attestations_insert_own ON user_attestations
    FOR INSERT WITH CHECK (user_id = auth.uid());

-- Re-attesting a new version of a document is an UPDATE of the same row (the table is
-- unique on user + type), so this is how a version bump is recorded.
CREATE POLICY attestations_update_own ON user_attestations
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Deliberately no DELETE policy: an attestation is a record that something was agreed to
-- at a point in time. Deleting it is not a thing a user gets to do.

-- ==========================================================================
-- GUARDIANS
-- ==========================================================================

CREATE POLICY managed_profiles_guardian_all ON managed_profiles
    FOR ALL
    USING (guardian_user_id = auth.uid())
    WITH CHECK (guardian_user_id = auth.uid());

-- A child on the team is a person on the roster, so the team can see the profile — the
-- same visibility teammates already have of each other through `users`. Read only: nobody
-- but the guardian edits a managed profile.
CREATE POLICY managed_profiles_select_teammates ON managed_profiles
    FOR SELECT USING (
        id IN (
            SELECT tm.managed_profile_id FROM team_members tm
            WHERE tm.team_id IN (SELECT get_user_team_ids(auth.uid()))
              AND tm.managed_profile_id IS NOT NULL
        )
    );

-- Consents are between the guardian and the platform. A team never reads them.
CREATE POLICY guardian_consents_own ON guardian_consents
    FOR ALL
    USING (guardian_user_id = auth.uid())
    WITH CHECK (guardian_user_id = auth.uid());

-- ==========================================================================
-- TENANT
-- ==========================================================================

CREATE POLICY teams_select_member ON teams
    FOR SELECT USING (is_team_member(id));

CREATE POLICY teams_insert_owner ON teams
    FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY teams_update_manager ON teams
    FOR UPDATE USING (can_manage_roster(id)) WITH CHECK (can_manage_roster(id));

-- No DELETE policy. Deleting a team cascades to every row it owns; that is an operator
-- action through the service role, not a button.

/*
 * team_members — ONE policy per verb.
 *
 * V1 had five overlapping SELECT policies (`team_members_select_own`,
 * `team_members_select_policy`, `team_members_select_teammates`, plus the two helper
 * functions they each called differently). Policies for the same verb OR together, so five
 * of them meant the effective rule was the union of five half-remembered intentions and no
 * single place to read it. This is that union, stated once:
 *
 *   you can see a team's roster if you are on the team, and you can always see your own
 *   membership rows — including the ones you hold for a managed profile, because there
 *   `user_id` is you, the guardian.
 */
CREATE POLICY team_members_select ON team_members
    FOR SELECT USING (is_team_member(team_id) OR user_id = auth.uid());

-- B21: no self-insert branch. See the header.
CREATE POLICY team_members_insert_roster ON team_members
    FOR INSERT WITH CHECK (can_manage_roster(team_id));

CREATE POLICY team_members_update_roster ON team_members
    FOR UPDATE USING (can_manage_roster(team_id)) WITH CHECK (can_manage_roster(team_id));

CREATE POLICY team_members_delete_roster ON team_members
    FOR DELETE USING (can_manage_roster(team_id));

-- Invite codes are credentials. V1 shipped `USING (true)` here for months.
CREATE POLICY invites_select_member ON invites
    FOR SELECT USING (is_team_member(team_id));

CREATE POLICY invites_insert_roster ON invites
    FOR INSERT WITH CHECK (can_manage_roster(team_id));

CREATE POLICY invites_update_roster ON invites
    FOR UPDATE USING (can_manage_roster(team_id)) WITH CHECK (can_manage_roster(team_id));

CREATE POLICY invites_delete_roster ON invites
    FOR DELETE USING (can_manage_roster(team_id));

-- ==========================================================================
-- LICENSING
-- ==========================================================================

-- A member may see their team's licensing state (the read-only banner and the seat count
-- are shown to everyone, not just the admin).
CREATE POLICY license_grants_select_member ON license_grants
    FOR SELECT USING (is_team_member(team_id));

/*
 * NO WRITE POLICY, on purpose.
 *
 * Nobody creates, edits or revokes a licence through the API. Gifting goes through
 * `grant_team_license`, which is SECURITY DEFINER and checks `is_platform_operator()`;
 * Stripe webhooks (Sprint 10) will write with the service role, which bypasses RLS. A team
 * admin cannot grant themselves a licence, which is the entire point of having one.
 */

-- Operators can confirm they are operators; nothing else about this table is reachable.
-- No write policy: the only way in is the service role. Escalation to operator is
-- deliberately not an API-shaped action.
CREATE POLICY platform_operators_select_self ON platform_operators
    FOR SELECT USING (user_id = auth.uid());

-- ==========================================================================
-- SEASONS AND SEASON-SCOPED DATA
-- ==========================================================================

CREATE POLICY seasons_select_member ON seasons
    FOR SELECT USING (is_team_member(team_id));

CREATE POLICY seasons_insert_structure ON seasons
    FOR INSERT WITH CHECK (can_manage_structure(team_id));

CREATE POLICY seasons_update_structure ON seasons
    FOR UPDATE USING (can_manage_structure(team_id))
    WITH CHECK (can_manage_structure(team_id));

CREATE POLICY seasons_delete_structure ON seasons
    FOR DELETE USING (can_manage_structure(team_id));

CREATE POLICY sub_teams_select_member ON sub_teams
    FOR SELECT USING (is_team_member(team_id));

CREATE POLICY sub_teams_insert_structure ON sub_teams
    FOR INSERT WITH CHECK (can_manage_structure(team_id));

CREATE POLICY sub_teams_update_structure ON sub_teams
    FOR UPDATE USING (can_manage_structure(team_id))
    WITH CHECK (can_manage_structure(team_id));

CREATE POLICY sub_teams_delete_structure ON sub_teams
    FOR DELETE USING (can_manage_structure(team_id));

/*
 * The content tables, governed identically.
 *
 * Generated in a loop rather than written out five times over, because "these tables have
 * exactly the same rule" is the invariant, and hand-copying it is how V1 ended up with
 * `sub_teams` and `seasons` using `FOR ALL USING (...)` with no WITH CHECK while their
 * neighbours used four separate policies. `schema_assertions.sql` asserts the resulting set
 * so a table added later without policies cannot slip through.
 *
 * The rule: any approved member of the team may read; any approved member of an ENTITLED
 * team may write. WITH CHECK is spelled out on UPDATE as well as USING, so a member cannot
 * move a row to another team by updating its `team_id`.
 */
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tasks', 'scouting_reports', 'match_plans', 'checklists',
        'meetings', 'meeting_attendance'
    ] LOOP
        EXECUTE format(
            'CREATE POLICY %1$s_select_member ON %1$I
                 FOR SELECT USING (is_team_member(team_id))', t);
        EXECUTE format(
            'CREATE POLICY %1$s_insert_content ON %1$I
                 FOR INSERT WITH CHECK (can_manage_content(team_id))', t);
        EXECUTE format(
            'CREATE POLICY %1$s_update_content ON %1$I
                 FOR UPDATE USING (can_manage_content(team_id))
                 WITH CHECK (can_manage_content(team_id))', t);
        EXECUTE format(
            'CREATE POLICY %1$s_delete_content ON %1$I
                 FOR DELETE USING (can_manage_content(team_id))', t);
    END LOOP;
END $$;
