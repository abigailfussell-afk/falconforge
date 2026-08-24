import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SprintArchived from '../SprintArchived';
import { TaskStatus, TaskType, type Task } from '../../types';

/**
 * The archived row is reachable from a keyboard.
 *
 * It was a clickable <div> until Sprint 8's retrospective. Sprint 5.5 fixed four rows of
 * exactly this shape — scouting cards, calendar rows, checklist items — and did not reach
 * this one, which is the same "fixed here, never checked for elsewhere" pattern that left C2
 * live in JoinTeam for eight sprints (B26).
 *
 * `getByRole('button')` is the assertion that matters: it is satisfied only by something the
 * accessibility tree considers interactive, so it fails against a div with an onClick even
 * though `fireEvent.click` would happily drive one. See docs/failure-modes.md §8.
 */

const archivedTask = (over: Partial<Task> = {}): Task => ({
    id: 'task-1',
    title: 'Rewire the intake',
    description: '',
    status: TaskStatus.Archived,
    type: TaskType.Feature,
    assignedTo: 'member-1',
    department: 'subteam-1',
    checklist: [],
    timeline: [],
    createdAt: 1_700_000_000_000,
    archivedAt: 1_700_000_500_000,
    seasonId: 'season-1',
    ...over,
});

const renderArchived = (tasks: Task[]) => {
    const openTask = vi.fn();
    const restoreTask = vi.fn();
    render(
        <SprintArchived
            tasks={tasks}
            openTask={openTask}
            restoreTask={restoreTask}
            getSubTeamName={() => 'Build'}
            getMemberName={() => 'Alex'}
            refusalReason={undefined}
        />
    );
    return { openTask, restoreTask };
};

describe('SprintArchived', () => {
    beforeEach(() => vi.clearAllMocks());

    it('exposes each archived task as a button, not a clickable div', () => {
        const { openTask } = renderArchived([archivedTask()]);

        const row = screen.getByRole('button', { name: /rewire the intake/i });
        fireEvent.click(row);

        expect(openTask).toHaveBeenCalledTimes(1);
        expect(openTask.mock.calls[0][0].id).toBe('task-1');
    });

    it('restores without also opening the task', () => {
        const { openTask, restoreTask } = renderArchived([archivedTask()]);

        fireEvent.click(screen.getByRole('button', { name: /restore/i }));

        expect(restoreTask).toHaveBeenCalledWith('task-1');
        // Restore used to need stopPropagation to escape the row's click handler. Now that
        // the row is a sibling button rather than an ancestor, there is nothing to escape —
        // and this asserts that the two controls stayed independent.
        expect(openTask).not.toHaveBeenCalled();
    });

    it('shows only archived tasks', () => {
        renderArchived([
            archivedTask(),
            archivedTask({ id: 'task-2', title: 'Still in progress', status: TaskStatus.InProgress }),
        ]);

        expect(screen.getByRole('button', { name: /rewire the intake/i })).toBeInTheDocument();
        expect(screen.queryByText(/still in progress/i)).not.toBeInTheDocument();
    });
});
