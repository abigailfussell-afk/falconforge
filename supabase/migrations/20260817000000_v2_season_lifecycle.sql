-- FalconForge — Sprint 4: the season lifecycle.
--
-- THE FIRST FORWARD MIGRATION. The schema froze at the end of Sprint 3, so this file adds to
-- `20260816*` and never edits it. Everything here is written to be applied to a database that
-- already holds real rows: new columns have defaults, and every policy is dropped by name
-- before being recreated so re-running against a partially-migrated database is not a puzzle.
--
-- WHAT THIS ADDS, AND WHY EACH PIECE EXISTS
--
--   seasons.game_title   FTC releases a new game each season and the season's name and the
--                        game's name are not the same string ("2026-2027 Season" vs
--                        "DECODE"). The sprint brief asks for both on a season.
--
--   seasons.is_archived  "Fresh start forward, full history backward." A prior season stays
--                        fully readable and stops accepting writes. `docs/v2-schema.md`
--                        listed this column under "deliberately NOT here — Sprint 4 owns
--                        read-only prior seasons and can add it as a forward migration".
--                        This is that migration.
--
-- WHY ARCHIVAL IS ENFORCED HERE RATHER THAN IN THE CLIENT
--
-- The sprint brief says an archived season must take "no edit/queue writes". A client-side
-- rule would be honoured only by a client that has heard about the archive. A device that was
-- offline when the season rolled over still believes the old season is current, and every
-- edit it makes would be accepted by the server — which is the same mistake as enforcing
-- licensing with a banner. Sprint 3 put entitlement in the database for exactly this reason;
-- archival gets the same treatment. The client-side half is UX in front of this rule, not a
-- substitute for it.
--
-- WHAT IS DELIBERATELY *NOT* GATED
--
--   * `seasons` itself. Un-archiving is an UPDATE of the season row, so gating that table on
--     its own flag would make archival a one-way door. Deleting an archived season likewise
--     stays available — `can_manage_structure` still governs both.
--   * `can_manage_roster`. The roster is team-level, not season-level; it was already exempt
--     from entitlement for the same reason and nothing about it belongs to a season.

-- ==========================================================================
-- COLUMNS
-- ==========================================================================

ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS game_title text
        CONSTRAINT seasons_game_title_not_blank
        CHECK (game_title IS NULL OR char_length(trim(game_title)) > 0);

-- NOT NULL with a default, so every existing season is open and no backfill is needed. The
-- NOT NULL is load-bearing rather than tidy: the policies below read `NOT is_archived`, and
-- NULL there is neither true nor false, so a nullable column would make a season with no
-- flag silently reject every write.
ALTER TABLE seasons
    ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN seasons.game_title IS
    'The FTC game this season plays (e.g. DECODE). Distinct from the season name.';
COMMENT ON COLUMN seasons.is_archived IS
    'A prior season: fully readable, accepts no writes to anything it scopes. Enforced by '
    'season_is_open() in the write policies of every season-scoped table, not by the client.';

-- B22 — season deletions never reached other devices.
--
-- `realtime.ts` subscribes to every entity in SYNCED_ENTITIES, and that list has always
-- included `seasons`. The B7 migration gave REPLICA IDENTITY FULL to the five tables it
-- listed and `seasons` was not one of them, so under the default replica identity (primary
-- key only) a season DELETE emits no `team_id` in its old-record payload, the
-- `team_id=eq.<id>` filter cannot match, and the event is dropped before any client sees it.
-- The season stayed on every other device until the every-5th-pull reconciliation. Assertion
-- 5 did not catch it because its list was written from the same five-table set rather than
-- from what the client actually subscribes to; that list now includes seasons.
ALTER TABLE seasons REPLICA IDENTITY FULL;

-- ==========================================================================
-- THE PREDICATE
-- ==========================================================================

/*
 * Is this season still accepting writes?
 *
 * SECURITY DEFINER for the same reason `team_can_write` is: a policy must not depend on the
 * reader's own visibility of the row that decides their permissions. STABLE so Postgres can
 * cache it within a statement, which matters when it is evaluated per row of a bulk update.
 *
 * Takes the team id as well as the season id and matches on both. The composite
 * `(season_id, team_id)` foreign key already guarantees they agree, so this is belt and
 * braces — but it means the predicate is self-contained rather than correct only because
 * something else is.
 *
 * A season id that does not exist returns false. There is no such row to write against, and
 * failing closed is the right answer for a predicate that gates writes.
 */
CREATE OR REPLACE FUNCTION public.season_is_open(p_season_id uuid, p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM seasons
        WHERE id = p_season_id
          AND team_id = p_team_id
          AND NOT is_archived
    );
$$;

/*
 * The same question for a row that hangs off a meeting rather than off a season directly.
 *
 * `meeting_attendance` is the one season-scoped table with no `season_id` of its own — it
 * carries `meeting_id` plus a denormalised `team_id` so RLS can scope it without a join.
 * Without this, attendance would be the single table on which an archived season still
 * accepted writes, which is the kind of one-table exception that is discovered years later.
 * Meetings have no UI until Sprint 8; the invariant is made total now so that sprint inherits
 * a rule rather than an exception.
 */
CREATE OR REPLACE FUNCTION public.meeting_season_is_open(p_meeting_id uuid, p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM meetings m
        JOIN seasons s ON s.id = m.season_id AND s.team_id = m.team_id
        WHERE m.id = p_meeting_id
          AND m.team_id = p_team_id
          AND NOT s.is_archived
    );
$$;

-- ==========================================================================
-- POLICIES
-- ==========================================================================
--
-- One policy per verb is the rule (assertion 9), so each of these is DROPped and recreated
-- rather than joined by a second policy — policies for a verb OR together, so an additional
-- policy would WIDEN the permission rather than narrowing it. Adding `AND season_is_open(...)`
-- to the existing predicate is the only shape that restricts.
--
-- SELECT is untouched everywhere. An archived season is read-only, not hidden: "full history
-- backward" is the whole point of keeping it.

-- The season-scoped tables that carry `season_id` directly and are governed by
-- `can_manage_content`.
--
-- `checklists` is NOT in this loop; see below.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tasks', 'scouting_reports', 'match_plans', 'meetings'
    ] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %1$s_insert_content ON %1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_update_content ON %1$I', t);
        EXECUTE format('DROP POLICY IF EXISTS %1$s_delete_content ON %1$I', t);

        EXECUTE format(
            'CREATE POLICY %1$s_insert_content ON %1$I
                 FOR INSERT WITH CHECK (
                     can_manage_content(team_id) AND season_is_open(season_id, team_id))', t);
        -- USING is evaluated against the row as it stands, WITH CHECK against the row as it
        -- would become. Both are gated: the first stops an edit to a row already in an
        -- archived season, the second stops a row being MOVED into one.
        EXECUTE format(
            'CREATE POLICY %1$s_update_content ON %1$I
                 FOR UPDATE
                 USING (can_manage_content(team_id) AND season_is_open(season_id, team_id))
                 WITH CHECK (
                     can_manage_content(team_id) AND season_is_open(season_id, team_id))', t);
        EXECUTE format(
            'CREATE POLICY %1$s_delete_content ON %1$I
                 FOR DELETE USING (
                     can_manage_content(team_id) AND season_is_open(season_id, team_id))', t);
    END LOOP;
END $$;

/*
 * `checklists`, where a TEMPLATE is exempt from the archive rule.
 *
 * A template (`is_template = true`) is a team-level library entry. Its `season_id` records
 * only which season it was captured FROM — provenance, not scope; nothing reads it as scope,
 * and `checklists_one_per_season` excludes templates from the one-per-season rule precisely
 * because they do not belong to a season the way a working checklist does.
 *
 * Without this exemption, saving a template while looking at an archived season is refused,
 * and that is the single most likely moment to want one: a team looks back at the checklist
 * they spent a season refining and saves it for next year. Found by doing exactly that in a
 * browser — the UI offered it, the server refused it, and the change sat in the queue
 * retrying with the sync indicator giving no reason. That is the silent-write failure this
 * sprint exists to stop, reintroduced by the sprint itself.
 *
 * It cannot be used to smuggle a write into an archived season. A template is invisible to
 * the working-checklist read path (which filters `is_template = false`), and flipping one to
 * `is_template = false` is caught by the UPDATE policy's WITH CHECK — that clause sees the
 * NEW row, which would be a working checklist in a closed season.
 */
DROP POLICY IF EXISTS checklists_insert_content ON checklists;
DROP POLICY IF EXISTS checklists_update_content ON checklists;
DROP POLICY IF EXISTS checklists_delete_content ON checklists;

CREATE POLICY checklists_insert_content ON checklists
    FOR INSERT WITH CHECK (
        can_manage_content(team_id)
        AND (is_template OR season_is_open(season_id, team_id)));

CREATE POLICY checklists_update_content ON checklists
    FOR UPDATE
    USING (can_manage_content(team_id)
           AND (is_template OR season_is_open(season_id, team_id)))
    WITH CHECK (can_manage_content(team_id)
                AND (is_template OR season_is_open(season_id, team_id)));

CREATE POLICY checklists_delete_content ON checklists
    FOR DELETE USING (
        can_manage_content(team_id)
        AND (is_template OR season_is_open(season_id, team_id)));

-- Attendance, reached through its meeting.
DROP POLICY IF EXISTS meeting_attendance_insert_content ON meeting_attendance;
DROP POLICY IF EXISTS meeting_attendance_update_content ON meeting_attendance;
DROP POLICY IF EXISTS meeting_attendance_delete_content ON meeting_attendance;

CREATE POLICY meeting_attendance_insert_content ON meeting_attendance
    FOR INSERT WITH CHECK (
        can_manage_content(team_id) AND meeting_season_is_open(meeting_id, team_id));

CREATE POLICY meeting_attendance_update_content ON meeting_attendance
    FOR UPDATE
    USING (can_manage_content(team_id) AND meeting_season_is_open(meeting_id, team_id))
    WITH CHECK (can_manage_content(team_id) AND meeting_season_is_open(meeting_id, team_id));

CREATE POLICY meeting_attendance_delete_content ON meeting_attendance
    FOR DELETE USING (
        can_manage_content(team_id) AND meeting_season_is_open(meeting_id, team_id));

-- Sub-teams are `can_manage_structure` rather than `can_manage_content` (seasons and
-- sub-teams are the shape of the team's work, which students do not redraw), but they belong
-- to a season just as firmly and an archived season's roster of sub-teams is history.
DROP POLICY IF EXISTS sub_teams_insert_structure ON sub_teams;
DROP POLICY IF EXISTS sub_teams_update_structure ON sub_teams;
DROP POLICY IF EXISTS sub_teams_delete_structure ON sub_teams;

CREATE POLICY sub_teams_insert_structure ON sub_teams
    FOR INSERT WITH CHECK (
        can_manage_structure(team_id) AND season_is_open(season_id, team_id));

CREATE POLICY sub_teams_update_structure ON sub_teams
    FOR UPDATE
    USING (can_manage_structure(team_id) AND season_is_open(season_id, team_id))
    WITH CHECK (can_manage_structure(team_id) AND season_is_open(season_id, team_id));

CREATE POLICY sub_teams_delete_structure ON sub_teams
    FOR DELETE USING (
        can_manage_structure(team_id) AND season_is_open(season_id, team_id));
