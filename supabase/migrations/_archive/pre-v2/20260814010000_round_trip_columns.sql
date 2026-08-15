-- Round D: give the fields that already exist in the app somewhere to live.
--
-- Three fields are set by the UI, held in local state, and then silently dropped on the
-- way to the server because no column exists and neither transform direction carries them.
-- The user sees their value until a sync round-trip, then it reverts.
--
--   B9  match_plans.partner_autonomous / partner_park
--       MatchPlan declares both (types.ts). transformToSupabaseSchema never sent them and
--       transformMatchPlanFromSupabase hardcoded `false` on read.
--
--   B10 match_plans.match_number was written from `data.matchNumber`, a property MatchPlan
--       does not have -- so the column (which already exists) was always written as null.
--       Fixed in the app by adding matchNumber to the type; no schema change needed here.
--
--   B17 tasks.archived_at
--       SprintPlanning sets archivedAt when archiving and SprintArchived sorts the list by
--       it. The archive itself survives via status='Archived', but the timestamp does not,
--       so every round-tripped task sorts as 0 and the "Archived <date>" label disappears.
--
-- All three are additive and nullable/defaulted, so existing rows stay valid and the
-- constraints from the security audit are unaffected.
--
-- PREREQUISITE: this must be applied BEFORE the Round D application code is deployed.
-- The registry writes these columns unconditionally; if they are absent the upsert fails
-- and every change parks in the dead-letter store.

ALTER TABLE match_plans ADD COLUMN IF NOT EXISTS partner_autonomous boolean NOT NULL DEFAULT false;
ALTER TABLE match_plans ADD COLUMN IF NOT EXISTS partner_park boolean NOT NULL DEFAULT false;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Archived tasks are read as a filtered list; the index keeps that cheap as seasons pile up.
CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at) WHERE archived_at IS NOT NULL;
