# FalconForge Entity Rename Implementation Plan

**Created:** 2026-01-05
**Status:** Planning (awaiting approval)

> **Recovery Instructions:** If this conversation times out or hits model limits, paste the contents of this file back into the chat with the prompt: "Continue implementing the entity rename plan from this document:" followed by the file contents.

---

## Overview

This plan restructures the entity naming in FalconForge to support multi-team access and proper scoping of data. The key change is introducing a top-level "Team" entity that users can create/join, with all other data scoped to Team + Season.

---

## Final Entity Model

```
User (Supabase auth.users)
  └── TeamMember (junction: User belongs to Team with role)
        └── Team (top-level FTC team organization)
              └── Season (competition year, e.g., "2025-2026 Decode")
                    ├── SubTeam (working groups: Build, Programming, etc.)
                    │     └── SubTeamMember (junction: TeamMember assigned to SubTeam)
                    ├── Task (sprint planning items)
                    │     ├── [embedded] checklist items
                    │     └── [embedded] timeline events
                    ├── ChecklistItem (pre-match checklist)
                    ├── ScoutingReport
                    ├── MatchPlan
                    └── PortfolioEntry
```

---

## Entity Definitions

### Team (NEW - replaces "Organization")
The top-level FTC team that users create or join.

```typescript
interface Team {
  id: string;
  name: string;              // e.g., "Falcon Force #12345"
  teamNumber: string | null; // FTC team number
  inviteCode: string;        // For joining
  ownerId: string;           // Coach who created it
  createdAt: number;
}
```

**Database table:** `teams` (rename from `organizations`)

### TeamMember (replaces "OrganizationMember")
A Supabase user who belongs to a Team.

```typescript
interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: 'coach' | 'mentor' | 'student';
  joinedAt: number;
}
```

**Database table:** `team_members` (rename from `organization_members`)

**UI Location:** Admin Settings → "Team Roster" section

### Season (no change)
A competition season within a Team.

```typescript
interface Season {
  id: string;
  teamId: string;           // NEW: scope to Team
  name: string;
  fieldImageUrl: string;
  createdAt: number;
}
```

### SubTeam (rename from "Team" in local code)
Working groups within a Team's Season.

```typescript
interface SubTeam {
  id: string;
  teamId: string;           // Scope to Team
  seasonId: string;         // Scope to Season
  name: string;             // e.g., "Build", "Programming"
  createdAt: number;
}
```

**Database table:** `sub_teams` (rename from `teams`)

**UI Location:** Admin Settings → "Sub-Teams & Assignments" section

### SubTeamMember (NEW junction table)
Assignment of a TeamMember to a SubTeam.

```typescript
interface SubTeamMember {
  id: string;
  subTeamId: string;
  teamMemberId: string;
  createdAt: number;
}
```

**Database table:** `sub_team_members` (rename from `team_members`)

**Note:** One TeamMember can be assigned to multiple SubTeams.

---

## User Flow Changes

### Current Flow:
```
Login → Main App (with demo data)
```

### New Flow:
```
Login → Team Picker Page → Main App (Season selector in nav)
              ↓
        Options if no teams:
        - "Create a Team" (for coaches)
        - "Join a Team" (enter invite code)
```

---

## File-by-File Changes

### Phase 1: Type Definitions

#### `src/types.ts`
- Rename `Team` interface → `SubTeam`
- Rename `Member` interface → DELETE (will use User data from TeamMember)
- Add new `Team` interface (top-level)
- Add `TeamMember` interface
- Add `SubTeamMember` interface

#### `src/lib/database.types.ts`
- Rename table `organizations` → `teams`
- Rename table `organization_members` → `team_members`
- Rename table `teams` → `sub_teams`
- Rename table `team_members` → `sub_team_members`
- Update all field references (organization_id → team_id, etc.)

### Phase 2: Constants

#### `src/constants.ts`
- Rename `MOCK_TEAMS` → `DEFAULT_SUBTEAMS`
- DELETE `MOCK_MEMBERS` (no longer needed - comes from Supabase users)
- Add `DEMO_TEAMS` constant for demo mode:
  ```typescript
  export const DEMO_TEAMS = [
    { id: 'demo-team-1', name: 'Demo Team 1', teamNumber: '00001' },
    { id: 'demo-team-2', name: 'Demo Team 2', teamNumber: '00002' },
  ];
  ```

### Phase 3: Store Updates

#### `src/lib/store.ts`
- Rename `Team` interface → `SubTeam`
- Rename `Member` interface → DELETE
- Rename `teams` state → `subTeams`
- Rename `members` state → DELETE (or keep for offline cache of user display names)
- Add `currentTeamId` state
- Add `teamMembers` state (cache of team roster)
- Update all action names:
  - `addTeam` → `addSubTeam`
  - `removeTeam` → `removeSubTeam`
  - `toggleMemberInTeam` → `toggleMemberInSubTeam`
  - `setTeams` → `setSubTeams`
  - DELETE member actions (managed via Supabase)
- Update `DEFAULT_TEAMS` reference → `DEFAULT_SUBTEAMS`
- Add Season `teamId` field

### Phase 4: Component Updates

#### `src/components/AdminSettings.tsx`
- "Sub-Teams & Assignments" section:
  - Variable renames: `teams` → `subTeams`
  - Function renames: `addTeam` → `addSubTeam`, etc.
  - Member assignment UI → pulls from TeamMembers (Supabase users on Team Roster)
- "Team Roster" section:
  - Keep as-is conceptually (this manages TeamMembers)
  - Backend will change to Supabase user invites

#### `src/components/SprintPlanning.tsx` (KanbanBoard)
- Update `department` dropdown to use SubTeam
- Update assignee dropdown to pull from TeamMembers

#### `src/components/PreMatchChecklist.tsx`
- Update assignment dropdown to pull from TeamMembers or SubTeams

#### Other components
- Search for `team` and `member` usage and update accordingly

### Phase 5: New Pages/Components

#### `src/pages/TeamPicker.tsx` (NEW)
- Shows after login if user has teams
- Lists user's teams with option to switch
- "Create a Team" and "Join a Team" buttons

#### Update `src/App.tsx` routing
- Add TeamPicker route
- Redirect to TeamPicker after login if no team selected
- Pass currentTeamId to authenticated routes

---

## Database Migration (Supabase)

When ready to update Supabase, run migration:

```sql
-- Rename organizations to teams
ALTER TABLE organizations RENAME TO teams;

-- Rename organization_members to team_members  
ALTER TABLE organization_members RENAME TO team_members;
ALTER TABLE team_members RENAME COLUMN organization_id TO team_id;

-- Rename teams to sub_teams
ALTER TABLE teams RENAME TO sub_teams;

-- Rename team_members (the old junction for sub-teams) to sub_team_members
ALTER TABLE team_members RENAME TO sub_team_members;
ALTER TABLE sub_team_members RENAME COLUMN team_id TO sub_team_id;

-- Add team_id to seasons
ALTER TABLE seasons ADD COLUMN team_id UUID REFERENCES teams(id);

-- Update RLS policies accordingly
```

---

## Demo Mode Behavior

For demo/offline mode:
- User is automatically assigned to "Demo Team 1" and "Demo Team 2"
- Default SubTeams created: Build, Programming, Drive, Scouting, Outreach
- Demo TeamMembers: 5 placeholder users (Abby B, Ben C, Charlie D, Dana E, Evan F)

---

## Checklist for Implementation

- [ ] Phase 1: Update `types.ts` with new interfaces
- [ ] Phase 1: Update `database.types.ts` with renamed tables
- [ ] Phase 2: Update `constants.ts` with renamed constants
- [ ] Phase 3: Update `store.ts` with renamed state and actions
- [ ] Phase 4: Update `AdminSettings.tsx` 
- [ ] Phase 4: Update `SprintPlanning.tsx`
- [ ] Phase 4: Update `PreMatchChecklist.tsx`
- [ ] Phase 4: Update any other components with team/member references
- [ ] Phase 5: Create `TeamPicker.tsx` page
- [ ] Phase 5: Update `App.tsx` routing
- [ ] Verify: Build succeeds with no TypeScript errors
- [ ] Verify: App runs and demo mode works
- [ ] Test: Navigate through all pages

---

## Notes

- The current `Member` entity (firstName, lastNameInitial) will be replaced by pulling display info from Supabase users via TeamMember relationships
- For demo mode, we'll keep mock TeamMember data that mimics what would come from Supabase
- This is a LOCAL CODE rename only - Supabase migration will be done separately later

---

## Approval

Please review this plan and confirm:
1. Does the entity model look correct?
2. Should I proceed with implementation?
3. Any changes to scope or approach?
