import { TaskStatus, SubTeam } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Testing,
  TaskStatus.Done
];

// Default sub-teams (working groups within a Team)
// Used as seed data when coaches create a new season
export const DEFAULT_SUBTEAMS: SubTeam[] = [
  { id: 'subteam-programming', name: 'Programming', memberIds: [] },
  { id: 'subteam-build', name: 'Build', memberIds: [] },
  { id: 'subteam-drive', name: 'Drive', memberIds: [] },
  { id: 'subteam-scouting', name: 'Scouting', memberIds: [] },
  { id: 'subteam-outreach', name: 'Outreach', memberIds: [] },
];

// The field image filename - MatchPlanner will prepend BASE_URL when using this
export const FIELD_IMAGE_URL = "DecodeField.png";
