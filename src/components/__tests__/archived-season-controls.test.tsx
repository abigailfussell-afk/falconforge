/**
 * FEAT-02 — an archived season offers no control that cannot act.
 *
 * "Prior seasons are read-only" is a database rule (`season_is_open()` gates every
 * season-scoped write policy) and the board did not know it. The task modal offered Save,
 * Delete and Archive; the feed offered a comment box and a delete; the archived list offered
 * Restore. Every one of them ran, the store's guard `console.warn`ed, `saveTask` closed the
 * modal anyway, and nothing on screen said why. At a venue that is indistinguishable from
 * lost work — `docs/failure-modes.md` §8, the class this project has hit seven times.
 *
 * What is NOT withdrawn is as much the point: the modal still opens, the feed still renders,
 * and last season stays browsable. That is the use case archiving exists to serve, so the
 * final case here is the control that would catch a fix which simply hid everything.
 */
import { describe, it, expect, vi } from 'vitest';
import { EDIT_REFUSAL_TEXT } from '../../lib/entitlement';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SprintTaskDetail from '../SprintTaskDetail';
import SprintTaskActivity from '../SprintTaskActivity';
import SprintArchived from '../SprintArchived';
import type { Task, TeamMember, SubTeam, TimelineEvent } from '../../types';

vi.mock('../../lib/auth', () => ({
    useAuth: () => ({
        profile: { id: 'user-1', email: 'a@b.c', fullName: 'Signed In', avatarUrl: null },
        displayName: 'Signed In',
        initials: 'SI',
    }),
}));

const MEMBER: TeamMember = {
    id: 'member-1', teamId: 'team-1', userId: 'user-1', fullName: 'Ada Lovelace',
    email: 'ada@test.com', role: 'student', status: 'approved', seatAssigned: true,
    avatarUrl: null, joinedAt: 1000,
};
const SUB_TEAMS: SubTeam[] = [{ id: 'st-1', name: 'Build', memberIds: [], seasonId: 'season-1' }];

const comment: TimelineEvent = {
    id: 'c1', type: 'comment', authorId: 'member-1', content: 'Intake jams', timestamp: 1000,
};

const doneTask: Task = {
    id: 'task-1', title: 'Rebuild the intake', description: 'notes',
    status: 'Done', type: 'Feature', assignedTo: 'member-1', department: 'st-1', checklist: [{ id: 'x', text: 'Order parts', completed: false }],
    timeline: [comment], createdAt: 1000, seasonId: 'season-1',
};

const renderModal = (canEdit: boolean) =>
    render(
        <SprintTaskDetail
            task={doneTask}
            isNewTask={false}
            teamMembers={[MEMBER]}
            subTeams={SUB_TEAMS}
            onChange={vi.fn()}
            onSave={vi.fn()}
            onRequestDelete={vi.fn()}
            onArchive={vi.fn()}
            onClose={vi.fn()}
            onAddComment={vi.fn()}
            onDeleteComment={vi.fn()}
            canEdit={canEdit}
            refusalReason={canEdit ? undefined : READ_ONLY}
        />,
    );

/*
 * Sprint 16 moved this sentence out of the components and into `EDIT_REFUSAL_TEXT`, because
 * a lapsed licence and a missing season used to get it too and it was false for both. These
 * tests render the components directly, so they supply the reason the way the app now does —
 * from the map — rather than restating the literal and going green while the app says
 * something else.
 */
const READ_ONLY = EDIT_REFUSAL_TEXT['archived-season'];

describe('the task modal on an archived season (FEAT-02)', () => {
    it('disables Save, Delete and Archive, and says why', () => {
        renderModal(false);

        for (const id of ['save-task', 'delete-task', 'archive-task']) {
            const control = screen.getByTestId(id);
            expect(control, `${id} is still live on an archived season`).toBeDisabled();
            expect(control.getAttribute('title'), `${id} does not say why`).toBe(READ_ONLY);
        }
    });

    it('leaves every field read-only, including ones nobody listed', () => {
        renderModal(false);

        // A `fieldset[disabled]` is what makes this true of fields added later too, so the
        // assertion is over what the DOM actually contains rather than over a list.
        const fields = [
            ...document.querySelectorAll<HTMLElement>('input, select, textarea'),
        ].filter((el) => el.getAttribute('data-testid') !== 'task-title-input');
        expect(fields.length, 'the modal rendered no fields at all').toBeGreaterThan(3);
        for (const field of fields) {
            expect(field, `${field.tagName} is editable on an archived season`).toBeDisabled();
        }
        expect(screen.getByTestId('task-title-input')).toBeDisabled();
    });

    it('still OPENS, and still shows the work — the control', () => {
        // A fix that hid the modal, or the feed, would pass every assertion above and destroy
        // the reason archiving keeps the data at all.
        renderModal(false);

        expect((screen.getByTestId('task-title-input') as HTMLInputElement).value)
            .toBe('Rebuild the intake');
        expect(screen.getByText('Intake jams'), 'the activity feed was hidden').toBeDefined();
        // Twice: the assignee option and the comment's author. Both are the feed working.
        expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0);
        // Cancel is not a write, so it must keep working — otherwise the modal is a trap.
        expect(screen.getByText('Cancel').closest('button')).not.toBeDisabled();
    });

    it('leaves all of it alone on an open season — the other control', () => {
        renderModal(true);

        expect(screen.getByTestId('save-task')).not.toBeDisabled();
        expect(screen.getByTestId('delete-task')).not.toBeDisabled();
        expect(screen.getByTestId('archive-task')).not.toBeDisabled();
        expect(screen.getByTestId('task-title-input')).not.toBeDisabled();
    });
});

describe('the comment box on an archived season (FEAT-02)', () => {
    const renderFeed = (canEdit: boolean, onAddComment = vi.fn()) => {
        const result = render(
            <SprintTaskActivity
                timeline={[comment]}
                teamMembers={[MEMBER]}
                onAddComment={onAddComment}
                onDeleteComment={vi.fn()}
                canEdit={canEdit}
                refusalReason={canEdit ? undefined : READ_ONLY}
            />,
        );
        return { ...result, onAddComment };
    };

    it('disables the box, the send button and the per-comment delete', () => {
        renderFeed(false);

        expect(screen.getByTestId('comment-input')).toBeDisabled();
        expect(screen.getByTestId('comment-send')).toBeDisabled();
        expect(screen.getByTestId('comment-send').getAttribute('title')).toBe(READ_ONLY);
        expect(screen.getByTestId('comment-delete')).toBeDisabled();
    });

    it('does not send even if something reaches the handler', () => {
        // The disabled attribute is UX. `submit()` refusing is the behaviour, and a keyboard
        // Enter on a control a browser extension re-enabled would otherwise still write.
        const { onAddComment } = renderFeed(false);

        fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'hello' } });
        fireEvent.keyDown(screen.getByTestId('comment-input'), { key: 'Enter' });

        expect(onAddComment, 'a comment was sent on an archived season').not.toHaveBeenCalled();
    });

    it('still renders the history — the control', () => {
        const { container } = renderFeed(false);
        expect(within(container).getByText('Intake jams')).toBeDefined();
    });

    it('sends normally on an open season — the other control', () => {
        const { onAddComment } = renderFeed(true);

        fireEvent.change(screen.getByTestId('comment-input'), { target: { value: 'hello' } });
        fireEvent.keyDown(screen.getByTestId('comment-input'), { key: 'Enter' });

        expect(onAddComment).toHaveBeenCalledWith('hello');
    });
});

describe('Restore on an archived season (FEAT-02)', () => {
    const archived: Task = { ...doneTask, status: 'Archived' as Task['status'], archivedAt: 2000 };

    const renderArchived = (canEdit: boolean, restoreTask = vi.fn()) => {
        render(
            <SprintArchived
                tasks={[archived]}
                openTask={vi.fn()}
                getSubTeamName={() => 'Build'}
                getMemberName={() => 'Ada Lovelace'}
                restoreTask={restoreTask}
                canEdit={canEdit}
                refusalReason={canEdit ? undefined : READ_ONLY}
            />,
        );
        return restoreTask;
    };

    it('is disabled and says why', () => {
        renderArchived(false);

        const restore = screen.getByTestId('restore-task');
        expect(restore).toBeDisabled();
        expect(restore.getAttribute('title')).toBe(READ_ONLY);
    });

    it('still lists the archived task, and still opens it — the control', () => {
        const openTask = vi.fn();
        render(
            <SprintArchived
                tasks={[archived]}
                openTask={openTask}
                getSubTeamName={() => 'Build'}
                getMemberName={() => 'Ada Lovelace'}
                restoreTask={vi.fn()}
                canEdit={false}
                refusalReason={READ_ONLY}
            />,
        );

        expect(screen.getByText('Rebuild the intake')).toBeDefined();
        fireEvent.click(screen.getByText('Rebuild the intake'));
        expect(openTask, 'an archived season stopped you reading last season').toHaveBeenCalled();
    });

    it('restores normally on an open season — the other control', () => {
        const restoreTask = renderArchived(true);
        fireEvent.click(screen.getByTestId('restore-task'));
        expect(restoreTask).toHaveBeenCalledWith('task-1');
    });
});
