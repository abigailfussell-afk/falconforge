import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, Gamepad2, BookOpen, Menu, X, Sun, Moon, Settings, ClipboardCheck, GraduationCap, LogOut, User } from 'lucide-react';
import { useAuth } from './lib/auth';
import { useAppStore } from './lib/store';
import LoginPage from './pages/Login';
import SyncStatusIndicator from './components/SyncStatusIndicator';

// Import existing components (we'll move these to src/components later)
import KanbanBoard from '../components/KanbanBoard';
import ScoutingReports from '../components/Competition';
import PreMatchChecklist from '../components/PreMatchChecklist';
import MatchPlanner from '../components/MatchPlanner';
import PortfolioAI from '../components/PortfolioAI';
import AdminSettings from '../components/AdminSettings';

function Dashboard() {
    const [activeTab, setActiveTab] = useState('kanban');
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { user, signOut, isConfigured } = useAuth();
    const { tasks, members, teams, theme, setTheme, addTask, updateTask, setMembers, setTeams } = useAppStore();
    const navigate = useNavigate();

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
        navigate('/login');
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
            {/* Sidebar - Visible on LG screens and up (Desktop) */}
            <aside className="hidden lg:flex w-64 flex-col bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 h-full">
                <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
                    <img src="/logo.png" className="w-12 h-12 object-contain rounded-lg" alt="Logo" />
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">FTC Manager</h1>
                </div>

                <nav className="flex-1 p-4 overflow-y-auto">
                    <NavItem id="kanban" label="Sprint Planning" icon={LayoutDashboard} />
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
                        <div className="flex justify-between items-center mb-4">
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase">Appearance</p>
                            <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="text-slate-500 dark:text-slate-400 hover:text-orange-600 dark:hover:text-orange-400">
                                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
                            </button>
                        </div>
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
                        <div className="mt-4 flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
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
                    )}
                </div>
            </aside>

            {/* Mobile/Tablet Header - Visible below LG screens */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 z-20 safe-area-top">
                <div className="flex items-center gap-2">
                    <img src="/logo.png" className="w-12 h-12 object-contain rounded-lg" alt="Logo" />
                    <span className="font-bold text-lg text-slate-900 dark:text-white">FTC Manager</span>
                </div>
                <div className="flex items-center gap-3">
                    <SyncStatusIndicator />
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
                <div className="lg:hidden fixed inset-0 bg-white dark:bg-slate-800 z-50 pt-20 px-4 safe-area-top">
                    <nav className="space-y-2">
                        <NavItem id="kanban" label="Sprint Planning" icon={LayoutDashboard} />
                        <NavItem id="checklist" label="Pre-Match Checklist" icon={CheckSquare} />
                        <NavItem id="scouting" label="Scouting Reports" icon={ClipboardCheck} />
                        <NavItem id="planner" label="Match Planner" icon={Gamepad2} />
                        <NavItem id="portfolio" label="Portfolio Helper" icon={BookOpen} />
                        <NavItem id="judging" label="Judging Prep" icon={GraduationCap} />
                        <NavItem id="admin" label="Admin Settings" icon={Settings} />
                    </nav>

                    {isConfigured && user && (
                        <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={handleSignOut}
                                className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                            >
                                <LogOut size={20} />
                                <span className="font-medium">Sign Out</span>
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Main Content Area */}
            <main className="flex-1 h-full overflow-hidden relative pt-16 lg:pt-0">
                {/* Sync status for desktop */}
                <div className="hidden lg:block absolute top-4 right-4 z-10">
                    <SyncStatusIndicator />
                </div>

                <div className="h-full w-full overflow-y-auto bg-slate-50 dark:bg-slate-900 p-4 lg:p-6">
                    {activeTab === 'kanban' && (
                        <KanbanBoard
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
                            members={members}
                            teams={teams}
                        />
                    )}
                    {activeTab === 'checklist' && <PreMatchChecklist />}
                    {activeTab === 'scouting' && <ScoutingReports />}
                    {activeTab === 'planner' && <MatchPlanner />}
                    {activeTab === 'portfolio' && <PortfolioAI tasks={tasksForComponents} view="portfolio" />}
                    {activeTab === 'judging' && <PortfolioAI tasks={tasksForComponents} view="judging" />}
                    {activeTab === 'admin' && (
                        <AdminSettings
                            members={members}
                            setMembers={setMembers}
                            teams={teams}
                            setTeams={setTeams}
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
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 animate-pulse">
                        B
                    </div>
                    <p className="text-slate-400">Loading...</p>
                </div>
            </div>
        );
    }

    return (
        <Routes>
            <Route path="/login" element={
                // If already logged in (or demo mode), redirect to dashboard
                !isConfigured || user ? <Navigate to="/" replace /> : <LoginPage />
            } />

            <Route path="/auth/callback" element={
                // OAuth callback handling
                <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 animate-pulse">
                            B
                        </div>
                        <p className="text-slate-400">Completing sign in...</p>
                    </div>
                </div>
            } />

            <Route path="/*" element={
                // Main app - accessible in demo mode or when authenticated
                !isConfigured || user ? <Dashboard /> : <Navigate to="/login" replace />
            } />
        </Routes>
    );
}

export default App;
