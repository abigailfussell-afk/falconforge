-- Migration: 014_fix_invites_rls
-- Description: Fix overly permissive invites SELECT policy
-- Date: 2026-03-08
--
-- The invites_select_all policy (from 009_auth_team_overhaul) uses USING (true),
-- allowing any authenticated user to read all teams' invite codes.
-- This replaces it with a team-membership-scoped policy.
--
-- The join_team_with_invite() RPC is SECURITY DEFINER, so the join flow
-- bypasses RLS and is NOT affected by this change.
-- ============================================

-- Drop the permissive policy
DROP POLICY IF EXISTS invites_select_all ON invites;

-- Team members can see their own team's invites
CREATE POLICY invites_select_team_members ON invites 
  FOR SELECT USING (
    team_id IN (SELECT get_user_team_ids(auth.uid()))
  );
