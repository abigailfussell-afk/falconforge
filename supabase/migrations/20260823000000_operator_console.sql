-- FalconForge — the operator console: finding a team, and turning it off.
--
-- THE THIRD FORWARD MIGRATION. Additive only: three new functions and nothing dropped,
-- rewritten or narrowed. No table changes at all — every column this needs already exists,
-- including `license_grants.revoked_at` and `operator_actions.action`'s 'license_revoke',
-- both of which have been in the schema since Sprint 3/6 with nothing that could write them.
--
-- WHY THIS EXISTS
--
-- The console shipped able to gift a licence to a team id typed by hand, and to rescue a
-- stranded team from a team id and a member id typed by hand. Both are correct and neither is
-- usable, because there was no way to LEARN a team id: `team_entitlement` is
-- `security_invoker`, `teams_select_member` is `is_team_member(id) OR is_team_guardian(id)`,
-- and NO policy anywhere mentions `is_platform_operator()`. So the operator's own team list
-- showed the operator's own teams — never the team that just emailed for help.
--
-- WHY RPCs AND NOT A POLICY
--
-- The obvious alternative is `teams_select_member ... OR is_platform_operator()`. Rejected,
-- and not on taste:
--
--   * That policy is on the read path the whole client uses. `teams` became an entity registry
--     entity with `scope: 'rls'` in the previous change, which means the pull issues
--     `select('*')` with NO predicate and lets the policy decide the row set. Widening the
--     policy would therefore silently widen a background sync — an operator's device would
--     pull, persist and cache every team on the platform, into IndexedDB, on a laptop.
--   * Every cross-tenant isolation test would need re-reasoning at once, because the operator
--     is a member of teams in those fixtures.
--
-- A SECURITY DEFINER function keeps the widening in one auditable place, off the sync path,
-- returning a fixed projection rather than `SELECT *`. The operator sees a directory; the
-- operator's app still syncs only their own teams.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No function returns a team's CONTENT — no tasks, no scouting, no match plans, no meeting
-- notes. Reading a team's shape (who is on it, what licence it holds, when it was last
-- touched) is what answers a support email; reading their work is a different and much larger
-- decision, and one nobody has asked for. The line is drawn here on purpose so that moving it
-- later is a visible change rather than a widened SELECT.

-- ==========================================================================
-- THE DIRECTORY
-- ==========================================================================

/*
 * Find a team without already knowing its id.
 *
 * `p_search` matches the team name, the FTC team number, or the primary admin's email. Those
 * are the three things a support email actually contains — "this is Kevin from 12345", "I'm
 * the coach of the Iron Falcons", or just a From: header.
 *
 * NULL or blank returns everything, which is the right default for a platform with a handful
 * of beta teams and is why there is no pagination here yet. If that stops being true the fix
 * is a LIMIT and an offset, not a different shape.
 *
 * THE ADMIN IS A LEFT JOIN, NOT AN INNER ONE. A stranded team has no admin row at all — that
 * is the entire reason `operator_transfer_team_admin` exists — so an inner join would hide
 * from this directory precisely the teams most likely to need the operator. Sprint 6 built the
 * rescue; this is what makes it findable.
 *
 * Seat arithmetic is the `team_entitlement` view's, repeated here rather than selected from
 * it, and that is a real cost worth naming: two definitions of "in force" can drift. The view
 * cannot be used because it is `security_invoker` BY DESIGN — reading it from inside a
 * SECURITY DEFINER function would either return the operator's own teams (wrong) or require
 * making the view definer-rights (which would hand every authenticated user every team's
 * licensing state, the exact thing its comment says security_invoker prevents). The predicate
 * is asserted identical to the view's in `operator-console.db.test.ts`.
 */
CREATE OR REPLACE FUNCTION public.operator_team_directory(p_search text DEFAULT NULL)
RETURNS TABLE (
    team_id uuid,
    team_name text,
    team_number text,
    created_at timestamptz,
    admin_member_id uuid,
    admin_name text,
    admin_email text,
    members_approved integer,
    members_pending integer,
    entitlement_status text,
    seats_total integer,
    seats_unlimited boolean,
    seats_used integer,
    valid_until timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_needle text;
BEGIN
    -- Not a json error object: this returns a TABLE, and a caller who is not an operator gets
    -- zero rows rather than a shape they would have to branch on. The UI never renders this
    -- for a non-operator anyway; the refusal is what makes that cosmetic.
    IF NOT is_platform_operator() THEN
        RETURN;
    END IF;

    v_needle := nullif(btrim(coalesce(p_search, '')), '');

    RETURN QUERY
    SELECT
        t.id,
        t.name,
        t.team_number,
        t.created_at,
        adm.id,
        adm.full_name,
        adm.email,
        (SELECT count(*)::integer FROM team_members m
          WHERE m.team_id = t.id AND m.status = 'approved'),
        (SELECT count(*)::integer FROM team_members m
          WHERE m.team_id = t.id AND m.status = 'pending'),
        CASE WHEN inforce.grant_count > 0 THEN 'active' ELSE 'read_only' END,
        inforce.seats_total,
        inforce.seats_unlimited,
        (SELECT count(*)::integer FROM team_members m
          WHERE m.team_id = t.id AND m.status = 'approved' AND m.seat_assigned),
        inforce.valid_until
    FROM teams t
    LEFT JOIN team_members adm
           ON adm.team_id = t.id AND adm.role = 'admin' AND adm.status <> 'removed'
    CROSS JOIN LATERAL (
        SELECT
            count(*) AS grant_count,
            CASE WHEN bool_or(g.seats IS NULL) THEN NULL ELSE sum(g.seats)::integer END
                AS seats_total,
            coalesce(bool_or(g.seats IS NULL), false) AS seats_unlimited,
            CASE WHEN bool_or(g.valid_until IS NULL) THEN NULL ELSE max(g.valid_until) END
                AS valid_until
        FROM license_grants g
        WHERE g.team_id = t.id
          AND g.revoked_at IS NULL
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now())
    ) inforce
    WHERE v_needle IS NULL
       OR t.name ILIKE '%' || v_needle || '%'
       OR t.team_number ILIKE '%' || v_needle || '%'
       OR adm.email ILIKE '%' || v_needle || '%'
    -- Deterministic, because a list that reorders under the click is failure-modes §13 and
    -- this project has already shipped that twice.
    ORDER BY t.name, t.id;
END;
$$;

-- ==========================================================================
-- ONE TEAM, IN ENOUGH DETAIL TO ANSWER AN EMAIL
-- ==========================================================================

/*
 * The roster, the licence history, and what the platform has done to this tenant.
 *
 * One json object rather than four functions because it backs ONE screen and a support
 * question is never "just the roster" — it is "who is this person, are they approved, and why
 * can't they edit anything", which needs the roster and the grants in the same glance.
 *
 * `grants` is EVERY grant, including revoked and expired ones, newest first. That is the point
 * of `revoked_at` being a timestamp rather than a DELETE, and the table's own comment says so:
 * "who granted what, and when it was withdrawn, is the audit trail behind every 'why can't my
 * team edit anything' support question." This is that question's screen.
 *
 * `actions` is this team's `operator_actions` rows. A team whose admin was reassigned by the
 * platform should show that on the same page as the roster it changed, not in a table nobody
 * opens.
 *
 * Emails ARE included, and that is the deliberate part. This is a support tool for a platform
 * operator who is already the data controller for every one of these rows; the alternative --
 * a directory that will not tell you which of three people called Sam emailed you -- is not a
 * privacy win, it is a tool that does not work. What is NOT here is any of the team's content.
 */
CREATE OR REPLACE FUNCTION public.operator_team_detail(p_team_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_team teams%ROWTYPE;
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not a platform operator');
    END IF;

    SELECT * INTO v_team FROM teams WHERE id = p_team_id;
    IF v_team.id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'No such team');
    END IF;

    RETURN json_build_object(
        'success', true,
        'team', json_build_object(
            'id', v_team.id,
            'name', v_team.name,
            'team_number', v_team.team_number,
            'created_at', v_team.created_at,
            'pending_admin_member_id', v_team.pending_admin_member_id
        ),
        'members', coalesce((
            SELECT json_agg(row_to_json(m) ORDER BY m.sort_role, m.full_name, m.id)
            FROM (
                SELECT
                    tm.id, tm.full_name, tm.email, tm.role, tm.status,
                    tm.seat_assigned, tm.joined_at,
                    tm.managed_profile_id IS NOT NULL AS is_managed,
                    -- Admins first, then coaches, then everyone: the order a support question
                    -- is usually about.
                    CASE tm.role WHEN 'admin' THEN 0 WHEN 'coach' THEN 1
                                 WHEN 'mentor' THEN 2 ELSE 3 END AS sort_role
                FROM team_members tm
                WHERE tm.team_id = p_team_id AND tm.status <> 'removed'
            ) m
        ), '[]'::json),
        'grants', coalesce((
            SELECT json_agg(row_to_json(g) ORDER BY g.created_at DESC)
            FROM (
                SELECT
                    lg.id, lg.source, lg.seats, lg.valid_from, lg.valid_until,
                    lg.revoked_at, lg.notes, lg.created_at,
                    -- "In force right now", computed once here so the UI does not re-derive
                    -- a rule the database already owns.
                    (lg.revoked_at IS NULL
                       AND lg.valid_from <= now()
                       AND (lg.valid_until IS NULL OR lg.valid_until > now())) AS in_force
                FROM license_grants lg
                WHERE lg.team_id = p_team_id
            ) g
        ), '[]'::json),
        'actions', coalesce((
            SELECT json_agg(row_to_json(a) ORDER BY a.created_at DESC)
            FROM (
                SELECT oa.id, oa.action, oa.detail, oa.notes, oa.created_at
                FROM operator_actions oa
                WHERE oa.team_id = p_team_id
            ) a
        ), '[]'::json),
        'seasons', coalesce((
            SELECT json_agg(row_to_json(s) ORDER BY s.created_at DESC)
            FROM (
                SELECT se.id, se.name, se.is_archived, se.created_at
                FROM seasons se
                WHERE se.team_id = p_team_id
            ) s
        ), '[]'::json)
    );
END;
$$;

-- ==========================================================================
-- TURNING IT OFF
-- ==========================================================================

/*
 * Withdraw a licence.
 *
 * BY GRANT, NOT BY TEAM, and that is forced by the data rather than chosen. Grants accumulate:
 * `create_team_as_admin` issues a 90-day trial at registration and `grant_team_license` adds a
 * gift on top, so a beta team routinely holds two in-force grants at once. "Revoke this team's
 * licence" is therefore ambiguous, and the ambiguous version of a destructive action is the
 * one that quietly does half the job — revoking the gift and leaving the trial, so the team
 * carries on writing and the operator believes they have shut it off.
 *
 * `p_all` is the un-ambiguous form: every grant in force for the team, in one transaction,
 * with one audit row naming all of them. That is what "shut off their access" actually means,
 * and it is a separate argument rather than a separate function so that the two cannot drift.
 *
 * REVOCATION IS NOT DELETION, at any layer. `team_can_write` goes false and the team becomes
 * read-only; every row it has ever written stays exactly where it is. The privacy policy
 * already promises this in as many words -- "a lapsed licence never deletes anything" -- and
 * the UI says it on the button, because an operator who is afraid of a control will not use
 * it in the moment they need it.
 *
 * Idempotent: a grant already revoked keeps its original `revoked_at`. Re-running this is not
 * an error and must not rewrite history to the second time somebody clicked.
 */
CREATE OR REPLACE FUNCTION public.operator_revoke_license(
    p_team_id uuid,
    p_grant_id uuid DEFAULT NULL,
    p_all boolean DEFAULT false,
    p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_revoked uuid[];
BEGIN
    IF NOT is_platform_operator() THEN
        RETURN json_build_object('success', false, 'error', 'Not a platform operator');
    END IF;

    IF p_grant_id IS NULL AND NOT p_all THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Name a grant to revoke, or pass p_all to revoke everything in force'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id) THEN
        RETURN json_build_object('success', false, 'error', 'No such team');
    END IF;

    /*
     * `team_id` is in the WHERE clause even when a grant id is given. The id alone would be
     * enough to find the row, but requiring both means a mistyped grant id cannot revoke a
     * DIFFERENT team's licence -- the failure this whole feature exists to let Kevin undo.
     */
    WITH revoked AS (
        UPDATE license_grants g
           SET revoked_at = now()
         WHERE g.team_id = p_team_id
           AND g.revoked_at IS NULL
           AND (p_grant_id IS NULL OR g.id = p_grant_id)
           -- With p_all, only what is actually in force: a grant that expired last month is
           -- not "revoked", it lapsed, and recording otherwise would misdescribe the history.
           AND (NOT p_all OR (g.valid_from <= now()
                              AND (g.valid_until IS NULL OR g.valid_until > now())))
        RETURNING g.id
    )
    SELECT coalesce(array_agg(id), '{}'::uuid[]) INTO v_revoked FROM revoked;

    IF array_length(v_revoked, 1) IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Nothing to revoke: no matching grant is currently in force'
        );
    END IF;

    -- Unconditional, like `operator_transfer_team_admin`'s: withdrawing a tenant's licence is
    -- recorded whether or not the operator bothered to say why. Notes enrich the record; they
    -- do not decide whether there is one.
    INSERT INTO operator_actions (operator_user_id, team_id, action, detail, notes)
    VALUES (
        auth.uid(), p_team_id, 'license_revoke',
        jsonb_build_object('grant_ids', to_jsonb(v_revoked), 'revoked_all', p_all),
        p_notes
    );

    RETURN json_build_object(
        'success', true,
        'revoked_count', array_length(v_revoked, 1),
        'grant_ids', to_jsonb(v_revoked)
    );
END;
$$;

-- ==========================================================================
-- GRANTS
-- ==========================================================================

-- PostgREST reaches these as `authenticated`, and a function it cannot execute is invisible
-- rather than merely refused.
GRANT EXECUTE ON FUNCTION public.operator_team_directory(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_team_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_revoke_license(uuid, uuid, boolean, text) TO authenticated;

/*
 * FROM PUBLIC **AND** anon. Revoking PUBLIC alone is a no-op here and the repo has paid for
 * that once already: `20260816000500_v2_grants.sql` sets ALTER DEFAULT PRIVILEGES granting
 * every new function to `anon`, so each arrives with its own acl entry independent of
 * PUBLIC's. Sprint 9 wrote the careful-looking half of this and shipped four RPCs an
 * anonymous caller could execute. Schema assertion 23 now enumerates the set and will fail on
 * anything outside its allowlist, which is what turns this from a habit into a property.
 */
REVOKE ALL ON FUNCTION public.operator_team_directory(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operator_team_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.operator_revoke_license(uuid, uuid, boolean, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.operator_team_directory(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_team_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_revoke_license(uuid, uuid, boolean, text) TO authenticated;
