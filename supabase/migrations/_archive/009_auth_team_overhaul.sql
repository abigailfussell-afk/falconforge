-- Migration: 009_auth_team_overhaul (Complete Schema)
-- Description: Full schema for teams, members, invites, and user attestations
-- Date: 2026-01-07

-- ============================================
-- 1. Create users table (syncs with auth.users)
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================
-- 2. Create teams table
-- ============================================

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  team_number text,
  owner_id uuid NOT NULL REFERENCES users(id),
  invite_code text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON teams(owner_id);
CREATE INDEX IF NOT EXISTS idx_teams_invite_code ON teams(invite_code);

-- ============================================
-- 3. Create team_members table
-- ============================================

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'student' CHECK (role IN ('coach', 'assistant_coach', 'mentor', 'student')),
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'removed')),
  is_billing_active boolean NOT NULL DEFAULT false,
  age_13_plus boolean DEFAULT NULL,
  full_name text,
  email text,
  avatar_url text,
  joined_at timestamptz DEFAULT now(),
  
  UNIQUE(team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);

-- ============================================
-- 4. Create invites table
-- ============================================

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz DEFAULT (now() + interval '24 hours'),
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_team_id ON invites(team_id);

-- ============================================
-- 5. Create user_attestations table
-- ============================================

CREATE TABLE IF NOT EXISTS user_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attestation_type text NOT NULL CHECK (attestation_type IN (
    'terms',
    'privacy',
    'community_guidelines',
    'age_18_plus',
    'coppa_responsibility',
    'billing_acknowledgement',
    'age_13_plus'
  )),
  version text NOT NULL DEFAULT '1.0',
  attested_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, attestation_type)
);

CREATE INDEX IF NOT EXISTS idx_attestations_user_id ON user_attestations(user_id);

-- ============================================
-- 6. Create seasons table
-- ============================================

CREATE TABLE IF NOT EXISTS seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  field_image_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seasons_team_id ON seasons(team_id);

-- ============================================
-- 7. Create sub_teams table
-- ============================================

CREATE TABLE IF NOT EXISTS sub_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id uuid REFERENCES seasons(id) ON DELETE CASCADE,
  name text NOT NULL,
  member_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_teams_team_id ON sub_teams(team_id);

-- ============================================
-- 8. Enable RLS on all tables
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_teams ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 9. Users table policies
-- ============================================

CREATE POLICY users_select_own ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY users_update_own ON users FOR UPDATE USING (id = auth.uid());
CREATE POLICY users_insert_own ON users FOR INSERT WITH CHECK (id = auth.uid());

-- Users can see other members of their teams
CREATE POLICY users_select_teammates ON users FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM team_members my_tm
    JOIN team_members their_tm ON my_tm.team_id = their_tm.team_id
    WHERE my_tm.user_id = auth.uid()
      AND my_tm.status = 'approved'
      AND their_tm.user_id = users.id
  )
);

-- ============================================
-- 10. Teams table policies
-- ============================================

CREATE POLICY teams_select_member ON teams FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.status = 'approved'
  )
);

CREATE POLICY teams_insert_owner ON teams FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY teams_update_coach ON teams FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = teams.id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- ============================================
-- 11. Team members table policies
-- ============================================

-- Users can see all members of teams they belong to
CREATE POLICY team_members_select_policy ON team_members FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM team_members my_membership
    WHERE my_membership.team_id = team_members.team_id
      AND my_membership.user_id = auth.uid()
      AND my_membership.status = 'approved'
  )
  OR user_id = auth.uid()  -- Users can always see their own membership
);

-- Allow self-insert (for join requests) or coach insert
CREATE POLICY team_members_insert_policy ON team_members FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- Only coaches can update team members
CREATE POLICY team_members_update_policy ON team_members FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- Only coaches can delete team members
CREATE POLICY team_members_delete_policy ON team_members FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- ============================================
-- 12. Invites table policies
-- ============================================

-- Anyone can lookup an invite by code (for joining)
CREATE POLICY invites_select_all ON invites FOR SELECT USING (true);

-- Coaches can insert invites
CREATE POLICY invites_insert_coach ON invites FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = invites.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- Coaches can delete invites
CREATE POLICY invites_delete_coach ON invites FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = invites.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- ============================================
-- 13. User attestations policies
-- ============================================

CREATE POLICY attestations_select_own ON user_attestations FOR SELECT USING (user_id = auth.uid());
CREATE POLICY attestations_insert_own ON user_attestations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY attestations_update_own ON user_attestations FOR UPDATE USING (user_id = auth.uid());

-- ============================================
-- 14. Seasons policies
-- ============================================

CREATE POLICY seasons_select_member ON seasons FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = seasons.team_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'approved'
  )
);

CREATE POLICY seasons_modify_coach ON seasons FOR ALL USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = seasons.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- ============================================
-- 15. Sub-teams policies
-- ============================================

CREATE POLICY sub_teams_select_member ON sub_teams FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = sub_teams.team_id
      AND tm.user_id = auth.uid()
      AND tm.status = 'approved'
  )
);

CREATE POLICY sub_teams_modify_coach ON sub_teams FOR ALL USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = sub_teams.team_id
      AND tm.user_id = auth.uid()
      AND tm.role = 'coach'
      AND tm.status = 'approved'
  )
);

-- ============================================
-- 16. Helper function: Join team with invite
-- ============================================

CREATE OR REPLACE FUNCTION join_team_with_invite(
  invite_code text,
  age_confirmed boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite invites%ROWTYPE;
  v_team teams%ROWTYPE;
  v_existing_member team_members%ROWTYPE;
  v_user users%ROWTYPE;
  v_new_member_id uuid;
BEGIN
  -- Find the invite
  SELECT * INTO v_invite
  FROM invites
  WHERE code = invite_code
    AND (expires_at IS NULL OR expires_at > now());
  
  IF v_invite IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid or expired invite code');
  END IF;
  
  -- Get team and user info
  SELECT * INTO v_team FROM teams WHERE id = v_invite.team_id;
  SELECT * INTO v_user FROM users WHERE id = auth.uid();
  
  -- Check if user is already a member
  SELECT * INTO v_existing_member
  FROM team_members
  WHERE team_id = v_invite.team_id
    AND user_id = auth.uid();
  
  IF v_existing_member IS NOT NULL THEN
    IF v_existing_member.status = 'removed' THEN
      -- Re-activate as pending
      UPDATE team_members
      SET status = 'pending', age_13_plus = age_confirmed
      WHERE id = v_existing_member.id;
      
      -- Increment invite use count
      UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;
      
      RETURN json_build_object(
        'success', true,
        'team_id', v_invite.team_id,
        'team_name', v_team.name,
        'status', 'pending'
      );
    ELSE
      RETURN json_build_object('success', false, 'error', 'You are already a member of this team');
    END IF;
  END IF;
  
  -- Add as pending member
  INSERT INTO team_members (team_id, user_id, role, status, age_13_plus, full_name, email)
  VALUES (v_invite.team_id, auth.uid(), 'student', 'pending', age_confirmed, v_user.full_name, v_user.email)
  RETURNING id INTO v_new_member_id;
  
  -- Increment invite use count
  UPDATE invites SET use_count = use_count + 1 WHERE id = v_invite.id;
  
  RETURN json_build_object(
    'success', true,
    'team_id', v_invite.team_id,
    'team_name', v_team.name,
    'member_id', v_new_member_id,
    'status', 'pending'
  );
END;
$$;

-- ============================================
-- 17. Helper function: Create team as coach
-- ============================================

CREATE OR REPLACE FUNCTION create_team_as_coach(
  team_name text,
  team_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
  v_member_id uuid;
  v_invite_code text;
  v_user users%ROWTYPE;
BEGIN
  -- Get user info
  SELECT * INTO v_user FROM users WHERE id = auth.uid();
  
  -- Generate invite code
  v_invite_code := upper(substr(md5(random()::text), 1, 8));
  
  -- Create the team
  INSERT INTO teams (name, team_number, owner_id, invite_code)
  VALUES (team_name, team_number, auth.uid(), v_invite_code)
  RETURNING id INTO v_team_id;
  
  -- Add creator as coach (approved and billing active)
  INSERT INTO team_members (team_id, user_id, role, status, is_billing_active, full_name, email)
  VALUES (v_team_id, auth.uid(), 'coach', 'approved', true, v_user.full_name, v_user.email)
  RETURNING id INTO v_member_id;
  
  -- Create initial invite
  INSERT INTO invites (team_id, code, created_by)
  VALUES (v_team_id, v_invite_code, auth.uid());
  
  -- Create default season
  INSERT INTO seasons (team_id, name)
  VALUES (v_team_id, 'Demo Season');
  
  RETURN json_build_object(
    'success', true,
    'team_id', v_team_id,
    'member_id', v_member_id,
    'invite_code', v_invite_code
  );
END;
$$;

-- ============================================
-- 18. Trigger: Auto-create user profile on signup
-- ============================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
    updated_at = now();
  
  RETURN NEW;
END;
$$;

-- Create the trigger (drop first if exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
