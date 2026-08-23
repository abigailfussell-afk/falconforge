-- SEC-09 — the invite code shown at team registration lasts a week, and says when it stops.
--
-- WHAT WAS WRONG
--
-- `invites.expires_at` defaulted to `now() + interval '24 hours'`, and `create_team_as_admin`
-- inserts `(team_id, code, created_by)` only — so the code printed on the "Team Created
-- Successfully!" screen died overnight, with nothing on that screen saying so. Codes generated
-- later from `InviteManager` lasted a week (`INVITE_LIFETIME_HOURS = 24 * 7`), so the two paths
-- disagreed about the same concept. Reproduced by registering three teams over the API:
--
--     name                   | code     | expires_at - created_at
--     SEC-08 Trial Chain 1   | D34352E1 | 1 day
--
-- The shape of the cost is the first-run experience of every beta team: a coach registers at
-- home on Sunday, reads the code out at Tuesday's meeting, and every student gets "Invalid or
-- expired invite code" — a true statement about a code the app told them to share, with no way
-- to tell it apart from a typo.
--
-- ONE DEFINITION, AND IT IS THE COLUMN DEFAULT
--
-- The lifetime was written down in two places that had already drifted. Raising the default and
-- ALSO leaving `INVITE_LIFETIME_HOURS` in the client would leave two places that merely agree
-- for now — `docs/failure-modes.md` §12, a hand-maintained value tracking another one, where
-- nothing fails when they diverge. So:
--
--   * the DEFAULT here is the only statement of how long an invite lasts;
--   * `create_team_as_admin` inserts without `expires_at` and reads back what the default chose
--     (`RETURNING`), returning it as `invite_expires_at` so the success screen prints the row's
--     own value rather than recomputing it;
--   * `InviteManager` drops its constant and its `expires_at`, and renders the value the insert
--     returns.
--
-- Existing invite rows are deliberately not migrated. Their expiry is a fact about a credential
-- that was issued under the old rule; extending one silently would be a change to something
-- somebody already shared.

ALTER TABLE invites
    ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

COMMENT ON COLUMN invites.expires_at IS
    'SEC-09: this DEFAULT is the one definition of how long an invite code lasts. '
    'create_team_as_admin and InviteManager both omit the column and read back what it chose. '
    'NULL means no expiry, which nothing currently writes.';

-- ==========================================================================
-- `create_team_as_admin`, re-stated with the invite expiry in its result.
--
-- Unchanged from `20260824000000_sec_01_protect_admin_membership.sql` apart from the invite
-- INSERT and the extra key; migrations are forward-only, so the whole body travels.
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
    v_invite_expires_at timestamptz;
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
    -- No `expires_at` here on purpose: the column DEFAULT is the ONE definition of
    -- how long an invite lasts, and RETURNING reads back what it actually chose, so
    -- the date the success screen prints is the row's, not the client's arithmetic.
    INSERT INTO invites (team_id, code, created_by)
    VALUES (v_team_id, v_invite_code, auth.uid())
    RETURNING expires_at INTO v_invite_expires_at;

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
        'invite_code', v_invite_code,
        'invite_expires_at', v_invite_expires_at
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) TO authenticated, service_role;
