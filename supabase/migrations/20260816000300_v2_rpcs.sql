-- FalconForge V2 — client-callable functions, and the triggers that hold the invariants
-- the type system cannot.

-- ==========================================================================
-- TRIGGER FUNCTIONS
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

/*
 * Mirror auth.users into public.users on signup and on any auth-side change.
 *
 * COALESCE on every field so a later auth event with sparse metadata cannot blank a profile
 * the user has since filled in.
 */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    INSERT INTO users (id, email, full_name, avatar_url, age_classification)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'age_classification'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, users.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        age_classification = COALESCE(EXCLUDED.age_classification, users.age_classification),
        updated_at = now();

    IF NEW.raw_user_meta_data->>'privacy_accepted' = 'true' THEN
        INSERT INTO user_attestations (user_id, attestation_type, version)
        VALUES (NEW.id, 'privacy_and_guidelines', '1.0')
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

/*
 * Keep the denormalised roster display fields in step with the profile.
 *
 * `managed_profile_id IS NULL` is new in V2 and it matters: a guardian's membership rows for
 * their children carry the guardian's `user_id`, so without this filter renaming yourself
 * would rename every child you are responsible for.
 */
CREATE OR REPLACE FUNCTION public.sync_user_to_team_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    END IF;

    RETURN NEW;
END;
$$;

/*
 * Who may hold which role.
 *
 * The business model puts an age floor under every role that carries responsibility: the
 * primary admin is 18+ and attests to the terms and to responsibility for the team's use of
 * the platform; coaches and mentors are 18+. Students have no floor, and a managed profile
 * is a child and therefore always a student (also a CHECK constraint, kept here as a clear
 * error rather than a constraint-violation string).
 *
 * Enforced in the DATABASE, at the moment the role is granted, because the client-side
 * version of this check is a dropdown that omits an option.
 */
CREATE OR REPLACE FUNCTION public.enforce_member_role_eligibility()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_age text;
BEGIN
    -- Only look when the role is actually being granted or changed.
    IF TG_OP = 'UPDATE'
       AND NEW.role IS NOT DISTINCT FROM OLD.role
       AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
        RETURN NEW;
    END IF;

    IF NEW.managed_profile_id IS NOT NULL THEN
        IF NEW.role <> 'student' THEN
            RAISE EXCEPTION
                'A managed profile can only be a student (attempted role: %)', NEW.role
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.role IN ('admin', 'coach', 'mentor') THEN
        SELECT age_classification INTO v_age FROM users WHERE id = NEW.user_id;

        IF v_age IS DISTINCT FROM '18_plus' THEN
            RAISE EXCEPTION
                'The % role requires an 18+ account (this account is: %)',
                NEW.role, COALESCE(v_age, 'unclassified')
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- The primary admin additionally has to have accepted the terms and the responsibility
    -- that comes with running a team. `coach_terms` is the combined terms + billing + COPPA
    -- attestation the create-team flow records immediately before calling
    -- `create_team_as_admin`; `terms` is accepted as the equivalent for a transfer.
    IF NEW.role = 'admin' THEN
        IF NOT EXISTS (
            SELECT 1 FROM user_attestations
            WHERE user_id = NEW.user_id
              AND attestation_type IN ('coach_terms', 'terms')
        ) THEN
            RAISE EXCEPTION
                'The team admin must accept the terms of service before taking the role'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

/*
 * Who may assign a seat, and how many there are to assign.
 *
 * Both halves live in a trigger rather than a policy because RLS cannot express either one.
 * A policy decides whether a ROW may be written; these are questions about a single COLUMN
 * (`seat_assigned` changed) and about the whole TABLE (how many seats are already in use).
 *
 * AUTHORITY. Seats are a billing decision, and the business model puts billing entirely with
 * the primary admin — they register the team, accept responsibility for it, and pay for it.
 * `can_manage_roster` (admin or coach) governs the rest of the membership row, so without
 * this check a coach could hand out the team's licensed seats.
 *
 * The INSERT case matters as much as the UPDATE one: without it a coach could delete a
 * member and re-insert them with `seat_assigned = true`, which is the same escalation with
 * an extra step. `create_team_as_admin` therefore inserts its admin unseated and assigns the
 * seat immediately afterwards, by which point the caller IS the team's admin and the check
 * passes on its own terms rather than through an exemption.
 *
 * CAPACITY. An unlimited grant (`seats IS NULL`) short-circuits, which is what every beta
 * team has.
 */
CREATE OR REPLACE FUNCTION public.enforce_seat_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_unlimited boolean;
    v_total integer;
    v_used integer;
BEGIN
    -- Releasing a seat is not a billing decision and needs no authority beyond the roster
    -- rights the row already required.
    IF NOT NEW.seat_assigned THEN
        RETURN NEW;
    END IF;

    -- Granting one is. Anything that turns `seat_assigned` on -- an INSERT that arrives with
    -- it set, or an UPDATE that flips it -- has to come from the admin.
    --
    -- `service_role` is exempt, and has to be. It is the platform's own identity: it already
    -- bypasses RLS everywhere, it is not reachable from the browser (the key never ships to
    -- a client), and it is what Stripe's webhook will assign seats with in Sprint 10. A
    -- trigger that blocked it would not be adding a boundary, only breaking the one caller
    -- that legitimately acts for the platform rather than for a user.
    IF (TG_OP = 'INSERT' OR NOT OLD.seat_assigned) AND auth.role() IS DISTINCT FROM 'service_role' THEN
        IF NOT can_manage_billing(NEW.team_id) THEN
            RAISE EXCEPTION
                'Only the team admin can assign a licensed seat'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.seat_assigned AND NEW.status = OLD.status THEN
        RETURN NEW;  -- already held a seat; nothing new is being consumed
    END IF;
    IF NEW.status <> 'approved' THEN
        RETURN NEW;  -- a pending or removed member does not occupy a seat
    END IF;

    SELECT coalesce(bool_or(g.seats IS NULL), false),
           CASE WHEN bool_or(g.seats IS NULL) THEN NULL ELSE sum(g.seats)::integer END
      INTO v_unlimited, v_total
    FROM license_grants g
    WHERE g.team_id = NEW.team_id
      AND g.revoked_at IS NULL
      AND g.valid_from <= now()
      AND (g.valid_until IS NULL OR g.valid_until > now());

    IF v_unlimited THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_used
    FROM team_members m
    WHERE m.team_id = NEW.team_id
      AND m.status = 'approved'
      AND m.seat_assigned
      AND m.id <> NEW.id;

    IF v_used >= coalesce(v_total, 0) THEN
        RAISE EXCEPTION
            'No licensed seats available for this team (% of % in use)',
            v_used, coalesce(v_total, 0)
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- ==========================================================================
-- TRIGGERS
-- ==========================================================================

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'managed_profiles', 'teams', 'team_members', 'license_grants',
        'seasons', 'sub_teams', 'tasks', 'scouting_reports', 'match_plans',
        'checklists', 'meetings', 'meeting_attendance'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER update_%1$s_updated_at BEFORE UPDATE ON %1$I
                 FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
    END LOOP;
END $$;

CREATE TRIGGER on_user_profile_update
    AFTER UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION sync_user_to_team_members();

CREATE TRIGGER enforce_member_role_eligibility_trigger
    BEFORE INSERT OR UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION enforce_member_role_eligibility();

CREATE TRIGGER enforce_seat_capacity_trigger
    BEFORE INSERT OR UPDATE ON team_members
    FOR EACH ROW EXECUTE FUNCTION enforce_seat_capacity();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ==========================================================================
-- CLIENT-CALLABLE FUNCTIONS
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.update_user_age_classification(classification text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF classification NOT IN ('under_13', '13_to_17', '18_plus') THEN
        RETURN json_build_object('success', false, 'error', 'Invalid age classification');
    END IF;

    UPDATE users
    SET age_classification = classification, updated_at = now()
    WHERE id = auth.uid();

    RETURN json_build_object('success', true);
END;
$$;

/*
 * Register a team.
 *
 * Renamed from `create_team_as_coach`: the person who registers a team is the PRIMARY ADMIN
 * — one per team, 18+, attested, solely responsible for billing and membership. "Coach" is
 * now a distinct, non-billing role, and calling the creator one was the source of the
 * schema's four roles being collapsed to a single `isCoach` boolean in the client.
 *
 * `season_name` is a REQUIRED argument. V1 hardcoded `'Demo Season'` here, which is how
 * every real team's first season came to be called that.
 *
 * THE TRIAL GRANT is the one piece of this that is temporary. A team with no licence is
 * read-only, so self-serve registration has to leave the team entitled or the app is dead on
 * arrival. Beta teams get 90 unlimited days, and the platform operator replaces that with a
 * real gift (`grant_team_license`) or Stripe replaces it in Sprint 10. When billing goes
 * live, delete the grant block and registration becomes "create team, then pay".
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
    INSERT INTO team_members (team_id, user_id, role, status, full_name, email)
    VALUES (v_team_id, auth.uid(), 'admin', 'approved', v_user.full_name, v_user.email)
    RETURNING id INTO v_member_id;

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

/*
 * Join a team with an invite code.
 *
 * SECURITY DEFINER, and it is the ONLY way a membership row comes into existence for
 * somebody who is not already on the team's roster — see B21 in the RLS migration. The new
 * member is PENDING: an invite code gets you into the queue, not onto the team.
 */
CREATE OR REPLACE FUNCTION public.join_team_with_invite(invite_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invite invites%ROWTYPE;
    v_team teams%ROWTYPE;
    v_existing_member team_members%ROWTYPE;
    v_user users%ROWTYPE;
    v_new_member_id uuid;
BEGIN
    SELECT * INTO v_invite
    FROM invites
    WHERE code = invite_code
      AND (expires_at IS NULL OR expires_at > now());

    IF v_invite.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid or expired invite code');
    END IF;

    IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
        RETURN json_build_object('success', false, 'error', 'This invite code has been used up');
    END IF;

    SELECT * INTO v_team FROM teams WHERE id = v_invite.team_id;
    SELECT * INTO v_user FROM users WHERE id = auth.uid();

    IF v_user.id IS NULL OR v_user.age_classification IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Please complete your account setup first');
    END IF;

    -- COPPA: an under-13 has no account of their own to join with. The membership belongs to
    -- a `managed_profile` created by their guardian, which is a flow the guardian UI (Sprint
    -- 9) builds. Until then this is still a dead end, but the schema behind it now exists.
    IF v_user.age_classification = 'under_13' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Members under 13 join through a guardian-managed profile. Ask your guardian to contact the team admin.'
        );
    END IF;

    SELECT * INTO v_existing_member
    FROM team_members
    WHERE team_id = v_invite.team_id
      AND user_id = auth.uid()
      AND managed_profile_id IS NULL;

    IF v_existing_member.id IS NOT NULL THEN
        IF v_existing_member.status = 'removed' THEN
            UPDATE team_members SET status = 'pending' WHERE id = v_existing_member.id;
            UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;

            RETURN json_build_object(
                'success', true,
                'team_id', v_invite.team_id,
                'team_name', v_team.name,
                'member_id', v_existing_member.id,
                'status', 'pending'
            );
        END IF;

        RETURN json_build_object('success', false, 'error', 'You are already a member of this team');
    END IF;

    INSERT INTO team_members (team_id, user_id, role, status, full_name, email)
    VALUES (v_invite.team_id, auth.uid(), 'student', 'pending', v_user.full_name, v_user.email)
    RETURNING id INTO v_new_member_id;

    UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;

    RETURN json_build_object(
        'success', true,
        'team_id', v_invite.team_id,
        'team_name', v_team.name,
        'member_id', v_new_member_id,
        'status', 'pending'
    );
END;
$$;

/*
 * Gift a team access. The platform operator's path, and the only write to `license_grants`
 * reachable through the API — the table has no write policy at all.
 *
 * `p_seats => NULL` is unlimited; `p_valid_until => NULL` is open-ended.
 */
CREATE OR REPLACE FUNCTION public.grant_team_license(
    p_team_id uuid,
    p_seats integer DEFAULT NULL,
    p_valid_until timestamptz DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_grant_id uuid;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not authorized');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id) THEN
        RETURN json_build_object('success', false, 'error', 'No such team');
    END IF;

    INSERT INTO license_grants (team_id, source, seats, valid_until, created_by, notes)
    VALUES (p_team_id, 'gift', p_seats, p_valid_until, auth.uid(), p_notes)
    RETURNING id INTO v_grant_id;

    RETURN json_build_object('success', true, 'grant_id', v_grant_id);
END;
$$;

/*
 * Move the admin role to another member.
 *
 * Has to be a function: `team_members_one_admin_per_team` is a unique index, so promoting
 * before demoting fails, and the client cannot be trusted to get the order right (or to do
 * both at all — an interrupted transfer with no admin is the failure mode that leaves a team
 * unable to manage itself). Both statements here run in one transaction.
 *
 * The incoming admin must satisfy the same eligibility rules as an original one; the
 * `enforce_member_role_eligibility` trigger checks that rather than this function repeating
 * it, so there is exactly one definition of who may be an admin.
 */
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
    UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    UPDATE team_members SET role = 'admin' WHERE id = p_new_member_id;

    RETURN json_build_object('success', true, 'admin_member_id', p_new_member_id);
END;
$$;
