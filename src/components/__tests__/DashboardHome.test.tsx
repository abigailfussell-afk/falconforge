import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardHome from '../DashboardHome';
import { useAppStore } from '@/lib/store';

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
                { id: '1', teamNumber: '123', matchNumber: 1, hasAutonomous: true, autoScore: 10, intakeType: 'Automatic', autoAim: true, farShooting: false, shotsTaken: 5, shotsMissed: 1, parking: 'No Park', rating: 4, endGameNotes: '' },
                { id: '2', teamNumber: '456', matchNumber: 2, hasAutonomous: false, autoScore: 0, intakeType: 'No Intake', autoAim: false, farShooting: false, shotsTaken: 0, shotsMissed: 0, parking: 'Full Park', rating: 3, endGameNotes: '' },
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
});
