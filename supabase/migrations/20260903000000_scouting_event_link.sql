-- Scouting reports can name an event by IDENTITY, not only by spelling.
--
-- THE DEFECT. `scouting_reports.event_name` is free text and the summary's filter groups on it
-- EXACTLY: `eventsIn()` keys a Map on the trimmed string, which is case-sensitive. Two scouts at
-- the same competition typing "League Meet 1" and "League meet 1" produce two events in the
-- filter and two separate summaries, and nothing tells anybody. Scouting that is silently split
-- in half is worse than scouting that is missing, because the numbers still look plausible.
--
-- `competition_events` was built in Sprint 18 for exactly this, and P-02's minimal set
-- deliberately did not touch it — its exit criterion said "the current event's reports" and said
-- nothing about the entity. This is that follow-up.
--
-- COMPOSITE FK, matching `event_matches`. `FOREIGN KEY (season_event_id, team_id) REFERENCES
-- competition_events (id, team_id)` rather than a plain reference to `id`, because a single-column
-- FK would let one team's report point at another team's event — B21's shape, where knowing a uuid
-- is the entire attack. The composite makes the tenant part of the constraint, so the database
-- refuses a cross-tenant link rather than relying on a policy to notice.
--
-- ON DELETE SET NULL, not CASCADE. Deleting an event must not delete the scouting done at it; the
-- reports fall back to their `event_name` text, which is exactly the state every existing row is
-- already in. Note this is a SINGLE-column SET NULL on a composite key, which is the trap
-- documented in the erasure runbook — `SET NULL` nulls EVERY column in the key, and `team_id` is
-- NOT NULL. So it is spelled `ON DELETE SET NULL (season_event_id)`, the per-column form Postgres
-- 15+ supports, which nulls only the link and leaves the tenant intact.
--
-- NULLABLE, and it stays nullable. Free text remains valid: a scout at an event the coach has not
-- entered yet must still be able to record what they saw. A column that forced an event would be
-- a gate with no door on the one screen used under time pressure.

ALTER TABLE scouting_reports
    ADD COLUMN IF NOT EXISTS season_event_id uuid;

-- `competition_events` needs the composite target to reference. It already has `UNIQUE (id, team_id)`
-- from `20260826000000`; asserted here rather than assumed, because a missing unique index would
-- make the ADD CONSTRAINT below fail with a message about no matching key, which reads like a data
-- problem rather than a schema one.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'competition_events'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (id, team_id)'
    ) THEN
        RAISE EXCEPTION
            'competition_events has no UNIQUE (id, team_id); the composite FK below cannot be created. '
            'That constraint is what makes a cross-tenant event link impossible (B21).';
    END IF;
END $$;

ALTER TABLE scouting_reports
    DROP CONSTRAINT IF EXISTS scouting_reports_season_event_fk;

ALTER TABLE scouting_reports
    ADD CONSTRAINT scouting_reports_season_event_fk
    FOREIGN KEY (season_event_id, team_id)
    REFERENCES competition_events (id, team_id)
    ON DELETE SET NULL (season_event_id);

-- The summary filters by event within a team and season, which is the shape this index serves.
CREATE INDEX IF NOT EXISTS scouting_reports_season_event_idx
    ON scouting_reports (team_id, season_id, season_event_id);

COMMENT ON COLUMN scouting_reports.season_event_id IS
    'The competition_events row this report was taken at, when the team has entered the event. '
    'NULL is normal and permanent for reports recorded against free-text event_name, including '
    'every row that predates this column. Readers must fall back to event_name.';
