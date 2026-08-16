-- FalconForge — Sprint 6: licensing enforcement, ownership transfer, versioned attestations.
--
-- THE SECOND FORWARD MIGRATION. The schema froze at the end of Sprint 3 and production holds
-- real rows, including Kevin's `platform_operators` identity and TestTeam's open-ended gift.
-- Nothing here drops or rewrites `license_grants`, `platform_operators` or `team_members`;
-- every change is additive or a LOOSENING of an existing constraint.
--
-- WHAT THIS ADDS, AND WHY
--
--   teams.pending_admin_*        Ownership transfer is a two-party handshake, not a one-click
--                               action. `transfer_team_admin` (Sprint 3) can only be called
--                               BY the outgoing admin, and the incoming admin must satisfy
--                               `enforce_member_role_eligibility` — which requires them to
--                               have accepted the terms. You cannot validly attest on
--                               somebody else's behalf, so the outgoing admin NOMINATES and
--                               the successor ACCEPTS. The nomination needs somewhere to
--                               live between those two moments.
--
--   operator_transfer_team_admin The failure this sprint exists to prevent. A retiring coach
--                               who leaves WITHOUT handing over strands the team: every
--                               remaining path to the admin role runs through
--                               `can_manage_billing`, which the departed admin alone
--                               satisfied, and the one-admin partial index blocks promoting
--                               anyone while their row still holds the role. The team keeps
--                               all its data and nobody can manage it. Only the platform
--                               operator can break that deadlock, so this is gated the same
--                               way `grant_team_license` is.
--
--   user_attestations version    A legal attestation whose history is overwritten cannot
--     in the unique key          answer "which version did they accept, and when" — the only
--                               question it exists to answer. The old key was
--                               (user_id, attestation_type), and `recordAttestation` upserts
--                               on it, so bumping a document version REPLACED the record of
--                               the previous acceptance. Widening the key keeps every
--                               version as its own row.
--
-- WHY SEATS ARE NOT ENFORCED PER MEMBER
--
-- Decided at this sprint's kickoff. Seats are PURCHASED TEAM CAPACITY and the gate is JOIN
-- APPROVAL: an admin cannot approve more members than the team is licensed for, which
-- `enforce_seat_capacity` already enforces in a BEFORE trigger. No policy consults
-- `seat_assigned`, deliberately:
--
--   * The enforcement point is then an action that is inherently ONLINE and rare (an admin
--     approving a request), rather than one that is constantly OFFLINE and hot (a student
--     writing a task at a competition). A per-member licence check in the write path would
--     put licensing on the critical path of the thing that must never fail on venue WiFi.
--   * A member who has been approved keeps working when their device knows nothing about
--     licensing, which is the offline-first requirement rather than a concession to it.
--
-- The three enforcement layers are all server-side and all already existed:
--   is_team_member()        → status = 'approved'; a pending member reaches nothing
--   team_can_write()        → an unlicensed team is read-only
--   enforce_seat_capacity() → approving over capacity is refused
--
-- This migration adds no fourth layer. It makes the second and third REACHABLE from a UI.

-- ==========================================================================
-- B25 — A CAPABILITY THAT ANSWERS "NULL" IS NOT A REFUSAL
-- ==========================================================================

/*
 * `can_manage_billing`, `can_manage_roster` and `can_manage_structure` were written as
 *
 *     SELECT current_team_role(p_team_id) = 'admin';
 *
 * and `current_team_role` returns NULL for somebody who is not an approved member of that
 * team. `NULL = 'admin'` is NULL, so the capability returns NULL rather than false, and
 * `NOT NULL` is NULL rather than true. Every guard of the shape
 *
 *     IF NOT can_manage_billing(p_team_id) THEN RETURN error; END IF;
 *
 * therefore DOES NOT FIRE for a non-member: the branch is skipped and the function proceeds
 * as though the caller were authorised. `transfer_team_admin` is exactly that shape, is
 * SECURITY DEFINER (so it does not meet RLS on the way out), and is EXECUTE-granted to
 * `authenticated` and `anon` by the schema's default privileges. A caller who is not on a
 * team could move that team's admin role.
 *
 * Found by a Sprint 6 test that expected another team's admin to be refused and got
 * `success: true`. This is B21's class of defect — a check that reads as airtight and is
 * skipped by three-valued logic — and it was invisible for the same reason: RLS coerces NULL
 * to false, so every POLICY built on these functions was and is correct. Only the plpgsql
 * guards were wrong, and `transfer_team_admin` had no caller, so nothing exercised one.
 *
 * Fixed at the root rather than at each call site. `coalesce(..., false)` in the three
 * functions makes every existing guard correct, makes every future guard correct by default,
 * and cannot change a single policy decision (NULL and false were already the same answer
 * there). The alternative — auditing each `IF NOT` — leaves the next one to be written wrong.
 *
 * `can_manage_content` was already safe: `is_team_member()` returns EXISTS, which is never
 * NULL, and `false AND anything` is false. It is left alone so the diff says only what it
 * means.
 */
CREATE OR REPLACE FUNCTION public.can_manage_billing(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT coalesce(current_team_role(p_team_id) = 'admin', false);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_roster(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT coalesce(current_team_role(p_team_id) IN ('admin', 'coach'), false);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_structure(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT coalesce(current_team_role(p_team_id) IN ('admin', 'coach'), false)
       AND team_can_write(p_team_id);
$$;

-- ==========================================================================
-- COLUMNS — the pending nomination
-- ==========================================================================

/*
 * A nomination in flight.
 *
 * On `teams` rather than in an `admin_transfers` table because there is at most one at a
 * time and it is a property OF the team, not an event log. A side table would need its own
 * RLS, its own "which row is current" question, and could drift out of step with the roster
 * it points into; a column referencing `team_members(id, team_id)` cannot point at a member
 * of a different team, and ON DELETE SET NULL means a nominee who leaves the team takes
 * their nomination with them rather than leaving a dangling promise.
 */
ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS pending_admin_member_id uuid,
    ADD COLUMN IF NOT EXISTS pending_admin_nominated_at timestamptz,
    ADD COLUMN IF NOT EXISTS pending_admin_nominated_by uuid REFERENCES users(id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'teams_pending_admin_member_fkey'
    ) THEN
        ALTER TABLE teams
            ADD CONSTRAINT teams_pending_admin_member_fkey
            FOREIGN KEY (pending_admin_member_id, id)
            REFERENCES team_members (id, team_id) ON DELETE SET NULL;
    END IF;
END $$;

COMMENT ON COLUMN teams.pending_admin_member_id IS
    'Member nominated to take the admin role, pending their own acceptance. Writable only '
    'through nominate_team_admin / accept_team_admin_nomination — see '
    'enforce_admin_nomination_authority, which stops a coach nominating themselves.';

-- ==========================================================================
-- ATTESTATION VERSIONING
-- ==========================================================================

/*
 * Widen the unique key to include `version`.
 *
 * A LOOSENING: every row that satisfied the old key satisfies the new one, so this cannot
 * fail on production data and cannot delete anything. `recordAttestation` upserts on this
 * key and is updated in the same change to name all three columns; an upsert naming only
 * two would find no matching unique index and error rather than silently misbehave.
 *
 * The DATABASE still asks only "has this person accepted these terms at all" — see
 * `enforce_member_role_eligibility`, unchanged below. Whether their acceptance is CURRENT is
 * a client question, because the current version number is a client artefact
 * (`ATTESTATION_VERSIONS` in lib/attestations.ts) and duplicating it here would create two
 * sources of truth that drift on the next legal rewrite. Consent identity: server. Consent
 * freshness: client.
 */
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_attestations_user_id_attestation_type_key'
    ) THEN
        ALTER TABLE user_attestations
            DROP CONSTRAINT user_attestations_user_id_attestation_type_key;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_attestations_user_type_version_key'
    ) THEN
        ALTER TABLE user_attestations
            ADD CONSTRAINT user_attestations_user_type_version_key
            UNIQUE (user_id, attestation_type, version);
    END IF;
END $$;

-- ==========================================================================
-- OPERATOR AUDIT
-- ==========================================================================

/*
 * What the platform operator did to somebody else's tenant.
 *
 * `operator_transfer_team_admin` overrides a team's own governance: it hands the admin role
 * to a member the outgoing admin never nominated, because the outgoing admin is gone. That is
 * the most consequential thing this platform can do to a tenant and it must leave a record
 * that neither the operator nor the team can quietly edit.
 *
 * The first draft of this recorded into `license_grants.notes` with `seats = 0` -- rejected,
 * and by the schema itself: `CHECK (seats IS NULL OR seats > 0)`. That was the right refusal
 * for a better reason than the constraint. `seats = NULL` would have meant UNLIMITED, so the
 * audit row was one un-revoke away from being a licence, and an entitlement table is a
 * strange place to learn who owns a team.
 */
CREATE TABLE IF NOT EXISTS operator_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    operator_user_id uuid NOT NULL REFERENCES users(id),
    team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    action text NOT NULL CHECK (action IN ('admin_transfer', 'license_grant', 'license_revoke')),
    -- Free-form detail: which member, which grant, why the operator was asked to step in.
    detail jsonb NOT NULL DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE operator_actions ENABLE ROW LEVEL SECURITY;

/*
 * Operators read; nobody writes through the API.
 *
 * Rows are created only by `operator_transfer_team_admin`, which is SECURITY DEFINER, so the
 * absence of an INSERT policy is the point rather than an omission: an audit trail a caller
 * can append to is not evidence. No UPDATE and no DELETE policy for the same reason.
 *
 * Deliberately NOT readable by the team. It names a platform decision about them, and the
 * default-deny rule says a table gets the narrowest audience that makes it useful.
 */
DROP POLICY IF EXISTS operator_actions_select_operator ON operator_actions;
CREATE POLICY operator_actions_select_operator ON operator_actions
    FOR SELECT USING (is_platform_operator());

CREATE INDEX IF NOT EXISTS operator_actions_team_idx ON operator_actions (team_id, created_at DESC);

GRANT SELECT ON public.operator_actions TO authenticated;

-- ==========================================================================
-- NOMINATION AUTHORITY
-- ==========================================================================

/*
 * Only the admin may nominate; only the nominee may decline.
 *
 * THIS TRIGGER IS THE SECURITY BOUNDARY, not the RPCs below it. `teams_update_manager`
 * grants UPDATE on `teams` to `can_manage_roster`, which is admin OR COACH. Without this,
 * a coach could PATCH `pending_admin_member_id` to their own member row over plain REST and
 * then call `accept_team_admin_nomination` — a two-request self-promotion to team admin that
 * never touches either RPC's authority check. The RPCs are ergonomics; this is the rule.
 *
 * Clearing is treated separately from setting. A nominee must be able to decline, and they
 * are not the admin, so "any change requires can_manage_billing" would trap them.
 */
CREATE OR REPLACE FUNCTION public.enforce_admin_nomination_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.pending_admin_member_id IS NOT DISTINCT FROM OLD.pending_admin_member_id THEN
        RETURN NEW;  -- the nomination is not what this UPDATE is changing
    END IF;

    -- The platform's own identity, as everywhere else: it bypasses RLS already, never ships
    -- to a browser, and is how `operator_transfer_team_admin` clears a stranded nomination.
    IF auth.role() = 'service_role' OR is_platform_operator() THEN
        RETURN NEW;
    END IF;

    IF NEW.pending_admin_member_id IS NULL THEN
        -- Declining. The outgoing nominee may do this; so may the admin who nominated them.
        IF can_manage_billing(NEW.id) OR EXISTS (
            SELECT 1 FROM team_members
            WHERE id = OLD.pending_admin_member_id
              AND user_id = auth.uid()
              AND managed_profile_id IS NULL
        ) THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION
            'Only the team admin or the nominee can withdraw an admin nomination'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT can_manage_billing(NEW.id) THEN
        RAISE EXCEPTION
            'Only the team admin can nominate a successor'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_admin_nomination_authority_trigger ON teams;
CREATE TRIGGER enforce_admin_nomination_authority_trigger
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION enforce_admin_nomination_authority();

-- ==========================================================================
-- TRANSFER: THE WARM PATH
-- ==========================================================================

/** How long a nomination stands before it has to be re-issued. */
CREATE OR REPLACE FUNCTION public.admin_nomination_ttl()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '14 days' $$;

/*
 * Step one of a handover: the admin names a successor.
 *
 * Validation mirrors `transfer_team_admin`'s, because a nomination that could never be
 * accepted is worse than a refusal — it looks done and quietly is not. The one check NOT
 * made here is the terms attestation: the whole point of the handshake is that the successor
 * has not accepted them yet, and `enforce_member_role_eligibility` will require it at the
 * moment of promotion.
 */
CREATE OR REPLACE FUNCTION public.nominate_team_admin(p_team_id uuid, p_new_member_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_new team_members%ROWTYPE;
BEGIN
    IF NOT can_manage_billing(p_team_id) THEN
        RETURN json_build_object('success', false, 'error', 'Only the team admin can nominate a successor');
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
    IF v_new.user_id = auth.uid() THEN
        RETURN json_build_object('success', false, 'error', 'You are already the admin of this team');
    END IF;

    UPDATE teams
       SET pending_admin_member_id = p_new_member_id,
           pending_admin_nominated_at = now(),
           pending_admin_nominated_by = auth.uid()
     WHERE id = p_team_id;

    RETURN json_build_object(
        'success', true,
        'pending_admin_member_id', p_new_member_id,
        'expires_at', now() + admin_nomination_ttl()
    );
END;
$$;

/*
 * Withdraw a nomination — the admin changing their mind, or the nominee declining.
 *
 * Authority is the trigger's, not this function's, so both callers reach one rule.
 */
CREATE OR REPLACE FUNCTION public.cancel_team_admin_nomination(p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    UPDATE teams
       SET pending_admin_member_id = NULL,
           pending_admin_nominated_at = NULL,
           pending_admin_nominated_by = NULL
     WHERE id = p_team_id;

    RETURN json_build_object('success', true);
END;
$$;

/*
 * Step two: the successor accepts, and the role moves.
 *
 * Gated on BEING THE NOMINEE rather than on `can_manage_billing` — the caller is by
 * definition not yet the admin. The demote-then-promote order and the single transaction are
 * `transfer_team_admin`'s reasoning, unchanged: the one-admin partial index permits no
 * instant with two, and an interrupted transfer that left a team with none is the failure
 * mode worth writing a function to avoid.
 *
 * The 18+ rule and the terms attestation are NOT checked here. They are
 * `enforce_member_role_eligibility`'s, which fires on the promotion UPDATE, so there stays
 * exactly one definition of who may hold this role. A nominee who has not accepted the terms
 * gets that trigger's error, which is what the UI turns into the attestation step.
 */
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
    IF v_current_admin_id IS NOT NULL THEN
        UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    END IF;
    UPDATE team_members SET role = 'admin' WHERE id = v_me.id;

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

-- ==========================================================================
-- TRANSFER: THE COLD PATH
-- ==========================================================================

/*
 * Reassign a stranded team's admin role, as the platform operator.
 *
 * WHY THIS CANNOT BE DONE ANY OTHER WAY. Every warm path requires the outgoing admin to act:
 * `transfer_team_admin` and `nominate_team_admin` both check `can_manage_billing`, and
 * `accept_team_admin_nomination` needs a nomination that only the admin can create. A coach
 * who retires without handing over therefore leaves a team where all the data is intact,
 * every remaining member is a coach or below, and NO API call can produce an admin. The
 * one-admin partial index also blocks promoting anybody while their row still holds the role
 * (`status <> 'removed'`), so even a direct roster edit cannot fix it.
 *
 * `v_current_admin_id IS NULL` is therefore a supported case, not a guard clause: a team
 * whose admin row was deleted outright has no admin to demote and still needs one.
 *
 * The successor's eligibility is still `enforce_member_role_eligibility`'s to judge. The
 * operator can choose WHO, never bypass WHAT the role requires.
 */
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

    IF v_current_admin_id IS NOT NULL THEN
        UPDATE team_members SET role = 'coach' WHERE id = v_current_admin_id;
    END IF;
    UPDATE team_members SET role = 'admin' WHERE id = p_new_member_id;

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

-- ==========================================================================
-- SEAT CAPACITY, READ-ONLY
-- ==========================================================================

/*
 * "Can this team approve one more member?" — the question the admin console asks before
 * offering an Approve button, answered by the same arithmetic the trigger enforces.
 *
 * A convenience for the UI, NOT a second definition of the rule: `enforce_seat_capacity` is
 * still what refuses the write, and the console handles its error even when this said yes
 * (two admins approving at once from different devices is exactly that race). Without it the
 * client would have to reimplement the grant-summing query and would get the
 * unlimited-versus-zero distinction wrong the first time.
 */
CREATE OR REPLACE FUNCTION public.team_seats_remaining(p_team_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    WITH inforce AS (
        SELECT coalesce(bool_or(g.seats IS NULL), false) AS unlimited,
               CASE WHEN bool_or(g.seats IS NULL) THEN NULL
                    ELSE sum(g.seats)::integer END AS total
          FROM license_grants g
         WHERE g.team_id = p_team_id
           AND g.revoked_at IS NULL
           AND g.valid_from <= now()
           AND (g.valid_until IS NULL OR g.valid_until > now())
    ), used AS (
        SELECT count(*)::integer AS n
          FROM team_members m
         WHERE m.team_id = p_team_id
           AND m.status = 'approved'
           AND m.seat_assigned
    )
    -- NULL means "no limit", which is not the same answer as a number and must not be
    -- flattened into a large one.
    SELECT CASE WHEN (SELECT unlimited FROM inforce) THEN NULL
                ELSE greatest(coalesce((SELECT total FROM inforce), 0) - (SELECT n FROM used), 0)
           END;
$$;

-- ==========================================================================
-- GRANTS
-- ==========================================================================

-- Matching `20260816000500_v2_grants.sql`: PostgREST reaches these as `authenticated`, and a
-- function it cannot execute is invisible rather than merely refused.
GRANT EXECUTE ON FUNCTION public.nominate_team_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_team_admin_nomination(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_team_admin_nomination(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_transfer_team_admin(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_seats_remaining(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_nomination_ttl() TO authenticated;
