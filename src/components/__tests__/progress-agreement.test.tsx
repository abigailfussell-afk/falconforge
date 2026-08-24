/**
 * FEAT-09's other half: the two screens AGREE.
 *
 * `sprint-progress.test.ts` pins the arithmetic. This pins the thing the defect actually was —
 * that the sidebar and the dashboard, rendered together, showed different numbers for the same
 * question. A shared selector that only one of them calls would pass every assertion in that
 * file (`docs/failure-modes.md` §2), and principle 9's own lesson is that the divergence is only
 * ever visible to somebody looking at two screens at once. So this looks at both.
 *
 * WHAT WOULD MAKE THIS FAIL: reverting either call site to its own arithmetic. Watched, both
 * ways.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from '../../App';

vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'coach@test.com', user_metadata: { full_name: 'Pat Coach' } },
        session: {},
        isLoading: false,
        isConfigured: true,
        signOut: vi.fn(),
    })),
}));

vi.mock('../../lib/sync', () => ({
    useSync: vi.fn(() => ({
        isOnline: true,
        syncStatus: 'idle',
        pendingChanges: 0,
        failedChanges: 0,
        failureReasons: [],
        lastSyncTime: new Date(),
        sync: vi.fn(),
        retryFailedChanges: vi.fn().mockResolvedValue(0),
        error: null,
    })),
}));

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: vi.fn(() => true),
    supabase: { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } },
    supabaseSync: null,
}));

/*
 * `indexedDBStorage` included, because the store's persist middleware reads it and a factory
 * mock that omits it leaves `useAppStore.persist` undefined — five files in this repo carry that
 * shape and the dashboard route died in its error boundary when one of them met a component that
 * reads it (Sprint 22).
 */
vi.mock('../../lib/offline-db', () => ({
    db: { syncQueue: { toArray: vi.fn().mockResolvedValue([]) } },
    clearLocalDatabase: vi.fn(),
    getPendingSyncCount: vi.fn().mockResolvedValue(0),
    getPendingSyncItems: vi.fn().mockResolvedValue([]),
    getSyncFailureCount: vi.fn().mockResolvedValue(0),
    getTerminalFailureReasons: vi.fn().mockResolvedValue([]),
    getSyncFailures: vi.fn().mockResolvedValue([]),
    moveToDeadLetter: vi.fn(),
    retrySyncFailures: vi.fn().mockResolvedValue(0),
    indexedDBStorage: {
        getItem: vi.fn().mockResolvedValue(null),
        setItem: vi.fn().mockResolvedValue(undefined),
        removeItem: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn(() => []) }));

import { useAppStore } from '../../lib/store';
vi.mock('@/lib/realtime');
vi.mock('@/lib/queries');

const task = (id: string, status: string) => ({
    id,
    title: id,
    description: '',
    status,
    type: 'Feature',
    assignedTo: '',
    department: '',
    checklist: [],
    timeline: [],
    createdAt: 1000,
    seasonId: 'season-1',
});

/**
 * Two Done, one To Do, one Backlog and one Archived.
 *
 * The Backlog and Archived rows are the whole fixture: under the old sidebar rule they were in
 * its denominator and not in the dashboard's, which is where the two numbers parted company.
 */
const TASKS = [
    task('done-1', 'Done'),
    task('done-2', 'Done'),
    task('todo-1', 'To Do'),
    task('backlog-1', 'Backlog'),
    task('archived-1', 'Archived'),
];

const renderApp = () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], {
        initialEntries: ['/app/dashboard'],
    });
    return render(<RouterProvider router={router} />);
};

beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
        teams: [{ id: 'team-1', name: 'Test Team', teamNumber: '12345', ownerId: 'user-1', createdAt: 1000 }],
        currentTeamId: 'team-1',
        teamMembers: [
            { id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'coach', status: 'approved', joinedAt: 1000, fullName: 'Pat Coach', email: 'coach@test.com', seatAssigned: false, avatarUrl: null },
        ],
        subTeams: [],
        tasks: TASKS as never,
        checklistsBySeason: {},
        scoutingReports: [],
        matchPlans: [],
        seasons: [{ id: 'season-1', name: '2026-27', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 }],
        currentSeasonId: 'season-1',
        theme: 'dark',
        isLoading: false,
    } as never);
});

describe('FEAT-09 — the sidebar and the dashboard agree about progress', () => {
    it('show the same done-over-total, counting neither Backlog nor Archived', async () => {
        renderApp();

        const sidebar = await screen.findByTestId('sidebar-progress');
        const tile = (await screen.findByText('Sprint Progress')).closest('button')!;

        // 2 of 3: two Done and one To Do. The Backlog and Archived rows are not in the sprint.
        expect(sidebar.textContent, 'the sidebar counts Backlog or Archived').toBe('2/3');
        expect(
            within(tile).getByText('2 / 3'),
            'the dashboard disagrees with the sidebar',
        ).toBeInTheDocument();
    });

    it('the Backlog tile still counts the backlog, which is a different question', () => {
        // Removing Backlog from PROGRESS must not remove it from the screen: "what is planned"
        // is a real number and it has its own tile.
        renderApp();
        const tile = screen.getByText('Backlog Items').closest('button')!;
        expect(within(tile).getByText('1')).toBeInTheDocument();
    });
});
