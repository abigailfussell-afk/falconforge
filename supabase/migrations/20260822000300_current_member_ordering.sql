-- `current_team_member_id`: a deterministic answer, and never a managed child's.
--
-- Sprint 9 fixed the guardian half of this by rewriting `meeting_attendance_select_member` to
-- name all of a guardian's children explicitly. The FUNCTION was left alone, which left the
-- other half of the same defect in place. Decided with Kevin 2026-08-17: fix it now rather than
-- leave a defect class half-closed, which is how the surviving half gets forgotten.
--
-- ==========================================================================
-- 1. `LIMIT 1` WITH NO `ORDER BY`
-- ==========================================================================
--
-- `docs/failure-modes.md` §13: no implicit ordering, ever. Postgres may return the rows of an
-- unordered query in any order and is not obliged to be consistent between two runs of the same
-- statement. B12 was this exact accident deciding which checklist was active.
--
-- For an ordinary member it has never mattered, because they hold one row per team. Nothing
-- SAYS so: there is no unique constraint on `(team_id, user_id)`, and that absence is
-- deliberate — it is what lets one guardian hold two children on the same team. So the safety
-- of this function rests on a property the schema does not enforce, which is exactly the shape
-- worth removing while it is cheap.
--
-- ==========================================================================
-- 2. IT DID NOT EXCLUDE MANAGED ROWS, AND THAT WAS AN ACT-AS HOLE
-- ==========================================================================
--
-- This is the part that is worth more than the ordering.
--
-- `check_in_with_code` resolves the caller with this function. A guardian's `team_members` row
-- carries the GUARDIAN's `user_id` and the CHILD's profile, so a guardian who scanned a QR
-- poster resolved to their child's membership and CHECKED THE CHILD IN — from wherever they
-- happened to be standing.
--
-- Plan section 3 refuses precisely that: "a guardian sees their children ... and never renders
-- the team as the child. Switching INTO the child would let a guardian account act as a team
-- member, which is a far larger surface to get right in RLS and the shape that quietly becomes
-- 'a guardian could do X as their child'." Checking a child in is that shape, reached by
-- accident rather than by design.
--
-- It also breaks what attendance is FOR. `attested_by` and `attested_at` exist so that "who
-- says so, and on what basis" has an answer three weeks later when a parent asks. A record
-- attested by the parent asking is not evidence of anything.
--
-- Every other caller wants the same narrowing: `meeting_attendance_select_member`'s
-- ordinary-member branch should return nothing for a guardian, because the guardian branch
-- added in `20260822000200_guardian_access.sql` already covers them properly — and covers ALL
-- their children rather than an arbitrary one.

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
       -- The caller acting AS THEMSELVES. A row held on a child's behalf is not that.
       AND managed_profile_id IS NULL
     -- Deterministic even if the "one row per member" property ever stops holding. `id` breaks
     -- the tie, because `joined_at` is a column default and two rows created in the same
     -- statement share it.
     ORDER BY joined_at, id
     LIMIT 1;
$$;

-- ==========================================================================
-- 3. THE REFUSAL HAS TO REACH SOMEBODY WHO CAN ACT ON IT
-- ==========================================================================
--
-- With the narrowing above, a guardian who scans a poster now falls into
-- `check_in_with_code`'s `not_a_member` branch and is told "You are not an approved member of
-- this team." That is TRUE and useless: they are standing in the room, their child is on the
-- roster, and the message describes neither.
--
-- `docs/failure-modes.md` §8: when a rule can refuse, make the refusal reach the person who can
-- satisfy it. Sprint 6 shipped the opposite — nominating an under-18 admin succeeded and the
-- refusal landed on the student at acceptance, the one person who could neither act on it nor
-- explain it.
--
-- So a guardian gets their own reason and their own instruction. Section 3 anticipated this
-- exchange from the other side ("when a student tries to do the one thing a managed profile
-- cannot ... the app tells them to ask their guardian"); this is the same sentence pointed at
-- the adult who is actually holding the phone.

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
        /*
         * A GUARDIAN GETS THEIR OWN REASON, and it is checked first.
         *
         * Since `current_team_member_id` stopped returning managed rows, a guardian scanning a
         * poster lands here -- and "You are not an approved member of this team" is true and
         * useless to somebody standing in the room whose child IS on the roster.
         *
         * `docs/failure-modes.md` section 8: when a rule can refuse, make the refusal reach the
         * person who can satisfy it. Section 3 anticipated this exchange from the other side
         * ("the app tells them to ask their guardian"); this is the same sentence pointed at
         * the adult holding the phone.
         */
        IF is_team_guardian(p_team_id) THEN
            RETURN json_build_object('success', false, 'reason', 'managed_profile',
                'error', 'A child taking part through a guardian cannot check themselves in. '
                      || 'Ask a coach to mark them present.');
        END IF;

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

REVOKE ALL ON FUNCTION public.check_in_with_code(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_in_with_code(uuid, text, text) TO authenticated;
