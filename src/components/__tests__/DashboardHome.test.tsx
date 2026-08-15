import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardHome from '../DashboardHome';
import { useAppStore } from '@/lib/store';

// Opt in to the manual mocks in src/lib/__mocks__: this suite renders widgets and asserts
// on their content; auth readiness and the background refresh hooks are not its subject.
vi.mock('@/lib/auth');
vi.mock('@/lib/queries');
vi.mock('@/lib/realtime');

describe('DashboardHome', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock state for store matching the component's expectations
        useAppStore.setState({
            tasks: [
                { id: '1', title: 'Task 1', description: '', assignedTo: '', status: 'To Do', department: 'Build', type: 'Feature', checklist: [], timeline: [], createdAt: 1000, tags: [] },
                { id: '2', title: 'Task 2', description: '', assignedTo: '', status: 'Done', department: 'Programming', type: 'Bug', checklist: [], timeline: [], createdAt: 1000, tags: [] },
            ],
            scoutingReports: [
                { id: '1', teamNumber: '123', matchNumber: 1, hasAutonomous: true, autoScore: 10, intakeType: 'Automatic', autoAim: true, farShooting: false, shotsTaken: 5, shotsMissed: 1, parking: 'No Park', rating: 4, endGameNotes: '', createdAt: 2000 },
                { id: '2', teamNumber: '456', matchNumber: 2, hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false, farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'Full Park', rating: 3, endGameNotes: '', createdAt: 3000 },
            ],
            checklist: [
                { id: '1', text: 'Item 1', checked: true },
                { id: '2', text: 'Item 2', checked: false },
                { id: '3', text: 'Item 3', checked: false },
            ],
            currentSeasonId: 'season-1',
            seasons: [{ id: 'season-1', name: 'Test Season', fieldImageData: '', createdAt: 1000 }]
        });
    });

    it('renders the dashboard widgets', () => {
        render(
            <MemoryRouter>
                <DashboardHome setActiveTab={vi.fn()} />
            </MemoryRouter>
        );

        // Check for section headers
        expect(screen.getByText('Sprint Progress')).toBeInTheDocument();
        expect(screen.getByText('Backlog Items')).toBeInTheDocument();
        expect(screen.getAllByText('Scouting Reports')[0]).toBeInTheDocument();
        expect(screen.getAllByText('Match Plans')[0]).toBeInTheDocument();
        expect(screen.getByText('Quick Actions')).toBeInTheDocument();
        expect(screen.getByText('Recent Activity')).toBeInTheDocument();

        // Check for specific stats derived from the mocked state
        expect(screen.getByText('1 / 2')).toBeInTheDocument(); // 1 Done / 2 Active
        expect(screen.getAllByText('0')[0]).toBeInTheDocument(); // 0 in backlog

        // 2 match plans, 2 scouting reports but we might have 2 "2"s rendered because of the stats
        const twos = screen.getAllByText('2');
        expect(twos.length).toBeGreaterThanOrEqual(1);
    });

    it('renders empty states when no data is present', () => {
        useAppStore.setState({
            tasks: [],
            scoutingReports: [],
            checklist: [],
            matchPlans: [],
        });

        render(
            <MemoryRouter>
                <DashboardHome setActiveTab={vi.fn()} />
            </MemoryRouter>
        );

        expect(screen.getByText('0 / 0')).toBeInTheDocument();

        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBeGreaterThanOrEqual(3); // backlog, scouting, match plans

        expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
    });

    it('renders recent activity in descending chronological order', () => {
        useAppStore.setState({
            tasks: [
                { id: 't1', title: 'Oldest Task', description: '', assignedTo: '', status: 'To Do', department: '', type: 'Feature', checklist: [], timeline: [], createdAt: 1000, tags: [] },
                { id: 't2', title: 'Newest Task', description: '', assignedTo: '', status: 'In Progress', department: '', type: 'Feature', checklist: [], timeline: [], createdAt: 5000, tags: [] },
            ],
            scoutingReports: [
                { id: 's1', teamNumber: '999', matchNumber: 1, hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false, farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'No Park', rating: 3, endGameNotes: '', createdAt: 3000 },
            ],
            matchPlans: [
                { id: 'm1', title: 'Mid Plan', drawingData: null, notes: '', allianceTeam: '', partnerAutonomous: false, partnerPark: false, updatedAt: 2000 },
            ],
            currentSeasonId: 'season-1',
            seasons: [{ id: 'season-1', name: 'Test Season', fieldImageData: '', createdAt: 1000 }],
        });

        render(
            <MemoryRouter>
                <DashboardHome setActiveTab={vi.fn()} />
            </MemoryRouter>
        );

        // Items should appear in order: Newest Task (5000), Scouting 999 (3000), Mid Plan (2000), Oldest Task (1000)
        const activityItems = screen.getAllByText(/Task:|Scouting:|Match Plan:/);
        expect(activityItems[0].textContent).toContain('Newest Task');
        expect(activityItems[1].textContent).toContain('Team 999');
        expect(activityItems[2].textContent).toContain('Mid Plan');
        expect(activityItems[3].textContent).toContain('Oldest Task');
    });
});

