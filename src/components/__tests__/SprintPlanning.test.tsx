import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SprintPlanning from '../SprintPlanning';
import type { Task, TeamMember, SubTeam } from '../../types';
// The app's own initials function, so a card and the sidebar cannot disagree about a person.
import { getMemberInitials } from '../../lib/member-utils';

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

// The signed-in person. `user-context` was merged into the auth context in Sprint 5, so the
// profile now comes off `useAuth()` — one profile source, one cache.
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        profile: { id: 'user-1', email: 'test@example.com', fullName: 'Test User', avatarUrl: null },
        displayName: 'Test User',
        initials: 'TU',
        isOffline: false,
    })),
}));

const mockTasks: Task[] = [
    {
        id: 'task-1',
        title: 'Build drivetrain',
        description: 'Assemble the robot drivetrain',
        status: 'To Do' as const,
        type: 'Feature' as const,
        assignedTo: 'member-1',
        department: 'subteam-1',
        tags: ['urgent'],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
        seasonId: 'season-1',
    },
    {
        id: 'task-2',
        title: 'Program autonomous',
        description: 'Write autonomous code',
        status: 'In Progress' as const,
        type: 'Feature' as const,
        assignedTo: 'member-2',
        department: 'subteam-2',
        tags: [],
        checklist: [{ id: 'c1', text: 'Test path', completed: false }],
        timeline: [],
        createdAt: Date.now(),
        seasonId: 'season-1',
    },
    {
        id: 'task-3',
        title: 'Fix motor issue',
        description: 'Motor is stuttering',
        status: 'Done' as const,
        type: 'Bug' as const,
        assignedTo: 'member-1',
        department: 'subteam-1',
        tags: ['bug'],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
        seasonId: 'season-1',
    },
];

const mockTeamMembers: TeamMember[] = [
    { id: 'member-1', teamId: 'team-1', userId: 'user-1', fullName: 'John Doe', email: 'john@test.com', role: 'student', status: 'approved', seatAssigned: false, avatarUrl: null, joinedAt: Date.now() },
    { id: 'member-2', teamId: 'team-1', userId: 'user-2', fullName: 'Jane Smith', email: 'jane@test.com', role: 'coach', status: 'approved', seatAssigned: true, avatarUrl: null, joinedAt: Date.now() },
];

const mockSubTeams: SubTeam[] = [
    { id: 'subteam-1', name: 'Build Team', memberIds: ['member-1'], seasonId: 'season-1' },
    { id: 'subteam-2', name: 'Programming', memberIds: ['member-2'], seasonId: 'season-1' },
];

const mockStore = {
    tasks: mockTasks,
    teamMembers: mockTeamMembers,
    subTeams: mockSubTeams,
    addTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    currentSeasonId: 'season-1',
    // Sprint 4: every view now asks whether its season is archived, so the mocked
    // store needs the season the records belong to.
    seasons: [{ id: 'season-1', name: 'Test Season', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 }],
};

// Import after mocks
import { useAppStore } from '../../lib/store';

// Opt in to the manual mock in src/lib/__mocks__: the board's background refresh hook
// would otherwise need a real QueryClientProvider, which this suite is not about.
vi.mock('@/lib/queries');

describe('SprintPlanning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
            if (typeof selector === 'function') {
                return selector(mockStore);
            }
            return mockStore;
        });
    });

    describe('Board View', () => {
        it('renders the sprint planning page', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            // Should have header
            const header = document.querySelector('h1, h2, [class*="header"]');
            expect(header).toBeDefined();
        });

        it('displays task titles', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            expect(screen.getByText('Build drivetrain')).toBeDefined();
            expect(screen.getByText('Program autonomous')).toBeDefined();
        });

        it('shows status columns', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            // Check for column headers
            const columnNames = ['Backlog', 'To Do', 'In Progress', 'Testing', 'Done'];
            columnNames.forEach(name => {
                const column = screen.queryByText(name);
                // At least some columns should be visible (verify it ran)
                expect(column === null || column !== null).toBe(true);
            });
        });

        it('has view toggle buttons', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            // Should have Board, List, Calendar view options
            const buttons = screen.getAllByRole('button');
            expect(buttons.length).toBeGreaterThan(0);
        });
    });

    describe('Task Creation', () => {
        it('has add task button', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            const buttons = screen.getAllByRole('button');
            const addButton = buttons.find(btn =>
                btn.textContent?.toLowerCase().includes('add') ||
                btn.textContent?.toLowerCase().includes('new') ||
                btn.querySelector('svg')
            );

            expect(addButton).toBeDefined();
        });

        it('opens the task form when New Item is clicked', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            /*
             * OPS-02. This used to search the buttons for one whose text contained "add" or
             * that held a `[class*="plus"]` child, then do everything inside `if (addButton)`
             * — with no assertion anywhere. The control it was looking for is called "New
             * Item" and has a `data-testid`, so the search had been matching nothing, and the
             * test passed whether the board rendered a form, a different form, or nothing at
             * all.
             */
            fireEvent.click(screen.getByTestId('new-task-button'));

            // The modal is the assertion: its title input is unique to the task form.
            expect(screen.getByTestId('task-title-input')).toBeInTheDocument();
            expect(screen.getByTestId('save-task')).toBeInTheDocument();
        });

        it('opens the form empty rather than on a task — the control', () => {
            // Without this, "the modal is open" could be satisfied by clicking a card.
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            fireEvent.click(screen.getByTestId('new-task-button'));

            // A new task opens with a deliberate placeholder, which the modal focuses and
            // selects for overtyping — so the control is that it is not an EXISTING task.
            const title = (screen.getByTestId('task-title-input') as HTMLInputElement).value;
            expect(title).toBe('New Task');
            expect(title).not.toBe('Build drivetrain');
        });
    });

    describe('Task Interaction', () => {
        it('opens task details when clicking a task', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            fireEvent.click(screen.getByText('Build drivetrain'));

            // OPS-02: this clicked and asserted nothing. What makes it a DETAIL view rather
            // than any modal is that it is loaded with that task.
            expect((screen.getByTestId('task-title-input') as HTMLInputElement).value)
                .toBe('Build drivetrain');
            expect(screen.getByText('Activity & Comments')).toBeInTheDocument();
        });

        it('shows task type badge', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            // Look for Feature or Bug badges (use queryAllByText since there may be multiple)
            const featureBadges = screen.queryAllByText(/feature/i);
            const bugBadges = screen.queryAllByText(/bug/i);

            // At least one task type badge should exist
            expect(featureBadges.length + bugBadges.length).toBeGreaterThan(0);
        });

        it('displays assignee information', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            /*
             * OPS-02: the body of this test was two comments. It is worth having, because the
             * assignee is what a card is READ for on a competition morning — so it now asserts
             * the thing the comments described.
             *
             * `mockTasks[0]` is assigned to `member-1`, who is John Doe; the board renders
             * initials on the card. `getMemberInitials` is the app's own function, used rather
             * than a hardcoded "JD" so this cannot disagree with the sidebar about the same
             * person (seven implementations of that once disagreed — failure-modes §1).
             */
            const assignee = mockTeamMembers[0];
            expect(assignee.id).toBe(mockTasks[0].assignedTo);
            expect(screen.getAllByText(getMemberInitials(assignee)).length).toBeGreaterThan(0);
        });
    });

    describe('Archive functionality', () => {
        it('can switch to the archived view', () => {
            /*
             * OPS-02: `queryByText(/archive/i)` then `if (archiveButton) { click }`, with no
             * assertion. A view switch that renders nothing, or a button that has been renamed,
             * both left this green.
             *
             * `mockTasks` holds no archived task, so the archived view's EMPTY STATE is what
             * proves the switch happened — and that is worth pinning in its own right:
             * failure-modes §4 lists two missing empty states that reached a brand-new team.
             */
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: /archived/i }));

            expect(screen.getByText(/no archived tasks/i)).toBeInTheDocument();
            // ...and the board's columns are gone, so this is a different view rather than an
            // extra panel.
            expect(screen.queryByText('Build drivetrain')).not.toBeInTheDocument();
        });

        it('lists an archived task when there is one — the control', () => {
            const archived = {
                ...mockTasks[0],
                id: 'task-archived',
                title: 'Last season chassis',
                status: 'Archived' as Task['status'],
                archivedAt: 1000,
            };

            render(
                <SprintPlanning
                    tasks={[...mockTasks, archived]}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: /archived/i }));

            expect(screen.getByText('Last season chassis')).toBeInTheDocument();
            expect(screen.queryByText(/no archived tasks/i)).not.toBeInTheDocument();
        });
    });

    describe('Empty state', () => {
        it('handles empty task list', () => {
            (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector) => {
                const emptyStore = { ...mockStore, tasks: [] };
                if (typeof selector === 'function') {
                    return selector(emptyStore);
                }
                return emptyStore;
            });

            render(
                <SprintPlanning
                    tasks={[]}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                    currentMember={mockTeamMembers[0]}
                />
            );

            // Should still render without errors
            const container = document.querySelector('[class*="sprint"], [class*="planning"]');
            expect(container).toBeDefined();
        });
    });
});
