import { TaskStatus, SubTeam } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Testing,
  TaskStatus.Done
];

/**
 * Default sub-teams (working groups within a Team), used as seed data.
 *
 * The ids are real UUIDs because every id in this app is a Postgres `uuid` column (C5).
 * They used to read `'subteam-programming'`, which is friendlier to a human and fatal to
 * a sync: the push fails on `invalid input syntax for type uuid`, retries five times and
 * parks in the dead-letter store. The user sees their sub-team locally and it never
 * reaches the server — and because sub_teams is the FK target for `tasks.sub_team_id`,
 * every task assigned to one fails too.
 *
 * They are hardcoded rather than generated so that a record created on one device names
 * the same sub-team as on another. Do not regenerate them.
 */
export const DEFAULT_SUBTEAMS: SubTeam[] = [
  { id: '657c8820-9d8b-4bba-89ea-15e97d787cc0', name: 'Programming', memberIds: [] },
  { id: '2a426522-1d27-4401-9b1d-1fd37d10e165', name: 'Build', memberIds: [] },
  { id: '46ee5d75-6342-4837-9e77-2044e64e2851', name: 'Drive', memberIds: [] },
  { id: 'e06d09b1-5348-43dc-8db0-ba4d5911b4dc', name: 'Scouting', memberIds: [] },
  { id: '5c4ca480-e1cc-459b-8435-6a79ff365672', name: 'Outreach', memberIds: [] },
];

// The field image filename - MatchPlanner will prepend BASE_URL when using this
export const FIELD_IMAGE_URL = "DecodeField.png";
