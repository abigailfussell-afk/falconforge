/**
 * FEAT-03 and FEAT-04 — two shapes of the same defect: the user does work and the app throws it
 * away without saying so.
 *
 * FEAT-03. A comment typed into a not-yet-saved task appeared in the feed and was discarded by
 * Save. `addComment` skipped the store while `isNewTask` (correctly — there is no row to update
 * yet) and `saveTask` then passed no `timeline` to `addTask`, which built a fresh one containing
 * "Task created" and nothing else. Reopen the task and the comment is gone, with no error and
 * nothing to retry.
 *
 * FEAT-04. Ticking a checklist box wrote straight into the STORE, because the handlers did
 * `const c = [...task.checklist]; c[idx].completed = …` — a shallow copy of the array whose item
 * objects belong to the store. So Cancel could not revert: the tick stayed on screen, was never
 * queued for sync, and vanished on the next pull. A student ticks "wiring checked", closes the
 * dialog, and the item silently un-ticks itself later, on their device only.
 *
 * THE FIDELITY THAT MAKES THE FEAT-04 TEST REAL, and without which it would assert the harness.
 * `App.tsx`'s route adapter hands `SprintPlanning` `{...task, timeline: task.timeline.map(...)}`
 * — a shallow copy of the task with a NEW timeline array and *the store's own checklist array
 * and item objects*. This file builds the prop exactly that way. Deep-cloning the fixture here
 * would make the test pass against the mutating version, which is `docs/failure-modes.md` §2:
 * a test satisfied by the state the defect also produces.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SprintPlanning from '../SprintPlanning';
import type { Task, TeamMember, SubTeam } from '../../types';

vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        profile: { id: 'user-1', email: 'coach@test.com', fullName: 'Pat Coach', avatarUrl: null },
        displayName: 'Pat Coach',
        initials: 'PC',
        isOffline: false,
    })),
}));

vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

vi.mock('@/lib/queries');

import { useAppStore } from '../../lib/store';

const MEMBERS: TeamMember[] = [
    { id: 'member-1', teamId: 'team-1', userId: 'user-1', fullName: 'Pat Coach', email: 'coach@test.com', role: 'coach', status: 'approved', seatAssigned: true, avatarUrl: null, joinedAt: 1000 },
];

const SUB_TEAMS: SubTeam[] = [
    { id: 'subteam-1', name: 'Build Team', memberIds: ['member-1'], seasonId: 'season-1' },
];

/**
 * The store's own task object, with the store's own checklist items in it.
 *
 * Rebuilt per test rather than shared, because half the point is that the OLD code mutated it.
 */
const storeTask = (): Task => ({
    id: 'task-1',
    title: 'Rebuild the intake',
    description: '',
    status: 'To Do',
    type: 'Feature',
    assignedTo: 'member-1',
    department: 'subteam-1',
    tags: [],
    checklist: [
        { id: 'c1', text: 'Wiring checked', completed: false },
        { id: 'c2', text: 'Belts tensioned', completed: false },
    ],
    timeline: [],
    createdAt: 1000,
    seasonId: 'season-1',
});

/** Exactly what `App.tsx`'s route adapter builds. See the docblock. */
const asRouteAdapterDoes = (t: Task): Task => ({
    ...t,
    timeline: t.timeline.map((e) => ({ ...e })),
});

let store: {
    tasks: Task[];
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
    addTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
    currentSeasonId: string;
    seasons: Array<{ id: string; name: string; gameTitle: string; fieldImageData: string; isArchived: boolean; createdAt: number }>;
};

beforeEach(() => {
    vi.clearAllMocks();
    store = {
        tasks: [storeTask()],
        teamMembers: MEMBERS,
        subTeams: SUB_TEAMS,
        addTask: vi.fn(),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        currentSeasonId: 'season-1',
        seasons: [{ id: 'season-1', name: 'Test Season', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 }],
    };
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: unknown) =>
        typeof selector === 'function' ? (selector as (s: unknown) => unknown)(store) : store,
    );
});

const renderBoard = () =>
    render(
        <SprintPlanning
            tasks={store.tasks.map(asRouteAdapterDoes)}
            teamMembers={MEMBERS}
            subTeams={SUB_TEAMS}
            currentMember={MEMBERS[0]}
        />,
    );

const openFirstTask = () => {
    fireEvent.click(screen.getAllByTestId('task-card')[0]);
};

describe('FEAT-04 — a cancelled checklist edit leaves the store alone', () => {
    it('does not tick the store’s item when the box is ticked and the dialog cancelled', () => {
        renderBoard();
        openFirstTask();

        const boxes = screen.getAllByRole('checkbox');
        fireEvent.click(boxes[0]);
        // The draft really did change — otherwise the assertion below passes for the wrong
        // reason, which is how a check quietly stops verifying.
        expect((boxes[0] as HTMLInputElement).checked).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(store.tasks[0].checklist[0].completed, 'Cancel left the store ticked').toBe(false);
        expect(store.updateTask).not.toHaveBeenCalled();
    });

    it('does not rewrite the store’s item text when the text is edited and cancelled', () => {
        renderBoard();
        openFirstTask();

        const textInputs = screen.getAllByPlaceholderText('Enter checklist item...');
        fireEvent.change(textInputs[0], { target: { value: 'Wiring checked TWICE' } });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(store.tasks[0].checklist[0].text).toBe('Wiring checked');
        expect(store.updateTask).not.toHaveBeenCalled();
    });

    it('leaves the untouched items as they were', () => {
        // The `map` replaces one item and returns the others by reference, which is correct and
        // worth pinning: a fix that rebuilt every item would be indistinguishable here today and
        // would quietly change identity semantics the board's keys rely on.
        renderBoard();
        openFirstTask();

        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(store.tasks[0].checklist[1]).toEqual({
            id: 'c2',
            text: 'Belts tensioned',
            completed: false,
        });
    });

    it('still saves the edit when Save is pressed', () => {
        // The other half. A fix that made Cancel work by making Save not work would pass every
        // assertion above.
        renderBoard();
        openFirstTask();

        fireEvent.click(screen.getAllByRole('checkbox')[0]);
        fireEvent.click(screen.getByTestId('save-task'));

        expect(store.updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                checklist: [
                    { id: 'c1', text: 'Wiring checked', completed: true },
                    { id: 'c2', text: 'Belts tensioned', completed: false },
                ],
            }),
        );
    });
});

describe('FEAT-03 — a comment typed before the task exists survives Save', () => {
    const typeComment = (text: string) => {
        fireEvent.change(screen.getByTestId('comment-input'), { target: { value: text } });
        fireEvent.click(screen.getByTestId('comment-send'));
    };

    it('passes the comment to addTask rather than dropping it', () => {
        renderBoard();
        fireEvent.click(screen.getByTestId('new-task-button'));

        fireEvent.change(screen.getByTestId('task-title-input'), {
            target: { value: 'Replace the odometry pod' },
        });
        typeComment('It has been slipping since Saturday.');

        fireEvent.click(screen.getByTestId('save-task'));

        expect(store.addTask).toHaveBeenCalledTimes(1);
        const [payload] = store.addTask.mock.calls[0] as [{ timeline?: Array<{ type: string; content: string }> }];
        // The ARGUMENT, not the call count: `addTask` was always called, and was always called
        // exactly once, with the comment missing from it (failure-modes §2).
        expect(payload.timeline, 'addTask was given no timeline at all').toBeDefined();
        expect(payload.timeline!.map((e) => e.content)).toContain(
            'It has been slipping since Saturday.',
        );
    });

    it('keeps more than one comment, newest first', () => {
        renderBoard();
        fireEvent.click(screen.getByTestId('new-task-button'));
        fireEvent.change(screen.getByTestId('task-title-input'), { target: { value: 'Two comments' } });

        typeComment('first');
        typeComment('second');
        fireEvent.click(screen.getByTestId('save-task'));

        const [payload] = store.addTask.mock.calls[0] as [{ timeline?: Array<{ content: string }> }];
        expect(payload.timeline!.map((e) => e.content)).toEqual(['second', 'first']);
    });

    it('does not write to the store while the task is still a draft', () => {
        // There is no row to update yet, and calling `updateTask` with an id the store has never
        // seen is how a queued update for a non-existent record gets created.
        renderBoard();
        fireEvent.click(screen.getByTestId('new-task-button'));
        typeComment('before it exists');

        expect(store.updateTask).not.toHaveBeenCalled();
        expect(store.addTask).not.toHaveBeenCalled();
    });

    it('still persists a comment immediately on a task that already exists', () => {
        // Unchanged behaviour, asserted because the fix touches the same function.
        renderBoard();
        openFirstTask();
        typeComment('on an existing task');

        expect(store.updateTask).toHaveBeenCalledWith(
            'task-1',
            expect.objectContaining({
                timeline: expect.arrayContaining([
                    expect.objectContaining({ content: 'on an existing task' }),
                ]),
            }),
        );
    });
});
