import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, Gamepad2, BookOpen, Menu, X, Sun, Moon, Settings, ClipboardCheck, GraduationCap, LogOut, User, Activity, ChevronDown, ArrowRightLeft } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useAppStore } from './lib/store';
import LoginPage from './pages/Login';
import TeamPicker from './pages/TeamPicker';
import SyncStatusIndicator from './components/SyncStatusIndicator';

// Import consolidated components from src/components
import SprintPlanning from './components/SprintPlanning';
import ScoutingReports from './components/ScoutingReports';
import PreMatchChecklist from './components/PreMatchChecklist';
import MatchPlanner from './components/MatchPlanner';
import PortfolioAI from './components/PortfolioAI';
import AdminSettings from './components/AdminSettings';
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
        setTeamMembers,
        setSubTeams,
        seasons,
        currentSeasonId,
        setCurrentSeason,
        currentTeamId,
        teams
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
        await signOut();
        // Use window.location for a clean redirect to ensure auth state is cleared
        window.location.href = `${import.meta.env.BASE_URL}#/login`;
    };

    const NavItem = ({ id, label, icon: Icon }: { id: string, label: string, icon: any }) => (
        <button
            onClick={() => {
                setActiveTab(id);
                setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mb-1
        ${activeTab === id
                    ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-bold shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200 font-medium'}`}
        >
            <Icon size={20} />
            <span>{label}</span>
        </button>
    );

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden transition-colors duration-200">
            <aside className="hidden lg:flex w-64 flex-col bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 h-full">
                <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-12 h-12 object-contain" alt="FalconForge Logo" />
                    <h1 className="text-xl font-black italic tracking-tighter bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent drop-shadow-sm">FALCON<span className="text-slate-700 dark:text-slate-300">FORGE</span></h1>
                </div>

                {/* Season Selector */}
                <div className="px-4 pt-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Season</label>
                    <div className="relative">
                        <select
                            value={currentSeasonId || ''}
                            onChange={(e) => setCurrentSeason(e.target.value)}
                            className="w-full appearance-none bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition"
                        >
                            {seasons.map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                </div>

                <nav className="flex-1 p-4 overflow-y-auto">
                    <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                    <NavItem id="kanban" label="Sprint Planning" icon={Activity} />
                    <NavItem id="checklist" label="Pre-Match Checklist" icon={CheckSquare} />
                    <NavItem id="scouting" label="Scouting Reports" icon={ClipboardCheck} />
                    <NavItem id="planner" label="Match Planner" icon={Gamepad2} />
                    <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                    <NavItem id="portfolio" label="Portfolio Helper" icon={BookOpen} />
                    <NavItem id="judging" label="Judging Prep" icon={GraduationCap} />
                    <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                    <NavItem id="admin" label="Admin Settings" icon={Settings} />
                </nav>

                <div className="p-4 border-t border-slate-100 dark:border-slate-700">
                    <div className="bg-slate-100 dark:bg-slate-700 rounded-xl p-4">
                        <div className="flex justify-between text-sm mb-1 text-slate-600 dark:text-slate-300">
                            <span>Tasks Done</span>
                            <span className="font-bold">{tasks.filter(t => t.status === 'Done').length}</span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1.5 mt-2">
                            <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${tasks.length > 0 ? (tasks.filter(t => t.status === 'Done').length / tasks.length) * 100 : 0}%` }}></div>
                        </div>
                    </div>

                    {/* User section */}
                    {isConfigured && user && (
                        <div className="mt-4 flex flex-col gap-2">
                            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 rounded-full flex items-center justify-center">
                                    <User size={16} className="text-orange-600 dark:text-orange-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                        {user.user_metadata?.full_name || user.email}
                                    </p>
                                </div>
                                <button
                                    onClick={handleSignOut}
                                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                                    title="Sign out"
                                >
                                    <LogOut size={16} />
                                </button>
                            </div>

                            {/* Team Switcher - Matches user section style exactly */}
                            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {teams.find(t => t.id === currentTeamId)?.teamNumber ? `#${teams.find(t => t.id === currentTeamId)?.teamNumber?.slice(0, 2)}` : 'T'}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                        {teams.find(t => t.id === currentTeamId)?.name || 'Select Team'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigate('/team-picker')}
                                    className="p-2 text-slate-400 hover:text-orange-500 transition-colors"
                                    title="Switch Team"
                                >
                                    <ArrowRightLeft size={16} />
                                </button>
                            </div>

                            {/* Sync Status + Theme Toggle */}
                            <div className="flex items-center gap-2">
                                <div className="flex-1">
                                    <SyncStatusIndicator variant="full" />
                                </div>
                                <button
                                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                                    className="p-2 text-slate-400 hover:text-orange-500 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                                    title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                                >
                                    {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Demo mode team switcher - when not logged in */}
                    {(!isConfigured || !user) && (
                        <div className="mt-4 flex flex-col gap-2">
                            {/* Team Switcher - Matches user section style exactly */}
                            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {teams.find(t => t.id === currentTeamId)?.teamNumber ? `#${teams.find(t => t.id === currentTeamId)?.teamNumber?.slice(0, 2)}` : 'T'}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                        {teams.find(t => t.id === currentTeamId)?.name || 'Select Team'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => navigate('/team-picker')}
                                    className="p-2 text-slate-400 hover:text-orange-500 transition-colors"
                                    title="Switch Team"
                                >
                                    <ArrowRightLeft size={16} />
                                </button>
                            </div>

                            {/* Theme Toggle for demo mode */}
                            <div className="flex justify-end">
                                <button
                                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                                    className="p-2 text-slate-400 hover:text-orange-500 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                                    title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                                >
                                    {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </aside>

            {/* Mobile/Tablet Header - Visible below LG screens */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 z-20 safe-area-top">
                <div className="flex items-center gap-2">
                    <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-12 h-12 object-contain" alt="FalconForge Logo" />
                    <span className="font-black text-lg italic tracking-tighter"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-700 dark:text-slate-300">FORGE</span></span>
                </div>
                <div className="flex items-center gap-3">
                    <SyncStatusIndicator variant="icon" />
                    <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="text-slate-600 dark:text-slate-300">
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                    <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-600 dark:text-slate-300">
                        {isMobileMenuOpen ? <X /> : <Menu />}
                    </button>
                </div>
            </div>

            {/* Mobile/Tablet Menu Overlay */}
            {isMobileMenuOpen && (
                <div className="lg:hidden fixed inset-0 bg-white dark:bg-slate-800 z-50 pt-4 px-4 safe-area-top overflow-y-auto flex flex-col">
                    <div className="flex items-center justify-between mb-6 px-2">
                        <div className="flex items-center gap-2">
                            <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-10 h-10 object-contain" alt="FalconForge Logo" />
                            <span className="font-black text-xl italic tracking-tighter"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-700 dark:text-slate-300">FORGE</span></span>
                        </div>
                        <button
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition flex items-center justify-center w-10 h-10"
                        >
                            <X size={24} />
                        </button>
                    </div>

                    {/* Mobile Season Selector */}
                    <div className="mb-4 px-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Season</label>
                        <div className="relative">
                            <select
                                value={currentSeasonId || ''}
                                onChange={(e) => setCurrentSeason(e.target.value)}
                                className="w-full appearance-none bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-slate-700 dark:text-slate-200"
                            >
                                {seasons.map((s) => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <nav className="space-y-2">
                        <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                        <NavItem id="kanban" label="Sprint Planning" icon={Activity} />
                        <NavItem id="checklist" label="Pre-Match Checklist" icon={CheckSquare} />
                        <NavItem id="scouting" label="Scouting Reports" icon={ClipboardCheck} />
                        <NavItem id="planner" label="Match Planner" icon={Gamepad2} />
                        <NavItem id="portfolio" label="Portfolio Helper" icon={BookOpen} />
                        <NavItem id="judging" label="Judging Prep" icon={GraduationCap} />
                        <NavItem id="admin" label="Admin Settings" icon={Settings} />
                    </nav>

                    {isConfigured && user && (
                        <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 pb-4">
                            {/* Mobile Team Switcher - Above Sign Out */}
                            <button
                                onClick={() => { navigate('/team-picker'); setIsMobileMenuOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl transition-all"
                            >
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-xs text-slate-400 dark:text-slate-500">
                                        {teams.find(t => t.id === currentTeamId)?.teamNumber ? `#${teams.find(t => t.id === currentTeamId)?.teamNumber}` : 'Team'}
                                    </p>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {teams.find(t => t.id === currentTeamId)?.name || 'Select Team'}
                                    </p>
                                </div>
                                <ArrowRightLeft size={16} className="text-slate-400" />
                            </button>

                            <button
                                onClick={handleSignOut}
                                className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                            >
                                <LogOut size={20} />
                                <span className="font-medium">Sign Out</span>
                            </button>
                        </div>
                    )}

                    {/* Demo mode mobile team switcher */}
                    {(!isConfigured || !user) && (
                        <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-700 pb-4">
                            <button
                                onClick={() => { navigate('/team-picker'); setIsMobileMenuOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl transition-all"
                            >
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-xs text-slate-400 dark:text-slate-500">
                                        {teams.find(t => t.id === currentTeamId)?.teamNumber ? `#${teams.find(t => t.id === currentTeamId)?.teamNumber}` : 'Team'}
                                    </p>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {teams.find(t => t.id === currentTeamId)?.name || 'Select Team'}
                                    </p>
                                </div>
                                <ArrowRightLeft size={16} className="text-slate-400" />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Main Content Area */}
            <main className="flex-1 h-full overflow-hidden relative pt-16 lg:pt-0">
                <div className="h-full w-full overflow-y-auto bg-slate-50 dark:bg-slate-900 p-4 lg:p-6">
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
                    {activeTab === 'portfolio' && <PortfolioAI tasks={tasksForComponents} view="portfolio" />}
                    {activeTab === 'judging' && <PortfolioAI tasks={tasksForComponents} view="judging" />}
                    {activeTab === 'admin' && (
                        <AdminSettings
                            teamMembers={teamMembers}
                            setTeamMembers={setTeamMembers}
                            subTeams={subTeams}
                            setSubTeams={setSubTeams}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}

function App() {
    const { user, isLoading, isConfigured } = useAuth();
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
            <Route path="/login" element={
                // If already logged in (or demo mode), redirect to team picker
                !isConfigured || user ? <Navigate to="/team-picker" replace /> : <LoginPage />
            } />

            <Route path="/auth/callback" element={
                // OAuth callback handling
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

            <Route path="/team-picker" element={
                // Team selection page - accessible when authenticated
                !isConfigured || user ? <TeamPicker /> : <Navigate to="/login" replace />
            } />

            <Route path="/*" element={
                // Main app - accessible in demo mode or when authenticated
                !isConfigured || user ? <Dashboard /> : <Navigate to="/login" replace />
            } />
        </Routes>
    );
}

export default App;
