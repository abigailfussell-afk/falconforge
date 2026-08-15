-- B7: make Realtime DELETE events actually reach clients.
--
-- `realtime.ts` subscribes to postgres_changes with `filter: team_id=eq.<id>` for INSERT,
-- UPDATE and DELETE. That works for INSERT/UPDATE, whose payloads carry the full new row.
--
-- It can never work for DELETE under the default replica identity. Logical replication only
-- emits the REPLICA IDENTITY columns in the old-record payload, and the default is the
-- primary key alone — so `team_id` is absent, the filter cannot match, and the event is
-- dropped before it reaches any client.
--
-- The visible symptom: deleting a task on one device leaves it on every other device until
-- the every-5th-pull full reconciliation happens to run. At a competition that reads as
-- "the deleted task came back".
--
-- Cost: every UPDATE and DELETE writes the whole old row to the WAL rather than just the
-- key. These tables hold single-digit thousands of rows at most, at low write volume. Do
-- not copy this onto a high-write table without measuring.
--
-- Only the tables `realtime.ts` actually subscribes to are changed. `schema_assertions.sql`
-- asserts this list, so adding a subscription without adding the table here fails the build.

ALTER TABLE tasks            REPLICA IDENTITY FULL;
ALTER TABLE scouting_reports REPLICA IDENTITY FULL;
ALTER TABLE match_plans      REPLICA IDENTITY FULL;
ALTER TABLE checklists       REPLICA IDENTITY FULL;
ALTER TABLE sub_teams        REPLICA IDENTITY FULL;
