-- SEC-17, corrected — the invite panel could not create an invite.
--
-- `20260828000000_sec_17_invite_codes.sql` made `invites.code DEFAULT generate_invite_code()`,
-- declared the generator SECURITY DEFINER, and revoked EXECUTE on it from every API role, on the
-- reasoning that "a DEFAULT is evaluated by the server as part of the INSERT, so nothing needs
-- EXECUTE". That is wrong. A DEFAULT expression is evaluated as the INSERTING role, and Postgres
-- checks EXECUTE on every function it calls. SECURITY DEFINER changes whose privileges the body
-- runs with, not who may call it.
--
-- So every invite a coach generated from the admin panel failed with
-- `permission denied for function generate_invite_code` (42501), and the panel showed only
-- "Failed to create invite". Production from 2026-08-28 to 2026-09-14: zero invites created.
-- `create_team_as_admin` kept working, because it is SECURITY DEFINER and runs as its owner —
-- which is also why the registration screen still printed a code and nothing looked wrong there.
--
-- Every test that proved the DEFAULT worked inserted as `service_role`, which holds EXECUTE; and
-- the one test that inserted as an admin expected a refusal and accepted ANY permission error,
-- so it was green over this. Both are fixed in `invite-code-generation.db.test.ts`.
--
-- THE FIX: SECURITY INVOKER, and EXECUTE for `authenticated`.
--
-- INVOKER because the body needs no elevated privilege — it reads eight bytes from
-- `extensions.gen_random_bytes`, which `authenticated` can already execute — and a SECURITY
-- DEFINER function with an API grant is the shape assertion 23 exists to watch. Granting EXECUTE
-- while leaving it DEFINER would work and would be the wider brush (`docs/failure-modes.md` §6).
--
-- What the grant exposes: `POST /rest/v1/rpc/generate_invite_code` returns eight random symbols
-- to a signed-in user. It is not an oracle — the codes come from the OS CSPRNG, are not stored,
-- and say nothing about any code any team holds — so a caller learns what `openssl rand` would
-- tell them. What SEC-17 actually protects is unchanged: no client can CHOOSE a code, because
-- INSERT and UPDATE on `invites.code` remain revoked, and the DEFAULT is still the only generator.
--
-- `anon` is NOT granted. An anonymous invite INSERT is refused either way (by this function
-- before RLS, rather than by `invites_insert_roster`); granting it would only add an anonymous
-- `/rpc` endpoint that no screen needs.
--
-- Additive and loosening only — safe to apply to the hosted project before the bundle, per
-- `docs/beta-ops.md` "Deploys". No client change is required: the panel already sends exactly
-- the three granted columns.

BEGIN;

ALTER FUNCTION public.generate_invite_code() SECURITY INVOKER;

GRANT EXECUTE ON FUNCTION public.generate_invite_code() TO authenticated;

COMMENT ON FUNCTION public.generate_invite_code() IS
    'SEC-17: the ONE invite-code generator. 8 symbols from a 32-symbol confusable-free alphabet, '
    'drawn from gen_random_bytes (OS CSPRNG). Reached through the invites.code DEFAULT. SECURITY '
    'INVOKER with EXECUTE for authenticated, because a DEFAULT runs as the inserting role '
    '(20260914000000 — the panel could not create invites without it).';

COMMIT;
