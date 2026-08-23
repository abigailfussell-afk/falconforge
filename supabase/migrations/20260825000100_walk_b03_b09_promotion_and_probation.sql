-- ============================================================================
-- WALK-B-03 — the promotion leaves a record
-- WALK-B-09 — a self-serve team is not told it was given a gift
-- ============================================================================

-- ---------------------------------------------------------------------------
-- WALK-B-03: managed_profiles remembers that the child got their own login
-- ---------------------------------------------------------------------------
--
-- `claim_managed_profile` moved the membership and cleared `promotion_code`, and that was all
-- it recorded. `managed_profiles` had no column that could say the promotion had happened, so
-- `GuardianView` — which renders a profile with no membership as "Not on a team yet — join with
-- the code their coach gave you" — showed the parent who had just handed the account over that
-- their child had apparently been dropped from the team, with a fresh "Give them their own
-- login" button underneath. The screen contradicted its own "Nothing is lost" copy.
--
-- It also let the guardian mint a SECOND claim code for a profile that no longer holds a
-- membership; the walkthrough recorded that it did not test what a second account redeeming it
-- would get. With `promoted_to_user_id` set, `promote_managed_profile` refuses outright, so the
-- question stops needing an answer.

ALTER TABLE managed_profiles
    ADD COLUMN IF NOT EXISTS promoted_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

COMMENT ON COLUMN managed_profiles.promoted_to_user_id IS
    'The account this child now signs in with, once the guardian handed the membership over. '
    'NULL means the child still has no login of their own (WALK-B-03).';

/*
 * ON DELETE SET NULL, not CASCADE, and the difference matters more here than it looks.
 *
 * CASCADE would delete the managed_profile when the promoted account is deleted — taking the
 * guardian consents with it, which are the record of WHY a minor was ever rostered. Plan §3 is
 * explicit that "the `managed_profiles` row and its consents are retained as the record of why
 * the child was rostered". SET NULL loses the pointer and keeps the record, which is the right
 * trade for a COPPA artefact.
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

    -- Already handed over. Reachable only if a code was minted before this migration existed
    -- and redeemed after, but a second promotion would repoint a membership that has already
    -- moved -- and the person it moved away from would learn about it from nothing at all.
    IF v_profile.promoted_to_user_id IS NOT NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'This child already has their own login.'
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

    -- The code is single-use, and the promotion is now RECORDED rather than merely implied by
    -- the absence of a membership. One UPDATE, inside the same transaction as the transfer, so
    -- a double-redeem cannot move rows that have already moved (WALK-B-03).
    UPDATE managed_profiles
    SET promotion_code = NULL,
        promoted_to_user_id = auth.uid(),
        promoted_at = now()
    WHERE id = v_profile.id;

    RETURN json_build_object(
        'success', true,
        'memberships_moved', v_moved,
        'promoted_at', now()
    );
END;
$$;

/*
 * And the guardian cannot mint a second code for a child who has already graduated.
 *
 * `offer_managed_profile_promotion` re-stated in full, because migrations are forward-only and
 * CREATE OR REPLACE carries the whole body. The rest of it is verbatim from
 * `20260822000200_guardian_access.sql` — the D3 migration in this same sprint got this wrong by
 * starting from an older copy of a different function, so this one was diffed against its
 * predecessor rather than retyped.
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

    -- WALK-B-03. Refusing here is what makes "no second offer" a rule rather than a UI
    -- decision: `docs/failure-modes.md` §8 is about controls that look live and do nothing,
    -- and the answer is always both halves -- hide the control AND have the server refuse.
    IF EXISTS (
        SELECT 1 FROM managed_profiles
        WHERE id = p_managed_profile_id AND promoted_to_user_id IS NOT NULL
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'This child already has their own login.'
        );
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

-- ---------------------------------------------------------------------------
-- WALK-B-09: "Gifted licence" on a team that was gifted nothing
-- ---------------------------------------------------------------------------
--
-- `EntitlementPanel` labelled any unlimited in-force grant "Gifted licence", so a coach who had
-- self-registered ninety seconds earlier read it on the same screen where step 1 had said "you
-- will be billed monthly". Nobody gifted them anything.
--
-- The view could not tell the two apart: both are `source = 'gift'`, because `license_grants`
-- has only `('gift', 'stripe')` and the automatic grant had to be one of them. Rather than
-- widen that CHECK on a frozen table -- which would need every reader of `source` revisited --
-- the view gains one boolean derived from the notes text that `create_team_as_admin` writes.
--
-- KEYED ON A STRING, AND THAT IS A REAL COST. `schema_assertions.sql` asserts the RPC and the
-- view still agree, because the failure mode otherwise is silent: the label quietly reverts to
-- "Gifted licence" for everybody and nothing goes red. That assertion is the whole reason this
-- is acceptable instead of a new column.

DROP VIEW IF EXISTS public.team_entitlement;

CREATE VIEW public.team_entitlement WITH (security_invoker = true) AS
SELECT
    t.id AS team_id,
    -- 'active' = may write. 'read_only' = expired, revoked, or never licensed; everything
    -- is still readable and nothing is ever removed.
    CASE WHEN inforce.grant_count > 0 THEN 'active' ELSE 'read_only' END AS status,
    -- NULL seats_total with seats_unlimited = false means "no seats granted"; NULL with
    -- seats_unlimited = true means "as many as you like". Two columns because one cannot
    -- carry both meanings.
    inforce.seats_total,
    inforce.seats_unlimited,
    (
        SELECT count(*)
        FROM team_members m
        WHERE m.team_id = t.id AND m.status = 'approved' AND m.seat_assigned
    ) AS seats_used,
    -- When the current entitlement runs out. NULL means open-ended.
    inforce.valid_until,
    -- When the team last had cover, for a read-only team's "expired on ..." message.
    lapsed.lapsed_at,
    inforce.sources,
    /*
     * Every in-force grant is the automatic one — i.e. nobody has looked at this team yet.
     *
     * `bool_and`, not `bool_or`: the moment an operator extends the probation there is a
     * second, human-issued grant in force, and the team has stopped being on probation even
     * though the probation row is still there. `coalesce(..., false)` because a team with NO
     * grants gets NULL from an empty aggregate, and a read-only team is not "on probation" —
     * `docs/failure-modes.md` §4, absence read as an answer.
     */
    coalesce(bool_and(inforce.is_probation), false) AS is_probation
FROM teams t
CROSS JOIN LATERAL (
    SELECT
        count(*) AS grant_count,
        CASE WHEN bool_or(g.seats IS NULL) THEN NULL ELSE sum(g.seats)::integer END
            AS seats_total,
        coalesce(bool_or(g.seats IS NULL), false) AS seats_unlimited,
        -- An open-ended grant beats any dated one, so it reports as NULL rather than as the
        -- largest date present.
        CASE WHEN bool_or(g.valid_until IS NULL) THEN NULL ELSE max(g.valid_until) END
            AS valid_until,
        coalesce(array_agg(DISTINCT g.source), '{}'::text[]) AS sources,
        bool_and(g.notes LIKE 'Automatic %-day beta probation%') AS is_probation
    FROM license_grants g
    WHERE g.team_id = t.id
      AND g.revoked_at IS NULL
      AND g.valid_from <= now()
      AND (g.valid_until IS NULL OR g.valid_until > now())
) inforce
CROSS JOIN LATERAL (
    SELECT max(g.valid_until) AS lapsed_at
    FROM license_grants g
    WHERE g.team_id = t.id AND g.valid_until IS NOT NULL
) lapsed
GROUP BY
    t.id, inforce.grant_count, inforce.seats_total, inforce.seats_unlimited,
    inforce.valid_until, lapsed.lapsed_at, inforce.sources;

COMMENT ON VIEW public.team_entitlement IS
    'Per-team licensing state. security_invoker: a reader sees only teams they can already '
    'read. status = active | read_only; read_only teams keep every row and lose only writes. '
    'is_probation = every in-force grant is the automatic one, so nobody has looked at this '
    'team yet (WALK-B-09).';

GRANT SELECT ON public.team_entitlement TO authenticated;
