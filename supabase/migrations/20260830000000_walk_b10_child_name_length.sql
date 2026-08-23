-- WALK-B-10 — the one name column Sprint 19's length pass missed.
--
-- `20260827000000_title_length_limits.sql` capped eight title/name columns at 120 characters
-- after the walkthrough stored a 165-character meeting title verbatim. It was written from
-- `information_schema.columns` for every `title`/`name` column in public — and it did not
-- include `managed_profiles.full_name`, which carries only `char_length(trim(full_name)) > 0`.
--
-- So a guardian could add a child called "Zoë 🚀 Verylongchildname…" at 142 characters and it
-- was accepted, stored, and rendered in full in five places: the coach's pending-approval list,
-- the roster, the "Who is joining?" select on the join screen, and every guardian sentence that
-- names the child. That is the worst column in the schema to have missed, because it is the one
-- an adult types on behalf of a minor and it lands on other people's screens.
--
-- 120 IS THE SAME NUMBER AS THE OTHER EIGHT, deliberately: this is one limit, not two.
-- `src/lib/text-limits.ts` holds the client half and
-- `src/test/__tests__/title-length-limits.test.ts` reads BOTH migrations and requires every
-- CHECK to state exactly `TITLE_MAX_LENGTH`, so the pair cannot drift (failure-modes §12).
--
-- Not folded into the earlier migration: 31 migrations are applied to production, and the
-- schema is forward-only from the beta onboarding onwards. Editing a migration that has run is
-- how a database and its history stop agreeing.

BEGIN;

-- Same guard, same reason as the Sprint 19 migration: ADD CONSTRAINT stops at the first
-- offending row and names only the table, which is the least useful moment to discover how many
-- there are. A child's name is something a parent wrote; it is reported, never truncated.
DO $$
DECLARE
    v_n integer;
    v_longest integer;
BEGIN
    SELECT count(*), max(char_length(btrim(full_name)))
      INTO v_n, v_longest
      FROM managed_profiles
     WHERE char_length(btrim(full_name)) > 120;

    IF v_n > 0 THEN
        RAISE EXCEPTION
            'WALK-B-10: % managed_profiles rows exceed the 120-character name limit (longest %) and must be shortened by hand first',
            v_n, v_longest;
    END IF;
END $$;

-- One line, like the eight in the Sprint 19 migration: the drift test reads
-- `CONSTRAINT <table>_<column>_length CHECK (char_length(btrim(<column>))` as one expression,
-- and a line break between ADD CONSTRAINT and CHECK made it invisible to the check whose entire
-- job is noticing that a column was capped in one place and not the other.
ALTER TABLE managed_profiles
    ADD CONSTRAINT managed_profiles_full_name_length CHECK (char_length(btrim(full_name)) <= 120);

COMMIT;
