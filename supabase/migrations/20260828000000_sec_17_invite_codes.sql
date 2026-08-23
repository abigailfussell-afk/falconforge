-- SEC-17 — one invite-code generator, and it is a CSPRNG.
--
-- THERE WERE TWO, which is the shape CLAUDE.md principle 9 names and the shape SEC-09 already
-- found in this exact table's lifetime column:
--
--   * `InviteManager.generateInviteCode()` — `Math.random()` over a 32-symbol alphabet with the
--     confusable characters removed (no I, O, 0, 1), 8 characters.
--   * `create_team_as_admin` — `upper(substr(md5(random()::text), 1, 8))`, 8 HEX characters.
--
-- Different alphabets, different entropy, one concept. A support call about "the code doesn't
-- work" could not be answered without knowing which screen produced it, and the registration
-- code carried ~32 bits where the panel's carried ~40.
--
-- NEITHER RNG IS CRYPTOGRAPHIC, and that is the actual defect rather than the length.
-- `Math.random()` in V8 is xorshift128+: its internal state is recoverable from a handful of
-- outputs, so a member who generates a few invites for their own team can predict the codes
-- another team generates afterwards. Postgres `random()` is a seeded PRNG with the same
-- property, and `md5` of a predictable input is a predictable digest. An invite code is a
-- bearer credential that lands somebody in a team's roster as `pending`, so it belongs to
-- `gen_random_bytes`, which reads the OS CSPRNG.
--
-- The fix is a column DEFAULT rather than a shared helper both callers remember to call,
-- because a helper is still two call sites and this table has already been bitten once by
-- exactly that. The DEFAULT is the only way a code gets made, and the column privilege below
-- is what turns "should not" into "cannot".

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- The generator.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    /*
     * 32 symbols, and the omissions are deliberate: no I, O, 0 or 1. A code is read off a
     * screen and typed into a phone at a venue, often by a thirteen-year-old, and this is the
     * alphabet the invite panel already used for that reason. Keeping it means the codes an
     * existing team has written down still look like the codes it gets tomorrow.
     */
    k_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    k_length   constant integer := 8;
    v_bytes    bytea;
    v_code     text := '';
    v_i        integer;
BEGIN
    v_bytes := extensions.gen_random_bytes(k_length);

    FOR v_i IN 0 .. k_length - 1 LOOP
        /*
         * `& 31` and not `% 32`, though here they are the same operation.
         *
         * The alphabet is 32 symbols, a power of two, so taking the low five bits of a uniform
         * byte is exactly uniform — no modulo bias, no rejection sampling needed. Written as a
         * mask so that the ASSUMPTION is visible: change the alphabet to a length that is not a
         * power of two and this line is silently biased, which is the kind of weakness that
         * never shows up in a test because every code it produces still looks random.
         */
        v_code := v_code || substr(k_alphabet, (get_byte(v_bytes, v_i) & 31) + 1, 1);
    END LOOP;

    RETURN v_code;
END;
$$;

COMMENT ON FUNCTION public.generate_invite_code() IS
    'SEC-17: the ONE invite-code generator. 8 symbols from a 32-symbol confusable-free alphabet, '
    'drawn from gen_random_bytes (OS CSPRNG). Reached through the invites.code DEFAULT, never '
    'called directly by application code.';

/*
 * NOT executable by a client.
 *
 * A DEFAULT is evaluated by the server as part of the INSERT, so nothing needs EXECUTE for the
 * normal path to work. Leaving the grant on would hand anyone an oracle for generating codes at
 * `/rest/v1/rpc/generate_invite_code` — harmless on its own, but SEC-06 is the finding about
 * SECURITY DEFINER functions being reachable there, and `schema_assertions.sql` assertion 23
 * will fail the Gate on any new one that is.
 */
REVOKE ALL ON FUNCTION public.generate_invite_code() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- The one place a code is made.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.invites ALTER COLUMN code SET DEFAULT public.generate_invite_code();

/*
 * "Should not set the code" becomes "cannot set the code".
 *
 * Sprint 16's lesson in a different shape: the rename is what turned six call sites into
 * compile errors. Here, revoking the column privilege is what stops a future component quietly
 * generating its own code again — the third time this table would have had two generators. RLS
 * cannot express a column, so this is a GRANT-level control, the same mechanism Sprint 9 used
 * for `managed_profiles.promotion_code`.
 *
 * SELECT is untouched: a member must be able to READ their team's code to share it. UPDATE is
 * revoked as well, because rotating a code is revoke-and-generate, not edit-in-place, and an
 * editable code is an editable credential.
 *
 * `create_team_as_admin` is SECURITY DEFINER and runs as its owner, so it is unaffected; so is
 * `service_role`, which the db suite uses to plant codes it needs to know in advance.
 */
REVOKE INSERT, UPDATE ON public.invites FROM anon, authenticated;

/*
 * REVOKE THE TABLE PRIVILEGE FIRST, THEN RE-GRANT PER COLUMN — the order is the whole thing.
 *
 * `REVOKE INSERT (code) ... ` on a role that holds table-level INSERT is a NO-OP: the table
 * grant already covers every column, including ones added later, and a column revoke cannot
 * subtract from it. The first draft of this migration did exactly that and
 * `has_column_privilege('authenticated','invites','code','INSERT')` still answered **true**
 * after it ran — a control that reads as applied and is not. This is the mechanism Sprint 9
 * had to learn for `managed_profiles.promotion_code`, and it is worth learning once per repo.
 *
 * INSERT: what the invite panel actually sends, and nothing else. `id`, `created_at`,
 * `expires_at` and `code` all have DEFAULTs, and not granting them is what makes those
 * DEFAULTs the only statement of their value rather than the usual one. That closes the same
 * hole for `expires_at` that SEC-09 closed by convention — the client already declines to send
 * it, and now it could not.
 *
 * UPDATE: `max_uses` only. The app never updates an invite at all today, but the
 * `invites_update_roster` policy exists, and revoking UPDATE outright would leave a policy with
 * no grant behind it — a rule that looks like it is protecting something and is guarding a door
 * nobody can reach. Narrowing or widening a code's seat cap is the one edit that makes sense on
 * an invite; changing its code or its expiry is rotation, which is revoke-and-generate.
 *
 * BOTH API ROLES GET THE SAME COLUMNS, including `anon`, and the first draft of this migration
 * did not — it gave `anon` nothing, on the reasoning that an anonymous caller has no business
 * creating an invite. `db:verify` refused that with "Tables the API roles cannot use (missing
 * GRANTs): invites (anon)", and the assertion is right and this migration was wrong.
 *
 * The repo's model is one boundary, not two: CLAUDE.md principle 4 makes RLS the security
 * boundary, and grants answer only "can PostgREST use this table at all" — a question that was
 * once answered NO for every table by a rebuild, which is why assertion 6 exists. `anon` is
 * already refused here by `can_manage_roster`, which is false with no session; narrowing the
 * grant on top of that is a second, weaker mechanism policing something RLS already decides,
 * and it is exactly the "one concept, two implementations" shape principle 9 is about.
 *
 * What is NOT bent to fit: the `code` column stays revoked from both roles. That is a different
 * question — not "may this role touch invites" but "may ANY client choose a credential" — and
 * the answer is no for the same reason `managed_profiles.promotion_code` is no. Assertion 6 asks
 * `has_any_column_privilege` precisely so a deliberate column narrowing can coexist with it.
 */
GRANT INSERT (team_id, created_by, max_uses) ON public.invites TO anon, authenticated;
GRANT UPDATE (max_uses) ON public.invites TO anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- create_team_as_admin, COPIED from the running database and patched in one place.
--
-- Sprint 17 rebuilt this function from an older migration and silently dropped SEC-01's
-- transaction-local flag and SEC-09's invite handling; the db suite caught it on the first run.
-- The body below is `pg_get_functiondef` output with the invite INSERT changed and nothing else.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_team_as_admin(team_name text, season_name text, team_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- SEC-09, and now SEC-17 alongside it: NO `expires_at` here AND NO `code`. Both column
    -- DEFAULTs are the one definition of their thing, and RETURNING reads back what the
    -- database actually chose, so the code and the date the success screen prints are the
    -- row's rather than this function's. `code` used to be
    -- `upper(substr(md5(random()::text), 1, 8))` computed right here -- a second generator,
    -- with a different alphabet and a different length from the one the invite panel used,
    -- and `random()` is not a CSPRNG. The first draft of the SEC-09 migration wrote
    -- `now() + interval '7 days'` on this line, which is the same number said in a second
    -- place; the code was the same mistake that nobody had noticed yet.
    INSERT INTO invites (team_id, created_by)
    VALUES (v_team_id, auth.uid())
    RETURNING code, expires_at INTO v_invite_code, v_invite_expires_at;

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
$function$;

COMMIT;
