-- Migration: 016_database_security_audit
-- Description: Implement strong PostgreSQL constraints, tenant isolation via composite FKs, and RLS vulnerability patches.
-- Date: 2026-03-17

-- ============================================
-- 1. ADD CHECK CONSTRAINTS TO PREVENT EMPTY STRINGS
-- ============================================

-- Backfill invalid existing data before applying constraints
UPDATE teams SET name = 'Unnamed Team' WHERE name IS NULL OR char_length(trim(name)) = 0;
UPDATE seasons SET name = 'Unnamed Season' WHERE name IS NULL OR char_length(trim(name)) = 0;
UPDATE sub_teams SET name = 'Unnamed SubTeam' WHERE name IS NULL OR char_length(trim(name)) = 0;
UPDATE tasks SET title = 'Untitled Task' WHERE title IS NULL OR char_length(trim(title)) = 0;
UPDATE checklists SET name = 'Unnamed Checklist' WHERE name IS NULL OR char_length(trim(name)) = 0;
DELETE FROM invites WHERE code IS NULL OR char_length(trim(code)) = 0;

-- Ensure critical string fields cannot be empty or just whitespace
ALTER TABLE teams ADD CONSTRAINT teams_name_check CHECK (char_length(trim(name)) > 0);
ALTER TABLE seasons ADD CONSTRAINT seasons_name_check CHECK (char_length(trim(name)) > 0);
ALTER TABLE sub_teams ADD CONSTRAINT sub_teams_name_check CHECK (char_length(trim(name)) > 0);
ALTER TABLE tasks ADD CONSTRAINT tasks_title_check CHECK (char_length(trim(title)) > 0);
ALTER TABLE checklists ADD CONSTRAINT checklists_name_check CHECK (char_length(trim(name)) > 0);
ALTER TABLE invites ADD CONSTRAINT invites_code_check CHECK (char_length(trim(code)) > 0);

-- Prevent logical impossibilities with numeric fields
-- scouting_reports.match_number: made NULLABLE 2026-08-14 (see B18).
--
-- The original constraint was a plain CHECK (match_number > 0) with no backfill, and it
-- cannot be applied to production as written: 5 of 9 live scouting reports have
-- match_number = 0. That value is fabricated by the app -- ScoutingReports.tsx validates
-- only teamNumber, and `newScout.matchNumber || 0` turns the NaN from an empty
-- parseInt() into 0, which the NOT NULL column accepts. The card then renders "Match 0".
--
-- The mismatch is the bug: the form treats match number as optional while the schema
-- treats it as required. Scouting happens in a hurry between matches, so optional is the
-- honest model -- forcing a value just gets a throwaway number typed in. NULL now means
-- "not recorded", and the app sends NULL instead of inventing a sentinel.
ALTER TABLE scouting_reports ALTER COLUMN match_number DROP NOT NULL;
UPDATE scouting_reports SET match_number = NULL WHERE match_number <= 0;

-- The NULL branch is redundant in SQL's three-valued logic (a CHECK evaluating to NULL
-- passes), but it is spelled out so nobody "tidies" the column back to NOT NULL.
ALTER TABLE scouting_reports ADD CONSTRAINT scouting_reports_match_number_check
  CHECK (match_number IS NULL OR match_number > 0);

-- match_plans.match_number was already nullable, so NULL passes here too.
ALTER TABLE match_plans ADD CONSTRAINT match_plans_match_number_check CHECK (match_number > 0);
ALTER TABLE invites ADD CONSTRAINT invites_use_count_check CHECK (use_count >= 0);

-- ============================================
-- 2. ENFORCE STRICT TENANT ISOLATION (COMPOSITE KEYS)
-- ============================================
-- Note: Sub_team_members cannot reliably be altered this way since team_members 
-- and sub_teams don't currently share a direct team_id relationship in the foreign key
-- without breaking existing data constraints. The RLS policies implemented in 013 
-- already enforce this isolation perfectly.

-- Allow referencing (id, team_id) composite keys
ALTER TABLE team_members ADD CONSTRAINT team_members_id_team_id_key UNIQUE (id, team_id);
ALTER TABLE seasons ADD CONSTRAINT seasons_id_team_id_key UNIQUE (id, team_id);
ALTER TABLE sub_teams ADD CONSTRAINT sub_teams_id_team_id_key UNIQUE (id, team_id);

-- Tasks: Ensure sub_team and assigned_to belong to the same team
ALTER TABLE tasks ADD CONSTRAINT tasks_sub_team_team_fkey 
  FOREIGN KEY (sub_team_id, team_id) REFERENCES sub_teams(id, team_id) DEFERRABLE;
  
ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_to_team_fkey 
  FOREIGN KEY (assigned_to, team_id) REFERENCES team_members(id, team_id) DEFERRABLE;

-- Scouting Reports: Ensure created_by belongs to the same team
ALTER TABLE scouting_reports ADD CONSTRAINT scouting_reports_created_by_team_fkey 
  FOREIGN KEY (created_by, team_id) REFERENCES team_members(id, team_id) DEFERRABLE;

-- Sub Team Members: REMOVED 2026-08-09.
--
-- This block originally did:
--     ALTER TABLE sub_team_members ADD COLUMN team_id uuid;
--     UPDATE  sub_team_members ... backfill from team_members
--     ALTER TABLE sub_team_members ALTER COLUMN team_id SET NOT NULL;
--     ALTER TABLE sub_team_members ADD CONSTRAINT sub_team_members_sub_team_team_fkey ...
--     ALTER TABLE sub_team_members ADD CONSTRAINT sub_team_members_team_member_team_fkey ...
--
-- The table does not exist in the hosted project. Probed 2026-08-09 via PostgREST:
--     GET /rest/v1/sub_team_members?select=id
--     -> PGRST205 "Could not find the table 'public.sub_team_members' in the schema cache"
--
-- 013_create_missing_entities.sql creates it, so that migration was evidently never applied
-- to production in full. Which means THIS migration could not have applied cleanly either --
-- it would have failed on the ALTER above. How much of the rest of this file actually reached
-- production is UNKNOWN and cannot be determined with the anon key: CHECK constraints,
-- composite UNIQUE keys and composite foreign keys are invisible to PostgREST.
--
-- >> Verify with `supabase db diff --linked --schema public` once authenticated, and expect
-- >> to have to re-apply some of the constraints above. Do NOT assume the tenant-isolation
-- >> guarantees in this file are live in production.
--
-- No application code references sub_team_members; the app models sub-team membership as the
-- `sub_teams.member_ids` array. Nothing is lost by dropping the block.


