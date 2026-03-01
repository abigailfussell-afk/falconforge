import { LayoutDashboard, CheckSquare, Gamepad2, BookOpen, Sun, Moon, Settings, ClipboardCheck, GraduationCap, LogOut, User, Activity, ChevronDown, ArrowRightLeft, Menu, X } from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import SyncStatusIndicator from './SyncStatusIndicator';
import type { Task, Season } from '../lib/store';
import type { Team } from '../types';

interface SidebarProps {
    activeTab: string;
    setActiveTab: (tab: string) => void;
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (open: boolean) => void;
    isCoach: boolean;
    user: SupabaseUser | null;
    isConfigured: boolean;
    onSignOut: () => void;
    onSwitchTeam: () => void;
    theme: 'light' | 'dark';
    setTheme: (theme: 'light' | 'dark') => void;
    tasks: Task[];
    seasons: Season[];
    currentSeasonId: string | null;
    setCurrentSeason: (id: string) => void;
    teams: Team[];
    currentTeamId: string | null;
}

export default function Sidebar({
    activeTab,
    setActiveTab,
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    isCoach,
    user,
    isConfigured,
    onSignOut,
    onSwitchTeam,
    theme,
    setTheme,
    tasks,
    seasons,
    currentSeasonId,
    setCurrentSeason,
    teams,
    currentTeamId,
}: SidebarProps) {
    const NavItem = ({ id, label, icon: Icon }: { id: string; label: string; icon: any }) => (
        <button
            data-testid={`nav-${id}`}
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

    const currentTeam = teams.find(t => t.id === currentTeamId);

    return (
        <>
            {/* Desktop Sidebar */}
            <aside data-testid="desktop-sidebar" className="hidden lg:flex w-64 flex-col bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 h-full">
                <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-12 h-12 object-contain" alt="FalconForge Logo" />
                    <h1 className="text-xl font-black italic tracking-tighter bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent drop-shadow-sm">FALCON<span className="text-slate-700 dark:text-slate-300">FORGE</span></h1>
                </div>

                {/* Season Selector */}
                <div className="px-4 pt-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Season</label>
                    <div className="relative">
                        <select
                            data-testid="season-selector"
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

                <nav data-testid="desktop-nav" className="flex-1 p-4 overflow-y-auto">
                    <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                    <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                    <NavItem id="kanban" label="Sprint Planning" icon={Activity} />
                    <NavItem id="checklist" label="Pre-Match Checklist" icon={CheckSquare} />
                    <NavItem id="scouting" label="Scouting Reports" icon={ClipboardCheck} />
                    <NavItem id="planner" label="Match Planner" icon={Gamepad2} />
                    <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                    <NavItem id="portfolio" label="Portfolio Helper" icon={BookOpen} />
                    <NavItem id="judging" label="Judging Prep" icon={GraduationCap} />
                    {isCoach && (
                        <>
                            <div className="my-4 border-t border-slate-100 dark:border-slate-700"></div>
                            <NavItem id="admin" label="Admin Settings" icon={Settings} />
                        </>
                    )}
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
                            {/* User Profile - Compact Layout */}
                            <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 rounded-full flex items-center justify-center flex-shrink-0">
                                    <User size={16} className="text-orange-600 dark:text-orange-400" />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-center">
                                    <p data-testid="user-display-name" className="text-sm font-bold text-slate-900 dark:text-white truncate leading-none mb-0.5">
                                        {user.user_metadata?.full_name || user.email}
                                    </p>
                                    <button
                                        data-testid="edit-profile-button"
                                        onClick={() => setActiveTab('profile')}
                                        className="text-[10px] text-left text-slate-500 hover:text-orange-600 dark:text-slate-400 dark:hover:text-orange-400 font-medium transition-colors"
                                    >
                                        Edit Profile
                                    </button>
                                </div>
                                <button
                                    data-testid="sign-out-button"
                                    onClick={onSignOut}
                                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                                    title="Sign out"
                                >
                                    <LogOut size={16} />
                                </button>
                            </div>

                            {/* Team Switcher */}
                            <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                                <div className="w-8 h-8 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {currentTeam?.teamNumber ? `#${currentTeam.teamNumber.slice(0, 2)}` : 'T'}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p data-testid="team-display-name" className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                        {currentTeam?.name || 'Select Team'}
                                    </p>
                                </div>
                                <button
                                    data-testid="switch-team-button"
                                    onClick={onSwitchTeam}
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
                                    data-testid="theme-toggle"
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

            {/* Mobile/Tablet Header */}
            <div data-testid="mobile-header" className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 z-20 safe-area-top">
                <div className="flex items-center gap-2">
                    <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-12 h-12 object-contain" alt="FalconForge Logo" />
                    <span className="font-black text-lg italic tracking-tighter"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-700 dark:text-slate-300">FORGE</span></span>
                </div>
                <div className="flex items-center gap-3">
                    <SyncStatusIndicator variant="icon" />
                    <button data-testid="mobile-theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="p-2 text-slate-600 dark:text-slate-300">
                        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                    </button>
                    <button data-testid="mobile-menu-button" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-600 dark:text-slate-300">
                        {isMobileMenuOpen ? <X /> : <Menu />}
                    </button>
                </div>
            </div>

            {/* Mobile/Tablet Menu Overlay */}
            {isMobileMenuOpen && (
                <div data-testid="mobile-menu" className="lg:hidden fixed inset-0 bg-white dark:bg-slate-800 z-50 pt-4 px-4 safe-area-top overflow-y-auto flex flex-col">
                    <div className="flex items-center justify-between mb-6 px-2">
                        <div className="flex items-center gap-2">
                            <img src={`${import.meta.env.BASE_URL}falcon_logo.png`} className="w-10 h-10 object-contain" alt="FalconForge Logo" />
                            <span className="font-black text-xl italic tracking-tighter"><span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">FALCON</span><span className="text-slate-700 dark:text-slate-300">FORGE</span></span>
                        </div>
                        <button
                            data-testid="mobile-menu-close"
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
                                data-testid="mobile-season-selector"
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

                    <nav data-testid="mobile-nav" className="space-y-2">
                        <NavItem id="dashboard" label="Dashboard" icon={LayoutDashboard} />
                        <NavItem id="kanban" label="Sprint Planning" icon={Activity} />
                        <NavItem id="checklist" label="Pre-Match Checklist" icon={CheckSquare} />
                        <NavItem id="scouting" label="Scouting Reports" icon={ClipboardCheck} />
                        <NavItem id="planner" label="Match Planner" icon={Gamepad2} />
                        <NavItem id="portfolio" label="Portfolio Helper" icon={BookOpen} />
                        <NavItem id="judging" label="Judging Prep" icon={GraduationCap} />
                        {isCoach && <NavItem id="admin" label="Admin Settings" icon={Settings} />}
                    </nav>

                    {isConfigured && user && (
                        <div className="mt-auto pt-4 border-t border-slate-200 dark:border-slate-700 space-y-2 pb-4">
                            {/* Mobile User Profile Link */}
                            <button
                                data-testid="mobile-edit-profile"
                                onClick={() => { setActiveTab('profile'); setIsMobileMenuOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl transition-all"
                            >
                                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/50 rounded-full flex items-center justify-center">
                                    <User size={16} className="text-orange-600 dark:text-orange-400" />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-xs text-slate-400 dark:text-slate-500">Signed in as</p>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {user.user_metadata?.full_name || user.email}
                                    </p>
                                </div>
                                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">Edit Profile</span>
                            </button>

                            {/* Mobile Team Switcher */}
                            <button
                                data-testid="mobile-switch-team"
                                onClick={() => { onSwitchTeam(); setIsMobileMenuOpen(false); }}
                                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-100 dark:bg-slate-700 rounded-xl transition-all"
                            >
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-xs text-slate-400 dark:text-slate-500">
                                        {currentTeam?.teamNumber ? `#${currentTeam.teamNumber}` : 'Team'}
                                    </p>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                                        {currentTeam?.name || 'Select Team'}
                                    </p>
                                </div>
                                <ArrowRightLeft size={16} className="text-slate-400" />
                            </button>

                            <button
                                data-testid="mobile-sign-out"
                                onClick={onSignOut}
                                className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                            >
                                <LogOut size={20} />
                                <span className="font-medium">Sign Out</span>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
