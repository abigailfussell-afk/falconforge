-- Baseline schema for FalconForge
--
-- Squashed from the 2026-03-08 full backup (backup-full-2026-03-08T22-03-03/07_restore.sql)
-- plus 20260317000000_database_security_audit.sql, which was applied to production after
-- that backup was taken.
--
-- WHY A BASELINE: migrations 001-008 were never committed to this repo, so the migration
-- history could not rebuild the database. Migrations 009-015 and the security audit are
-- preserved for reference in supabase/migrations/_archive/ but are already applied in
-- production and are NOT reproducible from an empty database.
--
-- Statement order differs from the backup: the backup emits tables alphabetically with
-- their foreign keys inline, which forward-references tables that do not exist yet.
-- Here it is tables -> foreign keys -> indexes -> functions -> RLS -> triggers.
--
-- VERIFY AGAINST PRODUCTION before trusting this for anything but local development:
--   supabase login && supabase link --project-ref cvnonrjzshaawzxcjwmn
--   supabase db diff --linked --schema public
-- An empty diff means this baseline matches production.


-- ==========================================
-- TABLES
-- ==========================================

CREATE TABLE IF NOT EXISTS checklists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    name text DEFAULT 'Pre-Match Checklist'::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb,
    is_template boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    code text NOT NULL,
    created_by uuid NOT NULL,
    expires_at timestamptz DEFAULT (now() + '24:00:00'::interval),
    max_uses integer,
    use_count integer DEFAULT 0 NOT NULL,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT invites_code_key UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS match_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    title text,
    match_number integer,
    alliance_team text,
    drawing_data jsonb DEFAULT '{}'::jsonb,
    notes text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS scouting_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    opponent_team_number text NOT NULL,
    match_number integer NOT NULL,
    event_name text,
    data jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS seasons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    name text NOT NULL,
    field_image_data text,
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS sub_teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid,
    name text NOT NULL,
    member_ids uuid[] DEFAULT '{}'::uuid[],
    created_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    season_id uuid NOT NULL,
    sub_team_id uuid,
    title text NOT NULL,
    description text,
    status text DEFAULT 'Backlog'::text NOT NULL,
    type text DEFAULT 'Feature'::text NOT NULL,
    assigned_to uuid,
    tags text[] DEFAULT '{}'::text[],
    checklist jsonb DEFAULT '[]'::jsonb,
    timeline jsonb DEFAULT '[]'::jsonb,
    due_date timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT tasks_status_check CHECK ((status = ANY (ARRAY['Backlog'::text, 'To Do'::text, 'In Progress'::text, 'Testing'::text, 'Done'::text, 'Archived'::text]))),
    CONSTRAINT tasks_type_check CHECK ((type = ANY (ARRAY['Feature'::text, 'Bug'::text])))
);

CREATE TABLE IF NOT EXISTS team_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'student'::text NOT NULL,
    status text DEFAULT 'approved'::text NOT NULL,
    is_billing_active boolean DEFAULT false NOT NULL,
    full_name text,
    email text,
    avatar_url text,
    joined_at timestamptz DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT team_members_team_id_user_id_key UNIQUE (team_id, user_id),
    CONSTRAINT team_members_role_check CHECK ((role = ANY (ARRAY['coach'::text, 'assistant_coach'::text, 'mentor'::text, 'student'::text]))),
    CONSTRAINT team_members_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'removed'::text])))
);

CREATE TABLE IF NOT EXISTS teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    team_number text,
    owner_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS user_attestations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    attestation_type text NOT NULL,
    version text DEFAULT '1.0'::text NOT NULL,
    attested_at timestamptz DEFAULT now(),
    PRIMARY KEY (id),
    CONSTRAINT user_attestations_user_id_attestation_type_key UNIQUE (user_id, attestation_type),
    CONSTRAINT user_attestations_attestation_type_check CHECK ((attestation_type = ANY (ARRAY['terms'::text, 'privacy'::text, 'community_guidelines'::text, 'age_18_plus'::text, 'coppa_responsibility'::text, 'billing_acknowledgement'::text, 'age_13_plus'::text, 'privacy_and_guidelines'::text, 'coach_terms'::text])))
);

CREATE TABLE IF NOT EXISTS users (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    avatar_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    age_classification text,
    PRIMARY KEY (id),
    CONSTRAINT users_age_classification_check CHECK ((age_classification = ANY (ARRAY['under_13'::text, '13_to_17'::text, '18_plus'::text])))
);


-- ==========================================
-- FOREIGN KEYS
-- ==========================================

ALTER TABLE checklists ADD CONSTRAINT checklists_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE checklists ADD CONSTRAINT checklists_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE invites ADD CONSTRAINT invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE invites ADD CONSTRAINT invites_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE match_plans ADD CONSTRAINT match_plans_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE match_plans ADD CONSTRAINT match_plans_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE scouting_reports ADD CONSTRAINT scouting_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE scouting_reports ADD CONSTRAINT scouting_reports_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE scouting_reports ADD CONSTRAINT scouting_reports_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE seasons ADD CONSTRAINT seasons_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE sub_teams ADD CONSTRAINT sub_teams_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE sub_teams ADD CONSTRAINT sub_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_season_id_fkey FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD CONSTRAINT tasks_sub_team_id_fkey FOREIGN KEY (sub_team_id) REFERENCES sub_teams(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD CONSTRAINT tasks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE team_members ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE team_members ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE teams ADD CONSTRAINT teams_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE user_attestations ADD CONSTRAINT user_attestations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_checklists_season_id ON public.checklists USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_checklists_team_id ON public.checklists USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_invites_code ON public.invites USING btree (code);
CREATE INDEX IF NOT EXISTS idx_invites_team_id ON public.invites USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_match_plans_season_id ON public.match_plans USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_match_plans_team_id ON public.match_plans USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_scouting_reports_opponent ON public.scouting_reports USING btree (opponent_team_number);
CREATE INDEX IF NOT EXISTS idx_scouting_reports_season_id ON public.scouting_reports USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_scouting_reports_team_id ON public.scouting_reports USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_seasons_team_id ON public.seasons USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_sub_teams_team_id ON public.sub_teams USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_season_id ON public.tasks USING btree (season_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON public.tasks USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON public.tasks USING btree (updated_at);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON public.team_members USING btree (team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON public.teams USING btree (owner_id);
CREATE INDEX IF NOT EXISTS idx_attestations_user_id ON public.user_attestations USING btree (user_id);


-- ==========================================
-- FUNCTIONS
-- ==========================================

CREATE OR REPLACE FUNCTION public.create_team_as_coach(team_name text, team_number text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_team_ids(user_uuid uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT team_id FROM team_members 
  WHERE user_id = user_uuid AND status = 'approved';
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO users (id, email, full_name, avatar_url, age_classification)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'age_classification'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
    age_classification = COALESCE(EXCLUDED.age_classification, users.age_classification),
    updated_at = now();
  IF NEW.raw_user_meta_data->>'privacy_accepted' = 'true' THEN
    INSERT INTO user_attestations (user_id, attestation_type, version)
    VALUES (NEW.id, 'privacy_and_guidelines', '1.0')
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_team_coach(p_team_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM team_members 
    WHERE team_id = p_team_id 
      AND user_id = p_user_id 
      AND status = 'approved'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.join_team_with_invite(invite_code text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.sync_user_to_team_members()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_user_age_classification(classification text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;


-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE scouting_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklists_delete ON checklists
    FOR DELETE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY checklists_insert ON checklists
    FOR INSERT
    WITH CHECK ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY checklists_select ON checklists
    FOR SELECT
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY checklists_update ON checklists
    FOR UPDATE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY invites_delete_coach ON invites
    FOR DELETE
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = invites.team_id) AND (tm.user_id = auth.uid()) AND (tm.role = 'coach'::text) AND (tm.status = 'approved'::text)))));

CREATE POLICY invites_insert_coach ON invites
    FOR INSERT
    WITH CHECK ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = invites.team_id) AND (tm.user_id = auth.uid()) AND (tm.role = 'coach'::text) AND (tm.status = 'approved'::text)))));

CREATE POLICY invites_select_all ON invites
    FOR SELECT
    USING (true);

CREATE POLICY match_plans_delete ON match_plans
    FOR DELETE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY match_plans_insert ON match_plans
    FOR INSERT
    WITH CHECK ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY match_plans_select ON match_plans
    FOR SELECT
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY match_plans_update ON match_plans
    FOR UPDATE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY scouting_reports_delete ON scouting_reports
    FOR DELETE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY scouting_reports_insert ON scouting_reports
    FOR INSERT
    WITH CHECK ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY scouting_reports_select ON scouting_reports
    FOR SELECT
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY scouting_reports_update ON scouting_reports
    FOR UPDATE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY seasons_modify_coach ON seasons
    FOR ALL
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = seasons.team_id) AND (tm.user_id = auth.uid()) AND (tm.role = 'coach'::text) AND (tm.status = 'approved'::text)))));

CREATE POLICY seasons_select_member ON seasons
    FOR SELECT
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = seasons.team_id) AND (tm.user_id = auth.uid()) AND (tm.status = 'approved'::text)))));

CREATE POLICY sub_teams_modify_coach ON sub_teams
    FOR ALL
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = sub_teams.team_id) AND (tm.user_id = auth.uid()) AND (tm.role = 'coach'::text) AND (tm.status = 'approved'::text)))));

CREATE POLICY sub_teams_select_member ON sub_teams
    FOR SELECT
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = sub_teams.team_id) AND (tm.user_id = auth.uid()) AND (tm.status = 'approved'::text)))));

CREATE POLICY tasks_delete ON tasks
    FOR DELETE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY tasks_insert ON tasks
    FOR INSERT
    WITH CHECK ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY tasks_select ON tasks
    FOR SELECT
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY tasks_update ON tasks
    FOR UPDATE
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY team_members_delete_policy ON team_members
    FOR DELETE
    USING (is_team_coach(team_id, auth.uid()));

CREATE POLICY team_members_insert_policy ON team_members
    FOR INSERT
    WITH CHECK (((user_id = auth.uid()) OR is_team_coach(team_id, auth.uid())));

CREATE POLICY team_members_select_own ON team_members
    FOR SELECT
    USING ((user_id = auth.uid()));

CREATE POLICY team_members_select_policy ON team_members
    FOR SELECT
    USING ((is_team_member(team_id, auth.uid()) OR (user_id = auth.uid())));

CREATE POLICY team_members_select_teammates ON team_members
    FOR SELECT
    USING ((team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)));

CREATE POLICY team_members_update_policy ON team_members
    FOR UPDATE
    USING (is_team_coach(team_id, auth.uid()));

CREATE POLICY teams_insert_owner ON teams
    FOR INSERT
    WITH CHECK ((owner_id = auth.uid()));

CREATE POLICY teams_select_member ON teams
    FOR SELECT
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = teams.id) AND (tm.user_id = auth.uid()) AND (tm.status = 'approved'::text)))));

CREATE POLICY teams_update_coach ON teams
    FOR UPDATE
    USING ((EXISTS ( SELECT 1
   FROM team_members tm
  WHERE ((tm.team_id = teams.id) AND (tm.user_id = auth.uid()) AND (tm.role = 'coach'::text) AND (tm.status = 'approved'::text)))));

CREATE POLICY attestations_insert_own ON user_attestations
    FOR INSERT
    WITH CHECK ((user_id = auth.uid()));

CREATE POLICY attestations_select_own ON user_attestations
    FOR SELECT
    USING ((user_id = auth.uid()));

CREATE POLICY attestations_update_own ON user_attestations
    FOR UPDATE
    USING ((user_id = auth.uid()));

CREATE POLICY users_insert_own ON users
    FOR INSERT
    WITH CHECK ((id = auth.uid()));

CREATE POLICY users_select_own ON users
    FOR SELECT
    USING ((id = auth.uid()));

CREATE POLICY users_select_via_teams ON users
    FOR SELECT
    USING ((id IN ( SELECT tm.user_id
   FROM team_members tm
  WHERE (tm.team_id IN ( SELECT get_user_team_ids(auth.uid()) AS get_user_team_ids)))));

CREATE POLICY users_update_own ON users
    FOR UPDATE
    USING ((id = auth.uid()));


-- ==========================================
-- TRIGGERS
-- ==========================================

DROP TRIGGER IF EXISTS update_checklists_updated_at ON checklists;
CREATE TRIGGER update_checklists_updated_at
    BEFORE UPDATE ON checklists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_match_plans_updated_at ON match_plans;
CREATE TRIGGER update_match_plans_updated_at
    BEFORE UPDATE ON match_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS on_user_profile_update ON users;
CREATE TRIGGER on_user_profile_update
    AFTER UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_to_team_members();

-- Auth schema triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT OR UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
