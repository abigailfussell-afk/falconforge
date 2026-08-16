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
