-- Sprint 9: what a guardian can see, how a child joins, and how a child graduates.
--
-- ==========================================================================
-- 1. A THIRD PREDICATE, RATHER THAN WIDENING THE TWO THAT EXIST
-- ==========================================================================
--
-- The plan's parking lot is explicit about the trap here:
--
--     "Guardian visibility is deliberately narrow, and depends on two predicates agreeing.
--      `get_user_team_ids` and `is_team_member` both exclude managed rows; both have to be
--      wrong before anything leaks, which is why breaking only one of them left the guardian
--      tests green during adversarial verification. Widening guardian access is a product
--      decision for Sprint 9 -- if it is widened, change both and re-check the roster
--      assertion."
--
-- Section 3 requires a guardian to see "their children -- consents given, upcoming meetings,
-- attendance", so access DOES have to widen. It is widened with a NEW predicate used on three
-- tables, and `get_user_team_ids` / `is_team_member` are left exactly as they are.
--
-- That choice is the whole design. Making a guardian an `is_team_member` would have been one
-- line and would have handed them:
--
--   * the full roster -- every adult's and every child's name and email, through
--     `team_members_select`;
--   * every OTHER managed child's profile, through `managed_profiles_select_teammates`, which
--     is the case Sprint 3 flagged and which only stays shut because a guardian's
--     `get_user_team_ids` is empty;
--   * invite codes, which are credentials (`invites_select_member`);
--   * and every season, sub-team, task, scouting report and match plan the team owns.
--
-- None of that is a guardian's business, and `docs/failure-modes.md` section 6 is five sprints
-- of exactly this: the widest-brush default, granted to unblock something, narrowed only later.
-- Both privilege escalations in this project's history came out of it.
--
-- ==========================================================================
-- 2. THE SIBLING BUG THIS ALSO FIXES
-- ==========================================================================
--
-- `current_team_member_id` is `SELECT id FROM team_members WHERE team_id = ... AND user_id =
-- auth.uid() AND status = 'approved' LIMIT 1` -- no ORDER BY, and no exclusion of managed rows.
--
-- For an ordinary member that is fine: they hold one row. For a GUARDIAN it returns one of
-- their children arbitrarily, because there is no unique constraint on `(team_id, user_id)` and
-- the hand-off confirms siblings are supported ("one guardian can hold two children on the same
-- team -- siblings work, and each consumes a seat"). So `meeting_attendance_select_member`
-- already granted a guardian access to exactly one child's attendance, chosen by whatever order
-- Postgres felt like returning -- and it could differ between two runs of the same query.
--
-- That is `docs/failure-modes.md` section 13, an ordering the storage layer never promised, and
-- it is live today. It has hurt nobody only because no guardian has ever signed in. Sprint 9 is
-- the sprint that changes that, so the attendance policy below is rewritten to name ALL of a
-- guardian's children on the team rather than leaning on that LIMIT 1.

-- --------------------------------------------------------------------------
-- Predicates
-- --------------------------------------------------------------------------

/**
 * The member rows the current user holds AS A GUARDIAN on this team.
 *
 * Plural, and that is the point -- see the sibling note above. Returns nothing for an ordinary
 * member, which is what keeps it additive when OR'd into a policy.
 */
CREATE OR REPLACE FUNCTION public.guardian_member_ids(p_team_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT id
    FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND managed_profile_id IS NOT NULL
      AND status = 'approved';
$$;

/**
 * Is the current user the guardian of an approved child on this team?
 *
 * `EXISTS` over the above. Deliberately requires `status = 'approved'`: a guardian whose join
 * request is still pending has nothing to see yet, and letting them read the schedule before
 * the admin has approved the child would make approval decorative.
 */
CREATE OR REPLACE FUNCTION public.is_team_guardian(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (SELECT 1 FROM guardian_member_ids(p_team_id));
$$;

-- --------------------------------------------------------------------------
-- Policies
-- --------------------------------------------------------------------------
--
-- Policies for one verb OR together, so a SECOND policy would widen what is permitted without
-- the existing one mentioning it. This file therefore REWRITES each predicate in place, which
-- is the convention `20260820000000_v2_meetings.sql` set for the same reason -- one place to
-- read the effective rule, instead of "the union of five half-remembered intentions" that
-- `team_members` had in V1.

-- The team's name and number, so the guardian view can say which team their child is on.
-- Nothing else about the team is exposed by this table.
DROP POLICY IF EXISTS teams_select_member ON teams;
CREATE POLICY teams_select_member ON teams
    FOR SELECT USING (is_team_member(id) OR is_team_guardian(id));

-- The schedule. A guardian needs to know when their child is expected, which is the single
-- most useful thing this view does. The schedule is not sensitive -- it is already visible to
-- every student on the team.
DROP POLICY IF EXISTS meetings_select_member ON meetings;
CREATE POLICY meetings_select_member ON meetings
    FOR SELECT USING (is_team_member(team_id) OR is_team_guardian(team_id));

/*
 * Attendance: a coach reads the team's, a member reads their own, a guardian reads their
 * CHILDREN'S -- all of them, not whichever one LIMIT 1 happened to pick.
 *
 * `current_team_member_id` is kept for the ordinary-member branch rather than replaced, so this
 * change cannot alter what a student sees. The guardian branch is a separate disjunct that
 * returns the empty set for anyone who is not a guardian.
 */
DROP POLICY IF EXISTS meeting_attendance_select_member ON meeting_attendance;
CREATE POLICY meeting_attendance_select_member ON meeting_attendance
    FOR SELECT USING (
        can_manage_meetings(team_id)
        OR team_member_id = current_team_member_id(team_id)
        OR team_member_id IN (SELECT guardian_member_ids(team_id))
    );

-- NOTHING ELSE IS WIDENED. `team_members_select`, `managed_profiles_select_teammates`,
-- `invites_select_member`, `users_select_teammates`, `seasons_select_member` and every content
-- table keep `is_team_member`, so a guardian still cannot read the roster, other children's
-- profiles, invite codes, or any of the team's work. Asserted behaviourally in
-- `guardian-access.rls.db.test.ts`.

-- ==========================================================================
-- 3. JOINING ON A CHILD'S BEHALF
-- ==========================================================================

/*
 * The guardian joins a team FOR a child, with an ordinary invite code.
 *
 * Section 3: the guardian creates the profile, never the coach. The coach shares the same
 * invite code they share with everybody, the guardian signs up, adds their own child, and joins
 * with it; the admin approves exactly as for any other member. The coach's workflow does not
 * change at all, which is why this is a sibling of `join_team_with_invite` rather than a
 * different mechanism -- same codes, same `pending` status, same approval.
 *
 * THE CONSENT CHECK IS THE POINT, and it is a gate WITH a door: `createGuardianSlice` records
 * `coppa_data_collection` in the same action that creates the profile, so by the time a child
 * can be selected here the consent exists. `docs/failure-modes.md` section 7 is four sprints of
 * the opposite -- `transfer_team_admin` refusing without an attestation nothing ever wrote, and
 * `SIGNUP_REQUIRED_ATTESTATIONS` checked by one component and written by none. Refusing here
 * with no writer anywhere would have been that defect again.
 */
CREATE OR REPLACE FUNCTION public.join_team_with_invite_for_child(
    invite_code text,
    p_managed_profile_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_invite invites%ROWTYPE;
    v_team teams%ROWTYPE;
    v_profile managed_profiles%ROWTYPE;
    v_user users%ROWTYPE;
    v_existing team_members%ROWTYPE;
    v_new_member_id uuid;
BEGIN
    -- The caller must own the profile. `is_profile_guardian` is SECURITY DEFINER over
    -- `guardian_user_id = auth.uid()`, so naming somebody else's child fails here rather than
    -- at the insert -- and naming YOUR OWN id is the shape B21 taught this project to try.
    IF NOT is_profile_guardian(p_managed_profile_id) THEN
        RETURN json_build_object('success', false, 'error', 'That is not your child''s profile');
    END IF;

    SELECT * INTO v_profile FROM managed_profiles WHERE id = p_managed_profile_id;

    IF NOT EXISTS (
        SELECT 1 FROM guardian_consents
        WHERE managed_profile_id = p_managed_profile_id
          AND consent_type = 'coppa_data_collection'
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'This child has no consent on record. Add it before joining a team.'
        );
    END IF;

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

    -- One row per CHILD per team. There is deliberately no unique constraint on
    -- `(team_id, user_id)` -- that is what lets a guardian hold two children on one team --
    -- so the duplicate check is per profile.
    SELECT * INTO v_existing
    FROM team_members
    WHERE team_id = v_invite.team_id
      AND managed_profile_id = p_managed_profile_id;

    IF v_existing.id IS NOT NULL THEN
        IF v_existing.status = 'removed' THEN
            UPDATE team_members SET status = 'pending' WHERE id = v_existing.id;
            UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;
            RETURN json_build_object(
                'success', true, 'team_id', v_invite.team_id, 'team_name', v_team.name,
                'member_id', v_existing.id, 'status', 'pending'
            );
        END IF;
        RETURN json_build_object(
            'success', false, 'error', 'This child is already on that team'
        );
    END IF;

    /*
     * `full_name` is the CHILD's; `email` is the GUARDIAN's.
     *
     * That combination is not an oversight -- it is the COPPA model made concrete. The roster
     * shows the child, because the child is who turns up; the contactable address is the
     * guardian's, because the child has no account and no email of their own that we hold.
     * `sync_user_to_team_members` only touches rows it matches by user id and name, and a
     * managed row's name is not the guardian's, so it does not overwrite this.
     */
    INSERT INTO team_members (
        team_id, user_id, managed_profile_id, role, status, full_name, email
    )
    VALUES (
        v_invite.team_id, auth.uid(), p_managed_profile_id, 'student', 'pending',
        v_profile.full_name, v_user.email
    )
    RETURNING id INTO v_new_member_id;

    UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;

    RETURN json_build_object(
        'success', true, 'team_id', v_invite.team_id, 'team_name', v_team.name,
        'member_id', v_new_member_id, 'status', 'pending'
    );
END;
$$;

-- ==========================================================================
-- 4. PROMOTION -- GRADUATING IN PLACE
-- ==========================================================================
--
-- Section 3: "It graduates in place: the `team_members` row keeps its `id` and only changes
-- which identity it points at (`user_id` guardian -> the new user, `managed_profile_id` ->
-- NULL), so attendance and task history survive untouched -- `meeting_attendance` is unique on
-- `(meeting_id, team_member_id)` -- with no re-approval and no seat churn. The
-- `managed_profiles` row and its consents are retained as the record of why the child was
-- rostered."
--
-- WHY A CLAIM CODE RATHER THAN AN EMAIL LOOKUP.
--
-- Something has to connect the roster row to an account that did not exist when the row was
-- made. Taking the child's email address and looking it up would be fewer moving parts, and it
-- makes this RPC an account-enumeration oracle -- ask it about any address and the error
-- message tells you whether that person has a FalconForge account. It would also have the
-- guardian asserting the child's identity rather than the child.
--
-- So it is a two-party handshake, the shape section 3 already reaches for elsewhere ("the fix
-- reuses Sprint 6's two-party handshake"): the guardian issues a code, the child signs up in
-- their own name and accepts the documents themselves, and the child redeems it. Nobody creates
-- an account for anybody.

ALTER TABLE managed_profiles
    ADD COLUMN promotion_code text UNIQUE
        CHECK (promotion_code IS NULL OR char_length(promotion_code) = 8);

COMMENT ON COLUMN managed_profiles.promotion_code IS
    'Set while a promotion is offered; cleared when it is redeemed or withdrawn. NULL is the '
    'normal state, which is why the UNIQUE index tolerates many NULLs.';

/*
 * THE CLIENT MAY READ THIS COLUMN AND MAY NOT WRITE IT.
 *
 * `managed_profiles_guardian_all` is `FOR ALL USING (guardian_user_id = auth.uid())`, so
 * without this a guardian could PATCH `promotion_code` directly to a value of their choosing --
 * 'AAAAAAAA' -- and a claim code is a credential. Whoever redeems it takes the child's place on
 * the roster, so a guessable one is a stranger one request away from a team they were never
 * invited to. "The UI only offers the generated code" is not access control; that is
 * `docs/failure-modes.md` section 6, and this project has shipped that mistake twice.
 *
 * RLS cannot express a column, but GRANTs can. Postgres has no way to subtract a column from a
 * table-level privilege, so the table-level INSERT/UPDATE is revoked and re-granted per column.
 * The list is therefore hand-maintained -- section 12 -- so it is asserted behaviourally rather
 * than trusted: `guardian-access.rls.db.test.ts` writes every other column as a guardian and
 * requires each to succeed, and writes this one and requires it to fail. A column added later
 * and forgotten here shows up as a refused write in that test, not as silence.
 *
 * The SECURITY DEFINER functions above run as the table owner and are unaffected, which is what
 * makes "generated server-side, never client-chosen" true rather than aspirational.
 *
 * THE UPDATE LIST IS EVERY COLUMN BUT ONE, and it has to be. The sync drain pushes with
 * `upsert(..., { onConflict: 'id' })`, which Postgres compiles to `INSERT ... ON CONFLICT (id)
 * DO UPDATE SET ...` over every column the client sent -- so UPDATE on `id` and
 * `guardian_user_id` is required for an ordinary offline write to land at all. Granting them
 * costs nothing: `managed_profiles_guardian_all` has `WITH CHECK (guardian_user_id =
 * auth.uid())`, so a guardian still cannot hand their child to somebody else, and re-pointing
 * their own row at themselves is a no-op.
 *
 * Found by running the real write path, not by reasoning about it: a first draft granted UPDATE
 * on `(full_name, notes, updated_at)` only, every policy test passed -- they issue plain
 * UPDATEs -- and `guardian-sync.db.test.ts` went red with three items stranded in the queue,
 * because the app does not write the way those tests do.
 */
REVOKE INSERT, UPDATE ON managed_profiles FROM authenticated;
GRANT INSERT (id, guardian_user_id, full_name, notes, created_at, updated_at)
    ON managed_profiles TO authenticated;
GRANT UPDATE (id, guardian_user_id, full_name, notes, created_at, updated_at)
    ON managed_profiles TO authenticated;

/**
 * Offer a child their own login. Guardian-initiated, and reversible until redeemed.
 *
 * Returns the code for the guardian to hand over. Re-issuing replaces the previous code, so a
 * code given to the wrong person can be revoked by generating another.
 */
CREATE OR REPLACE FUNCTION public.offer_managed_profile_promotion(p_managed_profile_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_code text;
BEGIN
    IF NOT is_profile_guardian(p_managed_profile_id) THEN
        RETURN json_build_object('success', false, 'error', 'That is not your child''s profile');
    END IF;

    -- 8 chars from a 32-symbol alphabet with no look-alikes (no O/0, I/1). Generated
    -- server-side: a client-chosen code is a client-chosen credential.
    SELECT string_agg(
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
               (floor(random() * 32) + 1)::int, 1), '')
    INTO v_code
    FROM generate_series(1, 8);

    UPDATE managed_profiles SET promotion_code = v_code WHERE id = p_managed_profile_id;

    RETURN json_build_object('success', true, 'code', v_code);
END;
$$;

/** Withdraw an offer that has not been redeemed. */
CREATE OR REPLACE FUNCTION public.withdraw_managed_profile_promotion(p_managed_profile_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT is_profile_guardian(p_managed_profile_id) THEN
        RETURN json_build_object('success', false, 'error', 'That is not your child''s profile');
    END IF;

    UPDATE managed_profiles SET promotion_code = NULL WHERE id = p_managed_profile_id;
    RETURN json_build_object('success', true);
END;
$$;

/**
 * Redeem a promotion code, AS THE CHILD, from their own new account.
 *
 * This is the graduation. Every `team_members` row the guardian holds for this profile has its
 * `user_id` repointed and its `managed_profile_id` cleared, KEEPING ITS ID -- which is what
 * preserves attendance (`meeting_attendance` is unique on `(meeting_id, team_member_id)` and
 * references it), task assignments, and the approval that was already given.
 *
 * What deliberately does NOT happen: no new row, no re-approval, no seat released and
 * reacquired, and the `managed_profiles` row and its consents are left in place as the record
 * of why the child was rostered in the first place.
 */
CREATE OR REPLACE FUNCTION public.claim_managed_profile(p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_profile managed_profiles%ROWTYPE;
    v_user users%ROWTYPE;
    v_moved integer;
BEGIN
    SELECT * INTO v_user FROM users WHERE id = auth.uid();
    IF v_user.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Please finish setting up your account first');
    END IF;

    /*
     * An under-13 cannot hold an account, so they cannot be the one redeeming this. Checked
     * with an explicit `= 'under_13'` rather than `<> '13_to_17'` so that a NULL classification
     * -- an account midway through setup -- falls to the guard above rather than through this
     * one. Absence is not an answer (failure-modes §4).
     */
    IF v_user.age_classification = 'under_13' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Members under 13 take part through a guardian-managed profile.'
        );
    END IF;

    SELECT * INTO v_profile FROM managed_profiles
    WHERE promotion_code = upper(trim(p_code)) AND promotion_code IS NOT NULL;

    IF v_profile.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'That code is not valid');
    END IF;

    IF v_profile.guardian_user_id = auth.uid() THEN
        RETURN json_build_object(
            'success', false,
            'error', 'This code is for your child to use on their own account, not yours.'
        );
    END IF;

    /*
     * The graduation itself. `id` is untouched by construction -- it is not in the SET list.
     *
     * Guarded against the one shape that would corrupt a roster: if the child is ALREADY a
     * member of that team in their own right, repointing would give them two rows on one team.
     * Refuse rather than merge; a merge would have to choose which row's history to keep, and
     * losing attendance is the exact thing this function exists to prevent.
     */
    IF EXISTS (
        SELECT 1
        FROM team_members mine
        JOIN team_members theirs ON theirs.team_id = mine.team_id
        WHERE mine.managed_profile_id = v_profile.id
          AND theirs.user_id = auth.uid()
          AND theirs.managed_profile_id IS NULL
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'You are already a member of that team with your own account.'
        );
    END IF;

    UPDATE team_members
    SET user_id = auth.uid(),
        managed_profile_id = NULL,
        full_name = COALESCE(v_user.full_name, full_name),
        email = v_user.email
    WHERE managed_profile_id = v_profile.id;

    GET DIAGNOSTICS v_moved = ROW_COUNT;

    -- The code is single-use. Cleared inside the same transaction as the transfer, so a
    -- double-redeem cannot move rows that have already moved.
    UPDATE managed_profiles SET promotion_code = NULL WHERE id = v_profile.id;

    RETURN json_build_object('success', true, 'memberships_moved', v_moved);
END;
$$;

-- --------------------------------------------------------------------------
-- Grants
-- --------------------------------------------------------------------------
--
-- `authenticated` only. `anon` is granted nothing: `20260819000000_revoke_anon_execute.sql`
-- exists because `GRANT ALL ON ALL FUNCTIONS TO anon` once made every RPC in the schema --
-- team administration and licensing included -- callable by an unauthenticated stranger, and
-- B25 was an outsider reaching a SECURITY DEFINER RPC that trusted a NULL role. Every function
-- here is SECURITY DEFINER and every one of them starts by asking who the caller is.
REVOKE ALL ON FUNCTION public.join_team_with_invite_for_child(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.offer_managed_profile_promotion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_managed_profile_promotion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_managed_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guardian_member_ids(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_team_guardian(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.join_team_with_invite_for_child(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.offer_managed_profile_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_managed_profile_promotion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_managed_profile(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_member_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_guardian(uuid) TO authenticated;
