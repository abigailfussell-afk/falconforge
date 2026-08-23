-- SEC-01 — a coach cannot touch the admin's membership row, and cannot hand out `admin`.
--
-- WHAT WAS WRONG
--
-- `team_members_update_roster` and `team_members_delete_roster` are
-- `USING (can_manage_roster(team_id))`, and `can_manage_roster` is admin **or coach**. RLS
-- decides whether a ROW may be written; it cannot say "not that column" or "not that row's
-- role". So every coach held plain-REST authority over the admin's own row. Reproduced on the
-- seeded stack as `successor@falconforge.test`, a coach of Iron Falcons:
--
--     POST   /rest/v1/user_attestations {"attestation_type":"terms"}          -> 201
--     PATCH  /rest/v1/team_members?team_id=eq.<iron>&role=eq.admin {"role":"student"}
--                                                                             -> 200
--     PATCH  /rest/v1/team_members?team_id=eq.<iron>&user_id=eq.<me> {"role":"admin"}
--                                                                             -> 200
--     POST   /rest/v1/rpc/can_manage_billing {"p_team_id":"<iron>"}           -> true
--
-- and, on a team whose admin has no rows referencing them, the shorter version:
--
--     DELETE /rest/v1/team_members?team_id=eq.<t>&role=eq.admin               -> 204  (stranded)
--     PATCH  /rest/v1/team_members?team_id=eq.<t>&user_id=eq.<me> {"role":"admin"} -> 204
--
-- The two-party nomination handshake, `transfer_team_admin` and `operator_transfer_team_admin`
-- were all bypassed. This is `docs/failure-modes.md` section 6 — the widest-brush default: one
-- capability (`can_manage_roster`) was made to answer a question it does not know the answer
-- to, namely "may this person decide who runs the team?" That question already has a name:
-- `can_manage_billing`, admin only.
--
-- WHAT THIS DOES
--
-- A BEFORE trigger, because the rule is about columns and about the OLD row, which is exactly
-- what a policy cannot express (the same reasoning `enforce_seat_capacity` is built on):
--
--   * nothing may change `role`, `user_id`, `managed_profile_id` or `status` on a row whose
--     CURRENT role is `admin`;
--   * nothing may set `role = 'admin'`, on INSERT or on UPDATE;
--   * nothing may DELETE a row whose role is `admin`.
--
-- `full_name`, `avatar_url`, `email` and `seat_assigned` are deliberately NOT guarded:
-- `sync_user_to_team_members` writes the first three when the admin renames themselves, and
-- `create_team_as_admin` seats its own founding admin. Guarding them would have broken both,
-- silently, in a way no test in this repo was watching.
--
-- HOW THE LEGITIMATE PATHS STILL WORK — the trap this fix is most likely to fall into
--
-- Four functions genuinely have to move the role: `create_team_as_admin` (the founding INSERT),
-- `transfer_team_admin`, `accept_team_admin_nomination` and `operator_transfer_team_admin`.
-- Each one now raises a TRANSACTION-LOCAL flag around exactly the statements that need it and
-- lowers it immediately afterwards, and the trigger honours the flag. `set_config(..., true)`
-- is `SET LOCAL`, so an exception anywhere in the call leaves nothing behind for the next
-- statement in the transaction, and PostgREST gives every request its own transaction.
--
-- The flag is not reachable from a client: PostgREST executes no SQL a caller writes, exposes
-- no function that sets a GUC, and sets only its own `request.*` parameters. It is a marker
-- saying "this statement is inside one of those four functions", not a permission.
--
-- WHY THE GUARD ONLY APPLIES TO STATEMENTS THAT ARRIVED OVER THE API
--
-- `team_members` is `ON DELETE CASCADE` from both `users` and `teams`. Deleting an account
-- through the GoTrue admin API, or running the erasure runbook in `docs/beta-ops.md` in psql,
-- cascades into this table — and neither of those carries a JWT, so a guard written only in
-- terms of `auth.role()` would have made a team's admin undeletable and taken the whole
-- account-deletion path down with it. Those callers are already unrestricted (they can drop
-- this trigger), so refusing them buys nothing and costs the runbook.
--
-- The exemption is written as a list of the roles a NON-API connection uses, not as "if this
-- is not PostgREST". PostgREST connects as `authenticator` and SET ROLEs from there, but
-- naming `authenticator` in the exempt direction would fail OPEN on any deployment that named
-- that role differently — and `docs/environment-divergences.md` is a document about exactly
-- that kind of assumption. Named this way, an unrecognised session role is still guarded.

CREATE OR REPLACE FUNCTION public.enforce_admin_membership_protection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_row team_members%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
    -- Not an API request at all: a migration, the erasure runbook, or a cascade from GoTrue
    -- deleting an auth user. See the header.
    IF session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
        RETURN v_row;
    END IF;

    -- The platform's own identity, exactly as in `enforce_seat_capacity`: it bypasses RLS
    -- already, the key never ships to a browser, and it is what the seed scripts and Stripe's
    -- webhook act as.
    IF auth.role() = 'service_role' THEN
        RETURN v_row;
    END IF;

    -- Inside `create_team_as_admin` / `transfer_team_admin` /
    -- `accept_team_admin_nomination` / `operator_transfer_team_admin`.
    IF coalesce(current_setting('falconforge.admin_transfer', true), 'off') = 'on' THEN
        RETURN v_row;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'admin' THEN
            RAISE EXCEPTION
                'The team admin''s membership cannot be removed. Transfer the admin role first.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.role = 'admin' AND (
           NEW.role               IS DISTINCT FROM OLD.role
        OR NEW.user_id            IS DISTINCT FROM OLD.user_id
        OR NEW.managed_profile_id IS DISTINCT FROM OLD.managed_profile_id
        OR NEW.status             IS DISTINCT FROM OLD.status
    ) THEN
        RAISE EXCEPTION
            'The team admin''s role, identity and membership status can only be changed by an admin transfer.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.role = 'admin' AND (TG_OP = 'INSERT' OR OLD.role IS DISTINCT FROM 'admin') THEN
        RAISE EXCEPTION
            'The admin role is granted by an admin transfer, never by a roster edit.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
END;
$$;

/*
 * Trigger ORDER is load-bearing, which is why the name starts with `enforce_admin_`.
 *
 * PostgreSQL fires BEFORE triggers in alphabetical order of trigger name, so this one runs
 * ahead of `enforce_member_role_eligibility_trigger` and `enforce_seat_capacity_trigger`.
 * Without that, a coach promoting themselves would be refused by the ELIGIBILITY trigger with
 * `check_violation` when they happen to lack an attestation, and by this one with
 * `insufficient_privilege` when they have one -- two different answers to "may you do this",
 * decided by a fact about the attacker rather than about their authority. The authority
 * question is answered first.
 */
DROP TRIGGER IF EXISTS enforce_admin_membership_protection_trigger ON team_members;
CREATE TRIGGER enforce_admin_membership_protection_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON team_members
    FOR EACH ROW EXECUTE FUNCTION enforce_admin_membership_protection();

-- ==========================================================================
-- THE FOUR FUNCTIONS THAT MAY MOVE THE ROLE
--
-- Re-stated in full because migrations are forward-only; the only change in each is the
-- `set_config` pair around the statements the trigger would otherwise refuse.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_team_as_admin(
    team_name text,
    season_name text,
    team_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_team_id uuid;
    v_member_id uuid;
    v_season_id uuid;
    v_invite_code text;
    v_user users%ROWTYPE;
    v_trial_days constant integer := 90;
BEGIN
    SELECT * INTO v_user FROM users WHERE id = auth.uid();

    IF v_user.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Not authenticated');
    END IF;

    IF v_user.age_classification IS DISTINCT FROM '18_plus' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'You must be 18 or older to register a team'
        );
    END IF;

    IF coalesce(trim(team_name), '') = '' THEN
        RETURN json_build_object('success', false, 'error', 'Team name is required');
    END IF;

    IF coalesce(trim(season_name), '') = '' THEN
        RETURN json_build_object('success', false, 'error', 'Season name is required');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_attestations
        WHERE user_id = auth.uid() AND attestation_type IN ('coach_terms', 'terms')
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'You must accept the terms of service before registering a team'
        );
    END IF;

    INSERT INTO teams (name, team_number, owner_id)
    VALUES (trim(team_name), team_number, auth.uid())
    RETURNING id INTO v_team_id;

    -- Before the member, so the seat-capacity trigger has an entitlement to consult.
    INSERT INTO license_grants (team_id, source, seats, valid_until, created_by, notes)
    VALUES (
        v_team_id, 'gift', NULL, now() + make_interval(days => v_trial_days), auth.uid(),
        format('Automatic %s-day beta trial issued at team registration', v_trial_days)
    );

    -- Unseated, then seated. `enforce_seat_capacity` requires the team's admin to be the one
    -- assigning a seat, and until this INSERT lands there is no admin to be. Splitting it in
    -- two means the founding admin passes the same check as everybody else rather than
    -- needing a bootstrap exemption, which is one fewer branch that could be widened later.
    PERFORM set_config('falconforge.admin_transfer', 'on', true);
    INSERT INTO team_members (team_id, user_id, role, status, full_name, email)
    VALUES (v_team_id, auth.uid(), 'admin', 'approved', v_user.full_name, v_user.email)
    RETURNING id INTO v_member_id;
    PERFORM set_config('falconforge.admin_transfer', 'off', true);

    UPDATE team_members SET seat_assigned = true WHERE id = v_member_id;

    v_invite_code := upper(substr(md5(random()::text), 1, 8));
    INSERT INTO invites (team_id, code, created_by)
    VALUES (v_team_id, v_invite_code, auth.uid());

    INSERT INTO seasons (team_id, name)
    VALUES (v_team_id, trim(season_name))
    RETURNING id INTO v_season_id;

    /*
     * Seed the season SERVER-SIDE.
     *
     * The client used to hold these as constants — `DEFAULT_SUBTEAMS` in constants.ts and
     * `DEFAULT_SEASON` / `DEFAULT_CHECKLIST_ITEMS` in the store — with ids hardcoded so that
     * every device agreed on them. Which meant every TEAM agreed on them too: two teams both
     * push sub-team `657c8820-…`, the second push upserts onto a row belonging to the first,
     * RLS refuses the UPDATE branch, and the second team's sub-teams dead-letter forever.
     *
     * Creating them here gives each team its own uuids, inside the transaction that creates
     * the team, before any client can reference one.
     */
    INSERT INTO sub_teams (team_id, season_id, name)
    SELECT v_team_id, v_season_id, name
    FROM unnest(ARRAY['Programming', 'Build', 'Drive', 'Scouting', 'Outreach']) AS name;

    -- The checklist row's id IS the season id. Blob-synced records have no per-record
    -- identity to merge on, so two offline devices need to agree on the row id without
    -- talking to each other; deriving it from the season is what makes their upserts
    -- converge on one row instead of racing to create two. `checklists_one_per_season` is
    -- the schema-side half of the same promise.
    INSERT INTO checklists (id, team_id, season_id, items)
    VALUES (v_season_id, v_team_id, v_season_id, jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Turn off robot', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Swap main battery', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Charge old battery', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Charge Driver Hub', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Tighten chassis screws', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Check wiring connections', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Clean wheels', 'checked', false),
        jsonb_build_object('id', gen_random_uuid(), 'text', 'Reset servo positions', 'checked', false)
    ));

    RETURN json_build_object(
        'success', true,
        'team_id', v_team_id,
        'member_id', v_member_id,
        'season_id', v_season_id,
        'invite_code', v_invite_code
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_team_admin(p_team_id uuid, p_new_member_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_current_admin_id uuid;
    v_new team_members%ROWTYPE;
BEGIN
    IF NOT can_manage_billing(p_team_id) THEN
        RETURN json_build_object('success', false, 'error', 'Only the team admin can transfer the role');
    END IF;

    SELECT * INTO v_new
    FROM team_members
    WHERE id = p_new_member_id AND team_id = p_team_id;

    IF v_new.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'That member is not on this team');
    END IF;

    IF v_new.status <> 'approved' THEN
        RETURN json_build_object('success', false, 'error', 'That member is not approved yet');
    END IF;

    IF v_new.managed_profile_id IS NOT NULL THEN
        RETURN json_build_object('success', false, 'error', 'A managed profile cannot be the team admin');
    END IF;

    SELECT id INTO v_current_admin_id
    FROM team_members
    WHERE team_id = p_team_id AND role = 'admin' AND status <> 'removed';

    IF v_current_admin_id = p_new_member_id THEN
        RETURN json_build_object('success', false, 'error', 'That member is already the admin');
    END IF;

    -- Demote first: the unique index permits only one admin at a time.
    PERFORM set_config('falconforge.admin_transfer', 'on', true);
    UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    UPDATE team_members SET role = 'admin' WHERE id = p_new_member_id;
    PERFORM set_config('falconforge.admin_transfer', 'off', true);

    RETURN json_build_object('success', true, 'admin_member_id', p_new_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_team_admin_nomination(p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_team teams%ROWTYPE;
    v_me team_members%ROWTYPE;
    v_current_admin_id uuid;
BEGIN
    SELECT * INTO v_team FROM teams WHERE id = p_team_id;
    IF v_team.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'No such team');
    END IF;
    IF v_team.pending_admin_member_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'There is no admin nomination for this team');
    END IF;
    IF v_team.pending_admin_nominated_at + admin_nomination_ttl() < now() THEN
        RETURN json_build_object(
            'success', false,
            'error', 'That nomination has expired. Ask the team admin to nominate you again.'
        );
    END IF;

    SELECT * INTO v_me
      FROM team_members
     WHERE id = v_team.pending_admin_member_id
       AND user_id = auth.uid()
       AND managed_profile_id IS NULL;

    IF v_me.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'You are not the nominee for this team');
    END IF;
    IF v_me.status <> 'approved' THEN
        RETURN json_build_object('success', false, 'error', 'Your membership is not approved yet');
    END IF;

    SELECT id INTO v_current_admin_id
      FROM team_members
     WHERE team_id = p_team_id AND role = 'admin' AND status <> 'removed';

    -- Demote first: the unique index permits only one admin at a time.
    PERFORM set_config('falconforge.admin_transfer', 'on', true);
    IF v_current_admin_id IS NOT NULL THEN
        UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    END IF;
    UPDATE team_members SET role = 'admin' WHERE id = v_me.id;
    PERFORM set_config('falconforge.admin_transfer', 'off', true);

    UPDATE teams
       SET pending_admin_member_id = NULL,
           pending_admin_nominated_at = NULL,
           pending_admin_nominated_by = NULL
     WHERE id = p_team_id;

    RETURN json_build_object(
        'success', true,
        'admin_member_id', v_me.id,
        'previous_admin_member_id', v_current_admin_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_transfer_team_admin(
    p_team_id uuid,
    p_new_member_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_new team_members%ROWTYPE;
    v_current_admin_id uuid;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not a platform operator');
    END IF;

    SELECT * INTO v_new FROM team_members WHERE id = p_new_member_id AND team_id = p_team_id;

    IF v_new.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'That member is not on this team');
    END IF;
    IF v_new.status <> 'approved' THEN
        RETURN json_build_object('success', false, 'error', 'That member is not approved yet');
    END IF;
    IF v_new.managed_profile_id IS NOT NULL THEN
        RETURN json_build_object('success', false, 'error', 'A managed profile cannot be the team admin');
    END IF;
    IF v_new.role = 'admin' THEN
        RETURN json_build_object('success', false, 'error', 'That member is already the admin');
    END IF;

    SELECT id INTO v_current_admin_id
      FROM team_members
     WHERE team_id = p_team_id AND role = 'admin' AND status <> 'removed';

    PERFORM set_config('falconforge.admin_transfer', 'on', true);
    IF v_current_admin_id IS NOT NULL THEN
        UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    END IF;
    UPDATE team_members SET role = 'admin' WHERE id = p_new_member_id;
    PERFORM set_config('falconforge.admin_transfer', 'off', true);

    -- A stranded team usually has a stale nomination on it; it is meaningless now.
    UPDATE teams
       SET pending_admin_member_id = NULL,
           pending_admin_nominated_at = NULL,
           pending_admin_nominated_by = NULL
     WHERE id = p_team_id;

    -- Unconditional: overriding a tenant's governance is recorded whether or not the operator
    -- bothered to say why. `p_notes` enriches the record; it does not decide whether there is
    -- one.
    INSERT INTO operator_actions (operator_user_id, team_id, action, detail, notes)
    VALUES (
        auth.uid(), p_team_id, 'admin_transfer',
        jsonb_build_object(
            'new_admin_member_id', p_new_member_id,
            'previous_admin_member_id', v_current_admin_id,
            'team_was_stranded', v_current_admin_id IS NULL
        ),
        p_notes
    );

    RETURN json_build_object(
        'success', true,
        'admin_member_id', p_new_member_id,
        'previous_admin_member_id', v_current_admin_id
    );
END;
$$;

-- `CREATE OR REPLACE FUNCTION` keeps the existing ACL, but this migration states its intended
-- end state rather than relying on what came before -- the same reasoning as
-- `20260819000000_revoke_anon_execute.sql`'s re-grants.
REVOKE EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transfer_team_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.transfer_team_admin(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.accept_team_admin_nomination(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.accept_team_admin_nomination(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_transfer_team_admin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.operator_transfer_team_admin(uuid, uuid, text) TO authenticated, service_role;

-- The trigger function is never called directly; EXECUTE on a trigger function is checked when
-- the trigger is created, not when it fires, so this is tidiness rather than a boundary.
REVOKE ALL ON FUNCTION public.enforce_admin_membership_protection() FROM PUBLIC, anon, authenticated;
