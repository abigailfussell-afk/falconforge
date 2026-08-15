-- Schema assertions, run against the local stack after `supabase db reset`.
--
-- Purpose: prove that supabase/migrations/ alone can reconstruct the database. Until
-- 2026-08-09 it could not -- the migration history began at 009 and the 001-008 that
-- created the tables were never committed, so the cloud project was the only source of
-- truth. If this file starts failing, that has silently become true again.
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
    -- 11 tables. sub_team_members is deliberately NOT here: 013 creates it and the security
    -- audit alters it, but it does not exist in the hosted project (verified 2026-08-09 via
    -- PostgREST -> PGRST205). Local must mirror production, not the migration fiction.
    FROM unnest(ARRAY[
        'checklists', 'invites', 'match_plans', 'scouting_reports', 'seasons',
        'sub_teams', 'tasks', 'team_members', 'teams',
        'user_attestations', 'users'
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
--    exposure patched in 014_fix_invites_rls.sql.
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

-- 4. The delta-sync contract: every table pulled incrementally by sync.ts must have an
--    updated_at column. sync.ts filters with `query.gte('updated_at', ...)`, and a missing
--    column makes that query error; pullChangesFromServer swallows it into a console.warn
--    and moves on, so the table just quietly stops delta-syncing.
--
--    015_delta_sync_columns.sql adds these to scouting_reports, sub_teams and seasons. The
--    2026-03-08 backup this baseline came from does NOT contain them despite being dated the
--    same day, so either the backup predates that migration or the migration never reached
--    production. UNVERIFIED against production -- see the note in the baseline migration.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(expected.name, ', ' ORDER BY expected.name) INTO missing
    FROM unnest(ARRAY[
        'tasks', 'seasons', 'sub_teams', 'match_plans', 'checklists', 'scouting_reports'
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

SELECT 'schema assertions passed' AS result;
