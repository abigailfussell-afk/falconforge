-- Take EXECUTE on the directly-called RPCs away from `anon`.
--
-- WHY THIS EXISTS
--
-- `20260816000500_v2_grants.sql` does `GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon,
-- authenticated, service_role`, plus the matching ALTER DEFAULT PRIVILEGES so every function a
-- later migration creates is granted the same way. That was written to fix a real outage --
-- migrations had rebuilt a database PostgREST could not use -- and it fixed it with the widest
-- possible brush. The consequence is that every RPC in this schema, including team
-- administration and licensing, is EXECUTE-granted to unauthenticated callers.
--
-- Sprint 6's B25 is what made this visible. `can_manage_billing` returned NULL rather than
-- false for a non-member, so `IF NOT can_manage_billing(...)` never fired, and
-- `transfer_team_admin` -- SECURITY DEFINER, so its writes do not meet RLS on the way out --
-- accepted an outsider. That is fixed at the root with `coalesce(..., false)`, and an anonymous
-- caller now gets `false` from every capability rather than NULL.
--
-- So this migration fixes nothing that is currently broken, and it is worth being honest about
-- that. It removes the second thing that had to be true for B25 to be reachable from the open
-- internet. Default-deny means an anonymous caller should not hold EXECUTE on
-- `transfer_team_admin` at all, rather than holding it and being refused by a guard -- because
-- the guard is code, and code is what was wrong the first time.
--
-- WHAT IS DELIBERATELY NOT REVOKED
--
-- The capability and predicate functions -- is_team_member, team_can_write, season_is_open,
-- can_manage_*, current_team_role, get_user_team_ids, is_platform_operator, is_profile_guardian,
-- meeting_season_is_open -- keep their grant. They are not an API surface: they are called
-- INSIDE the RLS policies, and a policy is evaluated as the calling role. Revoking them from
-- anon would not harden anything; it would make every anonymous SELECT raise "permission denied
-- for function" instead of returning the empty set. Sprint 3 verified that every table answers
-- anon with `200 []`, and that property is load-bearing -- it is what makes an unauthenticated
-- visitor see an empty app rather than an error page.
--
-- Trigger functions are left alone for the same reason they are harmless: PostgreSQL checks
-- EXECUTE on a trigger function when the trigger is CREATED, not when it fires.
--
-- Every function below is revoked one at a time rather than with a wildcard, so that adding a
-- function to this schema does not silently join or leave the set: a future RPC arrives granted
-- to anon by the default privileges above, and has to be added here on purpose.
--
-- WHY EACH FUNCTION IS REVOKED FROM **PUBLIC** AND NOT JUST FROM anon
--
-- Revoking from `anon` alone is a no-op, and it is a convincing-looking one. PostgreSQL grants
-- EXECUTE on every new function to PUBLIC by default, and `anon` is a member of PUBLIC like
-- every other role. The ACL on `transfer_team_admin` read:
--
--     =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- where the entry with the empty grantee IS PUBLIC. `REVOKE ... FROM anon` duly removed anon's
-- own entry and changed nothing about what anon could call. The first draft of this migration
-- did exactly that, and the behavioural tests caught it -- an ACL assertion would have passed.
--
-- `authenticated` and `service_role` hold their own explicit entries, so revoking PUBLIC does
-- not disturb them. The re-grants below are therefore belt and braces, and are written out so
-- that this migration states the intended end state rather than relying on what came before.

-- Team administration: nominate -> accept -> transfer, and the operator's rescue path.
REVOKE EXECUTE ON FUNCTION public.transfer_team_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_team_admin(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.nominate_team_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nominate_team_admin(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_team_admin_nomination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_team_admin_nomination(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.accept_team_admin_nomination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_team_admin_nomination(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.operator_transfer_team_admin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_transfer_team_admin(uuid, uuid, text) TO authenticated, service_role;

-- Licensing. `grant_team_license` is the operator gifting path; it checks
-- `is_platform_operator()`, and an anonymous caller has no business reaching that check.
REVOKE EXECUTE ON FUNCTION public.grant_team_license(uuid, integer, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_team_license(uuid, integer, timestamptz, text) TO authenticated, service_role;

-- Membership mutations. Both are guarded by a session in the client and by auth.uid() in the
-- function; neither is reachable from the signed-out UI.
REVOKE EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team_as_admin(text, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.join_team_with_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_team_with_invite(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.update_user_age_classification(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_age_classification(text) TO authenticated, service_role;
