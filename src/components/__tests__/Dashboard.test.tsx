import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from '../../App';

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
        failedChanges: 0,
        // Added in Sprint 6 (B24). Omitting it made SyncStatusIndicator read `.length` of
        // undefined -- the same mock-drift class as the offline-db mock below.
        failureReasons: [],
        lastSyncTime: new Date(),
        sync: vi.fn(),
        retryFailedChanges: vi.fn().mockResolvedValue(0),
        error: null,
    })),
}));

// Mock supabase config
vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: vi.fn(() => true),
    supabase: { auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } },
    // Null client: the Dashboard's team-data pull short-circuits, which is what this suite
    // wants. Declared explicitly because vitest throws on an export the mock omits.
    supabaseSync: null,
}));

// There was a `vi.mock('../../lib/user-context', ...)` here. That module is gone — its
// profile, offline flag and display-name derivations were merged into the auth context, which
// this file already mocks above. The mock survived deletion for a while because vitest only
// resolves a factory mock when something imports the path, so it sat here doing nothing.

/*
 * Mock offline-db.
 *
 * The counting helpers are declared even though this suite asserts nothing about them, because
 * `useSync` calls them on an interval and a factory mock throws when an omitted export is
 * ACCESSED rather than when it is imported. Sprint 6 added `getTerminalFailureReasons` to
 * `sync.ts`, and its absence here made every poll throw inside an async effect — which did not
 * fail an assertion, it hung the file for fifteen minutes. Mock drift, exactly as
 * `mock-drift.test.ts` warns.
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
}));

// Mock dexie-react-hooks
vi.mock('dexie-react-hooks', () => ({
    useLiveQuery: vi.fn(() => []),
}));

// Dashboard is not exported separately, so we test it via the store + rendering App.
// App is imported statically at the top: `vi.mock` calls are hoisted above all imports,
// so the mocks above are already in place. Importing it inside `beforeEach` instead used
// to blow the 10s hook timeout when the full suite ran in parallel — the first cold import
// pulls the entire component tree, and ESM caches the module anyway (no `vi.resetModules`
// here), so the repeated dynamic import bought nothing.
import { useAppStore } from '../../lib/store';
import { useAuth } from '../../lib/auth';

// Opt in to the manual mocks in src/lib/__mocks__ for the subsystems App touches on mount
// but this navigation suite does not assert on.
vi.mock('@/lib/realtime');
vi.mock('@/lib/queries');

// Setup store state for a logged-in coach user
function setupStore(overrides: Record<string, any> = {}) {
    useAppStore.setState({
        teams: [{ id: 'team-1', name: 'Test Team', teamNumber: '1234', ownerId: 'user-1', createdAt: 1000 }],
        currentTeamId: 'team-1',
        teamMembers: [
            { id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'coach', status: 'approved', joinedAt: 1000, fullName: 'Test User', email: 'test@test.com', seatAssigned: false, avatarUrl: null },
        ],
        subTeams: [],
        tasks: [],
        checklistsBySeason: {},
        scoutingReports: [],
        matchPlans: [],
        seasons: [{ id: 'season-1', name: '2025-2026', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 }],
        currentSeasonId: 'season-1',
        theme: 'dark',
        isLoading: false,
        // Resolves, because the store declares `initializeStore: () => Promise<void>`. A bare
        // vi.fn() returns undefined, so App.tsx could not handle its rejection without this
        // file throwing TypeError — the stub had drifted from the type it stands in for.
        initializeStore: vi.fn().mockResolvedValue(undefined),
        setTheme: vi.fn(),
        setCurrentSeason: vi.fn(),
        addTask: vi.fn(),
        updateTask: vi.fn(),
        setTeamMembers: vi.fn(),
        setSubTeams: vi.fn(),
        ...overrides,
    });
}

/*
 * Captured from the module factory at import time, before any test can override it.
 *
 * `vi.clearAllMocks()` clears recorded CALLS, not implementations. So the signed-out
 * redirect test near the bottom of this file -- which does `mockReturnValue({ user: null })`
 * -- leaked a signed-out user into every test DECLARED AFTER IT. Nothing caught that because
 * it happened to be last, and the leak is invisible until somebody appends to the file: the
 * Upcoming Deadlines tests below were written, failed, and turned out to be rendering the
 * landing page rather than the dashboard.
 */
const defaultUseAuth = vi.mocked(useAuth).getMockImplementation();

beforeEach(() => {
    vi.clearAllMocks();
    if (defaultUseAuth) vi.mocked(useAuth).mockImplementation(defaultUseAuth);
    setupStore();
});

/**
 * Renders the whole App at `entry` and hands back the router's history, so a test can assert
 * on the URL rather than on which component happens to be mounted.
 */
function renderApp(entry = '/app/dashboard') {
    const router = createMemoryRouter(
        [{ path: '*', element: <App /> }],
        { initialEntries: [entry] },
    );
    render(<RouterProvider router={router} />);
    return router;
}

describe('Dashboard Navigation', () => {
    /*
     * EVERY ASSERTION IN THIS BLOCK IS `getByText`, SINGULAR, ON PURPOSE.
     *
     * These used to read `getAllByText(...).length > 0`, and that was not defensive style —
     * it was load-bearing. `Sidebar.tsx` rendered the nav list twice (a `hidden lg:flex` rail
     * and a `lg:hidden` drawer), so every label genuinely appeared twice in the DOM and the
     * singular query genuinely threw. jsdom has no viewport, so both copies were "visible" to
     * the suite no matter which breakpoint a real browser would have shown.
     *
     * Sprint 5 collapsed the two into one responsive element rendering a single nav
     * definition. `getByText` throws when it matches more than one node, which makes each
     * line below an assertion that the duplication has not come back — worth more than the
     * rewrite itself, because the rewrite is a diff and this is a ratchet.
     */
    it('renders each core navigation item exactly once', () => {
        renderApp();

        // Document-wide: one node per nav entry. This is the sharpest form of "the nav is not
        // duplicated" — it does not care what the labels say, only that each view has a single
        // control. `getAllByTestId` throws on zero and the length check catches the second copy.
        for (const id of ['dashboard', 'kanban', 'checklist', 'scouting', 'planner', 'admin']) {
            expect(screen.getAllByTestId(`nav-${id}`)).toHaveLength(1);
        }

        // And the labels, scoped to the nav landmark. Scoped rather than document-wide because
        // some labels legitimately appear twice on the dashboard — "Sprint Planning" is both a
        // nav entry and a Quick Action tile — and conflating a shortcut with a duplicated nav
        // is how the original `getAllByText(...).length > 0` lost its meaning.
        const nav = within(screen.getByTestId('app-nav'));
        expect(nav.getByText('Dashboard')).toBeDefined();
        expect(nav.getByText('Sprint Planning')).toBeDefined();
        expect(nav.getByText('Pre-Match Checklist')).toBeDefined();
        expect(nav.getByText('Scouting Reports')).toBeDefined();
        expect(nav.getByText('Match Planner')).toBeDefined();

        // AI features were removed (see docs/ai-features-reference.md) — guard against reintroduction
        expect(screen.queryByText('Portfolio Helper')).toBeNull();
        expect(screen.queryByText('Judging Prep')).toBeNull();
    });

    it('renders exactly one season picker at any breakpoint', () => {
        renderApp();

        /*
         * The season picker was duplicated alongside the nav (`season-selector` and
         * `mobile-season-selector`). It is the ONLY season control in the app — rollover,
         * archival and read-only browsing of a prior season are reachable through nothing
         * else — so "there is exactly one, and it is in the single responsive sidebar" is
         * the property worth pinning. A future change that drops it below `lg` to save space
         * makes last season unreachable on a phone at a competition.
         */
        expect(screen.getAllByTestId('season-selector')).toHaveLength(1);
        expect(screen.queryByTestId('mobile-season-selector')).toBeNull();
        expect(screen.getByRole('option', { name: '2025-2026' })).toBeDefined();
    });

    it('shows Admin Settings for coach users', () => {
        renderApp();
        expect(screen.getByText('Admin Settings')).toBeDefined();
    });

    it('hides Admin Settings for non-coach users', () => {
        setupStore({
            teamMembers: [
                { id: 'tm-1', teamId: 'team-1', userId: 'user-1', role: 'student', status: 'approved', joinedAt: 1000, fullName: 'Test Student', email: 'student@test.com' },
            ],
        });

        renderApp();
        expect(screen.queryByText('Admin Settings')).toBeNull();
    });

    /*
     * Was `switches active tab when clicking a nav item`, which asserted that DashboardHome's
     * content disappeared. That could only ever prove the tab STATE changed. Views are real
     * routes now, so the thing worth asserting is the URL: it is what a deep link carries,
     * what the back button walks, and what survives a reload.
     */
    it('navigates to a view route when a nav item is clicked', async () => {
        const router = renderApp();
        expect(router.state.location.pathname).toBe('/app/dashboard');

        fireEvent.click(screen.getByTestId('nav-checklist'));

        expect(router.state.location.pathname).toBe('/app/checklist');

        // `await`, because the view is behind `React.lazy`. RouterProvider runs navigations in
        // a transition, so React deliberately keeps the previous view on screen while the new
        // chunk loads rather than flashing a spinner — the dashboard is still mounted for a
        // tick after the URL changes. Asserting synchronously here would be asserting on that
        // intermediate frame.
        await waitFor(() => expect(screen.queryByText('Sprint Progress')).toBeNull());
    });

    it('supports the browser back button across views', async () => {
        const router = renderApp();

        fireEvent.click(screen.getByTestId('nav-scouting'));
        expect(router.state.location.pathname).toBe('/app/scouting');

        fireEvent.click(screen.getByTestId('nav-planner'));
        expect(router.state.location.pathname).toBe('/app/planner');

        // Going back one entry is what the hardware/browser back button does. Under the tab
        // state this replaced there was nothing in the history to go back TO — pressing back
        // on the sprint board left the app entirely.
        await act(async () => {
            await router.navigate(-1);
        });
        expect(router.state.location.pathname).toBe('/app/scouting');
    });

    it.each([
        ['/app/board', 'kanban'],
        ['/app/checklist', 'checklist'],
        ['/app/scouting', 'scouting'],
        ['/app/planner', 'planner'],
        ['/app/admin', 'admin'],
        ['/app/profile', 'profile'],
    ])('deep-links straight to %s', async (path, navId) => {
        const router = renderApp(path);

        // The route resolved without redirecting — this is what a bookmark or a shared link
        // does, and what none of these views had before Sprint 5 (they were all one URL).
        expect(router.state.location.pathname).toBe(path);

        // And the shell agrees about which view is on screen. `profile` is a real route but
        // is reached from the user card rather than the nav list, so it has no rail entry.
        if (navId !== 'profile') {
            await waitFor(() =>
                expect(screen.getByTestId(`nav-${navId}`).getAttribute('aria-current')).toBe('page'),
            );
        }
    });

    it('redirects /app to the dashboard, and keeps the legacy /dashboard link working', () => {
        expect(renderApp('/app').state.location.pathname).toBe('/app/dashboard');
    });

    it('redirects the pre-Sprint-5 /dashboard URL rather than 404ing it', () => {
        // V1 through Sprint 4 handed out `#/dashboard`, so it is in histories and bookmarks.
        expect(renderApp('/dashboard').state.location.pathname).toBe('/app/dashboard');
    });

    it('sends an unknown view under /app back to the dashboard', () => {
        expect(renderApp('/app/not-a-view').state.location.pathname).toBe('/app/dashboard');
    });

    it('renders the archived-season banner exactly once, in the shell', async () => {
        /*
         * The banner lives above the `<Outlet>` rather than inside five feature components,
         * so that every season-scoped route gets exactly one. Asserting "exactly one" on a
         * route other than the default is what catches the two ways that breaks: a route
         * that renders its own copy on top of the shell's, and a shell rewrite that drops it.
         */
        setupStore({
            seasons: [{ id: 'season-1', name: '2025-2026', gameTitle: '', fieldImageData: '', isArchived: true, createdAt: 1000 }],
        });

        renderApp('/app/scouting');

        await waitFor(() =>
            expect(screen.getAllByTestId('archived-season-banner')).toHaveLength(1),
        );
    });

    /*
     * REGRESSION: a route must hand its view SEASON-SCOPED data.
     *
     * Sprint 4 replaced six copies of `x.seasonId === currentSeasonId` with `useSeasonScoped`
     * and discovered, in the process, that ScoutingReports had never had one at all — a whole
     * prior season of opponents had been listed alongside the current season's with no way to
     * tell them apart. The route adapters this sprint introduced are a brand-new place for
     * exactly that mistake: they read collections out of the store and pass them down as
     * props, so an adapter that reaches for `s.tasks` instead of `useSeasonScoped(s.tasks)`
     * silently reopens it. (One of them did, mid-sprint.)
     *
     * jsdom does not need a viewport for this: the assertion is about which records reach the
     * component, not about how they are laid out.
     */
    it('hands the board only the current season’s tasks', async () => {
        setupStore({
            seasons: [
                { id: 'season-1', name: '2025-2026', gameTitle: '', fieldImageData: '', isArchived: false, createdAt: 1000 },
                { id: 'season-0', name: '2024-2025', gameTitle: '', fieldImageData: '', isArchived: true, createdAt: 500 },
            ],
            currentSeasonId: 'season-1',
            tasks: [
                { id: 't-now', title: 'Rebuild the intake', description: '', assignedTo: '', status: 'To Do', department: '', type: 'Feature', checklist: [], timeline: [], createdAt: 1000, seasonId: 'season-1' },
                { id: 't-old', title: 'LAST SEASON drivetrain', description: '', assignedTo: '', status: 'To Do', department: '', type: 'Feature', checklist: [], timeline: [], createdAt: 900, seasonId: 'season-0' },
            ],
        });

        renderApp('/app/board');

        await waitFor(() => expect(screen.getByText('Rebuild the intake')).toBeDefined());
        expect(screen.queryByText('LAST SEASON drivetrain')).toBeNull();
    });

    it('renders the sign-out button', () => {
        renderApp();
        expect(document.querySelector('button[title="Sign out"]')).not.toBeNull();
    });

    it('displays the current user name', () => {
        renderApp();
        expect(screen.getByText('Test User')).toBeDefined();
    });

    it('displays the current team name', () => {
        renderApp();
        expect(screen.getByText('Test Team')).toBeDefined();
    });

    it('sends an unauthenticated visitor to LOG IN, remembering where they were going', async () => {
        // Override auth to return no user
        const authModule = await import('../../lib/auth');
        vi.mocked(authModule.useAuth).mockReturnValue({
            user: null,
            session: null,
            isLoading: false,
            isConfigured: true,
            signOut: vi.fn(),
        } as any);

        const router = renderApp('/app/checkin/0842');

        /*
         * This used to assert the LANDING page, and that was the bug Kevin reported after
         * testing with a friend: a student who scans a QR poster while signed out was dropped
         * on the marketing page with the destination discarded, left to work out for
         * themselves that the answer was "press Log In, then go and find Meetings again".
         *
         * Rule 4 of the design brief says a scan while logged out routes through login and
         * then COMPLETES the check-in. So the guard sends them to the sign-in form and carries
         * where they were going, which `Login` and `Onboarding` then honour.
         */
        expect(screen.getByTestId('email-input')).toBeDefined();
        expect(router.state.location.pathname).toBe('/login');
        expect(router.state.location.search).toContain('next=');
        expect(decodeURIComponent(router.state.location.search)).toContain('/app/checkin/0842');
    });
});

/**
 * The Upcoming Deadlines panel exists to fill the dashboard's lower two-thirds, which was
 * dead space before Sprint 5.5. It was rendered behind `upcomingDeadlines.length > 0`, so it
 * vanished when it had nothing to show -- putting the dead space back for exactly the teams
 * that meet it first, since a brand-new team has no tasks by definition. Found in a 1280px
 * Playwright capture of the seeded review team, which has a full roster and no tasks.
 */
describe('Upcoming Deadlines panel', () => {
    it('still renders its section when there is nothing due, rather than leaving a hole', async () => {
        setupStore({ tasks: [] });
        renderApp();

        // The heading is the part that disappeared. Recent Activity, on the same screen,
        // already kept its heading and showed an empty state; this is that inconsistency.
        expect(await screen.findByText('Upcoming Deadlines')).toBeDefined();
    });

    it('tells a team with no tasks at all where to start', async () => {
        setupStore({ tasks: [] });
        renderApp();

        expect(await screen.findByText('No tasks yet')).toBeDefined();
        expect(screen.getByRole('button', { name: /Plan your first sprint/i })).toBeDefined();
    });

    it('distinguishes "no tasks" from "tasks, but none of them dated"', async () => {
        // The two ways of being empty are different questions and get different answers: this
        // team HAS work, so pointing it at "plan your first sprint" would be wrong.
        setupStore({
            tasks: [
                { id: 't-1', seasonId: 'season-1', teamId: 'team-1', title: 'Rebuild the intake', status: 'To Do', createdAt: 1000 },
            ],
        });
        renderApp();

        expect(await screen.findByText('Nothing due')).toBeDefined();
        expect(screen.queryByText('No tasks yet')).toBeNull();
        expect(screen.getByRole('button', { name: /Open Sprint Planning/i })).toBeDefined();
    });

    it('shows the dated task instead of an empty state once one exists', async () => {
        setupStore({
            tasks: [
                { id: 't-1', seasonId: 'season-1', teamId: 'team-1', title: 'Rebuild the intake', status: 'To Do', createdAt: 1000, dueDate: Date.now() + 86_400_000 },
            ],
        });
        renderApp();

        expect(await screen.findByText('Rebuild the intake')).toBeDefined();
        expect(screen.queryByText('Nothing due')).toBeNull();
        expect(screen.queryByText('No tasks yet')).toBeNull();
    });
});
