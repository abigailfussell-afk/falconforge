-- Grant the API roles access to public objects.
--
-- KEEP THIS FILE LAST. It grants on everything that exists at the point it runs, and then
-- sets default privileges for everything created after it. A migration inserted between the
-- tables and this file is covered by the first half; one added later is covered by the
-- second. Moving this earlier silently un-covers every table defined after it.
--
-- WHY IT IS NEEDED
--
-- PostgREST connects as `anon`, `authenticated` or `service_role`. Those roles need ordinary
-- SQL privileges before RLS is even consulted: a missing GRANT produces
-- `permission denied for table teams`, which is a privilege error, not a policy denial.
--
-- Supabase used to configure default privileges so that anything created in `public` was
-- granted to those three roles automatically. Newer stack versions do not, so tables created
-- by migrations came out with only REFERENCES/TRIGGER/TRUNCATE — unusable through the API.
-- Rebuilding the database from `supabase/migrations/` produced a schema the application
-- could not read a single row of, and the CI schema job could not see it because those
-- assertions run as `postgres`, who has full rights regardless. The behavioural suite, which
-- connects as the real API roles, failed on contact.
--
-- This was found on `main` the day before the Sprint 3 squash, and the plan's parking list
-- carried a red note saying this file's contents must survive it. They did — including the
-- ALTER DEFAULT PRIVILEGES half, which is the part that would have quietly broken every one
-- of the six tables V2 adds.
--
-- SECURITY
--
-- Granting DML to `anon` is not a hole, and it is what Supabase's own bootstrap does. RLS is
-- the boundary and it is default-deny: every policy in this schema requires `auth.uid()`,
-- which is NULL for an unauthenticated request. `schema_assertions.sql` asserts RLS is
-- enabled on every table, and the behavioural suite asserts an anonymous client can reach
-- nothing. Both of those are what make this safe. Do not keep one and drop the other.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Everything that exists now — including the `team_entitlement` view, which is a relation
-- like any other as far as privileges are concerned.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- And everything a later migration creates. These apply to objects created by the role that
-- runs migrations (`postgres`), which is how every object in this schema is made.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
