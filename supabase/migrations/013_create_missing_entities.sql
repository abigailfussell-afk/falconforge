-- Migration: 013_create_missing_entities
-- Description: Create missing entity tables for offline-first sync
-- Date: 2026-01-10

-- ============================================
-- 1. CREATE TASKS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS tasks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    sub_team_id uuid,
    title text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'Backlog' CHECK (status IN ('Backlog', 'To Do', 'In Progress', 'Testing', 'Done')),
    type text NOT NULL DEFAULT 'Feature' CHECK (type IN ('Feature', 'Bug')),
    assigned_to uuid,
    tags text[] DEFAULT '{}',
    checklist jsonb DEFAULT '[]',
    timeline jsonb DEFAULT '[]',
    due_date timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT tasks_pkey PRIMARY KEY (id),
    CONSTRAINT tasks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT tasks_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    CONSTRAINT tasks_sub_team_id_fkey FOREIGN KEY (sub_team_id) REFERENCES sub_teams(id) ON DELETE SET NULL,
    CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_season_id ON tasks(season_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at);

-- RLS for tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_select ON tasks
    FOR SELECT USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY tasks_insert ON tasks
    FOR INSERT WITH CHECK (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY tasks_update ON tasks
    FOR UPDATE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY tasks_delete ON tasks
    FOR DELETE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

-- ============================================
-- 2. CREATE SCOUTING_REPORTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS scouting_reports (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    opponent_team_number text NOT NULL,
    match_number integer NOT NULL,
    event_name text,
    data jsonb DEFAULT '{}',
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT scouting_reports_pkey PRIMARY KEY (id),
    CONSTRAINT scouting_reports_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT scouting_reports_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE,
    CONSTRAINT scouting_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES team_members(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scouting_reports_team_id ON scouting_reports(team_id);
CREATE INDEX IF NOT EXISTS idx_scouting_reports_season_id ON scouting_reports(season_id);
CREATE INDEX IF NOT EXISTS idx_scouting_reports_opponent ON scouting_reports(opponent_team_number);

-- RLS for scouting_reports
ALTER TABLE scouting_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY scouting_reports_select ON scouting_reports
    FOR SELECT USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY scouting_reports_insert ON scouting_reports
    FOR INSERT WITH CHECK (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY scouting_reports_update ON scouting_reports
    FOR UPDATE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY scouting_reports_delete ON scouting_reports
    FOR DELETE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

-- ============================================
-- 3. CREATE MATCH_PLANS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS match_plans (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    title text,
    match_number integer,
    alliance_team text,
    drawing_data jsonb DEFAULT '{}',
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT match_plans_pkey PRIMARY KEY (id),
    CONSTRAINT match_plans_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT match_plans_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_match_plans_team_id ON match_plans(team_id);
CREATE INDEX IF NOT EXISTS idx_match_plans_season_id ON match_plans(season_id);

-- RLS for match_plans
ALTER TABLE match_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_plans_select ON match_plans
    FOR SELECT USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY match_plans_insert ON match_plans
    FOR INSERT WITH CHECK (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY match_plans_update ON match_plans
    FOR UPDATE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY match_plans_delete ON match_plans
    FOR DELETE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

-- ============================================
-- 4. CREATE CHECKLISTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS checklists (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'Pre-Match Checklist',
    items jsonb DEFAULT '[]',
    is_template boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    CONSTRAINT checklists_pkey PRIMARY KEY (id),
    CONSTRAINT checklists_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT checklists_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checklists_team_id ON checklists(team_id);
CREATE INDEX IF NOT EXISTS idx_checklists_season_id ON checklists(season_id);

-- RLS for checklists
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklists_select ON checklists
    FOR SELECT USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY checklists_insert ON checklists
    FOR INSERT WITH CHECK (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY checklists_update ON checklists
    FOR UPDATE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

CREATE POLICY checklists_delete ON checklists
    FOR DELETE USING (team_id IN (SELECT get_user_team_ids(auth.uid())));

-- ============================================
-- 5. CREATE SUB_TEAM_MEMBERS JUNCTION TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS sub_team_members (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    sub_team_id uuid NOT NULL,
    team_member_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT sub_team_members_pkey PRIMARY KEY (id),
    CONSTRAINT sub_team_members_sub_team_id_fkey FOREIGN KEY (sub_team_id) REFERENCES sub_teams(id) ON DELETE CASCADE,
    CONSTRAINT sub_team_members_team_member_id_fkey FOREIGN KEY (team_member_id) REFERENCES team_members(id) ON DELETE CASCADE,
    CONSTRAINT sub_team_members_unique UNIQUE (sub_team_id, team_member_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sub_team_members_sub_team_id ON sub_team_members(sub_team_id);
CREATE INDEX IF NOT EXISTS idx_sub_team_members_team_member_id ON sub_team_members(team_member_id);

-- RLS for sub_team_members
ALTER TABLE sub_team_members ENABLE ROW LEVEL SECURITY;

-- For sub_team_members, we need to check team access through sub_teams
CREATE POLICY sub_team_members_select ON sub_team_members
    FOR SELECT USING (
        sub_team_id IN (
            SELECT id FROM sub_teams 
            WHERE team_id IN (SELECT get_user_team_ids(auth.uid()))
        )
    );

CREATE POLICY sub_team_members_insert ON sub_team_members
    FOR INSERT WITH CHECK (
        sub_team_id IN (
            SELECT id FROM sub_teams 
            WHERE team_id IN (SELECT get_user_team_ids(auth.uid()))
        )
    );

CREATE POLICY sub_team_members_update ON sub_team_members
    FOR UPDATE USING (
        sub_team_id IN (
            SELECT id FROM sub_teams 
            WHERE team_id IN (SELECT get_user_team_ids(auth.uid()))
        )
    );

CREATE POLICY sub_team_members_delete ON sub_team_members
    FOR DELETE USING (
        sub_team_id IN (
            SELECT id FROM sub_teams 
            WHERE team_id IN (SELECT get_user_team_ids(auth.uid()))
        )
    );

-- ============================================
-- 6. UPDATE TRIGGER FOR updated_at
-- ============================================

-- Create or replace the timestamp update function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers to tables with updated_at
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_match_plans_updated_at ON match_plans;
CREATE TRIGGER update_match_plans_updated_at
    BEFORE UPDATE ON match_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_checklists_updated_at ON checklists;
CREATE TRIGGER update_checklists_updated_at
    BEFORE UPDATE ON checklists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. ENABLE REALTIME FOR NEW TABLES
-- ============================================

-- Enable realtime for the new tables (if supabase_realtime extension exists)
DO $$
BEGIN
    -- Try to add tables to realtime publication
    -- This may fail if realtime isn't set up, which is fine
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add tasks to realtime: %', SQLERRM;
    END;
    
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE scouting_reports;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add scouting_reports to realtime: %', SQLERRM;
    END;
    
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE match_plans;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add match_plans to realtime: %', SQLERRM;
    END;
    
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE checklists;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add checklists to realtime: %', SQLERRM;
    END;
END $$;
