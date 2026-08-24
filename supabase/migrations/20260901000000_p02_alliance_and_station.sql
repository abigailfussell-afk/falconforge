-- P-02 — which side of the field, and which driver station.
--
-- A scouting report has always recorded WHO was watched (`opponent_team_number`) and WHEN
-- (`match_number`), and nothing about WHERE. Two things a scouting lead actually asks depend on
-- it: "did they do better on red or blue?" (the field is not symmetric in most FTC games) and
-- "which of these two rows is the one I watched?" when two scouts covered the same match.
--
-- BOTH NULLABLE, and that is the whole design decision here. A scout at a venue is watching a
-- match, not filling in a form, and every required field is a reason for a report not to exist.
-- `match_number` is already optional for exactly this reason (B18: the fabricated "Match 0" came
-- from making an optional number look mandatory), and the same argument applies twice over to a
-- detail somebody may simply not have noted.
--
-- `alliance` is TEXT with a CHECK rather than an enum: an enum needs a migration to add a value,
-- and FRC uses the same two colours while other programs may not. `station` is smallint 1–3,
-- which covers FTC's two and FRC's three — the same reason `match.allianceSize` is a number in
-- the game definition rather than a hardcoded 2.

BEGIN;

ALTER TABLE scouting_reports
    ADD COLUMN IF NOT EXISTS alliance text,
    ADD COLUMN IF NOT EXISTS station  smallint;

-- Named constraints, so a later migration can drop them by name rather than by guessing.
ALTER TABLE scouting_reports
    ADD CONSTRAINT scouting_reports_alliance_valid
    CHECK (alliance IS NULL OR alliance IN ('red', 'blue'));

ALTER TABLE scouting_reports
    ADD CONSTRAINT scouting_reports_station_valid
    CHECK (station IS NULL OR station BETWEEN 1 AND 3);

COMMENT ON COLUMN scouting_reports.alliance IS
    'Which alliance the scouted team played on. NULL when the scout did not note it (P-02).';
COMMENT ON COLUMN scouting_reports.station IS
    'Driver station, 1-based. 1-2 for FTC, 1-3 for FRC. NULL when not noted (P-02).';

COMMIT;
