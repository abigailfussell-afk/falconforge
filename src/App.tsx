import { lazy, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useAppStore } from './lib/store';
import { useSeasonScoped } from './lib/season-scope';
import { APP_ROOT, DEFAULT_VIEW_PATH } from './lib/navigation';
import Wordmark from './components/Wordmark';
import LoginPage from './pages/Login';
import Onboarding from './pages/Onboarding';
import CreateTeam from './pages/CreateTeam';
import JoinTeam from './pages/JoinTeam';
import LandingPage from './pages/Landing';
import TermsAndConditions from './pages/legal/TermsAndConditions';
import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import CommunityGuidelines from './pages/legal/CommunityGuidelines';
import AppShell, { useAppShell } from './components/AppShell';
import DashboardHome from './components/DashboardHome';
import QueryProvider from './components/QueryProvider';

/*
 * Feature views are code-split.
 *
 * Every one of these used to be a static import pulled into the entry chunk, because the
 * views were `activeTab === '...' &&` branches rather than routes and a branch cannot be
 * split. Splitting them is also what fixes the standing build warning that `offline-db.ts`
 * was "both statically and dynamically imported, defeating its own code-split" — the sync
 * layer's dynamic importers now sit behind a route boundary rather than beside one.
 *
 * `DashboardHome` is deliberately NOT lazy. It is the view the app opens on, so splitting it
 * would buy nothing and cost a spinner on every cold start.
 */
const SprintPlanning = lazy(() => import('./components/SprintPlanning'));
const PreMatchChecklist = lazy(() => import('./components/PreMatchChecklist'));
const ScoutingReports = lazy(() => import('./components/ScoutingReports'));
const MatchPlanner = lazy(() => import('./components/MatchPlanner'));
const AdminSettings = lazy(() => import('./components/AdminSettings'));
const EditProfile = lazy(() => import('./components/EditProfile'));
const OperatorConsole = lazy(() => import('./components/admin/OperatorConsole'));

/*
 * Route adapters.
 *
 * These exist so the feature components keep the prop APIs their own test files are written
 * against, while the shell stays the one place the roster is filtered by team and the
 * sub-teams by season.
 */
function SprintPlanningRoute() {
    const { teamMembers, subTeams } = useAppShell();
    // `useSeasonScoped`, not `s.tasks`. The board shows THIS season's work; handing it the
    // raw collection is precisely the defect Sprint 4 found in ScoutingReports, where a
    // whole prior season's rows had been mixed into the current list with no way to tell
    // them apart.
    const tasks = useSeasonScoped(useAppStore((s) => s.tasks));
    // The store's `timeline[].type` is a widened string; the component's prop type is the
    // union it is actually drawn from. This narrowing used to sit inline in `Dashboard()`.
    const tasksForComponent = useMemo(
        () =>
            tasks.map((t) => ({
                ...t,
                timeline: t.timeline.map((e) => ({ ...e, type: e.type as 'comment' | 'history' })),
            })),
        [tasks],
    );
    return <SprintPlanning tasks={tasksForComponent} teamMembers={teamMembers} subTeams={subTeams} />;
}

function AdminSettingsRoute() {
    const { teamMembers, subTeams, canManageTeam } = useAppShell();

    // Hiding the nav item is UX; this is what happens when someone follows a deep link or a
    // bookmark from back when they were a coach. The database refuses the writes either way.
    if (!canManageTeam) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <div className="w-14 h-14 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                    <Activity className="text-red-500" size={26} />
                </div>
                <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Access Denied</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 max-w-prose">
                    Only the team admin and coaches have access to the Admin Settings page. Please
                    contact them if you believe this is an error.
                </p>
            </div>
        );
    }

    return <AdminSettings teamMembers={teamMembers} subTeams={subTeams} />;
}

/** The full-screen brand state shared by the loading and auth-callback screens. */
function SplashScreen({ message }: { message: string }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="text-center">
                <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6">
                    <div className="absolute inset-0 bg-gradient-to-r from-forge-500 to-amber-500 rounded-3xl blur-xl opacity-30 animate-pulse" />
                    <div className="relative w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-overlay border border-slate-700/50 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge"
                        />
                    </div>
                </div>
                <Wordmark size="lg" className="mb-4 justify-center" />
                <div className="flex items-center justify-center gap-2 text-slate-400">
                    <div className="w-4 h-4 border-2 border-forge-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">{message}</p>
                </div>
            </div>
        </div>
    );
}

function App() {
    const { user, isLoading, isSigningOut } = useAuth();
    const { theme, initializeStore } = useAppStore();

    useEffect(() => {
        initializeStore();
    }, [initializeStore]);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
    }, [theme]);

    if (isLoading || isSigningOut) {
        return (
            <SplashScreen
                message={isSigningOut ? 'Signing out securely...' : 'Preparing your workspace...'}
            />
        );
    }

    return (
        <QueryProvider>
            <Routes>
                <Route path="/" element={user ? <Navigate to={APP_ROOT} replace /> : <LandingPage />} />

                <Route path="/login" element={user ? <Navigate to="/onboarding" replace /> : <LoginPage />} />

                <Route path="/auth/callback" element={<SplashScreen message="Securing your session..." />} />

                {/* Legal pages - public */}
                <Route path="/legal/terms" element={<TermsAndConditions />} />
                <Route path="/legal/privacy" element={<PrivacyPolicy />} />
                <Route path="/legal/community" element={<CommunityGuidelines />} />

                {/* Onboarding routes - require auth */}
                <Route path="/onboarding" element={user ? <Onboarding /> : <Navigate to="/" replace />} />
                <Route path="/create-team" element={user ? <CreateTeam /> : <Navigate to="/" replace />} />
                <Route path="/join/:code?" element={<JoinTeam />} />

                {/*
                 * The app proper. Every view is a real URL: `#/app/board` is bookmarkable, the
                 * back button walks the views, and a reload lands where it left off.
                 */}
                <Route path={APP_ROOT} element={user ? <AppShell /> : <Navigate to="/" replace />}>
                    <Route index element={<Navigate to={DEFAULT_VIEW_PATH} replace />} />
                    <Route path="dashboard" element={<DashboardHome />} />
                    <Route path="board" element={<SprintPlanningRoute />} />
                    <Route path="checklist" element={<PreMatchChecklist />} />
                    <Route path="scouting" element={<ScoutingReports />} />
                    <Route path="planner" element={<MatchPlanner />} />
                    <Route path="profile" element={<EditProfile />} />
                    <Route path="admin" element={<AdminSettingsRoute />} />
                    {/*
                     * The operator page needs no route guard of its own. `OperatorConsole` asks
                     * `is_platform_operator()` and renders a plain explanation to anyone else —
                     * which is the "operator page seen by somebody who is not an operator" case,
                     * reachable by typing the URL and therefore worth answering properly rather
                     * than with a blank screen. Every RPC behind it refuses a non-operator too.
                     */}
                    <Route path="operator" element={<OperatorConsole />} />
                    {/* An unknown view under /app is a stale link, not a dead end. */}
                    <Route path="*" element={<Navigate to={DEFAULT_VIEW_PATH} replace />} />
                </Route>

                {/*
                 * Anything unrecognised goes home rather than to a blank screen — signed in,
                 * that is the app; signed out, the landing page.
                 *
                 * This is also what keeps `#/dashboard` working. That is the URL the app
                 * handed out from V1 through Sprint 4, so it is in browser histories, in the
                 * PWA's stored start-up state and quite possibly in someone's bookmarks bar,
                 * and it must not become a dead link. There WAS an explicit
                 * `<Route path="/dashboard">` here saying so; falsifying the route tests
                 * (rule 10) showed deleting it changed nothing, because this line already
                 * covered it. Two lines for one behaviour, one of which could rot unnoticed —
                 * so the redundant one is gone and the reason lives here.
                 */}
                <Route path="*" element={<Navigate to={user ? APP_ROOT : '/'} replace />} />
            </Routes>
        </QueryProvider>
    );
}

export default App;
