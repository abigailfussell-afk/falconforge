-- Schema assertions, run against the local stack after `supabase db reset`.
--
-- Purpose: prove that supabase/migrations/ alone can reconstruct the database, and that the
-- reconstruction holds the invariants the application relies on. Until 2026-08-09 the
-- migrations could not rebuild anything — the history began at 009 and the 001-008 that
-- created the tables were never committed, so the cloud project was the only source of
-- truth. If this file starts failing, that has silently become true again.
--
-- These run as `postgres`, who has every privilege regardless of RLS. They can therefore
-- prove a policy EXISTS but never what it PERMITS. That question is asked by the behavioural
-- suite in `src/test/db/`, which connects as the real API roles over HTTP. Neither file is
-- sufficient alone: this one catches a schema that cannot be built, that one catches a
-- schema that can be built and is wrong.
--
-- Run locally:
--   supabase db reset
--   docker exec -i supabase_db_falconforge psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/schema_assertions.sql
--
-- CI runs the same file via psql against 127.0.0.1:54322.

\set ON_ERROR_STOP on

-- 1. Every table the app and migrations depend on exists.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(expected.name, ', ' ORDER BY expected.name) INTO missing
    FROM unnest(ARRAY[
        -- identity
        'users', 'user_attestations', 'managed_profiles', 'guardian_consents',
        -- tenant
        'teams', 'team_members', 'invites',
        -- licensing
        'platform_operators', 'license_grants',
        -- season-scoped
        'seasons', 'sub_teams', 'tasks', 'scouting_reports', 'match_plans', 'checklists',
        'meetings', 'meeting_attendance'
    ]) AS expected(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name = expected.name
    );

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Tables missing after reset: %', missing;
    END IF;
END $$;

-- 2. Row Level Security is enabled on every public table.
--    A table without RLS is readable by any authenticated user via the anon key, which
--    ships in the client bundle. This is the check that would have caught the invite-code
--    exposure patched in the archived 014_fix_invites_rls.sql.
DO $$
DECLARE
    unprotected text;
BEGIN
    SELECT string_agg(tablename, ', ' ORDER BY tablename) INTO unprotected
    FROM pg_tables
    WHERE schemaname = 'public' AND NOT rowsecurity;

    IF unprotected IS NOT NULL THEN
        RAISE EXCEPTION 'RLS is disabled on: %', unprotected;
    END IF;
END $$;

-- 3. Every RLS-enabled table actually has at least one policy.
--    RLS with no policies denies everything, which fails closed rather than open -- but it
--    means the table is unusable, and that should surface here rather than as a support
--    ticket during a competition.
DO $$
DECLARE
    policyless text;
BEGIN
    SELECT string_agg(t.tablename, ', ' ORDER BY t.tablename) INTO policyless
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND t.rowsecurity
      AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = t.tablename
      );

    IF policyless IS NOT NULL THEN
        RAISE EXCEPTION 'RLS enabled but no policies defined on: %', policyless;
    END IF;
END $$;

-- 4. The delta-sync contract: every table pulled incrementally by the read path must have an
--    updated_at column. `pullFromServer` filters with `query.gte('updated_at', cursor)`, and
--    a missing column makes that query error; the pull swallows it into a console.warn and
--    moves on, so the table just quietly stops delta-syncing.
--
--    team_members is in this list as of V2. It had no updated_at, which is why the roster
--    could only ever refresh on a team switch.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(expected.name, ', ' ORDER BY expected.name) INTO missing
    FROM unnest(ARRAY[
        'tasks', 'seasons', 'sub_teams', 'match_plans', 'checklists', 'scouting_reports',
        'team_members', 'meetings', 'meeting_attendance',
        -- Sprint 9 put both guardian tables in the entity registry, which is what enrols a
        -- table in the pull. They are scoped by `guardian_user_id` rather than `team_id`
        -- (see `EntityScope`), but the delta contract is about the cursor column and applies
        -- to them identically. `guardian_consents` had no `updated_at` until
        -- `20260822000100_guardian_sync.sql` added one, rather than being exempted here.
        'managed_profiles', 'guardian_consents'
    ]) AS expected(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = expected.name
          AND column_name = 'updated_at'
    );

    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Delta-synced tables without updated_at: %', missing;
    END IF;
END $$;

-- 5. Realtime DELETE contract: every table realtime.ts subscribes to with a team_id filter
--    must have REPLICA IDENTITY FULL, or Postgres omits team_id from the DELETE payload,
--    the filter never matches, and cross-device deletions silently never arrive (B7).
--    relreplident: 'd' = default (primary key), 'f' = full.
--
--    THIS LIST MUST MATCH `SYNCED_TABLES` IN realtime.ts, which is SYNCED_ENTITIES plus
--    checklists. It did not: `seasons` has been in SYNCED_ENTITIES all along and was missing
--    here, so season deletions never propagated (B22, fixed in the Sprint 4 migration). The
--    list was written from the set of tables B7 happened to name rather than from what the
--    client subscribes to, which is how one table sat outside a rule everything else obeyed.
--
--    THE GUARDIAN TABLES ARE DELIBERATELY ABSENT, and adding them here would be wrong rather
--    than merely redundant. `realtime.ts` opens ONE channel, filtered by the open team, and
--    `managed_profiles`/`guardian_consents` have no `team_id` to filter on -- a guardian
--    typically has no membership of their own at all. They are in `GUARDIAN_ENTITIES`, not
--    `SYNCED_ENTITIES`, so `SYNCED_TABLES` does not contain them and this list still matches
--    it. Deletions on those tables propagate through the periodic full reconciliation, which
--    is adequate for rows one person edits on one device at a time.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offenders
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
          'seasons', 'sub_teams', 'tasks', 'scouting_reports', 'match_plans', 'checklists',
          -- Sprint 8 put both in the entity registry, which is what enrols a table in the
          -- realtime subscription as well as in the pull. A cancelled meeting has to reach
          -- the phones of the people who were going to turn up to it.
          'meetings', 'meeting_attendance')
      AND c.relreplident <> 'f';

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Realtime-subscribed tables without REPLICA IDENTITY FULL: %', offenders;
    END IF;
END $$;

-- 6. API role grants: PostgREST connects as anon/authenticated/service_role, and those
--    roles need ordinary SQL privileges before RLS is even consulted. A table without them
--    answers every request with `permission denied`, which is a privilege error, not a
--    policy denial -- the app is simply dead against it.
--
--    This is not hypothetical. Supabase used to grant these automatically on any table
--    created in `public` and newer versions do not, so tables created by these migrations
--    came out with only REFERENCES/TRIGGER/TRUNCATE. Rebuilding from migrations produced a
--    schema the application could not read a single row of, and nothing here noticed --
--    these assertions run as `postgres`, who has full rights regardless.
--
--    Granting to `anon` is safe only because assertion 2 above proves RLS is enabled on
--    every one of these tables. The two go together; do not keep this and drop that.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s (%s)', t.tablename, r.role), ', ' ORDER BY t.tablename, r.role)
      INTO offenders
    FROM pg_tables t
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role)
    WHERE t.schemaname = 'public'
      AND NOT (
          has_table_privilege(r.role, format('public.%I', t.tablename), 'SELECT')
          -- INSERT and UPDATE are asked COLUMN-wise, because Sprint 9 narrows one of them
          -- deliberately: `managed_profiles.promotion_code` is a claim code, readable by the
          -- guardian and writable only by the SECURITY DEFINER function that generates it, and
          -- Postgres has no way to subtract a column from a table-level privilege — the table
          -- grant has to be revoked and re-granted per column.
          --
          -- This still answers the question the assertion exists to ask ("can the API role use
          -- this table at all", after a rebuild produced a schema PostgREST could not read a
          -- row of). What it deliberately does NOT try to police is WHICH columns: a catalogue
          -- assertion is the wrong instrument for that — see `docs/environment-divergences.md`
          -- §5, where a `pg_proc` ACL assertion would have approved a REVOKE that was a no-op.
          -- The column list is asserted behaviourally, as a guardian, in
          -- `guardian-access.rls.db.test.ts`.
          AND has_any_column_privilege(r.role, format('public.%I', t.tablename), 'INSERT')
          AND has_any_column_privilege(r.role, format('public.%I', t.tablename), 'UPDATE')
          AND has_table_privilege(r.role, format('public.%I', t.tablename), 'DELETE')
      );

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Tables the API roles cannot use (missing GRANTs): %', offenders;
    END IF;
END $$;

-- 6b. Same, for views. `pg_tables` does not list them, so assertion 6 cannot see
--     `team_entitlement` -- and a view the client cannot select from is exactly as dead as a
--     table it cannot select from.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s (%s)', v.viewname, r.role), ', ' ORDER BY v.viewname, r.role)
      INTO offenders
    FROM pg_views v
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role)
    WHERE v.schemaname = 'public'
      AND NOT has_table_privilege(r.role, format('public.%I', v.viewname), 'SELECT');

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Views the API roles cannot select from (missing GRANTs): %', offenders;
    END IF;
END $$;

-- 7. Season scoping is NOT NULL, and the reference is COMPOSITE.
--
--    NOT NULL is what makes "a new season is a fresh start" a property of the schema. The
--    client used to filter with `!x.seasonId || x.seasonId === current` in five places, so a
--    row with a null season leaked into every season that ever existed.
--
--    The composite `(season_id, team_id) -> seasons (id, team_id)` is what makes a
--    cross-tenant reference impossible rather than merely unlikely. A plain `season_id` FK
--    would let a row in team A point at team B's season and RLS would never notice, because
--    every policy looks only at `team_id`.
DO $$
DECLARE
    nullable text;
    uncoupled text;
BEGIN
    SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name) INTO nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'season_id'
      AND c.is_nullable = 'YES';

    IF nullable IS NOT NULL THEN
        RAISE EXCEPTION 'Season-scoped tables with a nullable season_id: %', nullable;
    END IF;

    SELECT string_agg(expected.name, ', ' ORDER BY expected.name) INTO uncoupled
    FROM unnest(ARRAY[
        'sub_teams', 'tasks', 'scouting_reports', 'match_plans', 'checklists', 'meetings'
    ]) AS expected(name)
    WHERE NOT EXISTS (
        -- A foreign key on this table covering exactly (season_id, team_id).
        SELECT 1
        FROM pg_constraint fk
        JOIN pg_class rel ON rel.oid = fk.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE fk.contype = 'f'
          AND n.nspname = 'public'
          AND rel.relname = expected.name
          AND (
              SELECT array_agg(att.attname::text ORDER BY att.attname::text)
              FROM unnest(fk.conkey) AS k(attnum)
              JOIN pg_attribute att
                ON att.attrelid = fk.conrelid AND att.attnum = k.attnum
          ) = ARRAY['season_id', 'team_id']
    );

    IF uncoupled IS NOT NULL THEN
        RAISE EXCEPTION
            'Season-scoped tables without a composite (season_id, team_id) FK: %', uncoupled;
    END IF;
END $$;

-- 8. Every tenant table carries a NOT NULL team_id.
--    RLS scopes on it, sync filters on it, and a nullable one is a row no policy matches and
--    no client ever sees again.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(expected.name, ', ' ORDER BY expected.name) INTO offenders
    FROM unnest(ARRAY[
        'team_members', 'invites', 'license_grants', 'seasons', 'sub_teams', 'tasks',
        'scouting_reports', 'match_plans', 'checklists', 'meetings', 'meeting_attendance'
    ]) AS expected(name)
    WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = expected.name
          AND column_name = 'team_id'
          AND is_nullable = 'NO'
    );

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Tenant tables without a NOT NULL team_id: %', offenders;
    END IF;
END $$;

-- 9. Every content table has exactly one policy per verb.
--
--    V1's `team_members` had FIVE overlapping SELECT policies. Policies for a verb OR
--    together, so the effective rule was the union of five half-remembered intentions with
--    no single place to read it. One per verb is the rule V2 holds itself to; a second
--    SELECT policy appearing on a table is how that drift starts again.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s.%s x%s', t.name, v.cmd, counted.n), ', ') INTO offenders
    FROM unnest(ARRAY[
        'tasks', 'scouting_reports', 'match_plans', 'checklists', 'meetings',
        'meeting_attendance', 'seasons', 'sub_teams', 'team_members', 'invites'
    ]) AS t(name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS v(cmd)
    CROSS JOIN LATERAL (
        SELECT count(*) AS n FROM pg_policies p
        WHERE p.schemaname = 'public' AND p.tablename = t.name AND p.cmd = v.cmd
    ) counted
    WHERE counted.n <> 1;

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'Tables without exactly one policy per verb: %', offenders;
    END IF;
END $$;

-- 10. Every SECURITY DEFINER function pins its search_path.
--
--     A SECURITY DEFINER function runs with the owner's privileges. If it resolves an
--     unqualified name through a caller-controlled search_path, the caller chooses which
--     `users` table the function reads -- which is a privilege-escalation primitive, not a
--     style question. Every authorization predicate in this schema is SECURITY DEFINER.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
          SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS cfg
          WHERE cfg LIKE 'search_path=%'
      );

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION 'SECURITY DEFINER functions with an unpinned search_path: %', offenders;
    END IF;
END $$;

-- 11. Exactly one admin per team is enforced by an index, not by hope.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'team_members'
          AND indexname = 'team_members_one_admin_per_team'
    ) THEN
        RAISE EXCEPTION 'The one-admin-per-team unique index is missing';
    END IF;
END $$;

-- 12. `team_entitlement` is security_invoker.
--
--     Without it a view executes as its OWNER (postgres), which bypasses RLS on every table
--     it reads. This view reads `license_grants` and `team_members`, so a non-invoker
--     version would hand any authenticated user the licensing state and seat counts of
--     every team on the platform. This is the single most dangerous line in the schema to
--     lose, and it is invisible in the view definition itself.
DO $$
DECLARE
    opts text[];
BEGIN
    SELECT c.reloptions INTO opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'team_entitlement';

    IF opts IS NULL OR NOT ('security_invoker=true' = ANY (opts)) THEN
        RAISE EXCEPTION
            'team_entitlement is not security_invoker -- it leaks every team''s licensing state';
    END IF;
END $$;

-- 13. The checklist is one per season, per team (C6).
--     V1 had one row per TEAM, so a new season inherited the previous season's checklist and
--     the "fresh start" was not one. The partial unique index is what lets two offline
--     devices in the same season converge on a single row instead of creating two.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'checklists'
          AND indexname = 'checklists_one_per_season'
    ) THEN
        RAISE EXCEPTION 'The one-checklist-per-season unique index is missing';
    END IF;
END $$;

-- 14. The season lifecycle columns exist, and `is_archived` is NOT NULL.
--
--     NOT NULL is the invariant, not the column's presence. The write policies below read
--     `NOT is_archived`, and NULL is neither true nor false — so a nullable flag would turn
--     a season with no value into one that silently rejects every write, which presents as
--     "my team cannot save anything" with nothing in the UI to explain it.
DO $$
DECLARE
    v_is_nullable text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'seasons' AND column_name = 'game_title'
    ) THEN
        RAISE EXCEPTION 'seasons.game_title is missing';
    END IF;

    SELECT is_nullable INTO v_is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'seasons' AND column_name = 'is_archived';

    IF v_is_nullable IS NULL THEN
        RAISE EXCEPTION 'seasons.is_archived is missing';
    END IF;

    IF v_is_nullable <> 'NO' THEN
        RAISE EXCEPTION
            'seasons.is_archived is nullable -- NULL is neither archived nor open, and every '
            'season-scoped write policy would deny on it';
    END IF;
END $$;

-- 15. Every season-scoped WRITE policy consults the archive predicate.
--
--     "A prior season is read-only" is only as real as the weakest table it is spelled out
--     on. One table left off this rule is a hole nobody finds until a coach edits a task in
--     last year's season and it silently sticks.
--
--     SELECT is deliberately excluded: an archived season is read-only, not hidden.
--     `meeting_attendance` is the only one that reaches its season through `meetings`, so it
--     is checked against the predicate that does the same.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s.%s', p.tablename, p.cmd), ', ' ORDER BY p.tablename, p.cmd)
      INTO offenders
    FROM pg_policies p
    JOIN (VALUES
        ('tasks', 'season_is_open'),
        ('scouting_reports', 'season_is_open'),
        ('match_plans', 'season_is_open'),
        ('checklists', 'season_is_open'),
        ('meetings', 'season_is_open'),
        ('sub_teams', 'season_is_open'),
        ('meeting_attendance', 'meeting_season_is_open')
    ) AS expected(name, predicate) ON expected.name = p.tablename
    WHERE p.schemaname = 'public'
      AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%' || expected.predicate || '%';

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Season-scoped write policies that do not check whether the season is archived: %',
            offenders;
    END IF;
END $$;

-- 16. The admin-nomination column is guarded by a trigger, not only by its RPC.
--
--     `teams_update_manager` grants UPDATE on `teams` to `can_manage_roster`, which is admin
--     OR COACH. So the column that decides who may become admin is writable over plain REST
--     by somebody who must not decide it. `enforce_admin_nomination_authority` is what closes
--     that, and it is the kind of guard that gets dropped by a later refactor of `teams`
--     because nothing else references it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'teams'
          AND column_name = 'pending_admin_member_id'
    ) THEN
        RAISE EXCEPTION 'teams.pending_admin_member_id is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'enforce_admin_nomination_authority_trigger'
          AND tgrelid = 'public.teams'::regclass
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'enforce_admin_nomination_authority_trigger is missing from teams -- a coach can '
            'PATCH pending_admin_member_id to their own row and then accept it';
    END IF;
END $$;

-- 17. The admin role is still gated on an 18+ account AND a terms attestation.
--
--     Ownership transfer (Sprint 6) reaches `role = 'admin'` from a second direction, and
--     both new paths deliberately delegate eligibility to this one trigger rather than
--     repeating it. If the trigger goes, transfer silently stops requiring the successor to
--     have agreed to anything -- which is the entire legal point of the handshake.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'enforce_member_role_eligibility_trigger'
          AND tgrelid = 'public.team_members'::regclass
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'enforce_member_role_eligibility_trigger is missing from team_members';
    END IF;

    IF position('user_attestations' IN pg_get_functiondef(
        'public.enforce_member_role_eligibility()'::regprocedure)) = 0 THEN
        RAISE EXCEPTION
            'enforce_member_role_eligibility no longer consults user_attestations -- an admin '
            'could hold the role without having accepted the terms';
    END IF;
END $$;

-- 18. Attestations keep their history: the unique key includes `version`.
--
--     With the key on (user_id, attestation_type) alone, `recordAttestation`'s upsert
--     REPLACED the previous acceptance when a document version was bumped, so the record of
--     what somebody agreed to before was destroyed by them agreeing to something new. That is
--     the one thing a legal attestation exists to prove.
DO $$
DECLARE
    v_cols text;
BEGIN
    SELECT string_agg(a.attname, ',' ORDER BY a.attname)
      INTO v_cols
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = 'public.user_attestations'::regclass
      AND c.contype = 'u';

    IF v_cols IS DISTINCT FROM 'attestation_type,user_id,version' THEN
        RAISE EXCEPTION
            'user_attestations unique key is (%) -- expected it to include `version`, or '
            'bumping a document version overwrites the prior acceptance', coalesce(v_cols, 'none');
    END IF;
END $$;

-- 19. No policy enforces seats per member, and that is deliberate.
--
--     Decided at Sprint 6 kickoff: seats are purchased TEAM CAPACITY and the gate is join
--     approval (`enforce_seat_capacity`), never the write path. A policy that grew a
--     `seat_assigned` predicate would put licensing on the critical path of every offline
--     write at a competition and lock out a member whose device cannot ask. If this assertion
--     ever needs deleting, that is a product decision with an offline story attached, not a
--     tidy-up.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s.%s (%s)', tablename, cmd, policyname), ', ')
      INTO offenders
    FROM pg_policies
    WHERE schemaname = 'public'
      AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%seat_assigned%';

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Policies now reference seat_assigned: %. Seats are team capacity enforced at '
            'approval; per-member seat enforcement in the write path breaks offline use.',
            offenders;
    END IF;
END $$;

-- 20. B25 — every capability function returns a definite boolean, never NULL.
--
--     `current_team_role` is NULL for a non-member, so `current_team_role(x) = 'admin'`
--     returns NULL and `IF NOT can_manage_billing(x)` does not fire: the guard is SKIPPED and
--     the function continues as though the caller were authorised. RLS coerces NULL to false,
--     so every policy was correct and nothing revealed it; `transfer_team_admin` was the shape
--     that mattered and had no caller.
--
--     Asserted behaviourally against a uuid that belongs to no team, because the bug is
--     invisible in the function's text -- the broken version and the fixed version differ
--     only by a `coalesce` that is easy to drop in a later edit.
DO $$
DECLARE
    v_nowhere uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
    -- Spelled out one at a time rather than looped, so a failure names the function.
    IF can_manage_billing(v_nowhere) IS NULL THEN
        RAISE EXCEPTION 'can_manage_billing returns NULL for a non-member -- B25: every '
                        '`IF NOT can_manage_billing(...)` guard is skipped';
    END IF;
    IF can_manage_roster(v_nowhere) IS NULL THEN
        RAISE EXCEPTION 'can_manage_roster returns NULL for a non-member (B25)';
    END IF;
    IF can_manage_structure(v_nowhere) IS NULL THEN
        RAISE EXCEPTION 'can_manage_structure returns NULL for a non-member (B25)';
    END IF;
    IF can_manage_content(v_nowhere) IS NULL THEN
        RAISE EXCEPTION 'can_manage_content returns NULL for a non-member (B25)';
    END IF;
    -- Sprint 8. This one is called from `check_in_with_code` as well as from policies, so it
    -- is the shape B25 was: a NULL here skips a guard in a SECURITY DEFINER function.
    IF can_manage_meetings(v_nowhere) IS NULL THEN
        RAISE EXCEPTION 'can_manage_meetings returns NULL for a non-member (B25)';
    END IF;

    IF can_manage_billing(v_nowhere) OR can_manage_roster(v_nowhere)
       OR can_manage_structure(v_nowhere) OR can_manage_content(v_nowhere)
       OR can_manage_meetings(v_nowhere) THEN
        RAISE EXCEPTION 'A capability function grants a non-member access to a team';
    END IF;
END $$;

-- 21. Meetings are governed by `can_manage_meetings`, never by `can_manage_content`.
--
--     `can_manage_content` is "any approved member", which is right for tasks and scouting and
--     wrong for a record about a person: it would let a student create events and set anybody's
--     attendance, including their own. Sprint 8 replaced the predicate on all six write
--     policies, and this asserts the replacement rather than trusting it -- reverting one of
--     them is a two-word edit that no other assertion would notice, and the resulting hole is
--     silent (the write succeeds; nothing errors; the record is simply a lie).
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(format('%s.%s', tablename, cmd), ', ' ORDER BY tablename, cmd)
      INTO offenders
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('meetings', 'meeting_attendance')
      AND cmd <> 'SELECT'
      AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%can_manage_meetings%';

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'Meeting write policies not gated on can_manage_meetings: %. '
            'can_manage_content is any approved member, which lets a student write attendance.',
            offenders;
    END IF;
END $$;

-- 22. A student cannot read another student's attendance.
--
--     The season summary is a coach screen, but a SELECT policy of `is_team_member(team_id)`
--     would have made the rows behind it readable by every student over the API regardless.
--     Asserted on the policy text because the behavioural half lives in the RLS suite, and
--     because the failure mode here is someone widening the policy back to match the other
--     content tables for consistency's sake.
DO $$
DECLARE
    v_qual text;
BEGIN
    SELECT qual INTO v_qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'meeting_attendance' AND cmd = 'SELECT';

    IF v_qual IS NULL OR v_qual NOT LIKE '%current_team_member_id%' THEN
        RAISE EXCEPTION
            'meeting_attendance SELECT does not restrict students to their own rows (got: %)',
            coalesce(v_qual, '<no policy>');
    END IF;
END $$;

-- 23. NO SECURITY DEFINER FUNCTION JOINS THE ANON-EXECUTABLE SET BY ACCIDENT.
--
--     `20260819000000_revoke_anon_execute.sql` claims this property in its header -- "adding a
--     function to this schema does not silently join or leave the set" -- and nothing enforced
--     it, so Sprint 9 added four RPCs that did exactly that. `20260816000500_v2_grants.sql`
--     sets ALTER DEFAULT PRIVILEGES granting every new function to `anon`, so the default is
--     to be reachable and each new RPC has to opt OUT by hand.
--
--     THIS IS A DRIFT CHECK, NOT THE SECURITY PROPERTY, and the distinction matters --
--     `docs/environment-divergences.md` §5 is precisely that a catalogue assertion approved a
--     REVOKE that was a no-op. The refusal itself is asserted behaviourally, as anon, in
--     `anon-execute.rls.db.test.ts`. What this catches is the case that suite structurally
--     cannot: a function nobody thought to add to it.
--
--     To add a function here, decide which list it belongs in and say why. A predicate called
--     INSIDE an RLS policy must keep its anon grant -- a policy is evaluated as the calling
--     role, and revoking it turns every anonymous SELECT into "permission denied for function"
--     instead of the `200 []` that makes a signed-out visitor see an empty app.
DO $$
DECLARE
    offenders text;
BEGIN
    SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef                                  -- SECURITY DEFINER only
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> ALL (ARRAY[
          -- Predicates evaluated inside RLS policies. Revoking these BREAKS anonymous reads.
          'is_team_member', 'is_team_guardian', 'guardian_member_ids', 'is_profile_guardian',
          'get_user_team_ids', 'current_team_role', 'current_team_member_id',
          'can_manage_billing', 'can_manage_content', 'can_manage_meetings',
          'can_manage_roster', 'can_manage_structure',
          'team_can_write', 'team_seats_remaining', 'season_is_open', 'meeting_season_is_open',
          'meeting_checkin_opens', 'meeting_checkin_closes',
          'is_platform_operator', 'admin_nomination_ttl',
          -- Trigger functions: EXECUTE is checked when the trigger is created, not when it
          -- fires, so an anon grant on one is inert.
          'handle_new_user', 'sync_user_to_team_members', 'update_updated_at_column',
          'enforce_member_role_eligibility', 'enforce_seat_capacity',
          'enforce_admin_nomination_authority'
      ]);

    IF offenders IS NOT NULL THEN
        RAISE EXCEPTION
            'SECURITY DEFINER functions an anonymous caller can EXECUTE: %. Revoke them FROM PUBLIC, anon (revoking PUBLIC alone is a no-op: ALTER DEFAULT PRIVILEGES gives each new function its own anon grant), or add them to the allowlist above with a reason.',
            offenders;
    END IF;
END $$;

-- 24. SEC-01 -- the admin's membership row is not an ordinary roster row.
--
--     `team_members_update_roster` / `_delete_roster` are `can_manage_roster`, i.e. admin OR
--     COACH, over the whole row. A policy cannot say "not that column" or "not that row's
--     role", so before Sprint 10 a coach could demote the admin, delete their row, or write
--     `role = 'admin'` onto their own -- three ordinary REST calls, reproduced on the seeded
--     stack. `enforce_admin_membership_protection` is what closes it.
--
--     THE TRIGGER NAME IS PART OF THE ASSERTION. BEFORE triggers fire in alphabetical order,
--     and this one has to precede `enforce_member_role_eligibility_trigger` so the refusal is
--     about authority (42501) rather than about whether the attacker happens to have an
--     attestation (23514). Renaming it would silently swap which rule answers first.
--
--     Behavioural proof is `admin-membership-protection.rls.db.test.ts`, as the coach, over
--     PostgREST -- see `docs/environment-divergences.md` section 5. This is the drift check.
DO $$
DECLARE
    v_def text;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'enforce_admin_membership_protection_trigger'
          AND tgrelid = 'public.team_members'::regclass
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'enforce_admin_membership_protection_trigger is missing from team_members -- a '
            'coach can demote or delete the team admin over plain REST (SEC-01)';
    END IF;

    IF 'enforce_admin_membership_protection_trigger' >=
       'enforce_member_role_eligibility_trigger' THEN
        RAISE EXCEPTION
            'the SEC-01 trigger no longer sorts before enforce_member_role_eligibility_trigger, '
            'so the eligibility rule now answers the authority question first';
    END IF;

    v_def := pg_get_functiondef('public.enforce_admin_membership_protection()'::regprocedure);

    IF position('falconforge.admin_transfer' IN v_def) = 0 THEN
        RAISE EXCEPTION
            'enforce_admin_membership_protection no longer honours the transaction-local '
            'admin-transfer flag -- create_team_as_admin and the three transfer RPCs cannot work';
    END IF;

    -- Each of the four legitimate writers of `role = admin` must still raise the flag.
    FOR v_def IN
        SELECT pg_get_functiondef(p.oid)
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('create_team_as_admin', 'transfer_team_admin',
                             'accept_team_admin_nomination', 'operator_transfer_team_admin')
    LOOP
        IF position('falconforge.admin_transfer' IN v_def) = 0 THEN
            RAISE EXCEPTION
                'an admin-transfer RPC no longer sets the falconforge.admin_transfer flag, so '
                'the SEC-01 trigger will refuse it: %', left(v_def, 120);
        END IF;
    END LOOP;
END $$;

SELECT 'schema assertions passed' AS result;
