-- Migration: 011_fix_recursive_policies
-- Description: Fix infinite recursion in team_members policies by using security definer functions
-- Date: 2026-01-07

-- Create a helper function to check membership without triggering RLS
-- This bypasses the recursion by accessing the table directly via SECURITY DEFINER
CREATE OR REPLACE FUNCTION is_team_member(
  p_team_id uuid, 
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM team_members 
    WHERE team_id = p_team_id 
      AND user_id = p_user_id 
      AND status = 'approved'
  );
END;
$$;

-- Create a helper function to check coach role without triggering RLS
CREATE OR REPLACE FUNCTION is_team_coach(
  p_team_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM team_members 
    WHERE team_id = p_team_id 
      AND user_id = p_user_id 
      AND role = 'coach' 
      AND status = 'approved'
  );
END;
$$;

-- Drop existing problematic policies
DROP POLICY IF EXISTS team_members_select_policy ON team_members;
DROP POLICY IF EXISTS team_members_insert_policy ON team_members;
DROP POLICY IF EXISTS team_members_update_policy ON team_members;
DROP POLICY IF EXISTS team_members_delete_policy ON team_members;

-- Recreate policies using the helper functions

-- SELECT: Users can see members of their teams OR their own membership
CREATE POLICY team_members_select_policy ON team_members 
FOR SELECT USING (
  is_team_member(team_id, auth.uid()) 
  OR user_id = auth.uid()
);

-- INSERT: Self-insert (joining) OR coach insert
CREATE POLICY team_members_insert_policy ON team_members 
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR is_team_coach(team_id, auth.uid())
);

-- UPDATE: Only coaches can update team members
CREATE POLICY team_members_update_policy ON team_members 
FOR UPDATE USING (
  is_team_coach(team_id, auth.uid())
);

-- DELETE: Only coaches can delete team members
CREATE POLICY team_members_delete_policy ON team_members 
FOR DELETE USING (
  is_team_coach(team_id, auth.uid())
);
