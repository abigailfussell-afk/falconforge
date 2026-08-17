-- Bring `guardian_consents` up to the delta-sync contract every other synced table already meets.
--
-- Sprint 9 enrols `managed_profiles` and `guardian_consents` in the entity registry, which is
-- what puts them through the one read path (`pullFromServer`) and the one write queue. The read
-- path pulls incrementally: `query.gte('updated_at', cursor)`. `managed_profiles` already has
-- the column and the trigger; `guardian_consents` has neither -- it was written in Sprint 3 with
-- only `consented_at`, because nothing synced it.
--
-- WHY NOT EXEMPT IT INSTEAD
--
-- A guardian has one or two children, so a consent table that always full-pulled would cost
-- nothing measurable, and "exempt this one table" is a smaller diff than this migration.
--
-- It is also `docs/failure-modes.md` section 12 -- a hand-maintained list that must track
-- another list -- and this project has already paid for that one. `seasons` sat outside the
-- REPLICA IDENTITY assertion for four sprints because that list was written from the tables an
-- earlier fix happened to name rather than from what the client actually subscribes to, and
-- season deletions silently never propagated (B22). The exemption would have to be remembered
-- in `schema_assertions.sql`, in `server-pull.ts`, and by whoever next reads either. One column
-- on an empty table removes the special case instead of documenting it.
--
-- Note the failure mode this prevents is a QUIET one, which is why it is worth the migration
-- rather than being left to be discovered: `pullFromServer` swallows a failed query into a
-- `console.warn` and moves on, so a delta query against a missing column does not break the
-- app -- the table just stops syncing, and looks exactly like a guardian who has not consented.

ALTER TABLE guardian_consents
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER update_guardian_consents_updated_at
    BEFORE UPDATE ON guardian_consents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
