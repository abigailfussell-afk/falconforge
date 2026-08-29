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
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
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

/**
 * TENANT ON EVERY ROW.
 *
 * `teamId` is optional on the season-scoped types below, and optional for one reason only:
 * records persisted by an older build do not have it, and "this row does not say which team
 * it belongs to" must not be read as "it belongs to no team". Everything that consumes it
 * treats `undefined` as *unknown*, never as a mismatch.
 *
 * It exists because a local record used to carry no tenant at all — `fromRemote` dropped
 * `team_id` — so a task queued on Team A stayed in the collection the board renders after a
 * switch to Team B, until it was pushed and the next full pull evicted it (SYNC-15). A coach
 * on two teams saw the other team's card. Cosmetic and short-lived, but it is a tenant
 * boundary drawn in the UI, and the answer was already in the row we had thrown away.
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
  checklist: { id: string; text: string; completed: boolean }[];
  timeline: TimelineEvent[];
  createdAt: number;
  dueDate?: number;
  seasonId: string;
  archivedAt?: number;
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
}

export interface ScoutingReport {
  id: string;
  teamNumber: string;
  /** Undefined when the scout did not record a match number. Never 0 — see B18. */
  matchNumber?: number;
  eventName?: string;
  /**
   * The `competition_events` row this report was taken at, when the team has entered one.
   *
   * `eventName` remains the human label and remains written; this is the IDENTITY. The summary
   * groups on this when it is present, because grouping on the label alone splits an event in
   * two the moment somebody types "League meet 1" — `eventsIn()` keyed a case-sensitive Map, so
   * two scouts at one competition produced two summaries and nothing said so.
   *
   * UNDEFINED IS NORMAL AND PERMANENT, not a migration to finish: a scout at an event the coach
   * has not created yet must still be able to record what they saw, and every report written
   * before this column has none. Readers fall back to `eventName`.
   */
  seasonEventId?: string;
  /**
   * Which side of the field, and which driver station (P-02).
   *
   * BOTH OPTIONAL, for the same reason `matchNumber` is: a scout at a venue is watching a
   * match, not filling in a form, and every required field is a reason for a report not to
   * exist. They answer two questions a scouting lead actually asks — "were they better on red
   * or blue?", since the field is not symmetric in most FTC games, and "which of these two rows
   * is the one I watched?" when two scouts covered the same match.
   */
  alliance?: 'red' | 'blue';
  /** 1-based. 1–2 for FTC, 1–3 for FRC — the game definition's `match.allianceSize` bounds it. */
  station?: number;
  /**
   * Everything the GAME defines, keyed by `GameField.key` (P-01 phase S).
   *
   * This used to be ten typed properties — `hasAutonomous`, `intakeType`, `parking` and the
   * rest — which made DECODE part of the type system. Supporting next September's game meant
   * editing this interface, `constants.ts`, two components and the entity registry's
   * `toRemote`/`fromRemote`, three weeks before kickoff.
   *
   * `scouting_reports.data` has ALWAYS been a jsonb bag keyed exactly this way, so every
   * existing row is already a valid instance and nothing was migrated. What changed is that
   * the app stopped enumerating the keys: the form renders from the season's
   * `GameDefinition`, and unknown keys are preserved rather than dropped.
   *
   * `unknown`, not `any`: a caller has to say what it expects a field to be, which is what
   * stops `data.shotsTaken + 1` compiling into a string concatenation the day a template
   * changes a counter to a select. `game-definition.ts` carries the type per field.
   */
  data: Record<string, unknown>;
  createdBy?: string;   // TeamMember ID who created this report
  seasonId: string;     // Scoped to a specific Season
  createdAt?: number;
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
}

/**
 * One competition, with its schedule (D2).
 *
 * Kevin, 2026-08-23: paste/parse **plus** full manual entry **plus** editing after the fact.
 * The import is a shortcut; this entity is the substrate, and every field it fills is
 * enterable by hand — a coach whose schedule is not published yet, which is normal on the
 * morning of an event, has to be able to build the whole thing.
 */
export interface CompetitionEvent {
  id: string;
  name: string;
  /** FIRST's event code, e.g. `USMIDET1`. Free text; the app never fetches anything with it. */
  eventCode?: string;
  /**
   * `YYYY-MM-DD`, as a STRING, and that is deliberate.
   *
   * A competition date is a date, not an instant. Stored as epoch millis it renders one day
   * early at negative UTC offsets — `docs/failure-modes.md` §10, which this project has
   * already shipped twice and which is still open for task due dates. A `date` column and a
   * `YYYY-MM-DD` string on the client have no timezone to get wrong.
   */
  startsOn?: string;
  endsOn?: string;
  location?: string;
  notes?: string;
  seasonId: string;
  teamId?: string;
  createdAt?: number;
}

/** One match at one event. */
export interface EventMatch {
  id: string;
  eventId: string;
  phase: 'practice' | 'qualification' | 'playoff';
  matchNumber: number;
  /** Epoch millis. Undefined when the order is known and the time is not. */
  scheduledAt?: number;
  /**
   * Filled in afterwards, by hand. `undefined` means NOT PLAYED — never 0, which is a real
   * score and the exact conflation that corrupted five of nine live production rows (B18).
   */
  redScore?: number;
  blueScore?: number;
  notes?: string;
  teamId?: string;
}

/**
 * One team's changes to a curated scouting template, for one season (D4(b)).
 *
 * SEASON-SCOPED, which is the half D4 asked to be decided rather than discovered: *"the
 * override patch is season-scoped and must survive a season roll the same way sub-team
 * structure does — a team that customised its DECODE form does not want it silently carried
 * into BIOBUZZ, nor silently lost."* So the rollover wizard offers to copy it and SAYS it has,
 * exactly as it does for sub-team names.
 *
 * `baseDefinitionId` is on the patch because a patch is only meaningful next to the template it
 * was written against: a `hide: ['shotsMissed']` written for DECODE means nothing to a game
 * with no such field, and carrying it silently is the "silently carried into a new game" half
 * of what D4 rules out.
 */
export interface TeamGameOverride {
  id: string;
  seasonId: string;
  baseDefinitionId: string;
  baseVersion?: number | null;
  /** `{ add: [...], hide: [...], relabel: {...} }`. See `GamePatch`. */
  patch: import('./lib/game-definition').GamePatch;
  teamId?: string;
  createdAt?: number;
}

/**
 * One team in one match — a ROW, not a column (D2, and D3's knock-on).
 *
 * `red1 red2 blue1 blue2` was rejected for two reasons. FRC is 3v3 and FTC is 2v2, so four
 * columns bake FTC's alliance size into the schema — `teams.program` exists precisely so that
 * assumption stops being made. And a SURROGATE (a team playing a match that does not count for
 * them) is a property of a participation, which a column layout has nowhere to put; D2 says
 * surrogates and mid-event changes are routine, so an imported schedule that cannot express one
 * is "wrong by lunchtime".
 */
export interface MatchParticipant {
  id: string;
  matchId: string;
  alliance: 'red' | 'blue';
  /** 1-based within the alliance. */
  station: number;
  /** Text, not a reference: these are other teams, which this platform has never heard of. */
  teamNumber: string;
  teamName?: string;
  isSurrogate: boolean;
  teamId?: string;
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
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
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
  /**
   * Which bundled `GameDefinition` this season plays (P-01 phase S).
   *
   * Null on every season created before this column existed, which is all of them today —
   * `gameForSeason` falls back to matching `gameTitle`, then to the newest bundle, and the
   * report says where that guess is wrong (an archived season whose game the app no longer
   * ships). `game_snapshot` in phase M is what fixes it properly.
   */
  gameDefinitionId?: string | null;
  gameDefinitionVersion?: number | null;
  /**
   * Base64 field image, for offline support.
   *
   * THREE STATES, NOT TWO (`docs/failure-modes.md` section 4). `undefined` means "this device
   * has not fetched the column"; `''` means "this season has no field image". The pull
   * deliberately does not select `field_image_data` — a single image is up to ~670 KB of
   * base64 and it used to ride along with every `seasons` read on every app open (SYNC-03) —
   * so it is fetched once per season by `ensureSeasonFieldImage`, on the two screens that
   * show it.
   *
   * `toRemote` omits the column entirely when this is `undefined`, so renaming a season on a
   * device that has never loaded the image cannot blank it on the server.
   */
  fieldImageData?: string;
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
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
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
  teamId?: string;      // Which tenant this row belongs to. See TENANT ON EVERY ROW.
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
  /**
   * The outstanding claim code, while a promotion is being offered.
   *
   * READ-ONLY ON THE CLIENT, and enforced as such by column-level GRANTs rather than by
   * convention: it is a credential, and whoever redeems it takes the child's place on the
   * roster. It is generated by `offer_managed_profile_promotion` and cleared when the code is
   * redeemed or withdrawn, so `''` — the normal state — means "no promotion offered".
   *
   * Deliberately absent from `toRemote`; see the registry's `serverAssigned` for that entry.
   */
  promotionCode: string;
  /**
   * The account this child now signs in with, once the guardian handed the membership over.
   *
   * `null` means "still a managed profile", which is the normal state and is a DIFFERENT fact
   * from "not on a team yet" — conflating them is WALK-B-03: `GuardianView` renders a profile
   * with no membership as "Not on a team yet", so the parent who had just handed the account
   * over was shown their child apparently dropped from the team, with a fresh "Give them their
   * own login" button underneath contradicting the "Nothing is lost" copy beside it.
   *
   * READ-ONLY ON THE CLIENT, like `promotionCode` and enforced the same way — the column-level
   * GRANTs in `20260822000200_guardian_access.sql` list the writable columns and these are not
   * among them. Written only by `claim_managed_profile`, as the child, in the same transaction
   * that moves the membership.
   */
  promotedToUserId: string | null;
  /** When the hand-over happened, for "Now has their own login (since …)". */
  promotedAt: number | null;
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
