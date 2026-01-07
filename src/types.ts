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
  inviteCode: string;        // For joining
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
  age13Plus: boolean | null;
  // User display info (populated from Supabase users table)
  fullName: string | null;
  email: string;
  avatarUrl: string | null;
  joinedAt: number;
}

/**
 * Invite - Team invite link for joining
 */
export interface Invite {
  id: string;
  teamId: string;
  code: string;
  createdBy: string;
  expiresAt: number | null;
  createdAt: number;
}

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
  | 'age_13_plus';

/**
 * UserAttestation - Record of user's legal acknowledgements
 */
export interface UserAttestation {
  id: string;
  userId: string;
  attestationType: AttestationType;
  version: string;
  attestedAt: number;
}

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

/**
 * SubTeamMember - Junction table: TeamMember assigned to a SubTeam
 * One TeamMember can be assigned to multiple SubTeams.
 */
export interface SubTeamMember {
  id: string;
  subTeamId: string;
  teamMemberId: string;
  createdAt: number;
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
  archivedAt?: number;
}

export interface ScoutingReport {
  id: string;
  teamNumber: string;
  matchNumber: number;
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
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  assignedTo?: string; // TeamMember ID or SubTeam ID
}

export interface Flashcard {
  question: string;
  answer: string;
}
