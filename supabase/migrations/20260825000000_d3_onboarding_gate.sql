-- ============================================================================
-- D3 — the 30-day probation, and the two controls that actually fit the threat
-- ============================================================================
--
-- Kevin's decision of 2026-08-23 (docs/assessment-2026-08/decisions.md, D3) replaced the
-- automatic 90-day trial with a 30-day PROBATION that the operator extends to season length
-- once the team number has been eyeballed. The reasoning that matters for this file is why the
-- licence stopped being the anti-abuse control:
--
--     "Withholding the licence addresses neither [fake teams nor stolen numbers] — a squatter
--     with a read-only team has still taken the number, and the only people actually delayed
--     are real coaches."
--
-- So the two threats get their own controls, and they are the two structural changes here:
--
--   1. UNIQUE (program, team_number). Not primarily an anti-abuse feature: it fixes two
--      coaches from the same team both registering, and typo'd numbers, which are CERTAIN.
--      Claiming a taken number routes to "request to join" instead of silently creating a
--      duplicate.
--   2. One auto-created team per account. A second needs an operator grant. This closes
--      SEC-08's unlimited trial chaining outright and is invisible to a real coach, who has
--      one team and whose students arrive by invite.
--
-- `program` is a COLUMN and not a `"FTC-12345"` string, because FRC is planned and the numbers
-- overlap: the prefix stays data rather than a convention every query has to parse, and display
-- renders "FTC 12345". It defaults to `ftc` and NO FRC BEHAVIOUR IS BUILT — the column is cheap
-- insurance before the September schema freeze; the features are not.
--
-- Deliberately NOT here, per the project's guardrail bar (name the defect or leave it out): a
-- team-number format check, and any automatic verification against FIRST's published team list.
-- The latter is the same commercial-use exposure D2 avoids; a human check is one public URL.

-- ---------------------------------------------------------------------------
-- 1. teams.program, and one team per (program, number)
-- ---------------------------------------------------------------------------

ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT 'ftc'
        CHECK (program IN ('ftc', 'frc'));

COMMENT ON COLUMN teams.program IS
    'Which FIRST program this team competes in. FTC and FRC number ranges overlap, so the '
    'number alone is not an identity. Defaults to ftc; no FRC behaviour exists yet (D3).';

/*
 * FAIL LOUDLY ON EXISTING DUPLICATES, rather than picking a winner.
 *
 * A migration that silently deduplicates decides which of two real teams keeps its number, on
 * a database the author cannot see. Production is migrated by hand by Kevin before merge (per
 * `deploy.yml`'s header), so an exception here is a conversation rather than an outage — and
 * the message carries the numbers so the conversation can start immediately.
 *
 * This is also why the index below is created OUTSIDE any exception handler: if it fails, the
 * migration fails.
 */
DO $$
DECLARE
    v_dupes text;
BEGIN
    SELECT string_agg(format('%s (%s teams)', team_number, n), ', ' ORDER BY team_number)
    INTO v_dupes
    FROM (
        SELECT team_number, count(*) AS n
        FROM teams
        WHERE team_number IS NOT NULL AND btrim(team_number) <> ''
        GROUP BY program, team_number
        HAVING count(*) > 1
    ) d;

    IF v_dupes IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot add UNIQUE (program, team_number): these numbers are already held by more '
            'than one team -- %. Decide which team keeps each number before applying D3; '
            'the operator directory shows the admin and roster size for each.',
            v_dupes;
    END IF;
END $$;

/*
 * PARTIAL, on purpose. `team_number` is nullable and a team may legitimately have none — the
 * create-team wizard asks for it and does not insist, and a rookie team registering before FIRST
 * has issued a number is a real case in September. Postgres treats NULLs as distinct in a plain
 * UNIQUE anyway; the predicate makes that intent explicit and also excludes the empty string,
 * which the client can produce and which is NOT distinct from another empty string.
 */
CREATE UNIQUE INDEX IF NOT EXISTS teams_program_number_unique
    ON teams (program, team_number)
    WHERE team_number IS NOT NULL AND btrim(team_number) <> '';

-- ---------------------------------------------------------------------------
-- 2. The operator's permission for a second team
-- ---------------------------------------------------------------------------

/*
 * One row = "this account may self-create one more team".
 *
 * A SEPARATE TABLE rather than a row in `operator_actions`, and the reason is a column:
 * `operator_actions.team_id` is NOT NULL and references `teams`. This grant exists precisely
 * when there is no team yet, so it cannot be recorded there without making that column
 * nullable — which would weaken an audit table so that a different feature could borrow it.
 *
 * Single-use by construction (`used_at` / `used_team_id`), so an operator who helps a coach
 * once has not handed them a standing exemption. Nothing revokes an unused grant because
 * nothing needs to yet; deleting the row is the revoke, and only the operator can see the
 * table at all.
 */
CREATE TABLE IF NOT EXISTS extra_team_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by uuid NOT NULL REFERENCES users(id),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at timestamptz,
    used_team_id uuid REFERENCES teams(id) ON DELETE SET NULL
);

ALTER TABLE extra_team_grants ENABLE ROW LEVEL SECURITY;

/*
 * Operators read; nobody writes through the API. Same shape and same reasoning as
 * `operator_actions`: rows are created only by a SECURITY DEFINER RPC, so the absence of an
 * INSERT policy is the point rather than an omission. An exemption a caller can append to is
 * not an exemption.
 *
 * NOT readable by the user it names, deliberately. It records a platform decision about them,
 * and default-deny says a table gets the narrowest audience that makes it useful. The user
 * learns about it the only way that matters — the next team they create works.
 */
DROP POLICY IF EXISTS extra_team_grants_select_operator ON extra_team_grants;
CREATE POLICY extra_team_grants_select_operator ON extra_team_grants
    FOR SELECT USING (is_platform_operator());

CREATE INDEX IF NOT EXISTS extra_team_grants_unused_idx
    ON extra_team_grants (user_id) WHERE used_at IS NULL;

GRANT SELECT ON public.extra_team_grants TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_team_as_admin — 30 days, one team, one number
-- ---------------------------------------------------------------------------

/*
 * The signature is UNCHANGED (text, text, text) and that is deliberate.
 *
 * `program` could have been a fourth argument. It is not, because D3 says no FRC behaviour is
 * built now, and a fourth argument would need the GRANT/REVOKE lines in
 * `20260819000000_revoke_anon_execute.sql` re-issued for a new signature while the old one
 * stayed EXECUTE-able by `authenticated` — two functions where there should be one, and the
 * older one still reachable at `/rpc`. Every team created here is `ftc` by the column default.
 *
 * THIS BODY IS THE FOURTH COPY OF `create_team_as_admin`, AND THAT IS THE HAZARD.
 *
 * Migrations are forward-only, so `CREATE OR REPLACE` carries the WHOLE body, and every
 * previous fix has to be carried with it. The first draft of this migration was built from the
 * Sprint 3 original and silently dropped two later ones: SEC-01's `set_config` flag (so the
 * founding admin INSERT was refused by the very trigger SEC-01 added) and SEC-09's invite
 * handling (which had removed a duplicate definition of the seven days, and which this file
 * promptly wrote back in). Both were caught by `onboarding-gate.db.test.ts` on its first run,
 * which is the argument for the db suite existing at all — nothing in the unit suite can see
 * a trigger.
 *
 * Before replacing this function again, grep the migrations directory for every definition of
 * it and start from the LAST one, not the first.
 *
 * ERROR CODES, not just sentences. The client has to BRANCH on "that number is taken" — it
 * routes the coach to the join screen — and branching on prose is how a fix to the wording
 * becomes a broken funnel. `error` stays, unchanged in kind, so nothing that only displays it
 * has to change.
 */
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
    v_number text;
    v_existing teams%ROWTYPE;
    v_grant_id uuid;
    v_owned integer;
    /*
     * THIRTY, not ninety (D3). A probation rather than a trial: the operator extending it to
     * season length is the NORMAL path, not an exception. A coach registering at 8am on a
     * competition Saturday has a working app without waiting for Kevin, and a fake team is
     * worth thirty days of nothing.
     */
    v_trial_days constant integer := 30;
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

    -- Normalised once, here, so the uniqueness check and the INSERT cannot disagree about
    -- what " 12345 " is. Empty becomes NULL: a team with no number is a real case in
    -- September, and '' would collide with every other blank.
    v_number := nullif(btrim(coalesce(team_number, '')), '');

    -- ------------------------------------------------------------ the number is taken
    IF v_number IS NOT NULL THEN
        -- ALIASED, because `team_number` is also this function's own argument name and
        -- plpgsql resolves the bare identifier to the parameter: `column reference
        -- "team_number" is ambiguous`, 42702, which the db suite caught on its first run.
        SELECT t.* INTO v_existing FROM teams t
        WHERE t.program = 'ftc' AND t.team_number = v_number;

        IF v_existing.id IS NOT NULL THEN
            /*
             * ALREADY ON IT is a different sentence from SOMEBODY ELSE HAS IT, and telling
             * them apart is most of this feature's value. The commonest real cause of a
             * collision is not a squatter: it is the same coach registering twice, or the
             * second coach from one team doing it a week later. "You are already on this
             * team" ends that in one screen; "request to join" would send a team's own admin
             * into a queue for their own team.
             */
            IF EXISTS (
                SELECT 1 FROM team_members
                WHERE team_id = v_existing.id
                  AND user_id = auth.uid()
                  AND managed_profile_id IS NULL
                  AND status <> 'removed'
            ) THEN
                RETURN json_build_object(
                    'success', false,
                    'error_code', 'already_on_team',
                    'error', format(
                        'You are already on %s (#%s). Switch to it instead of creating it again.',
                        v_existing.name, v_number),
                    'team_id', v_existing.id,
                    'team_name', v_existing.name,
                    'team_number', v_number
                );
            END IF;

            /*
             * The team's NAME is returned and its id is not, and that asymmetry is the
             * security line. The name is what makes the message useful ("#12345 Iron Falcons
             * is already registered — ask their admin for an invite code"); the id is what
             * B21 called "the entire attack" when a membership could be created from it. The
             * caller gets enough to recognise their own team and nothing they could act on.
             */
            RETURN json_build_object(
                'success', false,
                'error_code', 'team_number_taken',
                'error', format(
                    '#%s %s is already registered on FalconForge. Ask their admin for an '
                    'invite code to join.', v_number, v_existing.name),
                'team_name', v_existing.name,
                'team_number', v_number
            );
        END IF;
    END IF;

    -- ------------------------------------------------------------ one team per account
    /*
     * SEC-08's trial chaining, closed. Counting OWNED teams rather than trial grants: a user
     * who was gifted a licence still owns exactly one team, and "how many teams did you
     * create" is the question, not "how many trials did you collect".
     *
     * `owner_id` is the right column and not `team_members`: a person can be a coach on three
     * teams and that is normal. Creating three is what this stops.
     */
    SELECT count(*) INTO v_owned FROM teams WHERE owner_id = auth.uid();

    IF v_owned > 0 THEN
        SELECT id INTO v_grant_id
        FROM extra_team_grants
        WHERE user_id = auth.uid() AND used_at IS NULL
        ORDER BY created_at
        LIMIT 1;

        IF v_grant_id IS NULL THEN
            RETURN json_build_object(
                'success', false,
                'error_code', 'one_team_per_account',
                'error',
                'This account already registered a team. If you genuinely run a second team, '
                'ask support@falcon-forge.com to enable it — it takes a minute.'
            );
        END IF;
    END IF;

    INSERT INTO teams (name, team_number, owner_id)
    VALUES (trim(team_name), v_number, auth.uid())
    RETURNING id INTO v_team_id;

    -- Consumed only once the team exists, so a failure anywhere above leaves the grant
    -- unspent. Single-use: an operator who helped once has not handed out a standing
    -- exemption.
    IF v_grant_id IS NOT NULL THEN
        UPDATE extra_team_grants
        SET used_at = now(), used_team_id = v_team_id
        WHERE id = v_grant_id;
    END IF;

    -- Before the member, so the seat-capacity trigger has an entitlement to consult.
    INSERT INTO license_grants (team_id, source, seats, valid_until, created_by, notes)
    VALUES (
        v_team_id, 'gift', NULL, now() + make_interval(days => v_trial_days), auth.uid(),
        -- WALK-B-09: the ADMIN PANEL keys its label on this text, so a brand-new self-serve
        -- team stops being told it was given a gift it never received. The word "probation"
        -- is D3's and is the honest one: extension is the normal path.
        format('Automatic %s-day beta probation issued at team registration', v_trial_days)
    );

    -- Unseated, then seated. `enforce_seat_capacity` requires the team's admin to be the one
    -- assigning a seat, and until this INSERT lands there is no admin to be. Splitting it in
    -- two means the founding admin passes the same check as everybody else rather than
    -- needing a bootstrap exemption, which is one fewer branch that could be widened later.
    --
    -- SEC-01's transaction-local flag. `enforce_admin_membership_protection` refuses any
    -- statement that writes `role = 'admin'`, which includes this founding INSERT; the four
    -- functions that legitimately move the role raise the flag around exactly the statement
    -- that needs it. `set_config(..., true)` is SET LOCAL, so an exception anywhere leaves
    -- nothing behind, and PostgREST gives every request its own transaction.
    PERFORM set_config('falconforge.admin_transfer', 'on', true);
    INSERT INTO team_members (team_id, user_id, role, status, full_name, email)
    VALUES (v_team_id, auth.uid(), 'admin', 'approved', v_user.full_name, v_user.email)
    RETURNING id INTO v_member_id;
    PERFORM set_config('falconforge.admin_transfer', 'off', true);

    UPDATE team_members SET seat_assigned = true WHERE id = v_member_id;

    v_invite_code := upper(substr(md5(random()::text), 1, 8));
    -- SEC-09, restored verbatim: NO `expires_at` here on purpose. The column DEFAULT is the
    -- ONE definition of how long an invite lasts, and RETURNING reads back what it actually
    -- chose, so the date the success screen prints is the row's rather than the client's
    -- arithmetic. The first draft of THIS migration wrote `now() + interval '7 days'` here,
    -- which is the same number said in a second place -- exactly what SEC-09 removed.
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
     */
    INSERT INTO sub_teams (team_id, season_id, name)
    SELECT v_team_id, v_season_id, name
    FROM unnest(ARRAY['Programming', 'Build', 'Drive', 'Scouting', 'Outreach']) AS name;

    -- The checklist row's id IS the season id. Blob-synced records have no per-record
    -- identity to merge on, so two offline devices need to agree on the row id without
    -- talking to each other.
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
        'invite_expires_at', v_invite_expires_at,
        'trial_days', v_trial_days
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The operator's side of the probation
-- ---------------------------------------------------------------------------

/*
 * The end of the current FTC season, for the one-click extension.
 *
 * 30 April is D3's own example and is after the world championship. Computed as "the next 30
 * April strictly after now" rather than "this year + 1", so an operator extending a team in
 * October 2026 and one extending in February 2027 both land on 2027-04-30 — a team registering
 * mid-season gets the rest of THIS season, not eighteen months.
 *
 * A function rather than a constant because the answer moves, and a constant that has to be
 * edited every August is `docs/failure-modes.md` §12 with a one-year fuse.
 */
CREATE OR REPLACE FUNCTION public.current_season_end()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
    SELECT CASE
        WHEN now() < make_timestamptz(extract(year FROM now())::int, 4, 30, 23, 59, 59, 'UTC')
            THEN make_timestamptz(extract(year FROM now())::int, 4, 30, 23, 59, 59, 'UTC')
        ELSE make_timestamptz(extract(year FROM now())::int + 1, 4, 30, 23, 59, 59, 'UTC')
    END;
$$;

/*
 * The new-team list: what the operator looks at to decide whether a probation becomes a season.
 *
 * D3 asks for "number, name, age, whether it has been used", and the last one is the one that
 * carries the decision. A fake team and a real team look identical on the first three; what
 * separates them is whether anybody has done anything. `has_been_used` is therefore
 * deliberately generous about what counts — a second person on the roster, or any content row
 * at all — because the question is "is this real", not "is this active".
 *
 * Ordered NEWEST FIRST, which is the opposite of the expiry directory and correct for the
 * opposite reason: that list answers "who runs out next", this one answers "who arrived".
 */
CREATE OR REPLACE FUNCTION public.operator_new_teams(p_limit integer DEFAULT 100)
RETURNS TABLE (
    team_id uuid,
    team_name text,
    program text,
    team_number text,
    created_at timestamptz,
    age_days integer,
    admin_name text,
    admin_email text,
    members_total integer,
    content_rows integer,
    has_been_used boolean,
    valid_until timestamptz,
    is_probation boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Zero rows rather than a json error object, matching `operator_team_directory`: a caller
    -- who is not an operator gets nothing to branch on, and the UI never renders this for one.
    IF NOT is_platform_operator() THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.program,
        t.team_number,
        t.created_at,
        floor(extract(epoch FROM (now() - t.created_at)) / 86400)::integer,
        adm.full_name,
        adm.email,
        counts.members_total,
        counts.content_rows,
        (counts.members_total > 1 OR counts.content_rows > 0),
        inforce.valid_until,
        inforce.is_probation
    FROM teams t
    LEFT JOIN team_members adm
           ON adm.team_id = t.id AND adm.role = 'admin' AND adm.status <> 'removed'
    CROSS JOIN LATERAL (
        SELECT
            (SELECT count(*)::integer FROM team_members m
              WHERE m.team_id = t.id AND m.status <> 'removed') AS members_total,
            (
                (SELECT count(*) FROM tasks x WHERE x.team_id = t.id)
              + (SELECT count(*) FROM scouting_reports x WHERE x.team_id = t.id)
              + (SELECT count(*) FROM match_plans x WHERE x.team_id = t.id)
              + (SELECT count(*) FROM meetings x WHERE x.team_id = t.id)
            )::integer AS content_rows
    ) counts
    CROSS JOIN LATERAL (
        SELECT
            CASE WHEN bool_or(g.valid_until IS NULL) THEN NULL ELSE max(g.valid_until) END
                AS valid_until,
            -- "Still on the automatic grant nobody has looked at yet." Keyed on the notes text
            -- this migration writes, which is a string comparison and therefore fragile --
            -- `schema_assertions.sql` asserts the two agree, because the alternative (a column
            -- on `license_grants`) is a wider change to a frozen table for one boolean.
            coalesce(bool_and(g.notes LIKE 'Automatic %-day beta probation%'), false)
                AS is_probation
        FROM license_grants g
        WHERE g.team_id = t.id
          AND g.revoked_at IS NULL
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now())
    ) inforce
    ORDER BY t.created_at DESC, t.id
    LIMIT greatest(coalesce(p_limit, 100), 1);
END;
$$;

/*
 * One click: extend this team's cover to the end of the season.
 *
 * A NEW GRANT rather than an UPDATE to the probation row, and that is the same choice
 * `grant_team_license` already makes. `license_grants` is an append-only record of what was
 * given and when; editing the probation's `valid_until` would erase the fact that a probation
 * ever happened, which is exactly the fact an operator wants six months later when a team
 * disputes something.
 *
 * The probation is left in force rather than revoked. `team_entitlement` takes the MAX of the
 * in-force grants' end dates, so the longer one wins and the shorter one simply stops
 * mattering; revoking it would add a "revoked" row to the audit trail describing something
 * nobody took away.
 */
CREATE OR REPLACE FUNCTION public.operator_extend_to_season(
    p_team_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_grant_id uuid;
    v_until timestamptz;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not authorized');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id) THEN
        RETURN json_build_object('success', false, 'error', 'No such team');
    END IF;

    v_until := current_season_end();

    INSERT INTO license_grants (team_id, source, seats, valid_until, created_by, notes)
    VALUES (
        p_team_id, 'gift', NULL, v_until, auth.uid(),
        coalesce(nullif(btrim(coalesce(p_notes, '')), ''),
                 'Probation extended to the end of the season by the platform operator')
    )
    RETURNING id INTO v_grant_id;

    INSERT INTO operator_actions (operator_user_id, team_id, action, detail, notes)
    VALUES (
        auth.uid(), p_team_id, 'license_grant',
        json_build_object('grant_id', v_grant_id, 'valid_until', v_until, 'reason', 'extend_to_season'),
        p_notes
    );

    RETURN json_build_object('success', true, 'grant_id', v_grant_id, 'valid_until', v_until);
END;
$$;

/*
 * Let one account create one more team.
 *
 * Named for what it is rather than for the abuse it answers: an operator using this is almost
 * always helping a real person who genuinely runs two teams, and a control whose name assumes
 * bad faith gets used apologetically or not at all.
 */
CREATE OR REPLACE FUNCTION public.operator_grant_extra_team(
    p_user_id uuid,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not authorized');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
        RETURN json_build_object('success', false, 'error', 'No such user');
    END IF;

    -- An unused grant already sitting there is not an error and must not become two: the
    -- operator has already said yes, and saying it twice should not buy two teams.
    SELECT id INTO v_id
    FROM extra_team_grants
    WHERE user_id = p_user_id AND used_at IS NULL
    ORDER BY created_at
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', true, 'grant_id', v_id, 'already_had_one', true
        );
    END IF;

    INSERT INTO extra_team_grants (user_id, granted_by, notes)
    VALUES (p_user_id, auth.uid(), nullif(btrim(coalesce(p_notes, '')), ''))
    RETURNING id INTO v_id;

    RETURN json_build_object('success', true, 'grant_id', v_id, 'already_had_one', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
--
-- `REVOKE ... FROM PUBLIC` first, every time. EXECUTE comes from PUBLIC and `anon` is a member
-- of it, so `REVOKE ... FROM anon` alone is a NO-OP that an assertion over `pg_proc` ACLs would
-- have approved (docs/environment-divergences.md §5). The behavioural check is in
-- `anon-execute.rls.db.test.ts`.

REVOKE ALL ON FUNCTION public.current_season_end() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_season_end() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.operator_new_teams(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_new_teams(integer) TO authenticated;

REVOKE ALL ON FUNCTION public.operator_extend_to_season(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_extend_to_season(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.operator_grant_extra_team(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_grant_extra_team(uuid, text) TO authenticated;

-- Unchanged signature, so its existing grants stand; re-stated because CREATE OR REPLACE on a
-- SECURITY DEFINER function is exactly the moment to be sure.
REVOKE ALL ON FUNCTION public.create_team_as_admin(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) TO authenticated, service_role;
