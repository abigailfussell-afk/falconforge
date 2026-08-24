/**
 * The Training stub, rendered through the real app (D5).
 *
 * WHY THE WHOLE APP RATHER THAN THE THREE COMPONENTS. Two of the four things D5 asked to have
 * settled are not properties of a component: that Training is REACHABLE (a nav entry a rookie
 * can find) and that it survives having no open season (the off-season case is when a team
 * actually trains). Both are properties of the shell and the route table, and a test that
 * rendered `<TrainingHome />` directly would pass with the route unwired and the nav entry
 * missing — `docs/failure-modes.md` section 2.
 *
 * The third — what a student sees versus a mentor — is asserted from the store's roster row
 * rather than by passing a prop, because the prop is what the component believes and the roster
 * row is what the app decides.
 *
 * WHAT WOULD MAKE THESE FAIL: removing the nav entry, unwiring a route, showing the sign-off
 * queue to a student (or hiding it from a mentor), letting the season gate reach Training, or
 * dropping the "nothing is recorded" wording that stops the disabled controls reading as a bug.
 * Each was watched red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import App from '../../App';
import type { MemberRole } from '../../types';

vi.mock('../../lib/auth', () => ({
    useAuth: vi.fn(() => ({
        user: { id: 'user-1', email: 'member@test.com', user_metadata: { full_name: 'Sam Member' } },
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
    supabase: {
        auth: { onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) },
    },
    supabaseSync: null,
}));

/* `indexedDBStorage` included: the store's persist middleware reads it, and a factory mock that
 * omits it leaves `useAppStore.persist` undefined (Sprint 22). */
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

const SEASONS = [
    {
        id: 'season-1',
        name: '2026-27',
        gameTitle: '',
        fieldImageData: '',
        isArchived: false,
        createdAt: 1000,
    },
];

const ARCHIVED_SEASONS = [{ ...SEASONS[0], isArchived: true }];

function signIn(role: MemberRole, seasons: typeof SEASONS | [] = SEASONS) {
    useAppStore.setState({
        teams: [{ id: 'team-1', name: 'Test Team', teamNumber: '12345', ownerId: 'user-1', createdAt: 1000 }],
        currentTeamId: 'team-1',
        teamMembers: [
            {
                id: 'tm-1',
                teamId: 'team-1',
                userId: 'user-1',
                role,
                status: 'approved',
                joinedAt: 1000,
                fullName: 'Sam Member',
                email: 'member@test.com',
                seatAssigned: false,
                avatarUrl: null,
            },
        ],
        subTeams: [],
        tasks: [],
        checklistsBySeason: {},
        scoutingReports: [],
        matchPlans: [],
        seasons,
        currentSeasonId: seasons.length > 0 ? 'season-1' : null,
        theme: 'dark',
        isLoading: false,
    } as never);
}

const renderAt = (path: string) =>
    render(
        <RouterProvider
            router={createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: [path] })}
        />,
    );

beforeEach(() => {
    vi.clearAllMocks();
});

describe('a rookie can find Training', () => {
    it('puts exactly one Training entry in the nav', async () => {
        signIn('student');
        renderAt('/app/dashboard');

        // Exactly one, document-wide: the rail and the drawer are one element rendering one
        // definition, and a second copy is the defect Sprint 5 deleted.
        expect(await screen.findAllByTestId('nav-training')).toHaveLength(1);
    });

    it('renders all eight tracks and says how much of the outline exists', async () => {
        signIn('student');
        renderAt('/app/training');

        expect(await screen.findByTestId('track-onboarding')).toBeInTheDocument();
        for (const id of [
            'onboarding',
            'safety',
            'mechanical',
            'electrical',
            'programming',
            'strategy',
            'outreach',
            'operations',
        ]) {
            expect(screen.getByTestId(`track-${id}`)).toBeInTheDocument();
        }

        expect(screen.getByTestId('outline-totals')).toHaveTextContent('11 of 61 lessons outlined');
    });

    it('says on every screen that this is a preview and records nothing', async () => {
        /*
         * Six of eight tracks are empty and every control is disabled. Without this sentence
         * the feature reads as shipped and broken rather than as a settled shape, and the
         * lesson pages are deep-linkable so the index's banner cannot cover them.
         */
        signIn('student');
        const { unmount } = renderAt('/app/training');
        expect(await screen.findByTestId('training-stub-notice')).toBeInTheDocument();
        unmount();

        const track = renderAt('/app/training/safety');
        expect(await screen.findByTestId('training-stub-notice')).toBeInTheDocument();
        track.unmount();

        renderAt('/app/training/safety/B1');
        expect(await screen.findByTestId('training-stub-notice')).toBeInTheDocument();
        expect(screen.getByTestId('no-progress-note')).toHaveTextContent('Nothing is recorded yet');
    });
});

describe('Training outlives the season', () => {
    it('renders with no season at all', async () => {
        /*
         * THE OFF-SEASON CASE, and the reason Training carries no season precondition: skills
         * belong to a person rather than to a season, and the summer between seasons is when a
         * team trains. Every other view in the app is season-scoped and goes read-only or empty
         * when there is no open season; this one must not.
         */
        signIn('student', []);
        renderAt('/app/training');

        expect(await screen.findByTestId('track-onboarding')).toBeInTheDocument();
        expect(screen.getByTestId('outline-totals')).toHaveTextContent('11 of 61');
    });
});

describe('the archived-season banner does not follow Training', () => {
    it('stays off Training and stays on the board', async () => {
        /*
         * FOUND IN THE BROWSER, with the seeded season archived: two amber banners stacked on
         * the Training page, the upper one saying "2026-2027 Season is archived — read only"
         * above the one view a season never touches. The banner explains why a season-scoped
         * view cannot be edited; above Training it explains nothing and contradicts the page.
         *
         * Both halves asserted together, because the fix is a suppression and a suppression that
         * is too broad is the same defect facing the other way.
         */
        signIn('student', ARCHIVED_SEASONS);
        const training = renderAt('/app/training');
        expect(await training.findByTestId('track-onboarding')).toBeInTheDocument();
        expect(training.queryByTestId('archived-season-banner')).toBeNull();
        training.unmount();

        signIn('student', ARCHIVED_SEASONS);
        renderAt('/app/board');
        expect(await screen.findByTestId('archived-season-banner')).toBeInTheDocument();
    });
});

describe('what a student sees versus a mentor', () => {
    it('shows the sign-off queue to a mentor and not to a student', async () => {
        signIn('student');
        const student = renderAt('/app/training');
        expect(await student.findByTestId('track-onboarding')).toBeInTheDocument();
        expect(student.queryByTestId('signoff-queue')).toBeNull();
        student.unmount();

        signIn('mentor');
        renderAt('/app/training');
        const queue = await screen.findByTestId('signoff-queue');
        expect(within(queue).getByText('Nothing is waiting for you')).toBeInTheDocument();
    });

    it('asks a student for a sign-off and offers a mentor the giving of one', async () => {
        // B1 is a mentor checkpoint, so the two sides differ. The control is disabled on both,
        // because nothing behind it exists yet.
        signIn('student');
        const student = renderAt('/app/training/safety/B1');
        const studentAction = await student.findByTestId('checkpoint-action');
        expect(studentAction).toHaveTextContent('Ask for a sign-off');
        expect(studentAction).toBeDisabled();
        student.unmount();

        signIn('coach');
        renderAt('/app/training/safety/B1');
        const mentorAction = await screen.findByTestId('checkpoint-action');
        expect(mentorAction).toHaveTextContent('Sign off');
        expect(mentorAction).toBeDisabled();
    });
});

describe('the lesson and track screens', () => {
    it('tells a track with no outline how many lessons it is waiting for', async () => {
        signIn('student');
        renderAt('/app/training/mechanical');

        const empty = await screen.findByTestId('track-empty');
        expect(empty).toHaveTextContent('10 lessons are planned for Mechanical');
        // And no lesson list at all, rather than an empty one.
        expect(screen.queryByTestId('lesson-list')).toBeNull();
    });

    it('lists the lessons of a written track', async () => {
        signIn('student');
        renderAt('/app/training/onboarding');

        const list = await screen.findByTestId('lesson-list');
        expect(within(list).getAllByRole('link')).toHaveLength(7);
        expect(within(list).getByTestId('lesson-A1')).toHaveTextContent('What FTC is');
    });

    it('links a lesson to the lessons that come first', async () => {
        signIn('student');
        renderAt('/app/training/onboarding/A7');

        const prereq = await screen.findByTestId('prereq-A6');
        expect(prereq).toHaveAttribute('href', '/app/training/onboarding/A6');
        expect(prereq).toHaveTextContent('Tools of the team');
    });

    it('warns that B1 gates build work', async () => {
        // The one lesson in the outline that blocks other work. If the banner is not on the
        // page, the rule exists only in a sentence nobody reads.
        signIn('student');
        renderAt('/app/training/safety/B1');

        expect(await screen.findByTestId('gates-build-work')).toHaveTextContent(
            'Nobody touches build work',
        );
    });

    it('says the lesson itself is not written', async () => {
        signIn('student');
        renderAt('/app/training/onboarding/A1');

        expect(await screen.findByTestId('lesson-body-empty')).toHaveTextContent('Not written yet');
    });

    it('does not resolve a lesson under the wrong track', async () => {
        // `/app/training/safety/A1` is a wrong link, not a redirect: rendering an Onboarding
        // lesson under a Safety heading with a Safety back link is worse than saying no.
        signIn('student');
        renderAt('/app/training/safety/A1');

        expect(await screen.findByText('No such lesson')).toBeInTheDocument();
        expect(screen.queryByTestId('lesson-detail')).toBeNull();
    });
});
