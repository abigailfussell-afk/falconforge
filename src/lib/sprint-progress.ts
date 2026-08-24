import type { Task } from '../types';

/**
 * How far through the sprint the team is — one definition, not two (FEAT-09).
 *
 * There were two, on the same screen, disagreeing:
 *
 *   - the sidebar counted `done / tasks.length`, which includes **Backlog and Archived**;
 *   - the dashboard counted `done / (To Do + In Progress + Testing + Done)`.
 *
 * So archiving a finished task LOWERED the sidebar's figure and left the dashboard's unchanged —
 * two numbers a coach can see at once, moving in different directions, from the same click.
 * `docs/failure-modes.md` §1 is eighteen instances of this shape, and its load-bearing
 * observation is that every dedup pass in this project has found a behavioural defect rather
 * than redundancy. This one is small, and it is still a screen disagreeing with itself.
 *
 * THE DASHBOARD'S DEFINITION WON, and the reason is what the number is FOR. "How much of this
 * sprint is done" is a question about the work in the sprint:
 *
 *   - **Backlog is not in the sprint.** It is the pile the sprint is drawn from, and counting it
 *     means a team that plans ahead looks like a team that is behind — the board's own columns
 *     already treat it as a separate place.
 *   - **Archived work is finished and filed.** Counting it in the denominator makes tidying up
 *     look like regress, which is the specific defect FEAT-09 reports.
 *
 * A pure function over a task list rather than a store selector: both callers already hold the
 * season-scoped list they want to measure (`useSeasonScoped`), and a selector would have to
 * re-derive that or take a second definition of "which tasks" — which is how there came to be two
 * of these in the first place.
 */
export interface SprintProgress {
    /** Tasks in the sprint that are finished. */
    done: number;
    /** Tasks in the sprint, finished or not. Never includes Backlog or Archived. */
    total: number;
    /** 0–100. Zero when there is nothing in the sprint, rather than NaN. */
    percent: number;
}

/**
 * The statuses that are "in the sprint".
 *
 * Written out rather than derived from `STATUS_COLUMNS` deliberately: the board's column list is
 * a rendering decision and this is a measurement, and tying them together means the next column
 * somebody adds to the board silently changes what "progress" means. If a status should count,
 * this list is where somebody says so.
 */
const IN_SPRINT = ['To Do', 'In Progress', 'Testing', 'Done'] as const;

export function sprintProgress(tasks: Task[]): SprintProgress {
    const inSprint = tasks.filter((t) => (IN_SPRINT as readonly string[]).includes(t.status));
    const done = inSprint.filter((t) => t.status === 'Done').length;
    return {
        done,
        total: inSprint.length,
        // Zero, not NaN: `0/0` renders as `NaN%` in a style attribute, which a browser drops
        // silently — a progress bar that is simply missing, on a brand-new team's first screen.
        percent: inSprint.length === 0 ? 0 : (done / inSprint.length) * 100,
    };
}
