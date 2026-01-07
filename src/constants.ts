import { TaskStatus, SubTeam, Team, TeamMember } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Testing,
  TaskStatus.Done
];

// Demo teams for offline/demo mode
// In production, users create teams or join via invite code
export const DEMO_TEAMS: Team[] = [
  {
    id: 'demo-team-1',
    name: 'Demo Team 1',
    teamNumber: '00001',
    inviteCode: 'DEMO1',
    ownerId: 'demo-user',
    createdAt: Date.now()
  },
  {
    id: 'demo-team-2',
    name: 'Demo Team 2',
    teamNumber: '00002',
    inviteCode: 'DEMO2',
    ownerId: 'demo-user',
    createdAt: Date.now()
  },
];

// Demo team members for offline/demo mode
// In production, these come from Supabase users via TeamMember relationships
export const DEMO_TEAM_MEMBERS: TeamMember[] = [
  { id: 'tm1', teamId: 'demo-team-1', userId: 'u1', role: 'student', fullName: 'Abby Brown', email: 'abby@demo.com', avatarUrl: null, joinedAt: Date.now() },
  { id: 'tm2', teamId: 'demo-team-1', userId: 'u2', role: 'student', fullName: 'Ben Clark', email: 'ben@demo.com', avatarUrl: null, joinedAt: Date.now() },
  { id: 'tm3', teamId: 'demo-team-1', userId: 'u3', role: 'student', fullName: 'Charlie Davis', email: 'charlie@demo.com', avatarUrl: null, joinedAt: Date.now() },
  { id: 'tm4', teamId: 'demo-team-1', userId: 'u4', role: 'mentor', fullName: 'Dana Evans', email: 'dana@demo.com', avatarUrl: null, joinedAt: Date.now() },
  { id: 'tm5', teamId: 'demo-team-1', userId: 'u5', role: 'coach', fullName: 'Evan Foster', email: 'evan@demo.com', avatarUrl: null, joinedAt: Date.now() },
];

// Default sub-teams (working groups within a Team)
// Renamed from MOCK_TEAMS
export const DEFAULT_SUBTEAMS: SubTeam[] = [
  { id: 'subteam-programming', name: 'Programming', memberIds: [] },
  { id: 'subteam-build', name: 'Build', memberIds: [] },
  { id: 'subteam-drive', name: 'Drive', memberIds: [] },
  { id: 'subteam-scouting', name: 'Scouting', memberIds: [] },
  { id: 'subteam-outreach', name: 'Outreach', memberIds: [] },
];

export const DEFAULT_CHECKLIST = [
  { id: '1', text: 'Immediately After Match - Return Misplaced Field Artifacts', checked: false },
  { id: '2', text: 'Immediately After Match - Turn off robot', checked: false },
  { id: '3', text: 'In Pit - Swap battery', checked: false },
  { id: '4', text: 'In Pit - Charge old battery', checked: false },
  { id: '5', text: 'In Pit - Charge driver hub', checked: false },
  { id: '6', text: 'In Pit - Check for loose screws', checked: false },
  { id: '7', text: 'In Pit - Check wiring connections', checked: false },
  { id: '8', text: 'Meet with next alliance team', checked: false },
  { id: '9', text: 'On Field - Turn on robot', checked: false },
  { id: '10', text: 'On Field - Preload artifacts', checked: false },
  { id: '11', text: 'On Field - Check gamepad connections', checked: false },
  { id: '12', text: 'On Field - Init autonomous', checked: false },
];

// The field image filename - MatchPlanner will prepend BASE_URL when using this
export const FIELD_IMAGE_URL = "DecodeField.png";
