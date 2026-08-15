-- Grant the API roles access to public tables.
--
-- WHY THIS IS NEEDED, AND WHY IT WAS NOT BEFORE
--
-- PostgREST connects as `anon`, `authenticated` or `service_role`. Those roles need
-- ordinary SQL privileges before RLS is even consulted: a missing GRANT produces
-- `permission denied for table teams`, which is a privilege error, not a policy denial.
--
-- Supabase used to configure default privileges so that any table created in `public` was
-- automatically granted to those three roles. Newer versions of the local stack do not, so
-- tables created by these migrations came out with only REFERENCES/TRIGGER/TRUNCATE --
-- unusable through the API. Rebuilding the database from `supabase/migrations/` produced a
-- schema the application could not read or write a single row of.
--
-- The hosted project predates the change and has the grants already, which is why nothing
-- was visibly broken: the gap was only ever in a from-scratch rebuild. The CI schema job
-- exists to prove exactly that rebuild works, and could not see this because it runs its
-- assertions as `postgres`, who has full rights regardless. The behavioural database suite
-- added in Sprint 2 connects as the real API roles, and failed on contact.
--
-- SECURITY: granting DML to `anon` is not a hole and is what Supabase's own bootstrap does.
-- RLS is the boundary, and it is default-deny -- every policy in this schema requires
-- `auth.uid()`, which is NULL for an unauthenticated request. `schema_assertions.sql`
-- asserts RLS is enabled on every table, and the behavioural suite asserts an anonymous
-- client can reach nothing. Both of those are what make this safe; neither may be removed.
--
-- Idempotent: re-granting an existing privilege is a no-op, so this applies cleanly to the
-- hosted project as well as to a fresh database.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Everything that exists now.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- And everything a later migration creates. These apply to objects created by the role
-- running migrations (`postgres`), which is how every table in this schema is made.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
