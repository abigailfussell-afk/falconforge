/**
 * WALK-B-01 — which `/app/*` routes a no-team account is allowed to stay on.
 *
 * The shell's no-team redirect asked "is this anything other than `/app/guardian`?", which is
 * the same answer as "does this route need a team?" only while the guardian view is the sole
 * team-free page. It stopped being that: `help` shipped without `requiresTeam` in the
 * beta-prep branch and `profile` never needed one — it edits the signed-in USER. So a
 * guardian following the "Edit Profile" link their own sidebar renders, or the "Getting
 * started" item in their own nav, landed on "Welcome! Let's get you set up." one second
 * later. Observed on both, as `guardian@` and as a freshly promoted parent account.
 *
 * The redirect reads `AppView.requiresTeam` now, so the two cannot drift again
 * (`docs/failure-modes.md` §12). These cases are the behaviour; `navigation.test.ts` pins the
 * registry itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import AppShell from '../AppShell';
import { useAppStore } from '../../lib/store';

vi.mock('@/lib/auth');
vi.mock('@/lib/realtime');

vi.mock('../../lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabase: {
        auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
    supabaseSync: {
        rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
    },
    resolveSyncAccessTokenAsync: vi.fn(async () => null),
    resolveSyncAccessToken: vi.fn(() => null),
    isAuthenticatedToken: vi.fn(() => false),
}));

vi.mock('../../lib/server-pull', () => ({
    fetchTeamData: vi.fn().mockResolvedValue(undefined),
    fetchGuardianData: vi.fn().mockResolvedValue(undefined),
    fetchSeasonData: vi.fn().mockResolvedValue(undefined),
    ensureSeasonFieldImage: vi.fn().mockResolvedValue(undefined),
    pullFromServer: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/sign-out', () => ({ performSignOut: vi.fn() }));

/** Renders wherever the router currently is, so a redirect is observable. */
function WhereAmI() {
    return <div data-testid="pathname">{useLocation().pathname}</div>;
}

/**
 * The shell's redirect waits out a hydration delay before firing. The wait is the point of
 * the assertion, so the clock is faked rather than slept through.
 */
function renderAt(pathname: string) {
    useAppStore.setState({
        currentTeamId: null,
        teamMembers: [],
        subTeams: [],
        managedProfiles: [{ id: 'p1', guardianUserId: 'u1', fullName: 'A Child', notes: '', promotionCode: '' }],
        seasons: [],
        currentSeasonId: null,
    } as never);

    render(
        <MemoryRouter initialEntries={[pathname]}>
            <Routes>
                <Route path="/onboarding" element={<WhereAmI />} />
                <Route path="/app" element={<AppShell />}>
                    <Route path="profile" element={<WhereAmI />} />
                    <Route path="help" element={<WhereAmI />} />
                    <Route path="guardian" element={<WhereAmI />} />
                    <Route path="board" element={<WhereAmI />} />
                    <Route path="checkin/:code" element={<WhereAmI />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

/** Let the shell's 1s hydration wait elapse, twice over. */
async function waitOutTheRedirect() {
    await act(async () => {
        vi.advanceTimersByTime(2500);
    });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a no-team account on a route that does not need one (WALK-B-01)', () => {
    it.each([
        ['/app/profile', 'renaming yourself is not a team action'],
        ['/app/help', 'the page a coach with no team most needs'],
        ['/app/guardian', 'the guardian’s own view'],
    ])('stays on %s — %s', async (pathname) => {
        renderAt(pathname);
        await waitOutTheRedirect();

        expect(
            screen.getByTestId('pathname').textContent,
            `${pathname} bounced a no-team account to the team picker`,
        ).toBe(pathname);
    });
});

describe('a no-team account on a route that does need one — the control', () => {
    it.each([
        ['/app/board'],
        ['/app/checkin/ABCD'],
    ])('is still sent to onboarding from %s', async (pathname) => {
        // Without these the "fix" could be "never redirect", which would show a parent a
        // plausible-looking but empty version of a team they are not on — the shape plan §3
        // forbids outright.
        renderAt(pathname);
        await waitOutTheRedirect();

        expect(screen.getByTestId('pathname').textContent).toBe('/onboarding');
    });
});
