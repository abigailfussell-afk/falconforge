-- Migration: 010_simplified_auth
-- Description: Simplify auth flows - move age/attestations to signup, remove redundant fields
-- Date: 2026-01-07

-- ============================================
-- 1. Add age_classification to users table
-- ============================================

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS age_classification text 
CHECK (age_classification IN ('under_13', '13_to_17', '18_plus'));

-- ============================================
-- 2. Drop age_13_plus from team_members table
-- ============================================

ALTER TABLE team_members DROP COLUMN IF EXISTS age_13_plus;

-- ============================================
-- 3. Drop invite_code from teams table
-- ============================================

ALTER TABLE teams DROP COLUMN IF EXISTS invite_code;

-- Also drop the index if it exists
DROP INDEX IF EXISTS idx_teams_invite_code;

-- ============================================
-- 4. Change field_image_url to field_image_data on seasons table
-- ============================================

-- Rename the column (preserves any existing URLs as data for now)
ALTER TABLE seasons RENAME COLUMN field_image_url TO field_image_data;

-- ============================================
-- 5. Update user_attestations CHECK constraint
-- ============================================

-- Drop and recreate the constraint with new attestation types
ALTER TABLE user_attestations 
DROP CONSTRAINT IF EXISTS user_attestations_attestation_type_check;

ALTER TABLE user_attestations
ADD CONSTRAINT user_attestations_attestation_type_check 
CHECK (attestation_type IN (
    -- Legacy types (kept for backwards compatibility)
    'terms',
    'privacy',
    'community_guidelines',
    'age_18_plus',
    'coppa_responsibility',
    'billing_acknowledgement',
    'age_13_plus',
    -- New simplified types
    'privacy_and_guidelines',  -- Combined privacy + community guidelines (signup)
    'coach_terms'              -- Combined terms + billing + COPPA (create team)
));

-- ============================================
-- 6. Update create_team_as_coach function
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
  
  -- Check user is 18+
  IF v_user.age_classification IS NULL OR v_user.age_classification != '18_plus' THEN
    RETURN json_build_object('success', false, 'error', 'You must be 18 or older to create a team');
  END IF;
  
  -- Generate invite code
  v_invite_code := upper(substr(md5(random()::text), 1, 8));
  
  -- Create the team (no invite_code column anymore)
  INSERT INTO teams (name, team_number, owner_id)
  VALUES (team_name, team_number, auth.uid())
  RETURNING id INTO v_team_id;
  
  -- Add creator as coach (approved and billing active)
  INSERT INTO team_members (team_id, user_id, role, status, is_billing_active, full_name, email)
  VALUES (v_team_id, auth.uid(), 'coach', 'approved', true, v_user.full_name, v_user.email)
  RETURNING id INTO v_member_id;
  
  -- Create initial invite in invites table
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
-- 7. Update join_team_with_invite function
-- ============================================

CREATE OR REPLACE FUNCTION join_team_with_invite(
  invite_code text
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
  
  -- Check user has completed signup with age classification
  IF v_user.age_classification IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Please complete your account setup first');
  END IF;
  
  -- Check if user is under 13
  IF v_user.age_classification = 'under_13' THEN
    RETURN json_build_object('success', false, 'error', 'Users under 13 must have their guardian contact the coach directly');
  END IF;
  
  -- Check if user is already a member
  SELECT * INTO v_existing_member
  FROM team_members
  WHERE team_id = v_invite.team_id
    AND user_id = auth.uid();
  
  IF v_existing_member IS NOT NULL THEN
    IF v_existing_member.status = 'removed' THEN
      -- Re-activate as pending
      UPDATE team_members
      SET status = 'pending'
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
  INSERT INTO team_members (team_id, user_id, role, status, full_name, email)
  VALUES (v_invite.team_id, auth.uid(), 'student', 'pending', v_user.full_name, v_user.email)
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
-- 8. Add function to update user age classification
-- ============================================

CREATE OR REPLACE FUNCTION update_user_age_classification(
  classification text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate classification
  IF classification NOT IN ('under_13', '13_to_17', '18_plus') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid age classification');
  END IF;
  
  -- Update the user's age classification
  UPDATE users
  SET age_classification = classification,
      updated_at = now()
  WHERE id = auth.uid();
  
  RETURN json_build_object('success', true);
END;
$$;
