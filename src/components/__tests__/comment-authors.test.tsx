/**
 * FEAT-01 — who a comment says it is from, written by one component and read by another.
 *
 * The defect was a mismatch across a seam, so the test has to cross the same seam.
 * `SprintPlanning` stored the AUTH USER id as `TimelineEvent.authorId`; `SprintTaskActivity`
 * resolves that against TEAM MEMBER ids, and `types.ts` documents the field as a TeamMember
 * id. So every comment anybody else left rendered as "Guest" with a "G" — on the board's only
 * collaboration surface, from the first day a team used it.
 *
 * Why it was invisible: the reader short-circuits on `profile.id` before the lookup runs, so
 * the author always sees their own name. You have to be a *different* signed-in user to see
 * it, which is exactly what `SprintTaskActivity.test.tsx`'s fixture could not express — it
 * hand-writes `authorId: 'member-1'`, the value the writer never produced, and therefore
 * passes whether the writer is right or wrong (`docs/failure-modes.md` §2).
 *
 * So: write through the real writer, read through the real reader, with two different people
 * signed in. Nothing here constructs an `authorId` by hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { Task, TeamMember, SubTeam, TimelineEvent } from '../../types';

vi.mock('../../lib/store', () => ({ useAppStore: vi.fn() }));

/** Who is signed in right now. Swapped between the write and the read. */
const mockUseAuth = vi.fn();
vi.mock('../../lib/auth', () => ({ useAuth: () => mockUseAuth() }));

vi.mock('@/lib/queries');

import SprintPlanning from '../SprintPlanning';
import SprintTaskActivity from '../SprintTaskActivity';
import { useAppStore } from '../../lib/store';

const STUDENT: TeamMember = {
    id: 'member-student', teamId: 'team-1', userId: 'user-student',
    fullName: 'Ada Lovelace', email: 'ada@test.com', role: 'student',
    status: 'approved', seatAssigned: true, avatarUrl: null, joinedAt: 1000,
};
const COACH: TeamMember = {
    id: 'member-coach', teamId: 'team-1', userId: 'user-coach',
    fullName: 'Grace Hopper', email: 'grace@test.com', role: 'coach',
    status: 'approved', seatAssigned: true, avatarUrl: null, joinedAt: 1000,
};
const ROSTER = [STUDENT, COACH];

const SUB_TEAMS: SubTeam[] = [
    { id: 'subteam-1', name: 'Build', memberIds: [], seasonId: 'season-1' },
];

const task: Task = {
    id: 'task-1', title: 'Rebuild the intake', description: '',
    status: 'To Do', type: 'Feature', assignedTo: '', department: 'subteam-1',
    tags: [], checklist: [], timeline: [], createdAt: 1000, seasonId: 'season-1',
};

const signedInAs = (member: TeamMember, name: string, initials: string) => {
    mockUseAuth.mockReturnValue({
        profile: { id: member.userId, email: member.email, fullName: name, avatarUrl: null },
        displayName: name,
        initials,
        isOffline: false,
    });
};

const updateTask = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    const store = {
        tasks: [task],
        teamMembers: ROSTER,
        subTeams: SUB_TEAMS,
        addTask: vi.fn(),
        updateTask,
        deleteTask: vi.fn(),
        currentSeasonId: 'season-1',
        seasons: [{ id: 'season-1', name: '2026-2027', gameTitle: '', isArchived: false, createdAt: 1000 }],
    };
    (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: unknown) =>
        typeof selector === 'function' ? (selector as (s: unknown) => unknown)(store) : store,
    );
});

/**
 * Add a comment to the task through the real UI, and return the timeline the store was
 * asked to persist.
 *
 * Deliberately reads the argument to `updateTask` rather than any component state: what
 * matters is the row that reaches the database, because that is what every OTHER device
 * will render.
 */
function commentAs(member: TeamMember, name: string, initials: string, text: string): TimelineEvent[] {
    signedInAs(member, name, initials);
    render(
        <SprintPlanning tasks={[task]} teamMembers={ROSTER} subTeams={SUB_TEAMS} currentMember={member} />,
    );

    fireEvent.click(screen.getByText('Rebuild the intake'));
    fireEvent.change(screen.getByPlaceholderText('Add a comment...'), { target: { value: text } });
    fireEvent.keyDown(screen.getByPlaceholderText('Add a comment...'), { key: 'Enter' });

    expect(updateTask, 'the comment never reached the store').toHaveBeenCalled();
    const [, patch] = updateTask.mock.calls.at(-1)!;
    return (patch as { timeline: TimelineEvent[] }).timeline;
}

describe('a comment written by one person and read by another (FEAT-01)', () => {
    it('renders the author’s name, not "Guest"', () => {
        const timeline = commentAs(STUDENT, 'Ada Lovelace', 'AL', 'Intake jams on the third cone');
        expect(timeline[0].content).toBe('Intake jams on the third cone');

        // A different person opens the same task. This is the whole test: the reader
        // short-circuits on the signed-in user, so the author must be resolved the hard way.
        signedInAs(COACH, 'Grace Hopper', 'GH');
        const { container } = render(
            <SprintTaskActivity
                timeline={timeline}
                teamMembers={ROSTER}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
            />,
        );

        const feed = within(container);
        expect(feed.getByText('Ada Lovelace'), 'the comment author was not named').toBeDefined();
        expect(feed.queryByText('Guest'), 'the author rendered as "Guest"').toBeNull();
        expect(feed.queryByText('G'), 'the author’s avatar rendered as "G"').toBeNull();
    });

    it('names the author of a status change too', () => {
        signedInAs(STUDENT, 'Ada Lovelace', 'AL');
        render(
            <SprintPlanning tasks={[task]} teamMembers={ROSTER} subTeams={SUB_TEAMS} currentMember={STUDENT} />,
        );

        fireEvent.click(screen.getByText('Rebuild the intake'));
        const status = screen.getByTestId('task-status-select');
        fireEvent.change(status, { target: { value: 'In Progress' } });
        fireEvent.click(screen.getByTestId('save-task'));

        const [, patch] = updateTask.mock.calls.at(-1)!;
        const history = (patch as Task).timeline.find((e) => e.type === 'history')!;
        expect(history, 'no history entry was written').toBeDefined();

        signedInAs(COACH, 'Grace Hopper', 'GH');
        const { container } = render(
            <SprintTaskActivity
                timeline={[history]}
                teamMembers={ROSTER}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
            />,
        );
        expect(within(container).getByText('Ada Lovelace')).toBeDefined();
    });

    it('still resolves a comment stored with the old auth user id', () => {
        // Every comment written before this fix is on a device and in a database with the
        // auth user id in it. A fix that renamed all of that history to "Guest" for ever
        // would be a worse bug than the one it closed.
        signedInAs(COACH, 'Grace Hopper', 'GH');
        const legacy: TimelineEvent = {
            id: 'old', type: 'comment', authorId: STUDENT.userId,
            content: 'Written last season', timestamp: 1000,
        };

        const { container } = render(
            <SprintTaskActivity
                timeline={[legacy]}
                teamMembers={ROSTER}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
            />,
        );

        expect(within(container).getByText('Ada Lovelace')).toBeDefined();
        expect(within(container).queryByText('Guest')).toBeNull();
    });

    it('does not attribute a guardian’s comment to their child', () => {
        // A guardian's roster row carries THEIR user id and their CHILD's profile — the
        // COPPA model. Matching on `userId` alone would name the child as the author of
        // something an adult wrote.
        const child: TeamMember = {
            ...STUDENT, id: 'member-child', userId: 'user-guardian',
            managedProfileId: 'profile-1', fullName: 'Small Child',
        };
        const guardian: TeamMember = {
            ...COACH, id: 'member-guardian', userId: 'user-guardian', fullName: 'A Parent',
        };
        signedInAs(STUDENT, 'Ada Lovelace', 'AL'); // somebody else is reading

        const legacy: TimelineEvent = {
            id: 'old', type: 'comment', authorId: 'user-guardian',
            content: 'Written by the parent', timestamp: 1000,
        };

        const { container } = render(
            <SprintTaskActivity
                timeline={[legacy]}
                teamMembers={[child, guardian]}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
            />,
        );

        expect(within(container).getByText('A Parent')).toBeDefined();
        expect(within(container).queryByText('Small Child'), 'the child was named as the author').toBeNull();
    });

    it('still says "Guest" for somebody who has left the team — the control', () => {
        // The fallback has to survive: a filter that resolved everything would pass the
        // cases above and say nothing.
        signedInAs(COACH, 'Grace Hopper', 'GH');
        const orphan: TimelineEvent = {
            id: 'x', type: 'comment', authorId: 'member-long-gone',
            content: 'Left the team', timestamp: 1000,
        };

        const { container } = render(
            <SprintTaskActivity
                timeline={[orphan]}
                teamMembers={ROSTER}
                onAddComment={vi.fn()}
                onDeleteComment={vi.fn()}
            />,
        );

        expect(within(container).getByText('Guest')).toBeDefined();
    });
});
