-- SEC-08 — a team comes into existence through `create_team_as_admin` or not at all.
--
-- WHAT WAS WRONG
--
-- `teams_insert_owner` was `FOR INSERT WITH CHECK (owner_id = auth.uid())`, so any
-- authenticated account could POST a bare row to `/rest/v1/teams`. Reproduced as
-- `guardian@falconforge.test`:
--
--     POST /rest/v1/teams {"name":"SEC-08 bare insert","owner_id":"<me>"}   -> 201
--
--     name                | members | grants | seasons
--     SEC-08 bare insert  |       0 |      0 |       0
--
-- A team with no admin, no licence and no season. It is invisible to the person who created it
-- (`teams_select_member` needs a membership row, and there is none), so nobody can delete it or
-- even find it; it shows up in `operator_team_directory`, which LEFT JOINs the admin, as a
-- stranded team with a blank name column. A free spam vector against the one console Kevin has.
--
-- Note the 201 above took a second attempt to see. With `Prefer: return=representation` the same
-- request came back 403 `new row violates row-level security policy` — because RETURNING has to
-- satisfy the SELECT policy too, and it did not. That is a good illustration of why "I tried it
-- and it was refused" is not the same claim as "it is refused": the row landed both times.
--
-- WHAT REPLACES IT: nothing.
--
-- `create_team_as_admin` is SECURITY DEFINER and owned by `postgres`, which owns `teams` and is
-- not subject to its policies (`relforcerowsecurity` is false), so the RPC never consulted this
-- policy and does not need it. That is the whole design — a team is created together with its
-- admin, its licence, its season, its sub-teams and its checklist, in one transaction, which is
-- exactly what the bare INSERT skipped. `entity-registry.ts` already records `teams` as
-- PULL-ONLY: "the client never supplies `owner_id`", so no client path loses anything either.
--
-- The other half of SEC-08 — one account can register unlimited teams, each with a fresh
-- 90-day unlimited-seat trial (reproduced: three in a row) — is NOT addressed here. It is a
-- billing question that depends on D1 and D3 and belongs with SEC-07; logged in the plan's
-- parking lot with the numbers.

DROP POLICY IF EXISTS teams_insert_owner ON teams;

COMMENT ON TABLE teams IS
    'SEC-08: no INSERT policy, deliberately. A team is created by create_team_as_admin, which '
    'runs as the table owner and creates the admin, licence, season, sub-teams and checklist in '
    'the same transaction. No DELETE policy either -- deleting a team cascades to every row it '
    'owns and is an operator action through the service role, not a button.';
