import { TaskStatus } from './types';

export const STATUS_COLUMNS = [
  TaskStatus.Backlog,
  TaskStatus.ToDo,
  TaskStatus.InProgress,
  TaskStatus.Testing,
  TaskStatus.Done
];

/**
 * THERE ARE NO CLIENT-SIDE SEED CONSTANTS ANY MORE.
 *
 * `DEFAULT_SUBTEAMS` used to live here as five hardcoded UUIDs, and `store.ts` held a
 * `DEFAULT_SEASON` and a `DEFAULT_CHECKLIST_ITEMS` alongside it. Sprint 2 made the ids real
 * UUIDs (C5), which fixed the cast failures but not the deeper problem: the ids were the
 * SAME on every device of every team.
 *
 * Two teams seeding sub-team `657c8820-…` both push it. The second push is an upsert onto a
 * row that belongs to the first team, so RLS refuses the UPDATE branch and the whole thing
 * dead-letters — the second team's sub-teams simply never sync, with an error nobody can
 * act on. And under the V2 schema a seeded season is worse still: `season_id` is NOT NULL
 * with a composite FK, so every task created under a season that exists only on the client
 * is unpushable too.
 *
 * Seeding is now the server's job. `create_team_as_admin` creates the team's first season,
 * its sub-teams and its pre-match checklist, with fresh per-team uuids, inside the same
 * transaction that creates the team. The client's copy arrives on the first pull like every
 * other row, which means it is real before the user can touch it.
 */

// The field image filename - MatchPlanner will prepend BASE_URL when using this