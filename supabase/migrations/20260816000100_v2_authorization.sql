-- FalconForge V2 — authorization.
--
-- V1 had exactly one authorization predicate, `is_team_coach(team_id, user_id)`, and every
-- policy that needed anything finer either inlined its own `EXISTS (SELECT 1 FROM
-- team_members ...)` or gave up and allowed all members. That is how `team_members` ended
-- up with five overlapping SELECT policies nobody could reason about.
--
-- V2 names the CAPABILITY instead of the role, so a policy reads as the question it is
-- actually asking, and changing who may do a thing is one function body rather than a grep
-- across every policy in the schema.
--
--   can_manage_billing   admin              licences, seats
--   can_manage_roster    admin, coach       membership, invites, team settings
--   can_manage_structure admin, coach       seasons, sub-teams
--   can_manage_content   any approved member  tasks, scouting, plans, checklists, meetings
--
-- Every capability that WRITES also requires the team to be entitled (`team_can_write`).
-- That is what makes "an expired team is read-only" a property of the database rather than
-- a banner the client could be talked out of showing.
--
-- All of these are SECURITY DEFINER so that a policy on `tasks` can consult `team_members`
-- without the reader needing their own SELECT rights on it, and STABLE so Postgres may
-- cache the result within a statement. `search_path` is pinned on every one: a SECURITY
-- DEFINER function with a mutable search_path is a privilege-escalation primitive.

-- ==========================================================================
-- MEMBERSHIP
-- ==========================================================================

/*
 * Teams the user belongs to IN THEIR OWN RIGHT.
 *
 * Deliberately excludes memberships the user holds on behalf of a managed profile
 * (`managed_profile_id IS NOT NULL`). A guardian whose child is on a team is not thereby a
 * member of that team: they can see their child's membership row and their child's profile
 * (see the guardian policies in the RLS migration) but not the team's tasks, scouting data
 * or roster. Widening that is a product decision for the guardian UI in Sprint 9, and the
 * safe default to start from is the narrow one.
 */
CREATE OR REPLACE FUNCTION public.get_user_team_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT team_id
    FROM team_members
    WHERE user_id = p_user_id
      AND status = 'approved'
      AND managed_profile_id IS NULL;
$$;

/** Is the CURRENT user an approved member of this team, in their own right? */
CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM team_members
        WHERE team_id = p_team_id
          AND user_id = auth.uid()
          AND status = 'approved'
          AND managed_profile_id IS NULL
    );
$$;

/** The current user's role in a team, or NULL if they are not an approved member. */
CREATE OR REPLACE FUNCTION public.current_team_role(p_team_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT role
    FROM team_members
    WHERE team_id = p_team_id
      AND user_id = auth.uid()
      AND status = 'approved'
      AND managed_profile_id IS NULL
    LIMIT 1;
$$;

/** Does the current user own this managed profile? */
CREATE OR REPLACE FUNCTION public.is_profile_guardian(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM managed_profiles
        WHERE id = p_profile_id AND guardian_user_id = auth.uid()
    );
$$;

/** Platform operator — the only identity that may gift a licence. Seeded by hand; see the
 *  `platform_operators` table comment. */
CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (SELECT 1 FROM platform_operators WHERE user_id = auth.uid());
$$;

-- ==========================================================================
-- ENTITLEMENT
-- ==========================================================================

/*
 * Is this team currently licensed to WRITE?
 *
 * A grant is in force when it is unrevoked, has started, and has not ended. Grants
 * accumulate, so any one of them in force is enough.
 *
 * A team with no grant at all is NOT entitled — read-only, never deleted. That is the
 * whole enforcement model in one predicate:
 *
 *   entitled      -> reads and writes
 *   not entitled  -> reads only; the data stays exactly where it is until somebody renews
 *
 * There is no state in which data is destroyed for non-payment, which is the promise the
 * business model makes to a team mid-season.
 *
 * Reads `license_grants` directly rather than the `team_entitlement` view: the view is
 * security_invoker (correctly — it is user-facing), and a policy must not depend on the
 * reader's own visibility of the rows that decide their permissions.
 */
CREATE OR REPLACE FUNCTION public.team_can_write(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM license_grants g
        WHERE g.team_id = p_team_id
          AND g.revoked_at IS NULL
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now())
    );
$$;

/*
 * "Is this team active, and how many seats does it have?" — the question the plan asks of
 * this view, answered for every team the reader can see.
 *
 * security_invoker = true is load-bearing. A view without it executes as its OWNER
 * (postgres), which bypasses RLS on `license_grants` and `team_members` entirely and would
 * hand every authenticated user the licensing state of every team on the platform. With it,
 * the underlying policies apply and a reader sees only their own team's row.
 */
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
    inforce.sources
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
        coalesce(array_agg(DISTINCT g.source), '{}'::text[]) AS sources
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
) lapsed;

COMMENT ON VIEW public.team_entitlement IS
    'Per-team licensing state. security_invoker: a reader sees only teams they can already '
    'read. status = active | read_only; read_only teams keep every row and lose only writes.';

-- ==========================================================================
-- CAPABILITIES
-- ==========================================================================

/** Licences and seat assignment. The primary admin alone — this is the person who
 *  registered the team and accepted responsibility for it. */
CREATE OR REPLACE FUNCTION public.can_manage_billing(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT current_team_role(p_team_id) = 'admin';
$$;

/*
 * Membership, invites and team settings.
 *
 * NOT gated on entitlement, on purpose. A team whose licence has lapsed must still be able
 * to see and manage who is on it — locking the admin out of the roster is how a licensing
 * problem turns into a support ticket nobody can resolve. Only CONTENT goes read-only.
 */
CREATE OR REPLACE FUNCTION public.can_manage_roster(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT current_team_role(p_team_id) IN ('admin', 'coach');
$$;

/** Seasons and sub-teams: the shape of the team's work, which students do not redraw.
 *  Preserves V1's coach-only rule on both tables. */
CREATE OR REPLACE FUNCTION public.can_manage_structure(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT current_team_role(p_team_id) IN ('admin', 'coach')
       AND team_can_write(p_team_id);
$$;

/** Tasks, scouting reports, match plans, checklists, meetings, attendance — the day-to-day
 *  work, which every approved member does. */
CREATE OR REPLACE FUNCTION public.can_manage_content(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT is_team_member(p_team_id) AND team_can_write(p_team_id);
$$;
