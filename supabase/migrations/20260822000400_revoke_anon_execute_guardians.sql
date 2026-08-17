-- Take EXECUTE on Sprint 9's RPCs away from `anon`, which Sprint 9 failed to do.
--
-- WHAT WENT WRONG, AND WHY IT LOOKED RIGHT
--
-- `20260822000200_guardian_access.sql` ends with what looks like the correct incantation:
--
--     REVOKE ALL ON FUNCTION public.claim_managed_profile(text) FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION public.claim_managed_profile(text) TO authenticated;
--
-- and all four RPCs remained callable by an unauthenticated client. Verified against the
-- HOSTED project after the migration landed: every one answered `anon` with 200.
--
-- `20260816000500_v2_grants.sql` does not only grant to PUBLIC. It also does
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, ...
--
-- so a function created by a later migration arrives with its OWN explicit `anon=X/postgres`
-- entry in the ACL, independent of PUBLIC's. Revoking PUBLIC removes the empty-grantee entry
-- and leaves anon's untouched.
--
-- `20260819000000_revoke_anon_execute.sql` says this in its header, in as many words -- "a
-- future RPC arrives granted to anon by the default privileges above, and has to be added here
-- on purpose" -- and revokes `FROM PUBLIC, anon`. Sprint 9 wrote the half of that incantation
-- that reads as the careful one. This is `docs/failure-modes.md` section 6: the widest-brush
-- default, narrowed only later, and the narrowing missed.
--
-- HOW BAD IT WAS
--
-- Not exploitable, and worth saying so plainly rather than implying otherwise. Every one of
-- these is SECURITY DEFINER and asks who the caller is on its first executable line;
-- `auth.uid()` is NULL for `anon`, so `is_profile_guardian` returns false and
-- `claim_managed_profile`'s user lookup finds nothing. Production returned a refusal body, not
-- data. What was missing is the layer BEFORE the guard -- which is the entire point of the
-- Sprint 8 migration, because "the guard is code, and code is what was wrong the first time"
-- (B25).
--
-- WHAT IS DELIBERATELY NOT REVOKED
--
-- `is_team_guardian` and `guardian_member_ids` keep their grant, for the same reason
-- `is_team_member` and `is_profile_guardian` do. They are not an API surface: they are called
-- INSIDE the `teams` / `meetings` / `meeting_attendance` SELECT policies, and a policy is
-- evaluated as the CALLING role. Revoking them from anon would not harden anything -- an
-- anonymous caller already gets false and the empty set from both -- and it would turn every
-- anonymous SELECT on those three tables into "permission denied for function" instead of
-- `200 []`. Sprint 3 verified that property and it is load-bearing: it is what makes an
-- unauthenticated visitor see an empty app rather than an error page.

REVOKE EXECUTE ON FUNCTION public.join_team_with_invite_for_child(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_team_with_invite_for_child(text, uuid)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.offer_managed_profile_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_managed_profile_promotion(uuid)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.withdraw_managed_profile_promotion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_managed_profile_promotion(uuid)
    TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.claim_managed_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_managed_profile(text)
    TO authenticated, service_role;
