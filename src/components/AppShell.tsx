import { Suspense, useEffect, useMemo, useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAppStore } from '../lib/store';
import { useSeasonScoped } from '../lib/season-scope';
import { setupRealtimeSubscription, teardownRealtimeSubscription } from '../lib/realtime';
import { fetchTeamData, fetchGuardianData } from '../lib/server-pull';
import { APP_ROOT } from '../lib/navigation';
import { supabaseSync } from '../lib/supabase';
import { performSignOut } from '../lib/sign-out';
import Sidebar from './Sidebar';
import ArchivedSeasonBanner from './ArchivedSeasonBanner';
import LicenceBanner from './LicenceBanner';
import OfflineBanner from './OfflineBanner';
import AppUpdatePrompt from './AppUpdatePrompt';
import RouteErrorBoundary from './RouteErrorBoundary';
import ReAttestationPrompt from './ReAttestationPrompt';
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
    /** Holds at least one managed child profile. Drives the "My children" nav entry. */
    isGuardian: boolean;
    /**
     * Mirrors the server's `can_manage_meetings` capability: the admin, a coach OR A MENTOR.
     *
     * A separate boolean from {@link canManageTeam} because it is a genuinely different set.
     * Sprint 8 is the first feature where `mentor` means anything — the role has been in the
     * schema since Sprint 3 with no capability distinguishing it from `student` — so this is
     * the first place the two answers diverge rather than one being a rename of the other.
     * UX only; the database refuses the writes regardless.
     */
    canManageMeetings: boolean;
    /** This user's row on the current team. The roster is keyed by member id, not user id. */
    currentMember: TeamMember | null;
    /** Platform operator, per `is_platform_operator()`. Null until the answer is known. */
    isOperator: boolean | null;
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
    const location = useLocation();
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
    /*
     * `!m.managedProfileId` IS LOAD-BEARING, and was added in Sprint 9.
     *
     * A guardian's `team_members` row carries THEIR user id and the CHILD's profile — that is
     * the whole COPPA model — so without this clause a guardian resolves to their child's
     * membership and the app renders the team as the child. That is precisely the act-as mode
     * plan section 3 refuses, arrived at by accident rather than by design: every
     * `currentMember`-driven control (the schedule's check-in button, attendance) would act on
     * the child while the guardian is signed in.
     *
     * It also matches the server, which is the point. `is_team_member` and `get_user_team_ids`
     * both carry `managed_profile_id IS NULL`, so a guardian resolving to a member here would
     * be a client that believes it is on a team the database says it is not on — empty screens
     * that look like a bug rather than a boundary.
     */
    const currentMember = useMemo(
        () => teamMembers.find((m) => m.userId === user?.id && !m.managedProfileId) ?? null,
        [teamMembers, user?.id],
    );
    const currentUserRole = currentMember?.role;
    const canManageTeam = currentUserRole === 'admin' || currentUserRole === 'coach';
    // `can_manage_meetings` server-side. Mentors run the schedule; they do not run the roster.
    const canManageMeetings = canManageTeam || currentUserRole === 'mentor';

    /*
     * Platform-operator status, asked of the database rather than inferred.
     *
     * `is_platform_operator()` is the same function every operator RPC gates on, so the nav and
     * the server cannot disagree about who this is. Null while unknown — and the nav treats null
     * as "no", which is the right default for a capability nobody should see by accident. There
     * is no fail-open argument here: unlike entitlement, being unable to ask costs the user
     * nothing, because an operator is one person and the page is not on anyone's critical path.
     */
    const [isOperator, setIsOperator] = useState<boolean | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!supabaseSync || !user) {
            setIsOperator(false);
            return;
        }
        supabaseSync
            .rpc('is_platform_operator')
            .then(({ data, error }) => {
                if (!cancelled) setIsOperator(error ? false : data === true);
            });
        return () => {
            cancelled = true;
        };
    }, [user]);

    /*
     * The guardian's own records, which are not team-scoped and so are not part of
     * `fetchTeamData`. Loaded once per signed-in user; a guardian typically has no team at all,
     * so hanging this off the team fetch would mean it never ran for the people who need it.
     */
    const managedProfiles = useAppStore((s) => s.managedProfiles);
    const isGuardian = managedProfiles.length > 0;

    useEffect(() => {
        if (!user?.id) return;
        fetchGuardianData(user.id).catch(console.error);
    }, [user?.id]);

    // Fetch team data when the team changes.
    useEffect(() => {
        if (currentTeamId) {
            fetchTeamData(currentTeamId).catch(console.error);
            return;
        }
        /*
         * "NO TEAM" IS NOT AN ERROR FOR A GUARDIAN — it is their normal state.
         *
         * A guardian holds a roster row on a child's behalf and no membership of their own, so
         * `currentTeamId` is null for them permanently. Bouncing to the team picker would make
         * `/app/guardian` unreachable: navigate to it, and one second later you are back on
         * onboarding being asked to pick a team you are not on. Found in the browser, doing
         * exactly that.
         *
         * The redirect exists for a DIFFERENT case — a member who has not chosen a team yet —
         * so it is scoped to routes that need one rather than removed.
         */
        if (location.pathname.startsWith(`${APP_ROOT}/guardian`)) return;

        // With no team, wait out a possible hydration delay before redirecting — persisted
        // state comes back from IndexedDB asynchronously and arriving here first is normal.
        const timeout = setTimeout(() => {
            if (!useAppStore.getState().currentTeamId) navigate('/onboarding');
        }, 1000);
        return () => clearTimeout(timeout);
    }, [currentTeamId, navigate, location.pathname]);

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

    const context: AppShellContext = {
        teamMembers,
        subTeams,
        canManageTeam,
        isGuardian,
        canManageMeetings,
        currentMember,
        isOperator,
    };

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden">
            <Sidebar
                isGuardian={isGuardian}
                canManageTeam={canManageTeam}
                isOperator={isOperator === true}
                onSignOut={() => performSignOut(signOut)}
                onSwitchTeam={() => navigate('/onboarding')}
            />

            {/*
             * Over the shell, not instead of it. A consent refresh is not a lockout: the user has
             * already accepted a previous version, so the app keeps rendering behind this and the
             * dialog is dismissible. See ReAttestationPrompt for why that is the right posture.
             */}
            <ReAttestationPrompt />

            <main className="flex-1 min-w-0 h-full overflow-hidden pt-header lg:pt-0">
                {/*
                 * `scroll-region` reserves the scrollbar track (`scrollbar-gutter: stable`)
                 * instead of the previous arrangement, which padded three sides here and
                 * pushed the fourth onto every direct child with `[&>*]:pr-4`. That worked
                 * until a child set its own `pr-*` or arrived inside a wrapper, and it made
                 * the whole layout jump 8px sideways the moment a list outgrew one screen.
                 */}
                <div className="h-full w-full scroll-region px-3 py-3 lg:px-5 lg:py-4">
                    {/*
                     * `h-full flex flex-col` on the width-limiter, not just `mx-auto`.
                     *
                     * Several views (the sprint board, scouting, the checklist) are written as
                     * `h-full flex flex-col` so that their own list scrolls INSIDE a fixed frame
                     * rather than growing the page — that is what keeps the board's column
                     * headers on screen while its cards scroll. `height: 100%` needs a parent
                     * with a definite height, so a plain `max-w-app mx-auto` wrapper silently
                     * breaks the chain and every one of those views collapses to content height.
                     * The outlet sits in a flex child, whose height IS definite, so `h-full`
                     * below it resolves; content taller than the frame still scrolls the region.
                     */}
                    <div className="max-w-app mx-auto h-full flex flex-col">
                        {/*
                         * TWO BANNERS, ONE POSITION, AND AT MOST ONE VISIBLE.
                         *
                         * They are deliberately not one component and not one predicate.
                         * `season-scope.ts` explains why: an archived season and a lapsed licence
                         * are different refusals with different fixes ("switch to this year" vs
                         * "renew"), and a single boolean produces a UI that cannot say which one
                         * the user is looking at. `useAccessState` composes them in one place and
                         * gives the archived season precedence, so this renders one banner rather
                         * than the two stacked ones that happen by accident.
                         */}
                        {/*
                         * Above those two, and on a different axis: connectivity and a waiting
                         * update are not alternative answers to "why can't I edit this?", and
                         * either can be true at the same time as a lapsed licence. Both are one
                         * compact line so the stack stays honest rather than becoming a wall.
                         */}
                        <AppUpdatePrompt />
                        <OfflineBanner />
                        <ArchivedSeasonBanner />
                        <LicenceBanner />
                        <div className="flex-1 min-h-0">
                            {/*
                             * The boundary is INSIDE the shell, so a crashing view leaves the
                             * sidebar, season picker and sync indicator working and the user can
                             * navigate away from it. `resetKey` is the pathname, which makes
                             * navigating away the reset -- no reload required.
                             */}
                            <RouteErrorBoundary resetKey={location.pathname}>
                                <Suspense fallback={<RouteFallback />}>
                                    <Outlet context={context} />
                                </Suspense>
                            </RouteErrorBoundary>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
