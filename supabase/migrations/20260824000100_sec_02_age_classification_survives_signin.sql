-- SEC-02 — "I've turned 18" survives the next sign-in.
--
-- WHAT WAS WRONG
--
-- `on_auth_user_created` is `AFTER INSERT OR UPDATE ON auth.users`, and GoTrue UPDATEs that
-- table on every password sign-in (`last_sign_in_at`), on `updateUser`, on a password change
-- and on an email change. `handle_new_user`'s conflict branch read
--
--     age_classification = COALESCE(EXCLUDED.age_classification, users.age_classification)
--
-- where `EXCLUDED.age_classification` is `raw_user_meta_data->>'age_classification'` — the
-- value chosen at SIGNUP, which nothing ever updates. So the metadata won every time, and the
-- column was reset to the signup answer on the user's next login. Reproduced on the seeded
-- stack as `iron-student0@` (metadata `13_to_17`):
--
--     rpc update_user_age_classification('18_plus')  -> users.age_classification = 18_plus
--     POST /auth/v1/token?grant_type=password        -> users.age_classification = 13_to_17
--     PUT  /auth/v1/user {"data":{"full_name":"…"}}  -> users.age_classification = 13_to_17
--
-- Sprint 9's `v2/age-classification-writer` fixed the CLIENT half of this (B27: `ensureUserProfile`
-- wrote signup metadata back over the column on every boot) and `FALCONFORGE_V2_PLAN.md` §8
-- recorded the whole finding as resolved. The server half was never touched, and it reverts the
-- correction on its own — so the plan's "✅ RESOLVED" line is corrected in the same commit as
-- this migration. The class is `docs/failure-modes.md` §1: one concept (a person's age) with two
-- writers that nothing compared afterwards.
--
-- THE RULE THIS REPLACES IT WITH
--
-- The trigger propagates a signup-metadata field only when THAT FIELD ACTUALLY CHANGED, and
-- otherwise leaves the profile row alone. Stated once, it fixes both columns the COALESCE was
-- wrong about:
--
--   * `age_classification` — nothing ever writes the metadata after signup, and
--     `update_user_age_classification` writes the COLUMN. So the metadata can only ever fill a
--     NULL (the `handle_new_user`/`ensureUserProfile` race), never overwrite an answer. This
--     also matches what the client already believes: "The row wins; metadata is only ever a
--     fallback" (`auth.tsx`).
--
--   * `full_name` / `avatar_url` — these DO get written after signup, by
--     `auth.updateUser({ data: { full_name } })`, and this trigger is the only thing that lands
--     that rename in `public.users` (from where `sync_user_to_team_members` carries it to the
--     roster). Simply letting the existing value win — the shortest reading of the finding —
--     would have silently deleted the rename path: the sidebar would update and the roster and
--     comments would not, which is the exact defect Sprint 5 spent a pass removing. So they are
--     re-applied when the metadata changed, and left alone when it did not, which is what makes
--     a correction written straight to `public.users` survive a plain sign-in.
--
-- The attestation block below is `20260821000000_signup_attestation_version.sql`'s, unchanged.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    -- On INSERT there is no OLD to compare against, and the conflict branch is then the
    -- `ensureUserProfile` race: the client got there first with a partial row, and the signup
    -- metadata is the better answer for every column it carries.
    v_name_changed boolean := TG_OP = 'INSERT'
        OR (OLD.raw_user_meta_data->>'full_name') IS DISTINCT FROM (NEW.raw_user_meta_data->>'full_name')
        OR (OLD.raw_user_meta_data->>'name')      IS DISTINCT FROM (NEW.raw_user_meta_data->>'name');
    v_avatar_changed boolean := TG_OP = 'INSERT'
        OR (OLD.raw_user_meta_data->>'avatar_url') IS DISTINCT FROM (NEW.raw_user_meta_data->>'avatar_url');
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
        -- GoTrue owns the address; there is no other writer.
        email = EXCLUDED.email,
        full_name = CASE WHEN v_name_changed
                         THEN COALESCE(EXCLUDED.full_name, users.full_name)
                         ELSE users.full_name END,
        avatar_url = CASE WHEN v_avatar_changed
                          THEN COALESCE(EXCLUDED.avatar_url, users.avatar_url)
                          ELSE users.avatar_url END,
        -- Note the argument order: the COLUMN first. This is the whole of SEC-02.
        age_classification = COALESCE(users.age_classification, EXCLUDED.age_classification),
        updated_at = now();

    IF NEW.raw_user_meta_data->>'privacy_accepted' = 'true' THEN
        INSERT INTO user_attestations (user_id, attestation_type, version)
        VALUES (
            NEW.id,
            'privacy_and_guidelines',
            -- What the client says it displayed. The client owns the number; see
            -- `20260821000000_signup_attestation_version.sql`.
            COALESCE(NEW.raw_user_meta_data->>'privacy_version', '1.0')
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;
