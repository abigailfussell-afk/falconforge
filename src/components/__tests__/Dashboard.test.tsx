import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Mocks (must be defined before importing App) ---

// Mock auth
const mockSignOut = vi.fn();
vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'test@test.com', user_metadata: { full_name: 'Test User' } },
        session: {},
        isLoading: false,
        isConfigured: true,
        signOut: mockSignOut,
    })),
}));

// Mock sync hook (SyncStatusIndicator dependency)
vi.mock('../../lib/sync', () => ({
    useSync: vi.fn(() => ({
        isOnline: true,
        syncStatus: 'idle',
        pendingChanges: 0,
        lastSyncTime: new Date(),
        sync: vi.fn(),
        error: null,
    })),
}));

// Mock supabase config
vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: vi.fn(() => true),
    supabase: { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } },
}));

// Mock user context
vi.mock('../../lib/user-context', () => ({
    useCurrentUser: vi.fn(() => ({
        id: 'user-1',
        currentUserRole: 'coach',
        isCoachOrAdmin: true,
        isCreator: true,
        canEdit: true,
    })),
}));

// Mock offline-db
vi.mock('../../lib/offline-db', () => ({
    db: { syncQueue: { toArray: vi.fn().mockResolvedValue([]) } },
    clearLocalDatabase: vi.fn(),
}));

// Mock dexie-react-hooks
vi.mock('dexie-react-hooks', () => ({
    useLiveQuery: vi.fn(() => []),
}));

// We need to import App lazily because Dashboard is not exported separately
// Instead, we'll test via the store + rendering App
import { useAppStore } from '../../lib/store';

// Setup store state for a logged-in coach user
function setupStore(overrides: Record<string, any> = {}) {
    useAppStore.setState({
        teams: [{ id: 'team-1', name: 'Test Team', teamNumber: '1234', ownerId: 'user-1', createdAt: 1000 }],
        currentTeamId: 'team-1',
        teamMembers: [
            { id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'coach', status: 'approved', joinedAt: 1000, fullName: 'Test User', email: 'test@test.com', isBillingActive: false, avatarUrl: null },
        ],
        subTeams: [],
        tasks: [],
        checklist: [],
        scoutingReports: [],
        matchPlans: [],
        seasons: [{ id: 'season-1', name: '2025-2026', fieldImageData: '', createdAt: 1000 }],
        currentSeasonId: 'season-1',
        theme: 'dark',
        isLoading: false,
        initializeStore: vi.fn(),
        fetchTeamData: vi.fn(),
        setTheme: vi.fn(),
        setCurrentSeason: vi.fn(),
        addTask: vi.fn(),
        updateTask: vi.fn(),
        setTeamMembers: vi.fn(),
        setSubTeams: vi.fn(),
        ...overrides,
    });
}

// Dynamic import of the default export from App
let App: any;

beforeEach(async () => {
    vi.clearAllMocks();
    setupStore();
    // Dynamically import to ensure mocks are in place
    const mod = await import('../../App');
    App = mod.default;
});

describe('Dashboard Navigation', () => {
    it('renders all core navigation items', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        // All nav items should be visible (desktop sidebar renders them)
        expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Sprint Planning').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Pre-Match Checklist').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Scouting Reports').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Match Planner').length).toBeGreaterThan(0);

        // AI features are disabled via feature flag — these should NOT be rendered
        expect(screen.queryByText('Portfolio Helper')).toBeNull();
        expect(screen.queryByText('Judging Prep')).toBeNull();
    });

    it('shows Admin Settings for coach users', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        // Coach should see Admin Settings
        expect(screen.getAllByText('Admin Settings').length).toBeGreaterThan(0);
    });

    it('hides Admin Settings for non-coach users', () => {
        setupStore({
            teamMembers: [
                { id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'student', status: 'approved', joinedAt: 1000, fullName: 'Test Student', email: 'student@test.com' },
            ],
        });

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        // Student should NOT see Admin Settings in nav
        expect(screen.queryByText('Admin Settings')).toBeNull();
    });

    it('switches active tab when clicking a nav item', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        // Initially the Dashboard tab is active, so "Sprint Progress" (from DashboardHome) is visible
        expect(screen.queryByText('Sprint Progress')).not.toBeNull();

        // Click on Pre-Match Checklist (a simpler component to detect)
        const checklistButtons = screen.getAllByText('Pre-Match Checklist');
        fireEvent.click(checklistButtons[0]);

        // DashboardHome content should no longer be visible since we switched tabs
        expect(screen.queryByText('Sprint Progress')).toBeNull();
    });

    it('renders the sign-out button', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        const signOutButton = document.querySelector('button[title="Sign out"]');
        expect(signOutButton).not.toBeNull();
    });

    it('displays the current user name', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByText('Test User')).toBeDefined();
    });

    it('displays the current team name', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByText('Test Team')).toBeDefined();
    });

    it('shows season selector', () => {
        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        expect(screen.getByText('2025-2026')).toBeDefined();
    });

    it('redirects to login when user is not authenticated', async () => {
        // Override auth to return no user
        const authModule = await import('../../lib/auth');
        vi.mocked(authModule.useAuth).mockReturnValue({
            user: null,
            session: null,
            isLoading: false,
            isConfigured: true,
            signOut: vi.fn(),
        } as any);

        render(
            <MemoryRouter initialEntries={['/dashboard']}>
                <App />
            </MemoryRouter>
        );

        // Should show login page elements instead of dashboard nav
        expect(screen.queryByText('Sprint Planning')).toBeNull();
    });
});
