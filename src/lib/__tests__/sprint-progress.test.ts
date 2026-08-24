/**
 * FEAT-09 — one definition of progress, not two.
 *
 * The sidebar counted `done / tasks.length`, which includes Backlog and Archived; the dashboard
 * counted only the four in-sprint statuses. So archiving a finished task LOWERED the sidebar's
 * figure and left the dashboard's unchanged — two numbers a coach can see at once, moving in
 * opposite directions, from the same click.
 *
 * THE ARCHIVE CASE IS THE TEST THAT MATTERS, and it is the one the defect was reported as. The
 * others are here because a shared selector has to be right about both ends: an empty sprint must
 * be 0% rather than NaN%, and a team whose backlog is full must not look like a team that is
 * behind.
 */
import { describe, it, expect } from 'vitest';
import { sprintProgress } from '../sprint-progress';
import type { Task } from '../../types';

const task = (status: string): Task =>
    ({
        id: crypto.randomUUID(),
        title: 't',
        description: '',
        status,
        type: 'Feature',
        assignedTo: '',
        department: '',
        checklist: [],
        timeline: [],
        createdAt: 1,
        seasonId: 's1',
    } as unknown as Task);

describe('sprintProgress', () => {
    it('counts the four in-sprint statuses and nothing else', () => {
        const p = sprintProgress([
            task('To Do'),
            task('In Progress'),
            task('Testing'),
            task('Done'),
            task('Backlog'),
            task('Archived'),
        ]);

        expect(p.total, 'Backlog or Archived counted towards the sprint').toBe(4);
        expect(p.done).toBe(1);
        expect(p.percent).toBe(25);
    });

    it('DOES NOT MOVE when a Done task is archived', () => {
        /*
         * The reported defect, stated as an assertion. Under the sidebar's old rule this figure
         * fell — tidying up read as regress — while the dashboard's stayed still, and both were
         * on screen together.
         */
        const before = sprintProgress([task('Done'), task('Done'), task('To Do')]);
        const after = sprintProgress([task('Done'), task('Archived'), task('To Do')]);

        expect(before.percent).toBeCloseTo(66.67, 1);
        // 1 of 2 now, because the archived one left the sprint entirely — done AND total fall,
        // which is the point: it is no longer part of what is being measured.
        expect(after.done).toBe(1);
        expect(after.total).toBe(2);
        expect(after.percent).toBe(50);
    });

    it('does not punish a team for having a backlog', () => {
        // Twenty things planned and both sprint tasks finished is 100%, not 9%.
        const p = sprintProgress([
            task('Done'),
            task('Done'),
            ...Array.from({ length: 20 }, () => task('Backlog')),
        ]);
        expect(p.percent).toBe(100);
        expect(p.total).toBe(2);
    });

    it('is 0 rather than NaN when the sprint is empty', () => {
        /*
         * `0/0` is NaN, and `width: NaN%` in a style attribute is dropped silently by every
         * browser — a progress bar that is simply missing, on the first screen a brand-new team
         * ever sees. `docs/failure-modes.md` §4: the zero case is the FIRST case, not an edge one.
         */
        expect(sprintProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
        expect(sprintProgress([task('Backlog')])).toEqual({ done: 0, total: 0, percent: 0 });
    });

    it('does not count a status it has never heard of', () => {
        // A column added to the board should not silently change what progress means; adding it
        // here is how somebody says it should count.
        expect(sprintProgress([task('Blocked'), task('Done')]).total).toBe(1);
    });
});
