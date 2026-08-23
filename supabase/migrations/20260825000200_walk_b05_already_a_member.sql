-- ============================================================================
-- WALK-B-05 — an approved member arriving at /join/CODE is sent into the team
-- ============================================================================
--
-- Half of WALK-B-05 is client-side (the pending screen must advance on its own; that is
-- `approval-watch.ts`). This is the other half, and it is the one that needs the server: a
-- student who was approved while looking at the join page, then reloaded, was told "You are
-- already a member of this team" and left standing on a join form. The walkthrough recorded it
-- as: *"after reload it is an empty join form; only navigating to any /app/* URL reveals
-- 'Select a team to continue' with the team now listed."*
--
-- The refusal is unchanged — an invite code still does not re-add anybody. What changes is that
-- it now says WHICH team, so the client can put them in it.
--
-- RETURNING THE TEAM ID IS SAFE HERE AND ONLY HERE. The caller is already a member, holds a
-- valid code for that team, and can read the row over PostgREST anyway. That is the same line
-- D3's `already_on_team` draws, and the deliberate opposite of `team_number_taken`, which
-- withholds the id precisely because the caller is NOT on the team (B21: "knowing a team's uuid
-- is the entire attack").
--
-- THE BODY BELOW IS COPIED, NOT RETYPED. `20260825000000_d3_onboarding_gate.sql` — the same
-- sprint — was rebuilt by hand from an older copy of `create_team_as_admin` and silently
-- dropped SEC-01's transaction-local flag and SEC-09's invite handling. Both were caught by the
-- db suite, but only because that function happens to be well covered. This one was produced by
-- reading the current definition out of the migration that owns it and patching exactly one
-- branch.

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

        /*
         * WALK-B-05, second half. This used to be a dead end: a student who was approved
         * while looking at the pending screen, then reloaded, was told "You are already a
         * member of this team" and left on a join form -- with no way from there into the
         * team except knowing to navigate to `/app` by hand. The exit criterion is that a
         * signed-in approved member hitting `/join/CODE` is SENT INTO the team.
         *
         * The team id is safe to return here and only here: the caller is a member of this
         * team, holds a valid code for it, and could read the row anyway. That is the same
         * line D3's `already_on_team` draws, and the opposite of `team_number_taken`, which
         * withholds the id precisely because the caller is NOT on the team.
         */
        RETURN json_build_object(
            'success', false,
            'error_code', 'already_member',
            'error', format('You are already on %s.', v_team.name),
            'team_id', v_invite.team_id,
            'team_name', v_team.name,
            'status', v_existing_member.status
        );
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

-- Signature unchanged, so the existing grants stand. Re-stated because CREATE OR REPLACE on a
-- SECURITY DEFINER function is exactly the moment to be sure, and because `REVOKE ... FROM anon`
-- alone is a no-op: EXECUTE comes from PUBLIC and `anon` is a member of it
-- (docs/environment-divergences.md §5).
REVOKE ALL ON FUNCTION public.join_team_with_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_team_with_invite(text) TO authenticated, service_role;
