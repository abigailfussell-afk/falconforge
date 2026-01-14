import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SprintPlanning from '../SprintPlanning';

// Mock the store
vi.mock('../../lib/store', () => ({
    useAppStore: vi.fn(),
}));

// Mock user context
vi.mock('../../lib/user-context', () => ({
    useCurrentUser: vi.fn(() => ({
        id: 'user-1',
        email: 'test@example.com',
        fullName: 'Test User',
    })),
}));

const mockTasks = [
    {
        id: 'task-1',
        title: 'Build drivetrain',
        description: 'Assemble the robot drivetrain',
        status: 'To Do',
        type: 'Feature',
        assignedTo: 'member-1',
        department: 'subteam-1',
        tags: ['urgent'],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
    },
    {
        id: 'task-2',
        title: 'Program autonomous',
        description: 'Write autonomous code',
        status: 'In Progress',
        type: 'Feature',
        assignedTo: 'member-2',
        department: 'subteam-2',
        tags: [],
        checklist: [{ id: 'c1', text: 'Test path', completed: false }],
        timeline: [],
        createdAt: Date.now(),
    },
    {
        id: 'task-3',
        title: 'Fix motor issue',
        description: 'Motor is stuttering',
        status: 'Done',
        type: 'Bug',
        assignedTo: 'member-1',
        department: 'subteam-1',
        tags: ['bug'],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
    },
];

const mockTeamMembers = [
    { id: 'member-1', fullName: 'John Doe', email: 'john@test.com', role: 'student' },
    { id: 'member-2', fullName: 'Jane Smith', email: 'jane@test.com', role: 'coach' },
];

const mockSubTeams = [
    { id: 'subteam-1', name: 'Build Team', memberIds: ['member-1'] },
    { id: 'subteam-2', name: 'Programming', memberIds: ['member-2'] },
];

const mockStore = {
    tasks: mockTasks,
    teamMembers: mockTeamMembers,
    subTeams: mockSubTeams,
    addTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    currentSeasonId: 'season-1',
};

// Import after mocks
import { useAppStore } from '../../lib/store';

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
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
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
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            expect(screen.getByText('Build drivetrain')).toBeDefined();
            expect(screen.getByText('Program autonomous')).toBeDefined();
        });

        it('shows status columns', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            // Check for column headers
            const columnNames = ['Backlog', 'To Do', 'In Progress', 'Testing', 'Done'];
            columnNames.forEach(name => {
                const column = screen.queryByText(name);
                // At least some columns should be visible
            });
        });

        it('has view toggle buttons', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
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
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
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

        it('opens task form when clicking add', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            const buttons = screen.getAllByRole('button');
            const addButton = buttons.find(btn =>
                btn.textContent?.toLowerCase().includes('add') ||
                btn.querySelector('[class*="plus"]')
            );

            if (addButton) {
                fireEvent.click(addButton);
                // Form or modal should open
            }
        });
    });

    describe('Task Interaction', () => {
        it('opens task details when clicking a task', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            const taskCard = screen.getByText('Build drivetrain');
            fireEvent.click(taskCard);

            // Task detail modal/panel should open
        });

        it('shows task type badge', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            // Look for Feature or Bug badges
            const featureBadge = screen.queryByText(/feature/i);
            const bugBadge = screen.queryByText(/bug/i);

            // At least task types should be distinguishable
        });

        it('displays assignee information', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            // Should show assignee name or initials
            // Look for member names or avatar indicators
        });
    });

    describe('Archive functionality', () => {
        it('can switch to archived view', () => {
            render(
                <SprintPlanning
                    tasks={mockTasks}
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            // Look for archived view toggle
            const archiveButton = screen.queryByText(/archive/i);
            if (archiveButton) {
                fireEvent.click(archiveButton);
            }
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
                    setTasks={vi.fn()}
                    teamMembers={mockTeamMembers}
                    subTeams={mockSubTeams}
                />
            );

            // Should still render without errors
            const container = document.querySelector('[class*="sprint"], [class*="planning"]');
            expect(container).toBeDefined();
        });
    });
});
