import { TaskStatus, Member, Team } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Validation,
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
  { id: '1', text: 'Turn off robot', checked: false },
  { id: '2', text: 'Swap main battery', checked: false },
  { id: '3', text: 'Charge old battery', checked: false },
  { id: '4', text: 'Charge Driver Hub', checked: false },
  { id: '5', text: 'Tighten chassis screws', checked: false },
  { id: '6', text: 'Check wiring connections', checked: false },
  { id: '7', text: 'Clean wheels', checked: false },
  { id: '8', text: 'Reset servo positions', checked: false },
];

export const FIELD_IMAGE_URL = "DecodeField.png";
