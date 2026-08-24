-- SEC-16 — the two guardian edges that outlive the guardian.
--
-- Both halves are one sentence apart from the code that was already there, and both were found
-- by reading rather than by anything failing, because neither produces an error.
--
-- 1. A GUARDIAN'S EMAIL CHANGE NEVER REACHED THEIR CHILD'S ROSTER ROW.
--    `sync_user_to_team_members` filters on `managed_profile_id IS NULL` so that renaming
--    yourself does not rename every child you are responsible for. Correct -- and it also meant
--    the guardian's EMAIL, which is denormalised onto the child's row as the only contactable
--    address for that child, was never updated. It went stale silently, and the moment it is
--    discovered is the moment somebody needs it.
--
-- 2. ERASING A GUARDIAN DESTROYED A GRADUATED CHILD'S RECORD.
--    `operator_erase_user` deletes `managed_profiles WHERE guardian_user_id = ...`, which for a
--    child who has since claimed their own login destroys the retained record the plan says to
--    keep -- while their membership and attendance (repointed at their own user id by
--    `claim_managed_profile`) survive. So the team keeps the member and loses the reason they
--    were ever rostered, which is the COPPA evidence trail.
--
-- BOTH BODIES ARE `pg_get_functiondef` OUTPUT WITH ONE STATEMENT PATCHED, not rebuilt from an
-- older migration. `HANDOFF_BUILD.md` records what rebuilding costs: SEC-01's transaction-local
-- flag and SEC-09's invite handling were both silently dropped that way. The generator asserts
-- its anchor appears exactly once before replacing it.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_user_to_team_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name
       OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
       OR NEW.email IS DISTINCT FROM OLD.email THEN

        UPDATE team_members
        SET full_name = NEW.full_name,
            avatar_url = NEW.avatar_url,
            email = NEW.email
        WHERE user_id = NEW.id
          AND managed_profile_id IS NULL;

        /*
         * ...and the EMAIL only, onto the guardian's children (SEC-16).
         *
         * A managed child's roster row carries the CHILD's name and the GUARDIAN's email --
         * `join_team_with_invite_for_child` writes exactly that pair, and it is the COPPA model
         * made concrete: the roster shows who turns up, and the contactable address belongs to
         * the adult, because the child has no account and no address we hold.
         *
         * The filter above exists so that renaming yourself does not rename every child you are
         * responsible for, which is right. But it also meant that CHANGING YOUR EMAIL never
         * reached them, so the one address a coach has for a child went stale the moment their
         * parent switched provider -- and it goes stale silently, discovered when somebody tries
         * to use it.
         *
         * `full_name` and `avatar_url` are deliberately absent from this second statement: both
         * belong to the child. This is the whole distinction the first filter was drawing, kept
         * intact and applied per column instead of per row.
         */
        IF NEW.email IS DISTINCT FROM OLD.email THEN
            UPDATE team_members
            SET email = NEW.email
            WHERE user_id = NEW.id
              AND managed_profile_id IS NOT NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.operator_erase_user(p_user_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    /*
     * Step 2 — their children, if they are a guardian. Cascades `guardian_consents` and the
     * child's own `team_members` row, which carries the GUARDIAN's user_id.
     *
     * NOT A CHILD WHO HAS GRADUATED (SEC-16). `promoted_to_user_id IS NULL` is the whole change,
     * and it is what the plan already said should happen: "The `managed_profiles` row and its
     * consents are retained as the record of why the child was rostered" (plan section 3,
     * promotion). This function deleted them, so erasing a guardian destroyed the COPPA evidence
     * trail for a child who is still on the team under their own login.
     *
     * The two cases are genuinely different people. A child who has NOT graduated exists in this
     * product only through their guardian -- no login, no address, every field entered by the
     * adult being erased -- so they go with them, which is what this line has always done and is
     * correct. A child who HAS graduated holds their own account and their own membership;
     * `claim_managed_profile` repointed `team_members.user_id` at them and set
     * `managed_profile_id` to NULL, so their roster row and attendance already survive this
     * function untouched. Destroying the profile row destroys only the record of WHY they were
     * rostered -- which is the one thing about them that is worth keeping, and is not the
     * guardian's personal data.
     *
     * What IS the guardian's, and is cleared: `notes`. Free text an adult wrote about a child,
     * which is exactly the kind of thing an erasure request is for. The child's name stays,
     * because it is the child's and their own account carries it already.
     */
    UPDATE managed_profiles
       SET notes = ''
     WHERE guardian_user_id = p_user_id
       AND promoted_to_user_id IS NOT NULL;

    DELETE FROM managed_profiles
     WHERE guardian_user_id = p_user_id
       AND promoted_to_user_id IS NULL;

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
$function$;

/*
 * The trigger is not re-created. `CREATE OR REPLACE FUNCTION` replaces the body in place and
 * `on_user_profile_update` already points at it by name, so dropping and re-adding the trigger
 * would be a change with no effect and one more thing to get wrong.
 */

COMMIT;
