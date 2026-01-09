-- Migration: 012_sync_user_updates_to_members
-- Description: Trigger to sync changes from users table to team_members table
-- Date: 2026-01-09

-- Function to sync user details to all their team memberships
CREATE OR REPLACE FUNCTION sync_user_to_team_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update if relevant fields changed
  IF NEW.full_name IS DISTINCT FROM OLD.full_name OR 
     NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR
     NEW.email IS DISTINCT FROM OLD.email THEN
     
    UPDATE team_members
    SET 
      full_name = NEW.full_name,
      avatar_url = NEW.avatar_url,
      email = NEW.email
    WHERE user_id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS on_user_profile_update ON users;
CREATE TRIGGER on_user_profile_update
  AFTER UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION sync_user_to_team_members();
