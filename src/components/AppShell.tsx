import { Suspense, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAppStore } from '../lib/store';
import { useSeasonScoped } from '../lib/season-scope';
import { setupRealtimeSubscription, teardownRealtimeSubscription } from '../lib/realtime';
import { fetchTeamData } from '../lib/server-pull';
import { performSignOut } from '../lib/sign-out';
import Sidebar from './Sidebar';
import ArchivedSeasonBanner from './ArchivedSeasonBanner';
import type { SubTeam, TeamMember } from '../types';

/**
 * What the shell has already worked out, handed to whichever view is on screen.
 *
 * The roster is filtered by TEAM and the sub-teams by SEASON, and both filters used to live
 * in `Dashboard()` alongside the tab switch. Deriving them once here and passing them through
 * the outlet keeps that property: a route cannot quietly acquire an unfiltered roster, and
 * nobody has to re-inline `x.seasonId === currentSeasonId` to get at a list (six copies of
 * that were deleted in Sprint 4, and one of them had been missing entirely — a whole season
 * of scouting reports had been leaking into the next season's list).
 */
export interface AppShellContext {
    teamMembers: TeamMember[];
    subTeams: SubTeam[];
    canManageTeam: boolean;
}

export function useAppShell(): AppShellContext {
    return useOutletContext<AppShellContext>();
}

/** Shown while a route's lazy chunk is in flight. */
function RouteFallback() {
    return (
        <div className="flex items-center justify-center py-20" role="status" aria-label="Loading view">
            <div className="w-6 h-6 border-2 border-forge-500 border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

/**
 * The application frame: navigation, the season-wide banner, and whatever route is active.
 *
 * WHAT THIS REPLACED
 *
 * `Dashboard()` in App.tsx held `const [activeTab, setActiveTab] = useState('dashboard')` and
 * a chain of `activeTab === 'kanban' && <SprintPlanning .../>` expressions. That meant no deep
 * links (every view was the same URL), no back button (the browser had nothing to go back to),
 * and no code splitting (every feature was in the entry chunk whether or not it was opened).
 * The views are real routes now — `#/app/board`, `#/app/scouting` — each behind `React.lazy`.
 *
 * THE BANNER RENDERS EXACTLY ONCE. `ArchivedSeasonBanner` sits above the `<Outlet>`, which is
 * the same position it held above the tab switch and for the same reason: every view below it
 * is season-scoped, so "this season is read-only" is a property of the frame rather than
 * something five feature components each have to remember to say. Putting it inside the routes
 * would render it once per route at best and zero times on a route that forgot.
 */
export default function AppShell() {
    const navigate = useNavigate();
    const { user, signOut } = useAuth();

    const allTeamMembers = useAppStore((s) => s.teamMembers);
    const allSubTeams = useAppStore((s) => s.subTeams);
    const currentTeamId = useAppStore((s) => s.currentTeamId);

    const subTeams = useSeasonScoped(allSubTeams);
    const teamMembers = useMemo(
        () => allTeamMembers.filter((m) => m.teamId === currentTeamId),
        [allTeamMembers, currentTeamId],
    );

    // Who can reach the admin screens.
    //
    // Mirrors the server's `can_manage_roster` capability (admin or coach) rather than the
    // V1 `isCoach` boolean, which branched on one of the schema's four roles and left mentors
    // indistinguishable from students. This is UX only: the database refuses the writes
    // regardless of what the sidebar renders.
    const currentUserRole = teamMembers.find((m) => m.userId === user?.id)?.role;
    const canManageTeam = currentUserRole === 'admin' || currentUserRole === 'coach';

    // Fetch team data when the team changes.
    useEffect(() => {
        if (currentTeamId) {
            fetchTeamData(currentTeamId);
            return;
        }
        // With no team, wait out a possible hydration delay before redirecting — persisted
        // state comes back from IndexedDB asynchronously and arriving here first is normal.
        const timeout = setTimeout(() => {
            if (!useAppStore.getState().currentTeamId) navigate('/onboarding');
        }, 1000);
        return () => clearTimeout(timeout);
    }, [currentTeamId, navigate]);

    // Realtime subscription lifecycle — subscribe when a team is selected & online.
    useEffect(() => {
        if (!currentTeamId) return;

        setupRealtimeSubscription(currentTeamId);

        const handleOnline = () => setupRealtimeSubscription(currentTeamId);
        const handleOffline = () => teardownRealtimeSubscription();

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            teardownRealtimeSubscription();
        };
    }, [currentTeamId]);

    const context: AppShellContext = { teamMembers, subTeams, canManageTeam };

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden">
            <Sidebar
                canManageTeam={canManageTeam}
                onSignOut={() => performSignOut(signOut)}
                onSwitchTeam={() => navigate('/onboarding')}
            />

            <main className="flex-1 min-w-0 h-full overflow-hidden pt-header lg:pt-0">
                {/*
                 * `scroll-region` reserves the scrollbar track (`scrollbar-gutter: stable`)
                 * instead of the previous arrangement, which padded three sides here and
                 * pushed the fourth onto every direct child with `[&>*]:pr-4`. That worked
                 * until a child set its own `pr-*` or arrived inside a wrapper, and it made
                 * the whole layout jump 8px sideways the moment a list outgrew one screen.
                 */}
                <div className="h-full w-full scroll-region px-3 py-3 lg:px-5 lg:py-4">
                    <div className="max-w-app mx-auto">
                        <ArchivedSeasonBanner />
                        <Suspense fallback={<RouteFallback />}>
                            <Outlet context={context} />
                        </Suspense>
                    </div>
                </div>
            </main>
        </div>
    );
}
