import { lazy, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useAppStore } from './lib/store';
import { useSeasonScoped } from './lib/season-scope';
import { APP_ROOT, DEFAULT_VIEW_PATH, loginWithReturnTo, readReturnTo } from './lib/navigation';
import Wordmark from './components/Wordmark';
import LoginPage from './pages/Login';
import Onboarding from './pages/Onboarding';
import CreateTeam from './pages/CreateTeam';
import JoinTeam from './pages/JoinTeam';
import ResetPassword from './pages/ResetPassword';
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
const GuardianView = lazy(() => import('./components/guardian/GuardianView'));
const GettingStarted = lazy(() => import('./pages/GettingStarted'));

/*
 * Meetings is six routes rather than one, and they are split separately on purpose.
 *
 * `CheckInPoster` pulls in the QR generator and `CheckIn` pulls in nothing but is the screen a
 * student reaches from a camera scan with a phone on venue WiFi — so neither belongs in the
 * chunk the schedule loads. Splitting them per route means a student who only ever checks in
 * never downloads the roster, the summary or the calendar.
 */
const MeetingsPage = lazy(() => import('./components/meetings/MeetingsPage'));
const EventDetail = lazy(() => import('./components/meetings/EventDetail'));
const AttendanceRoster = lazy(() => import('./components/meetings/AttendanceRoster'));
const AttendanceSummary = lazy(() => import('./components/meetings/AttendanceSummary'));
const CheckInPoster = lazy(() => import('./components/meetings/CheckInPoster'));
const CheckIn = lazy(() => import('./components/meetings/CheckIn'));

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

/**
 * The full-screen brand state shared by the loading and auth-callback screens.
 *
 * THE LOGO AND THE WORDMARK ARE ON SEPARATE LINES, and that has to be arranged rather than
 * assumed. Both were inline-level boxes — the logo tile an `inline-flex`, `Wordmark`'s root an
 * `inline-flex` too — with nothing between them, so they laid out on the SAME LINE, sharing a
 * baseline: the mark sat to the RIGHT of the logo and level with its bottom edge, which is not
 * a small misalignment but the wrong arrangement entirely. It carried a `justify-center` that
 * did nothing, because justification has no effect on a flex box sized to its own content.
 *
 * `flex mx-auto` makes the tile a centred block, and the wrapper below makes the wordmark one,
 * so the two stack and `text-center` centres each on its own line. Both fixes are needed:
 * either alone still leaves two inline boxes sharing a line.
 *
 * `splash-layout.spec.ts` measures it in a real browser, because this is a layout property and
 * jsdom computes no layout — the bug would render identically to the fix in a unit test.
 */
function SplashScreen({ message }: { message: string }) {
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="text-center">
                <div
                    data-testid="splash-logo"
                    className="relative mx-auto flex items-center justify-center w-24 h-24 mb-6"
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-forge-500 to-amber-500 rounded-3xl blur-xl opacity-30 animate-pulse" />
                    <div className="relative w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-overlay border border-slate-700/50 p-2">
                        <img
                            src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                            className="w-full h-full object-contain"
                            alt="FalconForge"
                        />
                    </div>
                </div>
                <div data-testid="splash-wordmark" className="mb-4">
                    <Wordmark size="lg" />
                </div>
                <div className="flex items-center justify-center gap-2 text-slate-400">
                    <div className="w-4 h-4 border-2 border-forge-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium">{message}</p>
                </div>
            </div>
        </div>
    );
}

/**
 * Send an unauthenticated visitor to LOG IN, remembering where they were going.
 *
 * This used to be `<Navigate to="/" replace />`, which dropped them on the marketing page with
 * the destination discarded. For a student who has just pointed their camera at a poster that
 * is the whole feature failing: they are one tap from checking in and instead they are reading
 * about robots.
 */
function SignInFirst() {
    const location = useLocation();
    return <Navigate to={loginWithReturnTo(`${location.pathname}${location.search}`)} replace />;
}

/**
 * Signed in and standing on `/login` — go on to wherever they were headed.
 *
 * The team picker stays in the path deliberately: an account can belong to several teams and
 * the app has always insisted on an explicit choice. What changes is that the DESTINATION
 * survives the detour, so a scanned poster still ends at the check-in screen.
 */
function ContinueAfterLogin() {
    const location = useLocation();
    const next = readReturnTo(location.search);
    return <Navigate to={next ? `/onboarding${location.search}` : '/onboarding'} replace />;
}

function App() {
    const { user, isLoading, isSigningOut } = useAuth();
    const { theme, initializeStore } = useAppStore();

    useEffect(() => {
        initializeStore().catch(console.error);
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

                <Route path="/login" element={user ? <ContinueAfterLogin /> : <LoginPage />} />

                <Route path="/auth/callback" element={<SplashScreen message="Securing your session..." />} />

                {/*
                 * Where a recovery email ends up. NOT where it points: the link lands on the
                 * origin root so that `detectSessionInUrl` can read the fragment (a URL has one
                 * fragment, and a HashRouter path in `redirectTo` would eat it), and
                 * `onAuthStateChange`'s PASSWORD_RECOVERY handler navigates here once the
                 * session exists.
                 *
                 * This route simply did not exist until Sprint 9, which is the second half of
                 * why recovery was dead in production: even when the app booted, the catch-all
                 * below matched and silently discarded the token.
                 *
                 * Public rather than behind the `user ?` guard — the page decides for itself,
                 * and tells somebody with no recovery session that their link has expired
                 * instead of bouncing them to the landing page with no explanation.
                 */}
                <Route path="/auth/reset-password" element={<ResetPassword />} />

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
                <Route path={APP_ROOT} element={user ? <AppShell /> : <SignInFirst />}>
                    <Route index element={<Navigate to={DEFAULT_VIEW_PATH} replace />} />
                    <Route path="dashboard" element={<DashboardHome />} />
                    <Route path="board" element={<SprintPlanningRoute />} />
                    <Route path="checklist" element={<PreMatchChecklist />} />
                    <Route path="scouting" element={<ScoutingReports />} />
                    {/*
                     * `summary` is declared before `:meetingId` for readability only —
                     * React Router ranks a static segment above a dynamic one regardless,
                     * so the order here is not what makes it work.
                     */}
                    <Route path="meetings" element={<MeetingsPage />} />
                    <Route path="meetings/summary" element={<AttendanceSummary />} />
                    <Route path="meetings/:meetingId" element={<EventDetail />} />
                    <Route path="meetings/:meetingId/roster" element={<AttendanceRoster />} />
                    <Route path="meetings/:meetingId/poster" element={<CheckInPoster />} />
                    {/*
                     * Where a scanned QR lands. Both forms exist: with a code (a scan) and
                     * without (the typed fallback). Signed out, the `user ?` guard on the
                     * parent route sends them to the landing page and the hash survives the
                     * round trip through login, so the scan resumes -- rule 4 of the brief.
                     */}
                    <Route path="checkin" element={<CheckIn />} />
                    <Route path="checkin/:code" element={<CheckIn />} />
                    <Route path="planner" element={<MatchPlanner />} />
                    <Route path="profile" element={<EditProfile />} />
                    {/*
                     * The guardian's own view. No route guard: the page reads only rows RLS
                     * already scopes to `guardian_user_id = auth.uid()`, so somebody who is not
                     * a guardian sees the empty state rather than an Access Denied — which is
                     * the honest answer, since "you have no children here" is exactly true.
                     */}
                    <Route path="guardian" element={<GuardianView />} />
                    <Route path="help" element={<GettingStarted />} />
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
