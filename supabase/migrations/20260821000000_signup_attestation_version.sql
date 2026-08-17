-- Record the signup attestation at the version the user was actually shown.
--
-- THE BUG
--
-- `handle_new_user` has recorded the signup consent since Sprint 3:
--
--     IF NEW.raw_user_meta_data->>'privacy_accepted' = 'true' THEN
--         INSERT INTO user_attestations (user_id, attestation_type, version)
--         VALUES (NEW.id, 'privacy_and_guidelines', '1.0')
--
-- with the version HARDCODED. Sprint 6 rewrote the legal documents and raised
-- `ATTESTATION_VERSIONS.privacy_and_guidelines` to '2.0' on the client. From that moment the
-- trigger wrote a record the client considered out of date, and `ReAttestationPrompt` -- which
-- asks "have they accepted the CURRENT version" -- told every brand-new account, on its first
-- screen, that the documents had changed since they last accepted them. They had not. The user
-- had accepted the 2.0 text thirty seconds earlier and the row said 1.0.
--
-- `attestations.ts` predicted this exactly, in a comment justifying why the DATABASE deliberately
-- does not know the current version: "duplicating it in a trigger would create two sources of
-- truth that drift on the next legal rewrite." One had already been duplicated in this trigger,
-- and it drifted on the next legal rewrite.
--
-- WHY SPRINT 7'S FIX DID NOT COVER IT
--
-- Sprint 7 found the same symptom from a different cause -- the sign-up form's checkbox was
-- never recorded at all -- and fixed it by calling `recordAttestation` from the client after
-- `signUp`. That writes the correct version, and it works on a machine where signing up
-- produces a session immediately. It does not work in PRODUCTION, where email confirmation is
-- on (`mailer_autoconfirm: false`), because there is no session yet: `recordAttestation` calls
-- `auth.getUser()`, gets nothing, and returns "Not authenticated" to a caller that logs a
-- warning and moves on.
--
-- The local stack has `enable_confirmations = false`, so the client path always fired there and
-- the row it wrote (2.0) masked the row the trigger wrote (1.0). The registration smoke test
-- asserts that a new account is not asked to re-accept, and it passes -- against a
-- configuration production does not have. Confirmed by reading `/auth/v1/settings` on both.
--
-- THE FIX
--
-- The version travels with the consent, in the same signup metadata that already carries
-- `privacy_accepted`. The client remains the only place a version number is WRITTEN DOWN
-- (`ATTESTATION_VERSIONS`); the trigger records what it was told. `coalesce` keeps a client
-- that has not been rebuilt working -- it simply records the old default, which is the honest
-- answer for a client that did not say.
--
-- This runs at account creation, so it is independent of when (or whether) a session appears.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    INSERT INTO users (id, email, full_name, avatar_url, age_classification)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'age_classification'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, users.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        age_classification = COALESCE(EXCLUDED.age_classification, users.age_classification),
        updated_at = now();

    IF NEW.raw_user_meta_data->>'privacy_accepted' = 'true' THEN
        INSERT INTO user_attestations (user_id, attestation_type, version)
        VALUES (
            NEW.id,
            'privacy_and_guidelines',
            -- What the client says it displayed. See the header: the client owns the number.
            COALESCE(NEW.raw_user_meta_data->>'privacy_version', '1.0')
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;
