import {
    LayoutDashboard,
    ClipboardCheck,
    Gamepad2,
    CheckSquare,
    Sparkles,
    TrendingUp,
    PlusCircle,
    ArrowRight,
    Activity
} from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { AI_FEATURES_ENABLED } from '../constants';

interface DashboardHomeProps {
    setActiveTab: (tab: string) => void;
}

export default function DashboardHome({ setActiveTab }: DashboardHomeProps) {
    const { user } = useAuth();
    const { tasks: allTasks, matchPlans: allMatchPlans, scoutingReports: allScoutingReports, currentSeasonId } = useAppStore();

    // Filter data by current season
    const tasks = allTasks.filter(t => !t.seasonId || t.seasonId === currentSeasonId);
    const matchPlans = allMatchPlans.filter(p => !p.seasonId || p.seasonId === currentSeasonId);
    const scoutingReports = allScoutingReports.filter(r => !r.seasonId || r.seasonId === currentSeasonId);

    const firstName = user?.user_metadata?.full_name?.split(' ')[0] || 'Team Member';

    // Calculate sprint metrics
    const doneCount = tasks.filter(t => t.status === 'Done').length;
    const activeStatuses = ['To Do', 'In Progress', 'Testing', 'Done'];
    const activeTotalCount = tasks.filter(t => activeStatuses.includes(t.status)).length;
    const backlogCount = tasks.filter(t => t.status === 'Backlog').length;

    const stats = [
        { label: 'Sprint Progress', value: `${doneCount} / ${activeTotalCount}`, icon: CheckSquare, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', link: 'kanban' },
        { label: 'Backlog Items', value: backlogCount, icon: LayoutDashboard, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', link: 'kanban' },
        { label: 'Scouting Reports', value: scoutingReports.length, icon: ClipboardCheck, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', link: 'scouting' },
        { label: 'Match Plans', value: matchPlans.length, icon: Gamepad2, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', link: 'planner' },
    ];

    const allQuickActions = [
        { id: 'kanban', label: 'Sprint Planning', desc: 'Track your team\'s progress', icon: LayoutDashboard, color: 'bg-blue-500' },
        { id: 'checklist', label: 'Pre-Match Checklist', desc: 'Always be competition ready', icon: CheckSquare, color: 'bg-teal-500' },
        { id: 'scouting', label: 'Scouting Reports', desc: 'Know your competition', icon: ClipboardCheck, color: 'bg-green-500' },
        { id: 'planner', label: 'Match Planner', desc: 'Plan with your allies', icon: Gamepad2, color: 'bg-orange-500' },
        { id: 'portfolio', label: 'Portfolio Helper', desc: 'Summarize your team\'s accomplishments', icon: Sparkles, color: 'bg-pink-500', ai: true },
        { id: 'judging', label: 'Judging Prep', desc: 'Be ready to answer any question', icon: Sparkles, color: 'bg-purple-500', ai: true },
    ];
    const quickActions = AI_FEATURES_ENABLED ? allQuickActions : allQuickActions.filter(a => !a.ai);

    // Get 3 most recent activities
    const recentActivity = [
        ...matchPlans.map(p => ({ type: 'plan', title: p.title, date: p.updatedAt, id: p.id })),
        ...scoutingReports.map(r => ({ type: 'scout', title: `Team ${r.teamNumber}`, date: r.createdAt || 0, id: r.id })),
        ...tasks.map(t => ({ type: 'task', title: t.title, date: t.createdAt, id: t.id }))
    ].sort((a, b) => b.date - a.date).slice(0, 5);

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header / Welcome */}
            <div className="relative overflow-hidden bg-gradient-to-r from-orange-600 to-orange-500 rounded-3xl p-8 text-white shadow-xl">
                <div className="relative z-10">
                    <h1 className="text-3xl md:text-4xl font-bold mb-2">Welcome back, {firstName}! 👋</h1>
                    <p className="text-orange-100 text-lg opacity-90 max-w-xl">
                        Your robotics Command Center is ready. You have {tasks.filter(t => ['To Do', 'In Progress', 'Testing'].includes(t.status)).length} open tasks for this sprint.
                    </p>
                </div>
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-white/10 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 right-10 w-32 h-32 bg-orange-400/20 rounded-full blur-2xl"></div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {stats.map((stat, i) => (
                    <div
                        key={i}
                        onClick={() => setActiveTab(stat.link)}
                        className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer hover:shadow-md hover:border-orange-300 dark:hover:border-orange-600 transition-all"
                    >
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`${stat.bg} ${stat.color} p-2 rounded-lg`}>
                                <stat.icon size={18} />
                            </div>
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{stat.label}</span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Quick Actions */}
                <div className="lg:col-span-2 space-y-4">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <PlusCircle size={20} className="text-orange-500" />
                        Quick Actions
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {quickActions.map((action, i) => (
                            <button
                                key={i}
                                onClick={() => setActiveTab(action.id)}
                                className="group relative bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-orange-500/50 transition-all text-left overflow-hidden"
                            >
                                <div className="relative z-10">
                                    <div className={`${action.color} text-white w-12 h-12 rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                                        <action.icon size={24} />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1">{action.label}</h3>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">{action.desc}</p>
                                </div>
                                <ArrowRight className="absolute top-6 right-6 text-slate-300 dark:text-slate-600 group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
                                <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-slate-50 dark:bg-slate-700/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="space-y-4">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity size={20} className="text-orange-500" />
                        Recent Activity
                    </h2>
                    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden text-sm">
                        {recentActivity.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                {recentActivity.map((item, i) => (
                                    <div
                                        key={i}
                                        className="p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                                        onClick={() => setActiveTab(item.type === 'plan' ? 'planner' : item.type === 'scout' ? 'scouting' : 'kanban')}
                                    >
                                        <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${item.type === 'plan' ? 'bg-orange-500' :
                                            item.type === 'scout' ? 'bg-green-500' : 'bg-blue-500'
                                            }`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-slate-900 dark:text-white truncate">
                                                {item.type === 'plan' ? 'Match Plan: ' :
                                                    item.type === 'scout' ? 'Scouting: ' : 'Task: '}
                                                {item.title}
                                            </p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                {new Date(item.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-8 text-center">
                                <TrendingUp className="mx-auto text-slate-300 mb-2" size={32} />
                                <p className="text-slate-500 dark:text-slate-400">No activity yet. Start by adding a task or scouting report!</p>
                            </div>
                        )}
                        <div className="p-3 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700">
                            <button
                                onClick={() => setActiveTab('kanban')}
                                className="w-full text-center text-xs font-bold text-orange-600 dark:text-orange-400 hover:underline"
                            >
                                View all project updates
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
