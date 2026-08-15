-- B7: make Realtime DELETE events actually reach clients.
--
-- realtime.ts subscribes to postgres_changes with `filter: team_id=eq.<id>` for INSERT,
-- UPDATE and DELETE. That works for INSERT/UPDATE, whose payloads carry the full new row.
--
-- It can never work for DELETE. Postgres logical replication only emits the REPLICA
-- IDENTITY columns in the old-record payload, and the default replica identity is the
-- primary key alone. So `team_id` is absent from the DELETE payload, the filter cannot
-- match, and the event is dropped before it reaches the client.
--
-- The visible symptom: deleting a task on one device leaves it on every other device until
-- the every-5th-pull full reconciliation happens to run. At a competition that reads as
-- "the deleted task came back".
--
-- REPLICA IDENTITY FULL makes Postgres emit the entire old row, so `team_id` is present and
-- the filter matches.
--
-- Cost: every UPDATE and DELETE writes the full old row to the WAL rather than just the key.
-- These tables are small (single-digit thousands of rows at most, low write volume) so the
-- extra WAL is not a concern here. Do not apply this pattern blindly to a high-write table.
--
-- Only the tables realtime.ts actually subscribes to are changed.

ALTER TABLE tasks REPLICA IDENTITY FULL;
ALTER TABLE scouting_reports REPLICA IDENTITY FULL;
ALTER TABLE match_plans REPLICA IDENTITY FULL;
ALTER TABLE checklists REPLICA IDENTITY FULL;
ALTER TABLE sub_teams REPLICA IDENTITY FULL;
