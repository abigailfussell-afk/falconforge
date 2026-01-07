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
