// Task status constants
export const TaskStatus = {
  Backlog: 'Backlog',
  ToDo: 'To Do',
  InProgress: 'In Progress',
  Testing: 'Testing',
  Done: 'Done',
  Archived: 'Archived'
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

export const TaskType = {
  Feature: 'Feature',
  Bug: 'Bug'
} as const;

export type TaskType = typeof TaskType[keyof typeof TaskType];

// ============================================
// NEW ENTITY MODEL (as of 2026-01-05)
// ============================================

/**
 * Team - The top-level FTC team organization
 * Users can create teams (as coaches) or join via invite code.
 * All other data (Seasons, SubTeams, Tasks, etc.) is scoped to a Team.
 */
export interface Team {
  id: string;
  name: string;              // e.g., "Falcon Force #12345"
  teamNumber: string | null; // FTC team number
  ownerId: string;           // Coach who created it
  createdAt: number;
}

/**
 * MemberRole — who can do what.
 *
 * `admin` is the primary administrator: exactly one per team, 18+, attested, and the only
 * role that touches licensing. `assistant_coach` is gone — it was a fourth name for "not
 * quite a coach" that the UI exposed and no code ever branched on, while `mentor` existed
 * in the schema and was unreachable from the interface.
 *
 * These names are enforced by a CHECK constraint and by `enforce_member_role_eligibility`,
 * which refuses admin/coach/mentor to an account that is not 18+. Client-side role checks
 * are UX; the database is the boundary.
 */
export type MemberRole = 'admin' | 'coach' | 'mentor' | 'student';

/**
 * TeamMember - A person who belongs to a Team
 * Managed in Admin Settings → "Team Roster" section
 */
export interface TeamMember {
  id: string;
  teamId: string;
  /**
   * The LOGIN that acts for this membership. For a guardian-managed profile this is the
   * guardian's account, not the child's — a child under 13 has no credentials at all.
   */
  userId: string;
  /** Set when this row is a child a guardian is responsible for. Always a student. */
  managedProfileId?: string | null;
  role: MemberRole;
  status: 'pending' | 'approved' | 'removed';
  /**
   * Whether the admin has given this member one of the team's licensed seats. Called
   * `isBillingActive` in V1, which described neither what it was nor who set it.
   */
  seatAssigned: boolean;
  // User display info (populated from Supabase users table)
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
  joinedAt: number;
}


/**
 * AgeClassification - User's age range for authorization
 */
export type AgeClassification = 'under_13' | '13_to_17' | '18_plus';

/**
 * AttestationType - Types of legal acknowledgements
 */
export type AttestationType =
  | 'terms'
  | 'privacy'
  | 'community_guidelines'
  | 'age_18_plus'
  | 'coppa_responsibility'
  | 'billing_acknowledgement'
  | 'age_13_plus'
  | 'privacy_and_guidelines'  // Combined privacy + community guidelines (signup)
  | 'coach_terms';            // Combined terms + billing + COPPA (create team)


/**
 * SubTeam - Working groups within a Team (scoped to Season)
 * Examples: Build, Programming, Drive, Scouting, Outreach
 * Renamed from the previous "Team" entity in local code.
 */
export interface SubTeam {
  id: string;
  name: string;
  memberIds: string[];  // TeamMember IDs assigned to this SubTeam
  seasonId: string;     // Scoped to a specific Season
}

/**
 * SEASON SCOPING IS NOT OPTIONAL.
 *
 * `seasonId` is required on every season-scoped type below, mirroring `season_id NOT NULL`
 * in the schema. It used to be optional, and the client compensated with
 * `!x.seasonId || x.seasonId === currentSeasonId` written out in five places — a filter
 * that lets a row with no season leak into EVERY season, which is the exact opposite of the
 * fresh start a new season is supposed to be. Those filters are gone; the type is what
 * stops them coming back.
 */


// ============================================
// OTHER ENTITIES (unchanged names)
// ============================================

export interface TimelineEvent {
  id: string;
  type: 'comment' | 'history';
  authorId: string; // TeamMember ID or 'System'
  content: string;
  timestamp: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  type: TaskType;
  assignedTo: string; // TeamMember ID
  department: string; // SubTeam ID
  tags: string[];
  checklist: { id: string; text: string; completed: boolean }[];
  timeline: TimelineEvent[];
  createdAt: number;
  dueDate?: number;
  seasonId: string;
  archivedAt?: number;
}

export interface ScoutingReport {
  id: string;
  teamNumber: string;
  /** Undefined when the scout did not record a match number. Never 0 — see B18. */
  matchNumber?: number;
  eventName?: string;
  hasAutonomous: boolean;
  autoScore: number;
  intakeType: 'No Intake' | 'Human Player' | 'Automatic';
  autoAim: boolean;
  farShooting: boolean;
  shotsTaken: number;
  shotsMissed: number;
  parking: 'No Park' | 'Full Park' | 'Partial Park';
  rating: number; // 1-5
  endGameNotes: string;
  createdBy?: string;   // TeamMember ID who created this report
  seasonId: string;     // Scoped to a specific Season
  createdAt?: number;
}

/**
 * One line of a pre-match checklist.
 *
 * No `seasonId` here: the checklist is stored as one row PER SEASON and the whole item
 * array lives in that row's `items` column, so the season is a property of the list rather
 * than of each line. V1 carried it per item and per row at once, and the two disagreed.
 */
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  assignedTo?: string; // TeamMember ID or SubTeam ID
}

export interface MatchPlan {
  id: string;
  title: string;
  /**
   * Undefined when not recorded. The match_plans.match_number column has always existed,
   * but the write path read `data.matchNumber` from a type that had no such property, so
   * it was written as null every time (B10).
   */
  matchNumber?: number;
  drawingData: any; // SVG path data
  notes: string;
  allianceTeam: string;
  partnerAutonomous: boolean;
  partnerPark: boolean;
  updatedAt: number;
  seasonId: string;
}

export interface Season {
  id: string;
  name: string;
  /**
   * The FTC game this season plays — "DECODE", "CENTERSTAGE". Distinct from {@link name},
   * which is the team's label for the year ("2026-2027 Season"). `''` means not recorded;
   * the column is nullable with a not-blank CHECK, and the mapping trims to null.
   */
  gameTitle: string;
  fieldImageData: string;  // Base64 encoded image data for offline support
  teamId?: string;  // Scoped to Team
  /**
   * A prior season: fully readable, accepts no writes to anything it scopes.
   *
   * This is UX in front of a database rule, not the rule itself. `season_is_open()` gates
   * the INSERT/UPDATE/DELETE policy of every season-scoped table, so a client that has not
   * heard about the archive yet still cannot write — which is the case that matters, since
   * a device offline during the rollover is exactly the one that still thinks last season
   * is current.
   */
  isArchived: boolean;
  createdAt: number;
}

// ============================================
// MEETINGS AND ATTENDANCE (Sprint 8)
// ============================================

/**
 * What kind of event this is. Drives the colour, the icon and — for `deadline` — whether
 * attendance exists at all.
 *
 * These are the seven the design specifies, and the strings match the `event_type` CHECK
 * constraint exactly. `team_meeting` rather than `meeting` because `meeting` is already the
 * name of the row.
 */
export type MeetingEventType =
  | 'practice'
  | 'team_meeting'
  | 'build'
  | 'competition'
  | 'outreach'
  | 'fundraiser'
  | 'deadline';

/**
 * Present, Excused or Absent. There is no Late.
 *
 * A scan inside the check-in window is simply Present — the window IS the lateness rule, and
 * a fourth state would need a threshold, a policy for who sets it, and a column in every
 * report. The database CHECK was narrowed to these three in Sprint 8's migration so the type
 * and the constraint cannot drift.
 *
 * A member with no record is not "absent". They are unrecorded, rendered "—", and stay that
 * way until a coach saves the roster. Nobody is auto-marked absent, ever: an attendance
 * record is a claim somebody made, and "the system assumed" is not a claim.
 */
export type AttendanceStatus = 'present' | 'excused' | 'absent';

/** How a status came to be recorded: a scanned QR, a typed code, or a coach saying so. */
export type AttendanceMethod = 'qr' | 'code' | 'coach';

/**
 * One occurrence on the schedule.
 *
 * A recurring series is a set of these rows, generated together, sharing `seriesId` and
 * `recurrenceRule` and NOT sharing `publicCode`. Each occurrence owns its own code, which is
 * what stops last Monday's poster checking anybody in to this Monday's session.
 */
export interface Meeting {
  id: string;
  title: string;
  description: string;
  location: string;
  eventType: MeetingEventType;
  /**
   * The four digits printed under the QR, unique within the team.
   *
   * `''` means the event has no check-in: always true of a deadline, and true of anything a
   * coach turned attendance tracking off for.
   */
  publicCode: string;
  /** Members are expected. False for an optional event that still takes attendance. */
  attendanceRequired: boolean;
  startsAt: number;
  endsAt?: number;
  /**
   * Explicit check-in window. `undefined` means the default — 15 minutes before the start
   * until the end — which is applied at read time by `checkinWindow()` and by the database's
   * `meeting_checkin_opens`/`meeting_checkin_closes`, never written into the record.
   *
   * That is what makes "moving the meeting moves the window, unless it was overridden" true
   * without a third field recording whether it was overridden.
   */
  checkinOpensAt?: number;
  checkinClosesAt?: number;
  /** How the series was generated. Empty for a one-off. */
  recurrenceRule: string;
  /** Shared by every occurrence generated together. Empty once an occurrence is forked. */
  seriesId: string;
  /** TeamMember id. */
  createdBy: string;
  seasonId: string;
}

/**
 * One person's attendance at one meeting.
 *
 * `attestedBy` and `attestedAt` are the point of the record rather than metadata on it: the
 * status alone cannot answer "who says so, and on what basis" when a parent asks three weeks
 * later. `method` is the other half — a coach re-reading a roster needs to tell "they scanned
 * in at 5:58" from "I ticked this box from memory".
 *
 * No `seasonId`: it hangs off its meeting, which is the one season-scoped table without one.
 * The database reaches the season through `meeting_season_is_open`.
 */
export interface MeetingAttendance {
  id: string;
  meetingId: string;
  /** TeamMember id — not a user id. A guardian-managed profile has a roster row and no login. */
  teamMemberId: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  notes: string;
  /** TeamMember id of whoever recorded it. Themselves, for a scan. */
  attestedBy: string;
  attestedAt?: number;
}

/**
 * What a guardian can consent to on a child's behalf.
 *
 * Constrained by a CHECK on `guardian_consents.consent_type`. `coppa_data_collection` is the
 * one that makes rostering a child lawful; the other three are the same documents every
 * account-holder accepts at signup, given here by the adult because the child never sees a
 * signup screen.
 */
export type GuardianConsentType =
  | 'coppa_data_collection'
  | 'terms'
  | 'privacy'
  | 'community_guidelines';

/**
 * A child a guardian holds a profile for.
 *
 * The child has NO row in `auth.users` and no credentials at all: under COPPA an under-13
 * may not hold an account, so the guardian signs in and the child's team membership is a
 * `team_members` row whose `user_id` is the GUARDIAN and whose `managedProfileId` points
 * here. That is what makes every existing `user_id = auth.uid()` policy do the right thing
 * for a managed child without a second access path.
 *
 * NO BIRTH DATE, AND DELIBERATELY SO. `birth_year` was dropped in Sprint 9 (plan section 3):
 * the app never knows anyone's age, only what was asserted once, so promotion to a child's
 * own login is triggered by a person and never by a date. Nothing here may reintroduce an
 * age computation — there is no birthday on this type or on `users` to compute it from.
 */
export interface ManagedProfile {
  id: string;
  /** The guardian's `auth.users` id. Always the signed-in user for a locally-created row. */
  guardianUserId: string;
  fullName: string;
  /** Free text the guardian keeps for themselves — allergies, a pickup arrangement. */
  notes: string;
  createdAt?: number;
}

/**
 * One consent, given once by a guardian for one child.
 *
 * Unique on `(managedProfileId, consentType)`, so re-consenting updates in place rather than
 * accumulating rows — the opposite of `user_attestations`, whose unique key includes the
 * version precisely so the record of each acceptance survives. The asymmetry is deliberate
 * and predates Sprint 9; what Sprint 9 fixes is that `version` no longer has a database
 * DEFAULT, so the number recorded here is always one the client actually displayed.
 */
export interface GuardianConsent {
  id: string;
  managedProfileId: string;
  guardianUserId: string;
  consentType: GuardianConsentType;
  /**
   * The version of the document the guardian was shown, from `ATTESTATION_VERSIONS`.
   *
   * NEVER defaulted, here or in the database. A caller that does not know which version it
   * displayed has no business recording a consent, and since Sprint 9 the column is NOT NULL
   * with no default, so omitting it fails loudly instead of inventing '1.0'.
   */
  version: string;
  consentedAt?: number;
}

/**
 * A saved checklist a team can start a new season from.
 *
 * Stored in `checklists` with `is_template = true`, which exempts the row from
 * `checklists_one_per_season` — so a team may keep several, while still having exactly one
 * WORKING checklist per season. A template's `season_id` records only where it was captured
 * from; nothing reads it as scope.
 *
 * Templates travel with their own generated id rather than the season-derived id working
 * checklists use, because the convergence problem that convention solves does not exist
 * here: a template is created once, by one device, deliberately.
 */
export interface ChecklistTemplate {
  id: string;
  name: string;
  items: ChecklistItem[];
  /** The season this template was captured from. Provenance, not scope. */
  seasonId: string;
}
