import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AdminSettings from '../AdminSettings';
import * as auth from '@/lib/auth';
import { useAppStore } from '@/lib/store';

// Mock auth context
vi.mock('@/lib/auth', () => ({
    useAuth: vi.fn(),
}));

// Mock user context
vi.mock('@/lib/user-context', () => ({
    useCurrentUser: vi.fn().mockReturnValue({
        currentUserRole: 'coach',
        isCoachOrAdmin: true,
        isCreator: true,
        canEdit: true,
    }),
}));

describe('AdminSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock state for store
        useAppStore.setState({
            teams: [{ id: 'team-1', name: 'Test Team', teamNumber: '1234', ownerId: 'user-1', createdAt: 1000 }],
            currentTeamId: 'team-1',
            teamMembers: [{ id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'coach', status: 'approved', joinedAt: 1000, fullName: 'Test User', email: 'test@test.com', isBillingActive: false, avatarUrl: null }],
            subTeams: [],
            seasons: [],
            currentSeasonId: null,
        });

        // Default mock state for auth
        vi.mocked(auth.useAuth).mockReturnValue({
            user: { id: 'user-1', email: 'test@test.com', user_metadata: { full_name: 'Test User' } } as any,
            session: {} as any,
            isLoading: false,
            signInWithEmail: vi.fn(),
            signUpWithEmail: vi.fn(),
            signInWithGoogle: vi.fn(),
            signInWithMicrosoft: vi.fn(),
            signOut: vi.fn(),
            resetPassword: vi.fn(),
            updateProfile: vi.fn(),
            updateAgeClassification: vi.fn(),
            isConfigured: true,
            ageClassification: null,
        });
    });

    const mockProps = {
        teamMembers: [],
        subTeams: [],
    };

    it('renders the admin settings sections', () => {
        render(
            <MemoryRouter>
                <AdminSettings {...mockProps} />
            </MemoryRouter>
        );

        // Core Headers
        expect(screen.getByText('Admin Settings')).toBeInTheDocument();
        expect(screen.getByText('Team Roster')).toBeInTheDocument();
        expect(screen.getByText('Sub-Teams & Assignments')).toBeInTheDocument();
        expect(screen.getByText('Season Manager')).toBeInTheDocument();
    });

    it('allows interacting with sub-teams section', () => {
        render(
            <MemoryRouter>
                <AdminSettings {...mockProps} />
            </MemoryRouter>
        );

        // Verify the sub-teams section is shown (e.g., looking for the Add Sub-Team button)
        const subTeamInput = screen.getByPlaceholderText('New Sub-Team Name (e.g. Pit Crew)');
        expect(subTeamInput).toBeInTheDocument();

        fireEvent.change(subTeamInput, { target: { value: 'New Sub-Team' } });
        expect(subTeamInput).toHaveValue('New Sub-Team');
    });
});
