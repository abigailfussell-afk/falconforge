-- Meetings and attendance: the columns, the capability, the policies and the check-in RPC.
--
-- The fourth forward migration on the frozen schema. Sprint 3 landed `meetings` and
-- `meeting_attendance` schema-only, deliberately, so that the freeze would not force a
-- migration for the first recurring meeting. This is that migration: it adds what a real
-- feature needs on top of the shape Sprint 3 chose, and it does not alter that shape.
--
-- THREE THINGS HERE ARE NARROWER THAN WHAT SPRINT 3 SHIPPED, and each is deliberate.
--
--   1. `can_manage_content` is "any approved member". Meetings inherited it with every other
--      content table, which means that today a STUDENT may create events and set anybody's
--      attendance. Attendance is a record about a person, kept so a coach can answer "who says
--      so" to a parent three weeks later; a member being able to write their own is the one
--      thing it must not permit. `can_manage_meetings` replaces it -- admin, coach or mentor.
--      This is also the first place in the application where `mentor` means anything at all:
--      the role has existed in the schema since Sprint 3 and no capability has ever separated
--      it from `student`.
--
--   2. `meeting_attendance.status` allowed 'late'. The design has no late state anywhere -- a
--      scan inside the check-in window is simply Present -- so a value the UI can never produce
--      and no report can ever explain is removed rather than carried. Zero rows exist.
--
--   3. Attendance SELECT was `is_team_member(team_id)`: every member could read every row
--      through the API whether or not a screen showed it. These are minors' attendance
--      records. A student now reads their own and nobody else's.
--
-- All three are narrowings, so nothing that worked stops working -- there is no meetings UI to
-- break, which is exactly why they belong here rather than after a season of use.

-- ==========================================================================
-- COLUMNS
-- ==========================================================================

ALTER TABLE meetings
    ADD COLUMN event_type text NOT NULL DEFAULT 'team_meeting'
        CHECK (event_type IN ('practice', 'team_meeting', 'build', 'competition',
                              'outreach', 'fundraiser', 'deadline')),
    -- The human-readable occurrence code, printed on the poster and typed by anyone whose
    -- phone has no camera. Nullable: a deadline has neither attendance nor a code.
    ADD COLUMN public_code text,
    -- Whether members are expected, as opposed to whether check-in exists at all. An outreach
    -- event can be optional and still take attendance from whoever turns up, which is why this
    -- is a second flag rather than a rename of "has a code".
    ADD COLUMN attendance_required boolean NOT NULL DEFAULT true,
    /*
     * The check-in window, where NULL means "the default".
     *
     * The default is 15 minutes before `starts_at` until `ends_at`, and it is applied at READ
     * time by `meeting_checkin_opens`/`meeting_checkin_closes` below rather than written into
     * these columns at save time. That is what makes the design's "changing the time
     * re-derives the window unless it was overridden" true by construction: a meeting that
     * never had its window edited holds NULL here, so moving the meeting moves the window,
     * and one that was edited holds a timestamp that no later edit to the times disturbs.
     *
     * Storing the derived value instead would need a third column recording whether it had
     * been overridden, and that column would be the thing that got out of step.
     */
    ADD COLUMN checkin_opens_at timestamptz,
    ADD COLUMN checkin_closes_at timestamptz,
    /*
     * The occurrences generated together from one recurrence rule.
     *
     * There is no `event_series` table. A series has no state of its own that an occurrence
     * does not already carry: `recurrence_rule` (added in Sprint 3, unused until now) records
     * how the set was generated, and the three apply-modes the design asks for are three
     * different WHERE clauses over this column -- this row, this row and every later one, or
     * every row sharing it. Editing one occurrence forks it by setting `series_id` to NULL.
     *
     * The occurrences are real rows, created up front. That is not an implementation
     * convenience: it is what lets each one own a distinct code (below), and it is what lets a
     * coach create a term's worth of build sessions on a laptop with no signal.
     */
    ADD COLUMN series_id uuid;

/*
 * The code is a credential, so its shape is a constraint rather than a convention.
 *
 * Four digits, scoped to the team. Globally-unique four digits would exhaust in an afternoon
 * across many teams; scoping to the team keeps the code short enough to print at poster size
 * and type on a numeric keypad, and the check-in RPC resolves it inside the caller's own team,
 * so there is no ambiguity to resolve.
 */
ALTER TABLE meetings ADD CONSTRAINT meetings_code_shape
    CHECK (public_code IS NULL OR public_code ~ '^[0-9]{4}$');

-- A deadline carries no attendance and no QR. Stated here as well as in the UI, because "the
-- form does not offer it" is not a property of the data.
ALTER TABLE meetings ADD CONSTRAINT meetings_deadline_has_no_attendance
    CHECK (event_type <> 'deadline'
           OR (public_code IS NULL AND attendance_required = false));

ALTER TABLE meetings ADD CONSTRAINT meetings_checkin_window_ordered
    CHECK (checkin_opens_at IS NULL
           OR checkin_closes_at IS NULL
           OR checkin_closes_at >= checkin_opens_at);

/*
 * THE RULE THAT MAKES THE WHOLE FEATURE HONEST.
 *
 * A weekly series shares its title and its settings and never its code. A student who
 * photographs the poster on Monday cannot use that photo to check in to the meeting they
 * missed the following Monday -- not because the client declines to, but because the code
 * resolves to one occurrence and that occurrence's window is long shut.
 *
 * The client draws a code it does not already hold for the team (the read path pulls whole
 * tables rather than the current season, so it holds every code the team has ever used) and
 * this index is what makes that a guarantee rather than an expectation: two coaches creating
 * events offline at the same moment can draw the same number, and one of those pushes must
 * fail rather than quietly produce two meetings answering to one code.
 */
CREATE UNIQUE INDEX meetings_public_code_per_team
    ON meetings (team_id, public_code)
    WHERE public_code IS NOT NULL;

CREATE INDEX idx_meetings_series ON meetings (series_id) WHERE series_id IS NOT NULL;

ALTER TABLE meeting_attendance
    /*
     * How the status got there: a scanned QR, a typed code, or a coach saying so.
     *
     * Sprint 3's comment on `attested_by`/`attested_at` argued that an attendance record is a
     * claim somebody made rather than a fact the system observed. This is the other half of
     * that: `attested_by` answers who, and this answers on what basis. A coach re-reading a
     * roster needs to tell "they scanned in at 5:58" from "I ticked this box from memory".
     */
    ADD COLUMN method text NOT NULL DEFAULT 'coach'
        CHECK (method IN ('qr', 'code', 'coach'));

-- No late tracking, anywhere. See the header.
ALTER TABLE meeting_attendance DROP CONSTRAINT meeting_attendance_status_check;
ALTER TABLE meeting_attendance ADD CONSTRAINT meeting_attendance_status_check
    CHECK (status IN ('present', 'absent', 'excused'));

/*
 * Realtime DELETE contract (B7, and B22 for the table that got left off the list).
 *
 * Registering these two in `entity-registry.ts` enrols them in the pull loop AND in the
 * realtime subscription, which filters on `team_id`. Under the default replica identity a
 * DELETE payload carries the primary key only, the filter never matches, and a meeting
 * cancelled on the coach's laptop stays on every student's phone until a full reconciliation
 * happens to run. Assertion 5 in `schema_assertions.sql` is extended to cover both.
 */
ALTER TABLE meetings           REPLICA IDENTITY FULL;
ALTER TABLE meeting_attendance REPLICA IDENTITY FULL;

-- ==========================================================================
-- PREDICATES
-- ==========================================================================

/*
 * The caller's row on a team, if they have one.
 *
 * Everything about attendance is keyed by `team_members.id` rather than by `auth.users.id` --
 * the FKs, the unique constraint, `attested_by` -- because a managed profile (COPPA, Sprint 9)
 * has a roster row and no login. So both the self-read policy and the check-in RPC need this
 * translation, and neither should write its own copy of it.
 *
 * Unapproved members get NULL: a pending join request is not attendance-eligible.
 */
CREATE OR REPLACE FUNCTION public.current_team_member_id(p_team_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT id FROM team_members
     WHERE team_id = p_team_id
       AND user_id = auth.uid()
       AND status = 'approved'
     LIMIT 1;
$$;

/*
 * Who may run the schedule: the admin, a coach, or a mentor.
 *
 * `coalesce(..., false)` is B25's lesson and is not decoration. `current_team_role` returns
 * NULL for a non-member, `NULL IN (...)` is NULL, and a policy coerces NULL to false -- so the
 * naked expression is safe INSIDE a policy and unsafe everywhere else. B25 was exactly that
 * shape: `IF NOT can_manage_billing(...)` never fired for an outsider because the value was
 * NULL rather than false, and the SECURITY DEFINER function behind it accepted them. This
 * function is called from the check-in RPC as well as from policies, so it fails closed here.
 *
 * Gated on `team_can_write` like the other content capabilities: a lapsed licence makes the
 * team's content read-only, and a schedule is content.
 */
CREATE OR REPLACE FUNCTION public.can_manage_meetings(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT coalesce(current_team_role(p_team_id) IN ('admin', 'coach', 'mentor'), false)
       AND team_can_write(p_team_id);
$$;

/*
 * The check-in window, with the defaults applied.
 *
 * ONE definition, used by the RPC and readable by anything else that needs to ask. The client
 * necessarily has its own copy (it renders "check-in opens 5:45 PM" offline, hours before
 * anybody asks the server anything), and `checkin-window.test.ts` reads the numbers back out
 * of THIS FILE to prove the two agree -- a comment saying "keep these in step" is how they
 * stop being in step.
 *
 * A meeting with no `ends_at` closes four hours after it starts. Something has to bound it:
 * the alternative is a code that stays live forever, which is the property this whole design
 * exists to prevent.
 */
CREATE OR REPLACE FUNCTION public.meeting_checkin_opens(p_meeting meetings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(p_meeting.checkin_opens_at, p_meeting.starts_at - interval '15 minutes');
$$;

CREATE OR REPLACE FUNCTION public.meeting_checkin_closes(p_meeting meetings)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT coalesce(
        p_meeting.checkin_closes_at,
        p_meeting.ends_at,
        p_meeting.starts_at + interval '4 hours'
    );
$$;

-- ==========================================================================
-- POLICIES
-- ==========================================================================
--
-- One policy per verb (assertion 9), so each is DROPped and recreated rather than joined by a
-- second: policies for a verb OR together, so an extra policy would WIDEN what is permitted.
-- Narrowing means rewriting the predicate.
--
-- The `season_is_open` / `meeting_season_is_open` conjuncts are Sprint 4's and are preserved
-- exactly. A prior season is read-only in the database, and meetings are no exception.

DROP POLICY IF EXISTS meetings_insert_content ON meetings;
DROP POLICY IF EXISTS meetings_update_content ON meetings;
DROP POLICY IF EXISTS meetings_delete_content ON meetings;

CREATE POLICY meetings_insert_content ON meetings
    FOR INSERT WITH CHECK (
        can_manage_meetings(team_id) AND season_is_open(season_id, team_id));

CREATE POLICY meetings_update_content ON meetings
    FOR UPDATE
    USING (can_manage_meetings(team_id) AND season_is_open(season_id, team_id))
    WITH CHECK (can_manage_meetings(team_id) AND season_is_open(season_id, team_id));

CREATE POLICY meetings_delete_content ON meetings
    FOR DELETE USING (
        can_manage_meetings(team_id) AND season_is_open(season_id, team_id));

-- SELECT on `meetings` is untouched and stays `is_team_member`. The schedule is for everybody;
-- that is the whole of the student experience.

DROP POLICY IF EXISTS meeting_attendance_insert_content ON meeting_attendance;
DROP POLICY IF EXISTS meeting_attendance_update_content ON meeting_attendance;
DROP POLICY IF EXISTS meeting_attendance_delete_content ON meeting_attendance;
DROP POLICY IF EXISTS meeting_attendance_select_member ON meeting_attendance;

/*
 * A student reads their own row and nobody else's.
 *
 * The season summary (per-student rates, who is below 75%) is a coach, mentor and admin
 * screen. Leaving SELECT at `is_team_member` would have meant the numbers behind it were
 * available to every student over the API regardless -- "the UI does not show it" is not
 * access control, and this is a table of minors' attendance records.
 *
 * `current_team_member_id` returns NULL for a non-member and for an unapproved one, and
 * `team_member_id = NULL` is NULL, which a policy reads as false. Fails closed.
 */
CREATE POLICY meeting_attendance_select_member ON meeting_attendance
    FOR SELECT USING (
        can_manage_meetings(team_id)
        OR team_member_id = current_team_member_id(team_id));

/*
 * Writes are the coach's, and self check-in does not come through here.
 *
 * `check_in_with_code` is SECURITY DEFINER, so a student checking themselves in never meets
 * these policies. That is the point: the only self-write path is one that validates the code,
 * the window and the season server-side against `now()`, so there is no shape of INSERT a
 * student can construct directly -- including one naming somebody else, or one back-dated into
 * a window that has closed.
 */
CREATE POLICY meeting_attendance_insert_content ON meeting_attendance
    FOR INSERT WITH CHECK (
        can_manage_meetings(team_id) AND meeting_season_is_open(meeting_id, team_id));

CREATE POLICY meeting_attendance_update_content ON meeting_attendance
    FOR UPDATE
    USING (can_manage_meetings(team_id) AND meeting_season_is_open(meeting_id, team_id))
    WITH CHECK (can_manage_meetings(team_id) AND meeting_season_is_open(meeting_id, team_id));

CREATE POLICY meeting_attendance_delete_content ON meeting_attendance
    FOR DELETE USING (
        can_manage_meetings(team_id) AND meeting_season_is_open(meeting_id, team_id));

-- ==========================================================================
-- CHECK-IN
-- ==========================================================================

/*
 * A student checks themselves in, once, inside the window, and cannot undo it.
 *
 * WHY THIS IS AN RPC AND NOT A QUEUED WRITE, in an application whose first principle is that
 * every feature works offline.
 *
 * Because a check-in is a claim about the present moment, and an offline client has no
 * credible account of what the present moment is. Queue it, and the client supplies the
 * timestamp; every property the design asks for -- the window, the dead code from last week,
 * "a student cannot check in for a meeting they did not attend" -- becomes a request the
 * client is trusted to honour. `now()` here is the server's, and it is the only reason any of
 * those hold.
 *
 * The offline half of attendance is the coach's roster, which is an ordinary queued write and
 * works with no signal at all. That is not a consolation prize: it is the mechanism that
 * covers the venue with dead WiFi, which is the case this application exists for. Self
 * check-in is the convenience that removes the coach from the loop when there IS signal.
 * Decided with Kevin at Sprint 8 kickoff, and it follows Sprint 6's seat-capacity precedent --
 * put the enforcement on an action that is inherently online, so the offline write path never
 * has to consult a rule it cannot evaluate.
 *
 * Returns a reason rather than raising. Every refusal below is a thing a student can act on
 * ("you are too early", "the coach has closed check-in", "you already scanned"), and an
 * exception would arrive at the UI as an opaque failure with the reason in a log nobody reads.
 */
CREATE OR REPLACE FUNCTION public.check_in_with_code(
    p_team_id uuid,
    p_code text,
    p_method text DEFAULT 'qr'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_member_id uuid;
    v_meeting meetings%ROWTYPE;
    v_now timestamptz := now();
    v_opens timestamptz;
    v_closes timestamptz;
    v_existing meeting_attendance%ROWTYPE;
    v_id uuid;
BEGIN
    IF p_method NOT IN ('qr', 'code') THEN
        RETURN json_build_object('success', false, 'reason', 'invalid_method',
            'error', 'Unrecognised check-in method.');
    END IF;

    v_member_id := current_team_member_id(p_team_id);
    IF v_member_id IS NULL THEN
        RETURN json_build_object('success', false, 'reason', 'not_a_member',
            'error', 'You are not an approved member of this team.');
    END IF;

    -- A lapsed licence makes the team read-only. Say so rather than reporting a bad code.
    IF NOT team_can_write(p_team_id) THEN
        RETURN json_build_object('success', false, 'reason', 'team_read_only',
            'error', 'This team''s licence has lapsed, so attendance cannot be recorded.');
    END IF;

    SELECT * INTO v_meeting
      FROM meetings
     WHERE team_id = p_team_id
       AND public_code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g');

    IF v_meeting.id IS NULL THEN
        RETURN json_build_object('success', false, 'reason', 'unknown_code',
            'error', 'That code does not match a meeting for your team.');
    END IF;

    -- Unreachable through a code lookup, since a deadline is constrained to have none. Kept
    -- because "the constraint makes this impossible" is a claim that outlives the constraint.
    IF v_meeting.event_type = 'deadline' THEN
        RETURN json_build_object('success', false, 'reason', 'no_attendance_for_type',
            'error', 'Deadlines do not take attendance.');
    END IF;

    IF NOT meeting_season_is_open(v_meeting.id, p_team_id) THEN
        RETURN json_build_object('success', false, 'reason', 'season_archived',
            'error', 'That meeting belongs to an archived season.');
    END IF;

    v_opens := meeting_checkin_opens(v_meeting);
    v_closes := meeting_checkin_closes(v_meeting);

    IF v_now < v_opens THEN
        RETURN json_build_object('success', false, 'reason', 'window_not_open',
            'error', 'Check-in has not opened yet.',
            'opens_at', v_opens, 'meeting_title', v_meeting.title);
    END IF;

    IF v_now > v_closes THEN
        RETURN json_build_object('success', false, 'reason', 'window_closed',
            'error', 'Check-in has closed for that meeting.',
            'closed_at', v_closes, 'meeting_title', v_meeting.title);
    END IF;

    /*
     * INSERT ... ON CONFLICT DO NOTHING, then look at what is there.
     *
     * Checking first and inserting second would be a race with the student's own double-tap,
     * and the loser of that race gets a unique violation rather than the "you are already
     * checked in" the design specifies. Letting the constraint arbitrate means the second
     * request reports the FIRST one's timestamp, which is the honest answer.
     *
     * A coach's manual override is not overwritten either -- if a coach has already marked
     * somebody Excused, their scan reports the excusal rather than silently promoting itself
     * to Present. The coach is the authority on the record; the scan is evidence.
     */
    INSERT INTO meeting_attendance (
        meeting_id, team_id, team_member_id, status, method, attested_by, attested_at
    )
    VALUES (
        v_meeting.id, p_team_id, v_member_id, 'present', p_method, v_member_id, v_now
    )
    ON CONFLICT (meeting_id, team_member_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT * INTO v_existing
          FROM meeting_attendance
         WHERE meeting_id = v_meeting.id AND team_member_id = v_member_id;

        RETURN json_build_object(
            'success', false, 'reason', 'already_recorded',
            'error', 'Your attendance for this meeting is already recorded.',
            'status', v_existing.status,
            'method', v_existing.method,
            'recorded_at', v_existing.attested_at,
            'meeting_id', v_meeting.id,
            'meeting_title', v_meeting.title
        );
    END IF;

    RETURN json_build_object(
        'success', true,
        'attendance_id', v_id,
        'meeting_id', v_meeting.id,
        'meeting_title', v_meeting.title,
        'starts_at', v_meeting.starts_at,
        'ends_at', v_meeting.ends_at,
        'location', v_meeting.location,
        'public_code', v_meeting.public_code,
        'status', 'present',
        'method', p_method,
        'recorded_at', v_now
    );
END;
$$;

/*
 * Close check-in early (1c).
 *
 * A one-column UPDATE, but it is an RPC because `now()` has to be the server's for the same
 * reason it does above -- a coach's tablet setting `checkin_closes_at` from its own clock can
 * close the window in the past or, worse, in the future. It re-checks the capability rather
 * than relying on the UPDATE policy, so the refusal is a sentence instead of a zero-row update
 * the caller has to interpret.
 */
CREATE OR REPLACE FUNCTION public.close_meeting_checkin(p_team_id uuid, p_meeting_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_closes timestamptz := now();
BEGIN
    IF NOT can_manage_meetings(p_team_id) THEN
        RETURN json_build_object('success', false, 'reason', 'not_permitted',
            'error', 'Only an admin, coach or mentor can close check-in.');
    END IF;

    IF NOT meeting_season_is_open(p_meeting_id, p_team_id) THEN
        RETURN json_build_object('success', false, 'reason', 'season_archived',
            'error', 'That meeting belongs to an archived season.');
    END IF;

    UPDATE meetings
       SET checkin_closes_at = v_closes
     WHERE id = p_meeting_id
       AND team_id = p_team_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'reason', 'unknown_meeting',
            'error', 'That meeting does not exist on this team.');
    END IF;

    RETURN json_build_object('success', true, 'checkin_closes_at', v_closes);
END;
$$;

-- ==========================================================================
-- GRANTS
-- ==========================================================================
--
-- Sprint 7's rule: a directly-called RPC is revoked from PUBLIC (not from `anon`, which is a
-- no-op -- EXECUTE arrives via PUBLIC and the first draft of that migration proved it) and
-- re-granted to the roles that should hold it.
--
-- The predicates are NOT revoked, for the reason `20260819000000_revoke_anon_execute.sql`
-- gives: they are called inside policies, evaluated as the calling role, and revoking them
-- turns an anonymous SELECT from `200 []` into "permission denied for function".

REVOKE EXECUTE ON FUNCTION public.check_in_with_code(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in_with_code(uuid, text, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.close_meeting_checkin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_meeting_checkin(uuid, uuid) TO authenticated, service_role;
