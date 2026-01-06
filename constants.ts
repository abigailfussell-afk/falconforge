import { TaskStatus, Member, Team } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Testing,
  TaskStatus.Done
];

export const MOCK_MEMBERS: Member[] = [
  { id: 'm1', firstName: 'Abby', lastNameInitial: 'B' },
  { id: 'm2', firstName: 'Ben', lastNameInitial: 'C' },
  { id: 'm3', firstName: 'Charlie', lastNameInitial: 'D' },
  { id: 'm4', firstName: 'Dana', lastNameInitial: 'E' },
  { id: 'm5', firstName: 'Evan', lastNameInitial: 'F' },
];

export const MOCK_TEAMS: Team[] = [
  { id: 't1', name: 'Programming', memberIds: ['m1'] },
  { id: 't2', name: 'Build', memberIds: ['m2'] },
  { id: 't3', name: 'Drive', memberIds: ['m3'] },
  { id: 't4', name: 'Scouting', memberIds: ['m5'] },
  { id: 't5', name: 'Outreach', memberIds: ['m4'] },
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
