-- Migration: 015_delta_sync_columns
-- Description: Add updated_at columns and triggers to tables missing them
-- Date: 2026-03-08
--
-- Tables that ALREADY have updated_at + trigger: tasks, match_plans, checklists
-- Tables that NEED updated_at: scouting_reports, sub_teams, seasons
-- ============================================

-- Reuse the existing trigger function (created in 013_create_missing_entities.sql)
-- CREATE OR REPLACE FUNCTION update_updated_at_column() ...

-- ============================================
-- 1. scouting_reports
-- ============================================

ALTER TABLE scouting_reports 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: set updated_at = created_at for existing rows
UPDATE scouting_reports SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS update_scouting_reports_updated_at ON scouting_reports;
CREATE TRIGGER update_scouting_reports_updated_at
    BEFORE UPDATE ON scouting_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_scouting_reports_updated_at ON scouting_reports(updated_at);

-- ============================================
-- 2. sub_teams
-- ============================================

ALTER TABLE sub_teams 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: set updated_at = created_at for existing rows
UPDATE sub_teams SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS update_sub_teams_updated_at ON sub_teams;
CREATE TRIGGER update_sub_teams_updated_at
    BEFORE UPDATE ON sub_teams
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_sub_teams_updated_at ON sub_teams(updated_at);

-- ============================================
-- 3. seasons
-- ============================================

ALTER TABLE seasons 
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: set updated_at = created_at for existing rows
UPDATE seasons SET updated_at = created_at WHERE updated_at IS NULL;

DROP TRIGGER IF EXISTS update_seasons_updated_at ON seasons;
CREATE TRIGGER update_seasons_updated_at
    BEFORE UPDATE ON seasons
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_seasons_updated_at ON seasons(updated_at);
