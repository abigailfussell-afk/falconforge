-- WALK-A-11 — a length limit on every title and name column.
--
-- The walkthrough stored a 165-character meeting title and a 125-character sub-team name, both
-- verbatim, because nothing in the stack had an opinion about length. The client cap added in the
-- same change (src/lib/text-limits.ts, TITLE_MAX_LENGTH = 120) is the one a user meets; this is
-- the one that holds when the client is an older bundle, a direct PostgREST call, or a sync queue
-- drained from a device that has not reloaded in a month.
--
-- 120 IS WRITTEN IN TWO PLACES and that is a hand-maintained pair (docs/failure-modes.md §12).
-- `src/test/__tests__/title-length-limits.test.ts` parses this file and the TS constant and fails
-- if they disagree, so the drift is caught by the Gate rather than by a dead-lettered write.
--
-- char_length(), not length() or octet_length(): code POINTS. A team called "Falcons 🦅" should be
-- measured the way a person counts it, and octet_length would charge four bytes for the bird.
-- btrim() first, so 120 characters plus trailing spaces is not a rejection the user cannot see.

BEGIN;

-- --------------------------------------------------------------------------------------------
-- Fail loudly if any existing row would violate, rather than letting ADD CONSTRAINT do it.
--
-- ADD CONSTRAINT's own error names the constraint and the table and stops at the first one, which
-- is the least useful moment to find out that production has eleven long titles across four
-- tables. This reports all of them, once, before anything is altered. Truncating them silently
-- was the alternative and is not on offer: a title is something a person wrote.
-- --------------------------------------------------------------------------------------------
DO $$
DECLARE
    v_rows text;
BEGIN
    SELECT string_agg(format('%s (%s rows, longest %s)', src, n, longest), '; ' ORDER BY src)
      INTO v_rows
      FROM (
        SELECT 'tasks.title' AS src, count(*) AS n, max(char_length(btrim(title))) AS longest
          FROM tasks WHERE char_length(btrim(title)) > 120
        UNION ALL
        SELECT 'meetings.title', count(*), max(char_length(btrim(title)))
          FROM meetings WHERE char_length(btrim(title)) > 120
        UNION ALL
        SELECT 'sub_teams.name', count(*), max(char_length(btrim(name)))
          FROM sub_teams WHERE char_length(btrim(name)) > 120
        UNION ALL
        SELECT 'seasons.name', count(*), max(char_length(btrim(name)))
          FROM seasons WHERE char_length(btrim(name)) > 120
        UNION ALL
        SELECT 'checklists.name', count(*), max(char_length(btrim(name)))
          FROM checklists WHERE char_length(btrim(name)) > 120
        UNION ALL
        SELECT 'match_plans.title', count(*), max(char_length(btrim(title)))
          FROM match_plans WHERE char_length(btrim(title)) > 120
        UNION ALL
        SELECT 'competition_events.name', count(*), max(char_length(btrim(name)))
          FROM competition_events WHERE char_length(btrim(name)) > 120
        UNION ALL
        SELECT 'teams.name', count(*), max(char_length(btrim(name)))
          FROM teams WHERE char_length(btrim(name)) > 120
      ) AS over
     WHERE n > 0;

    IF v_rows IS NOT NULL THEN
        RAISE EXCEPTION
            'WALK-A-11: rows exceed the 120-character title limit and must be shortened by hand first: %',
            v_rows;
    END IF;
END $$;

-- --------------------------------------------------------------------------------------------
-- The constraints.
--
-- NOT NULL is NOT asserted here — several of these columns are nullable today and changing that
-- is a different decision with different consequences. `char_length(NULL) > 120` is NULL, and a
-- CHECK passes on NULL, so a nullable column keeps its nulls and gains the cap.
-- --------------------------------------------------------------------------------------------
ALTER TABLE tasks
    ADD CONSTRAINT tasks_title_length CHECK (char_length(btrim(title)) <= 120);

ALTER TABLE meetings
    ADD CONSTRAINT meetings_title_length CHECK (char_length(btrim(title)) <= 120);

ALTER TABLE sub_teams
    ADD CONSTRAINT sub_teams_name_length CHECK (char_length(btrim(name)) <= 120);

ALTER TABLE seasons
    ADD CONSTRAINT seasons_name_length CHECK (char_length(btrim(name)) <= 120);

ALTER TABLE checklists
    ADD CONSTRAINT checklists_name_length CHECK (char_length(btrim(name)) <= 120);

ALTER TABLE match_plans
    ADD CONSTRAINT match_plans_title_length CHECK (char_length(btrim(title)) <= 120);

ALTER TABLE competition_events
    ADD CONSTRAINT competition_events_name_length CHECK (char_length(btrim(name)) <= 120);

ALTER TABLE teams
    ADD CONSTRAINT teams_name_length CHECK (char_length(btrim(name)) <= 120);

COMMIT;
