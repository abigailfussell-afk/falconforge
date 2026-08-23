-- SEC-11 — the erasure the Privacy Policy promises, as an audited tool.
--
-- The policy says "when you delete your account we remove your personal information and your
-- memberships. Work you contributed to a team stays with the team." Until now that sentence was
-- backed by a psql session: `docs/beta-ops.md` "Erasing a person's data", which was a deliberate
-- decision for a beta of a few known teams (Kevin, 2026-08-18) and is the right call for a
-- handful of requests. It does not survive contact with a paying customer, and every request
-- costs a hand-typed transaction against production.
--
-- THIS MIGRATION ENCODES THAT RUNBOOK RATHER THAN INVENTING A PROCEDURE. Its SQL was run against
-- a real database and its effects measured, which makes it a far better specification than
-- anything written fresh — the ORDER in it is load-bearing and non-obvious, and the reason is
-- worth restating because anyone editing this function will be tempted to simplify it:
--
--   `team_members` has five composite foreign keys pointing at it with ON DELETE SET NULL, and
--   four of them CANNOT FIRE. `SET NULL` nulls every column in the key, so each one tries to null
--   a `team_id` that is NOT NULL — and `teams.pending_admin_member_id` tries to null `teams.id`
--   itself. So a plain DELETE FROM team_members is REFUSED for anybody who has been assigned a
--   task, created a meeting, filed a scouting report, taken a roster, or been nominated as admin.
--   Every reference has to be released explicitly first, one column at a time, because a
--   composite FK with any NULL column is not enforced.
--
-- TWO THINGS THE RUNBOOK GETS WRONG, both found by testing it rather than reading it, and both
-- fixed here. They compound, and together they mean the documented procedure does not actually
-- erase an administrator:
--
--   1. "Then delete the login in the Supabase dashboard" DOES NOT WORK for most people. Measured:
--      `auth.admin.deleteUser` on a team owner is refused ("Database error deleting user"); on a
--      plain student it succeeds. `public.users.id -> auth.users(id) ON DELETE CASCADE` means
--      deleting the login deletes the profile row, and four NO ACTION references — `teams.owner_id`,
--      `teams.pending_admin_nominated_by`, `invites.created_by`, `extra_team_grants.granted_by` —
--      refuse that for anyone who has ever owned a team or issued an invite. Which is every admin.
--
--   2. The runbook's anonymisation IS NOT DURABLE. It updates `public.users.email` to a tombstone
--      and leaves `auth.users` alone — but `handle_new_user()` fires AFTER INSERT **OR UPDATE** on
--      `auth.users` and its upsert says `email = EXCLUDED.email` ("GoTrue owns the address; there
--      is no other writer"). So the next time GoTrue writes that row for any reason — a password
--      reset, an email confirmation — the real address is copied straight back over the tombstone.
--      Combined with (1), an erased administrator keeps a working login that silently un-erases
--      itself.
--
-- So this function anonymises `auth.users` FIRST and lets the existing trigger carry the
-- tombstone into `public.users`, which uses the sync instead of fighting it, and then sets the
-- two columns the trigger deliberately preserves. And it BANS the login rather than deleting it:
-- one deterministic outcome for every person, instead of a procedure that half-works depending on
-- whether the requester ever owned a team.

BEGIN;

-- ==============================================================================================
-- 1. The audit trail has to be able to outlive its subject.
-- ==============================================================================================
--
-- `operator_actions.team_id` was NOT NULL with ON DELETE CASCADE, which means deleting a team
-- would delete the record of its own deletion — an audit log that erases exactly the entries most
-- worth keeping. The plan anticipated this ("needs `team_id` nullable and the CHECK widened").
--
-- SET NULL rather than NO ACTION, because the alternative is refusing to delete a team that has
-- ever been touched by an operator, which is every team an operator would delete. The team's
-- identity is captured into `detail` at delete time so the row still says what happened after the
-- foreign key has nothing left to point at.
ALTER TABLE public.operator_actions ALTER COLUMN team_id DROP NOT NULL;

ALTER TABLE public.operator_actions DROP CONSTRAINT operator_actions_team_id_fkey;
ALTER TABLE public.operator_actions
    ADD CONSTRAINT operator_actions_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;

ALTER TABLE public.operator_actions DROP CONSTRAINT operator_actions_action_check;
ALTER TABLE public.operator_actions
    ADD CONSTRAINT operator_actions_action_check CHECK (action = ANY (ARRAY[
        'admin_transfer'::text,
        'license_grant'::text,
        'license_revoke'::text,
        'user_erase'::text,
        'team_delete'::text
    ]));

COMMENT ON COLUMN public.operator_actions.team_id IS
    'SEC-11: nullable and ON DELETE SET NULL, so the record of a team deletion survives the team. '
    'The team name and number are copied into `detail` for exactly this case.';

-- ==============================================================================================
-- 2. Erase a person.
-- ==============================================================================================
CREATE OR REPLACE FUNCTION public.operator_erase_user(
    p_user_id uuid,
    p_notes   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_stranded    text;
    v_tombstone   text;
    v_memberships integer;
    v_children    integer;
    v_attendance  integer;
    v_tasks       integer;
    v_meetings    integer;
    v_reports     integer;
    v_attested    integer;
    v_nominations integer;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error_code', 'not_operator',
                                 'error', 'Not a platform operator');
    END IF;

    IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
        RETURN json_build_object('success', false, 'error_code', 'no_such_user',
                                 'error', 'No such user');
    END IF;

    /*
     * REFUSE TO STRAND A TEAM.
     *
     * The runbook's own first statement is a count that must be zero: removing the membership of
     * a team's only administrator leaves a team nobody can administer, and the remedy —
     * `operator_transfer_team_admin` — already exists. Refusing is better than doing it and
     * reporting it, because the operator is mid-request and would have to undo a deletion.
     *
     * Phrased as SOLE administrator rather than "is an administrator anywhere", which is the
     * runbook's cruder test. The two agree whenever a team has one admin, which is the model
     * (`CLAUDE.md`: one 18+ primary admin per team); where they differ, this one is right —
     * a team with a second administrator is not stranded by losing the first.
     */
    SELECT string_agg(t.name, ', ' ORDER BY t.name) INTO v_stranded
      FROM team_members m
      JOIN teams t ON t.id = m.team_id
     WHERE m.user_id = p_user_id
       AND m.role = 'admin'
       AND m.status <> 'removed'
       AND NOT EXISTS (
           SELECT 1 FROM team_members o
            WHERE o.team_id = m.team_id
              AND o.role = 'admin'
              AND o.status <> 'removed'
              AND o.user_id IS DISTINCT FROM p_user_id
       );

    IF v_stranded IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error_code', 'sole_admin',
            'error', 'This person is the only administrator of: ' || v_stranded ||
                     '. Transfer the admin role first, then erase.',
            'teams', v_stranded
        );
    END IF;

    -- Counted BEFORE anything is released, because afterwards there is nothing left to count and
    -- an audit row saying "0 memberships removed" is indistinguishable from one that did nothing.
    SELECT count(*) INTO v_memberships FROM team_members WHERE user_id = p_user_id;
    SELECT count(*) INTO v_children    FROM managed_profiles WHERE guardian_user_id = p_user_id;
    SELECT count(*) INTO v_attendance  FROM meeting_attendance
     WHERE team_member_id IN (SELECT id FROM team_members WHERE user_id = p_user_id);

    -- ------------------------------------------------------------------------------------------
    -- Step 1 — release every composite reference. None of these can be left to a cascade; see the
    -- header. Single-column UPDATEs, because a composite FK with any NULL column is not enforced.
    -- ------------------------------------------------------------------------------------------
    UPDATE teams
       SET pending_admin_member_id    = NULL,
           pending_admin_nominated_at = NULL,
           pending_admin_nominated_by = NULL
     WHERE pending_admin_member_id IN (SELECT id FROM team_members WHERE user_id = p_user_id);
    GET DIAGNOSTICS v_nominations = ROW_COUNT;

    UPDATE tasks SET assigned_to = NULL
     WHERE assigned_to IN (SELECT id FROM team_members WHERE user_id = p_user_id);
    GET DIAGNOSTICS v_tasks = ROW_COUNT;

    UPDATE meetings SET created_by = NULL
     WHERE created_by IN (SELECT id FROM team_members WHERE user_id = p_user_id);
    GET DIAGNOSTICS v_meetings = ROW_COUNT;

    UPDATE scouting_reports SET created_by = NULL
     WHERE created_by IN (SELECT id FROM team_members WHERE user_id = p_user_id);
    GET DIAGNOSTICS v_reports = ROW_COUNT;

    UPDATE meeting_attendance SET attested_by = NULL
     WHERE attested_by IN (SELECT id FROM team_members WHERE user_id = p_user_id);
    GET DIAGNOSTICS v_attested = ROW_COUNT;

    -- Step 2 — their children, if they are a guardian. Cascades `guardian_consents` and the
    -- child's own `team_members` row, which carries the GUARDIAN's user_id.
    DELETE FROM managed_profiles WHERE guardian_user_id = p_user_id;

    /*
     * Step 3 — their memberships. Cascades THEIR OWN attendance and nothing else's.
     *
     * The flag is for the case the `sole_admin` check above deliberately allows through: an
     * administrator of a team that has ANOTHER administrator. Their row is still an admin row, and
     * SEC-01's trigger protects it. Without this the erasure is refused for them — and only for
     * them, which is the kind of partial failure that looks like a data problem rather than a
     * rule. See the trigger's own comment for why this is not `admin_transfer`.
     */
    PERFORM set_config('falconforge.operator_removal', 'on', true);
    DELETE FROM team_members WHERE user_id = p_user_id;
    PERFORM set_config('falconforge.operator_removal', 'off', true);

    -- ------------------------------------------------------------------------------------------
    -- Step 4 — the login, and it goes BEFORE the profile row rather than after.
    --
    -- `handle_new_user()` fires on UPDATE of `auth.users` and copies `email` straight into
    -- `public.users`. Writing the tombstone here means that trigger CARRIES the erasure rather
    -- than undoing it later; writing it to `public.users` alone (which is what the runbook does)
    -- leaves a value the next password reset overwrites with the real address.
    --
    -- BANNED, NOT DELETED. Deleting the login is refused for anyone who has ever owned a team or
    -- issued an invite — measured, not assumed — because `public.users` cascades from it and four
    -- NO ACTION references refuse that. A ban is one outcome for everybody instead of a procedure
    -- that silently half-works for administrators.
    --
    -- The full uuid, not the runbook's first 8 characters: `auth.users.email` is unique, and 8 hex
    -- characters is a birthday collision at a few thousand erasures — a failure that would look
    -- like a broken erasure rather than a name clash.
    -- ------------------------------------------------------------------------------------------
    v_tombstone := 'erased-' || replace(p_user_id::text, '-', '') || '@erased.invalid';

    UPDATE auth.users
       SET email              = v_tombstone,
           raw_user_meta_data = '{}'::jsonb,
           banned_until       = now() + interval '100 years'
     WHERE id = p_user_id;

    -- Step 5 — the two columns the trigger deliberately preserves. `handle_new_user` only takes a
    -- name from metadata when the metadata CHANGED and the new value is non-null, so emptying
    -- `raw_user_meta_data` above leaves `full_name` exactly as it was. That is correct for a
    -- normal profile edit and wrong here, so it is stated explicitly.
    UPDATE users
       SET full_name  = 'Erased user',
           avatar_url = NULL,
           updated_at = now()
     WHERE id = p_user_id;

    /*
     * The audit row, with `team_id` NULL: an erasure is not an action against one team, and the
     * person may have been in several. What it records is the SHAPE of what was removed, which is
     * what a later "did we honour that request, and what did it touch?" needs — and deliberately
     * NOT the name or address that was erased, because an audit log that keeps the personal
     * information is not an erasure.
     */
    INSERT INTO operator_actions (operator_user_id, team_id, action, detail, notes)
    VALUES (
        auth.uid(), NULL, 'user_erase',
        jsonb_build_object(
            'user_id',              p_user_id,
            'memberships_removed',  v_memberships,
            'children_removed',     v_children,
            'attendance_removed',   v_attendance,
            'tasks_unassigned',     v_tasks,
            'meetings_released',    v_meetings,
            'reports_released',     v_reports,
            'attestations_released', v_attested,
            'nominations_cleared',  v_nominations
        ),
        p_notes
    );

    RETURN json_build_object(
        'success', true,
        'user_id', p_user_id,
        'memberships_removed', v_memberships,
        'children_removed', v_children,
        'attendance_removed', v_attendance,
        'tasks_unassigned', v_tasks,
        'meetings_released', v_meetings,
        'reports_released', v_reports,
        'attestations_released', v_attested,
        'login_disabled', true
    );
END;
$$;

COMMENT ON FUNCTION public.operator_erase_user(uuid, text) IS
    'SEC-11: remove a person''s personal information and memberships, leaving their contributions '
    'with the team. Anonymises auth.users FIRST so handle_new_user carries the tombstone, and bans '
    'the login rather than deleting it (deletion is refused for anyone who has owned a team).';

REVOKE ALL ON FUNCTION public.operator_erase_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_erase_user(uuid, text) TO authenticated, service_role;

-- ==============================================================================================
-- 3. Delete a team.
-- ==============================================================================================
CREATE OR REPLACE FUNCTION public.operator_delete_team(
    p_team_id      uuid,
    p_confirm_name text,
    p_notes        text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_team    record;
    v_members integer;
    v_seasons integer;
    v_tasks   integer;
    v_meetings integer;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error_code', 'not_operator',
                                 'error', 'Not a platform operator');
    END IF;

    SELECT id, name, team_number, program INTO v_team FROM teams WHERE id = p_team_id;
    IF v_team.id IS NULL THEN
        RETURN json_build_object('success', false, 'error_code', 'no_such_team',
                                 'error', 'No such team');
    END IF;

    /*
     * THE NAME HAS TO BE TYPED, and this is the only guard that survives a tired operator.
     *
     * Every other refusal in this file protects against a state; this one protects against the
     * WRONG ROW. `operator_revoke_license` makes the same argument for keeping `team_id` in its
     * WHERE clause — "a mistyped grant id cannot revoke a DIFFERENT team's licence". Deleting a
     * team cascades seventeen tables and there is no undo short of a restore, so the id alone is
     * not enough evidence of intent.
     *
     * Compared with btrim but WITHOUT case folding: a team called "Iron Falcons" is not confirmed
     * by typing "iron falcons". If the operator cannot reproduce the name exactly they are not
     * looking at the team they think they are.
     */
    IF p_confirm_name IS NULL OR btrim(p_confirm_name) <> v_team.name THEN
        RETURN json_build_object(
            'success', false,
            'error_code', 'name_mismatch',
            'error', 'Type the team''s name exactly to confirm. Expected: ' || v_team.name
        );
    END IF;

    SELECT count(*) INTO v_members  FROM team_members WHERE team_id = p_team_id;
    SELECT count(*) INTO v_seasons  FROM seasons      WHERE team_id = p_team_id;
    SELECT count(*) INTO v_tasks    FROM tasks        WHERE team_id = p_team_id;
    SELECT count(*) INTO v_meetings FROM meetings     WHERE team_id = p_team_id;

    /*
     * RECORDED BEFORE THE DELETE, and with the team's identity copied into `detail`.
     *
     * The insert has to happen first because `operator_actions.team_id` is ON DELETE SET NULL: the
     * row survives, but its pointer does not. Copying name and number into the jsonb is what keeps
     * the entry legible afterwards — "team_delete, team_id NULL" is an audit line that records
     * nothing. Unlike the erasure above, a team name is not personal information, so keeping it is
     * the right side of the same argument.
     */
    INSERT INTO operator_actions (operator_user_id, team_id, action, detail, notes)
    VALUES (
        auth.uid(), p_team_id, 'team_delete',
        jsonb_build_object(
            'team_id',      p_team_id,
            'team_name',    v_team.name,
            'team_number',  v_team.team_number,
            'program',      v_team.program,
            'members',      v_members,
            'seasons',      v_seasons,
            'tasks',        v_tasks,
            'meetings',     v_meetings
        ),
        p_notes
    );

    /*
     * The delete itself. Seventeen tables cascade from `teams`, which is the schema doing the work
     * — every one of them was declared ON DELETE CASCADE deliberately, because a team's content
     * has no meaning without the team. The two that do NOT cascade are the ones that must not:
     * `extra_team_grants.used_team_id` is SET NULL, releasing the operator's one-extra-team grant
     * so it can be used again, and `operator_actions.team_id` is now SET NULL for the reason above.
     *
     * People are untouched. `team_members` rows go; `users` rows do not, because a person who
     * leaves a deleted team still has an account, and erasing them is the OTHER function.
     */
    PERFORM set_config('falconforge.operator_removal', 'on', true);
    DELETE FROM teams WHERE id = p_team_id;
    PERFORM set_config('falconforge.operator_removal', 'off', true);

    RETURN json_build_object(
        'success', true,
        'team_id', p_team_id,
        'team_name', v_team.name,
        'members_removed', v_members,
        'seasons_removed', v_seasons,
        'tasks_removed', v_tasks,
        'meetings_removed', v_meetings
    );
END;
$$;

COMMENT ON FUNCTION public.operator_delete_team(uuid, text, text) IS
    'SEC-11: delete a team and everything that cascades from it. Requires the team name typed '
    'exactly. Records the action BEFORE the delete, because operator_actions.team_id is SET NULL.';

REVOKE ALL ON FUNCTION public.operator_delete_team(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_delete_team(uuid, text, text) TO authenticated, service_role;


-- ==============================================================================================
-- 4. The admin-protection trigger has to know about operator removals.
--
-- SEC-01 made the admin's `team_members` row unremovable, which is right and which stops BOTH
-- functions above dead: erasing a non-sole administrator deletes their membership, and deleting a
-- team cascades into `team_members` and takes the admin's row with it. Every team has an admin, so
-- `operator_delete_team` was refused for every team.
--
-- Copied from `pg_get_functiondef` on the running database and patched in exactly one place.
-- ==============================================================================================
CREATE OR REPLACE FUNCTION public.enforce_admin_membership_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    /*
     * SEC-11. Inside `operator_erase_user` / `operator_delete_team`.
     *
     * A SEPARATE FLAG FROM `admin_transfer`, deliberately. Both licence the same mechanical act —
     * removing a row this trigger otherwise protects — but they are different intents, and a flag
     * named for the wrong one is a comment that lies to the next reader. `admin_transfer` says
     * "the admin role is moving and the roster will still have an admin afterwards", which is
     * exactly what an erasure or a team deletion does NOT promise.
     *
     * WITHOUT THIS, deleting a team is refused for every team that has an administrator, which is
     * every team: `DELETE FROM teams` cascades into `team_members`, the admin's row comes with it,
     * and this trigger stops it. Measured, and worth recording HOW: a psql probe of the same
     * function SUCCEEDED, because psql connects as `postgres` and the first bypass above exempts
     * it. The probe agreed with a broken function. Only the test issuing the call the way the app
     * does — an operator's JWT through PostgREST — showed the refusal.
     *
     * Transaction-local (`set_config(..., true)`), like the flag above: it cannot leak past the
     * statement that set it, and there is no path that sets it without immediately doing the
     * removal it exists for.
     */
    IF coalesce(current_setting('falconforge.operator_removal', true), 'off') = 'on' THEN
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
$function$;

COMMIT;
