-- SEC-06 — the SECURITY DEFINER predicates stop being cross-tenant oracles at `/rest/v1/rpc`.
--
-- WHAT WAS WRONG
--
-- PostgREST exposes every function it can EXECUTE at `/rpc/<name>`, and
-- `20260819000000_revoke_anon_execute.sql` deliberately left the predicates granted, on the
-- grounds that "they are not an API surface: they are called INSIDE the RLS policies". The
-- first half of that is what turned out to be untrue: they are an API surface, and three of
-- them take an id rather than reading `auth.uid()`, so they answer questions about people and
-- teams the caller has nothing to do with. Reproduced on the seeded stack with the anon key and
-- no session at all:
--
--     anon POST /rpc/get_user_team_ids    {"p_user_id": <reviewer's uid>}
--       -> ["163f3ef0-…"]                    another user's team list
--     anon POST /rpc/team_can_write       {"p_team_id": <iron falcons>}
--       -> true                              a stranger's licensing state
--     anon POST /rpc/team_seats_remaining {"p_team_id": <iron falcons>}
--       -> 0                                 and how full they are
--
-- and `full@`, an authenticated member of a DIFFERENT team, got the same three answers.
--
-- THE SECOND HALF OF THE OLD CLAIM IS TRUE, AND IT DECIDES THE SHAPE OF THIS FIX
--
-- A policy is evaluated as the CALLING role, so a predicate a policy consults must remain
-- EXECUTE-able by that role. Revoking `is_team_member` from `anon` would not harden anything;
-- it would turn every anonymous SELECT into "permission denied for function" instead of the
-- `200 []` that lets a signed-out visitor see an empty app — and that property is load-bearing
-- for the landing page and the join-by-link page. Measured before and after this migration, all
-- eighteen tables still answer `anon` with `200 []`.
--
-- So each predicate is fixed by the narrowest thing that works for it:
--
--   * `get_user_team_ids(p_user_id uuid)` is REPLACED by a zero-argument
--     `get_user_team_ids()` reading `auth.uid()`. The two policies that call it always passed
--     `auth.uid()` anyway, so nothing loses a capability — but the arg'd form is gone, and with
--     it the only predicate that would answer about somebody else. It is dropped rather than
--     revoked: a function that ignores its own parameter is the shape `docs/failure-modes.md`
--     §7 is about, and PostgREST answers the old call with "could not find the function".
--
--   * `team_can_write` and `team_seats_remaining` gain a membership check, so they answer only
--     about a team the caller is on, and are then revoked from `anon` as well. Neither is
--     consulted by any policy an anonymous caller can reach: `team_can_write` appears only in
--     WRITE policies, and `team_seats_remaining` appears in no policy at all.
--
--   * `season_is_open`, `meeting_season_is_open` and `current_team_role` are NOT changed.
--     `current_team_role` already answers only about the caller. The other two leak one bit —
--     whether a season the caller already knows the uuid of is archived — and closing it would
--     put a second membership probe on every content write, which is a real per-row cost for a
--     fact about nobody. Logged in the plan's parking lot rather than done quietly.
--
-- `service_role` is exempt from the membership checks, as it is from `enforce_seat_capacity`
-- and the SEC-01 trigger: it is the platform's own identity, it bypasses RLS everywhere, and it
-- is what the db suite and the seed scripts act as. Without the exemption
-- `operator-console.db.test.ts`'s "team could still write after every grant was revoked" would
-- have kept passing while asserting nothing, which is exactly the class of green result this
-- sprint keeps finding.

-- ==========================================================================
-- get_user_team_ids — no longer takes somebody else's id
-- ==========================================================================

/*
 * Teams the CURRENT user belongs to in their own right.
 *
 * Still excludes memberships held on behalf of a managed profile: a guardian whose child is on
 * a team is not thereby a member of it. `is_team_member` carries the same clause, and Sprint 3
 * found the hard way that BOTH have to be wrong before anything leaks — which is why they are
 * two functions rather than one.
 */
CREATE OR REPLACE FUNCTION public.get_user_team_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT team_id
    FROM team_members
    WHERE user_id = auth.uid()
      AND status = 'approved'
      AND managed_profile_id IS NULL;
$$;

-- Recreated to bind to the new signature. Same rule, stated the same way.
DROP POLICY IF EXISTS users_select_teammates ON users;
CREATE POLICY users_select_teammates ON users
    FOR SELECT USING (
        id IN (
            SELECT tm.user_id FROM team_members tm
            WHERE tm.team_id IN (SELECT get_user_team_ids())
        )
    );

-- The old overload can only go once nothing references it.
DROP FUNCTION IF EXISTS public.get_user_team_ids(uuid);

GRANT EXECUTE ON FUNCTION public.get_user_team_ids() TO anon, authenticated, service_role;

-- ==========================================================================
-- team_can_write / team_seats_remaining — about YOUR team, and not at /rpc
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.team_can_write(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    -- `coalesce` on `auth.role()`, because it is NULL on a connection with no JWT and
    -- `NULL OR false` is NULL -- which is B25's exact shape. RLS would coerce it to false, and
    -- an `IF NOT team_can_write(...)` written later would not.
    SELECT (coalesce(auth.role() = 'service_role', false) OR is_team_member(p_team_id))
       AND EXISTS (
        SELECT 1 FROM license_grants g
        WHERE g.team_id = p_team_id
          AND g.revoked_at IS NULL
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now())
    );
$$;

/*
 * Unchanged arithmetic; the membership check is new.
 *
 * NULL still means "no limit" and must not be flattened into a large number — which is why a
 * non-member is refused outright rather than answered with NULL. "No answer" and "no seats" are
 * arithmetically identical and semantically opposite (`docs/failure-modes.md` §4), and this
 * function returns the one value where that matters most.
 */
CREATE OR REPLACE FUNCTION public.team_seats_remaining(p_team_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_unlimited boolean;
    v_total integer;
    v_used integer;
BEGIN
    IF NOT (coalesce(auth.role() = 'service_role', false) OR is_team_member(p_team_id)) THEN
        RAISE EXCEPTION 'Seat counts are only available to members of that team'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT coalesce(bool_or(g.seats IS NULL), false),
           CASE WHEN bool_or(g.seats IS NULL) THEN NULL ELSE sum(g.seats)::integer END
      INTO v_unlimited, v_total
      FROM license_grants g
     WHERE g.team_id = p_team_id
       AND g.revoked_at IS NULL
       AND g.valid_from <= now()
       AND (g.valid_until IS NULL OR g.valid_until > now());

    IF v_unlimited THEN
        RETURN NULL;
    END IF;

    SELECT count(*)::integer INTO v_used
      FROM team_members m
     WHERE m.team_id = p_team_id
       AND m.status = 'approved'
       AND m.seat_assigned;

    RETURN greatest(coalesce(v_total, 0) - v_used, 0);
END;
$$;

-- Neither is consulted by a policy an anonymous caller reaches, so neither needs the grant that
-- the predicates evaluated inside SELECT policies keep. Revoked FROM PUBLIC as well as from
-- anon: revoking anon alone is a no-op, because ALTER DEFAULT PRIVILEGES in
-- `20260816000500_v2_grants.sql` gives every new function its own anon entry AND anon is a
-- member of PUBLIC. That mistake has been made in this repo twice.
REVOKE EXECUTE ON FUNCTION public.team_can_write(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_can_write(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.team_seats_remaining(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.team_seats_remaining(uuid) TO authenticated, service_role;
