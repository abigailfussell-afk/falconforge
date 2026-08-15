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
 * TeamMember - A Supabase user who belongs to a Team
 * Managed in Admin Settings → "Team Roster" section
 */
export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'coach' | 'assistant_coach' | 'mentor' | 'student';
  status: 'pending' | 'approved' | 'removed';
  isBillingActive: boolean;
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
  seasonId?: string;    // Scoped to a specific Season
}


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
  seasonId?: string;
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
  seasonId?: string;    // Scoped to a specific Season
  createdAt?: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  assignedTo?: string; // TeamMember ID or SubTeam ID
  seasonId?: string;   // Scoped to a specific Season
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
  seasonId?: string;
}

export interface Season {
  id: string;
  name: string;
  fieldImageData: string;  // Base64 encoded image data for offline support
  teamId?: string;  // Scoped to Team
  createdAt: number;
}
