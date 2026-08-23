-- SEC-10 — an under-13 cannot get an account, and the refusal is the database's.
--
-- WHAT WAS WRONG
--
-- `CompleteProfileForm.tsx` disables the submit button when the age selection is `under_13`,
-- and that was the whole of it. `signUpWithEmail` forwards whatever it is given,
-- `handle_new_user` writes it, and the column's CHECK accepts it. Reproduced against the local
-- stack with plain curl — no client involved:
--
--     POST /auth/v1/signup {"email":"…","data":{"age_classification":"under_13", …}}
--     -> 200, and public.users now holds  (…, under_13, 'Tiny Person')
--
--     POST /rest/v1/rpc/update_user_age_classification {"classification":"under_13"}
--     -> {"success": true}
--
-- `PrivacyPolicy.tsx` states "A member under 13 does not have a FalconForge account and cannot
-- create one." The account is inert afterwards — `join_team_with_invite` refuses `under_13` —
-- so what is actually collected is an email address and a name belonging to a child, which is
-- precisely the collection the policy says never happens. That is the COPPA posture the whole
-- guardian model exists to avoid: plan §3, "FalconForge never collects information from a
-- child — every field is entered by an adult."
--
-- WHERE THE RULE LIVES, AND WHY IT IS ONE RULE
--
-- There are three doors into that column and the finding names two of them. The third is a
-- plain `PATCH /rest/v1/users?id=eq.<me> {"age_classification":"under_13"}`, which
-- `users_update_own` permits — the assessment's own capability matrix lists "direct `users`
-- PATCH" beside the RPC. Fixing the two named doors and leaving that one open would be
-- theatre, and writing the same condition into `handle_new_user`, the RPC and a policy would be
-- `docs/failure-modes.md` §1: one concept, three copies, nothing comparing them.
--
-- So the rule is a BEFORE trigger on `public.users`, which every door has to pass through:
-- `handle_new_user`'s INSERT at signup, the RPC's UPDATE, and any direct PATCH. It raises
-- rather than silently coercing, because a signup that appears to work and produces an account
-- the app refuses to use is worse than one that says no.
--
-- The column CHECK is deliberately NOT narrowed to two values. `join_team_with_invite` still
-- reads `age_classification = 'under_13'` to explain the guardian route, `AgeClassification` in
-- `types.ts` still has three members, and `CompleteProfileForm` still offers the choice — in
-- order to tell the child what to do instead. `under_13` remains a thing a person can SAY; it
-- stops being a thing an account can BE.

CREATE OR REPLACE FUNCTION public.enforce_no_under_13_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.age_classification = 'under_13' THEN
        RAISE EXCEPTION
            'Members under 13 use a guardian-managed profile and do not have an account of their own. Ask a parent or guardian to sign up and add you.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_no_under_13_account_trigger ON users;
CREATE TRIGGER enforce_no_under_13_account_trigger
    BEFORE INSERT OR UPDATE OF age_classification ON users
    FOR EACH ROW EXECUTE FUNCTION enforce_no_under_13_account();

REVOKE ALL ON FUNCTION public.enforce_no_under_13_account() FROM PUBLIC, anon, authenticated;

/*
 * And the earlier, kinder copy of that one rule.
 *
 * The trigger above is the authority. This RPC already validates its argument, and reaching the
 * trigger from here would surface a 500 where the caller's contract is
 * `{success: false, error: …}` — which `updateAgeClassification` in `auth.tsx` renders as a
 * message on the profile screen. Refusing here puts the explanation in front of the person who
 * can act on it, which is the same reason `nominate_team_admin` checks age itself rather than
 * leaving it to `enforce_member_role_eligibility`.
 *
 * It is a copy, and copies drift (§12), so `no-under-13-accounts.db.test.ts` asserts BOTH doors
 * refuse rather than trusting that they agree.
 */
CREATE OR REPLACE FUNCTION public.update_user_age_classification(classification text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF classification = 'under_13' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Members under 13 use a guardian-managed profile and do not have an account of their own.'
        );
    END IF;

    IF classification NOT IN ('13_to_17', '18_plus') THEN
        RETURN json_build_object('success', false, 'error', 'Invalid age classification');
    END IF;

    UPDATE users
    SET age_classification = classification, updated_at = now()
    WHERE id = auth.uid();

    RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_age_classification(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_user_age_classification(text) TO authenticated, service_role;
