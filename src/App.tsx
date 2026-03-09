import { useState, useEffect } from 'react';
import { AI_FEATURES_ENABLED } from './constants';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useAppStore } from './lib/store';
import LoginPage from './pages/Login';
import Onboarding from './pages/Onboarding';
import CreateTeam from './pages/CreateTeam';
import JoinTeam from './pages/JoinTeam';
import TermsAndConditions from './pages/legal/TermsAndConditions';
import PrivacyPolicy from './pages/legal/PrivacyPolicy';
import CommunityGuidelines from './pages/legal/CommunityGuidelines';
import Sidebar from './components/Sidebar';

// Import consolidated components from src/components
import SprintPlanning from './components/SprintPlanning';
import ScoutingReports from './components/ScoutingReports';
import PreMatchChecklist from './components/PreMatchChecklist';
import MatchPlanner from './components/MatchPlanner';
import PortfolioAI from './components/PortfolioAI';
import AdminSettings from './components/AdminSettings';
import EditProfile from './components/EditProfile';
import DashboardHome from './components/DashboardHome';

function Dashboard() {
    const [activeTab, setActiveTab] = useState('dashboard');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { user, signOut, isConfigured } = useAuth();
    const {
        tasks: allTasks,
        teamMembers: allTeamMembers,
        subTeams: allSubTeams,
        theme,
        setTheme,
        addTask,
        updateTask,
        seasons,
        currentSeasonId,
        setCurrentSeason,
        currentTeamId,
        teams,
        fetchTeamData
    } = useAppStore();
    const navigate = useNavigate();

    // Filter data by current season (include items with no seasonId for backwards compatibility)
    const tasks = allTasks.filter(t => !t.seasonId || t.seasonId === currentSeasonId);
    const teamMembers = allTeamMembers.filter(m => m.teamId === useAppStore.getState().currentTeamId);
    const subTeams = allSubTeams.filter(t => !t.seasonId || t.seasonId === currentSeasonId);

    // Adapt store data to component props format
    const tasksForComponents = tasks.map(t => ({
        ...t,
        timeline: t.timeline.map(e => ({
            ...e,
            type: e.type as 'comment' | 'history'
        }))
    }));

    const handleSignOut = async () => {
        // Reset store state first (prevents sync actions from queueing during teardown)
        useAppStore.getState().resetToDefaults();
        await signOut();
        // Clear lightweight localStorage keys
        localStorage.removeItem('falconforge-sync-timestamps');
        // Clear IndexedDB tables (sync queue + persisted app state)
        try {
            const { clearLocalDatabase, clearAppState } = await import('./lib/offline-db');
            await clearLocalDatabase();
            await clearAppState();
        } catch (e) {
            console.warn('Failed to clear IndexedDB:', e);
        }
        // Use window.location for a clean redirect to ensure auth state is cleared
        window.location.href = `${import.meta.env.BASE_URL}#/login`;
    };

    // Calculate role for permissions
    const currentUserRole = teamMembers.find(m => m.userId === user?.id)?.role;
    const isCoach = currentUserRole === 'coach';

    // Fetch team data when team changes
    useEffect(() => {
        if (currentTeamId) {
            fetchTeamData(currentTeamId);
        }
    }, [currentTeamId, fetchTeamData]);

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden transition-colors duration-200">
            <Sidebar
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isMobileMenuOpen={isMobileMenuOpen}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                isCoach={isCoach}
                user={user}
                isConfigured={isConfigured ?? false}
                onSignOut={handleSignOut}
                onSwitchTeam={() => navigate('/onboarding')}
                theme={theme}
                setTheme={setTheme}
                tasks={tasks}
                seasons={seasons}
                currentSeasonId={currentSeasonId}
                setCurrentSeason={setCurrentSeason}
                teams={teams}
                currentTeamId={currentTeamId}
            />

            {/* Main Content Area */}
            <main className="flex-1 h-full overflow-hidden relative pt-16 lg:pt-0">
                <div className="h-full w-full overflow-y-auto bg-slate-50 dark:bg-slate-900 pl-4 pt-4 pb-4 lg:pl-6 lg:pt-6 lg:pb-6 [&>*]:pr-4 lg:[&>*]:pr-6">
                    {activeTab === 'dashboard' && <DashboardHome setActiveTab={setActiveTab} />}
                    {activeTab === 'kanban' && (
                        <SprintPlanning
                            tasks={tasksForComponents}
                            setTasks={(newTasks) => {
                                // This bridges the old component API with the new store
                                let updatedTasks = [];
                                if (typeof newTasks === 'function') {
                                    updatedTasks = newTasks(tasksForComponents);
                                } else {
                                    updatedTasks = newTasks;
                                }

                                // Update each task in store
                                updatedTasks.forEach((t: any) => {
                                    const existing = tasks.find(et => et.id === t.id);
                                    if (!existing) {
                                        addTask(t);
                                    } else {
                                        updateTask(t.id, t);
                                    }
                                });
                            }}
                            teamMembers={teamMembers}
                            subTeams={subTeams}
                        />
                    )}
                    {activeTab === 'checklist' && <PreMatchChecklist />}
                    {activeTab === 'scouting' && <ScoutingReports />}
                    {activeTab === 'planner' && <MatchPlanner />}
                    {AI_FEATURES_ENABLED && activeTab === 'portfolio' && <PortfolioAI tasks={tasksForComponents} view="portfolio" />}
                    {AI_FEATURES_ENABLED && activeTab === 'judging' && <PortfolioAI tasks={tasksForComponents} view="judging" />}
                    {activeTab === 'profile' && <EditProfile />}
                    {activeTab === 'admin' && (
                        isCoach ? (
                            <AdminSettings
                                teamMembers={teamMembers}
                                subTeams={subTeams}
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-8">
                                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                                    <Activity className="text-red-500" size={32} />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Access Denied</h2>
                                <p className="text-slate-600 dark:text-slate-400 max-w-md">
                                    Only team coaches have access to the Admin Settings page. Please contact your coach if you believe this is an error.
                                </p>
                            </div>
                        )
                    )}
                </div>
            </main>
        </div>
    );
}

function App() {
    const { user, isLoading } = useAuth();
    const { theme, initializeStore } = useAppStore();

    // Initialize store on mount
    useEffect(() => {
        initializeStore();
    }, [initializeStore]);

    // Apply theme on mount
    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    // Show loading screen while checking auth
    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
                <div className="text-center">
                    {/* Logo with pulsing gradient backdrop */}
                    <div className="relative inline-flex items-center justify-center w-24 h-24 mb-6">
                        {/* Pulsing gradient background */}
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-500 to-amber-500 rounded-3xl blur-xl opacity-30 animate-pulse"></div>
                        {/* Logo container - matches Login page */}
                        <div className="relative w-20 h-20 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl shadow-xl border border-slate-700/50 p-2">
                            <img
                                src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                className="w-full h-full object-contain"
                                alt="FalconForge Logo"
                            />
                        </div>
                    </div>
                    <h1 className="text-3xl font-black italic tracking-tighter mb-4">
                        <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span>
                        <span className="text-slate-300">FORGE</span>
                    </h1>
                    <div className="flex items-center justify-center gap-2 text-slate-400">
                        <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-sm font-medium">Preparing your workspace...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Routes>
            {/* Public routes */}
            <Route path="/login" element={
                user ? <Navigate to="/onboarding" replace /> : <LoginPage />
            } />

            <Route path="/auth/callback" element={
                <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
                    <div className="text-center">
                        <div className="relative w-24 h-24 mx-auto mb-8">
                            <div className="absolute inset-0 bg-orange-500/20 rounded-3xl blur-xl animate-pulse"></div>
                            <div className="relative w-24 h-24 bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl flex items-center justify-center border border-slate-700/50 shadow-2xl p-2">
                                <img
                                    src={`${import.meta.env.BASE_URL}falcon_logo.png`}
                                    className="w-full h-full object-contain animate-pulse"
                                    alt="FalconForge Logo"
                                />
                            </div>
                        </div>
                        <h2 className="text-xl font-black italic tracking-tighter mb-2"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-300">FORGE</span></h2>
                        <p className="text-sm text-slate-400 mb-4">Authenticating</p>
                        <div className="flex items-center justify-center gap-2 text-slate-400">
                            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-sm font-medium">Securing your session...</p>
                        </div>
                    </div>
                </div>
            } />

            {/* Legal pages - public */}
            <Route path="/legal/terms" element={<TermsAndConditions />} />
            <Route path="/legal/privacy" element={<PrivacyPolicy />} />
            <Route path="/legal/community" element={<CommunityGuidelines />} />

            {/* Onboarding routes - require auth */}
            <Route path="/onboarding" element={
                user ? <Onboarding /> : <Navigate to="/login" replace />
            } />

            <Route path="/create-team" element={
                user ? <CreateTeam /> : <Navigate to="/login" replace />
            } />

            <Route path="/join/:code?" element={
                <JoinTeam />
            } />

            {/* Main app - require auth and team */}
            <Route path="/*" element={
                user ? <Dashboard /> : <Navigate to="/login" replace />
            } />
        </Routes>
    );
}

export default App;
