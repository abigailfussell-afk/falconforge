import {
    LayoutDashboard,
    ClipboardCheck,
    Gamepad2,
    CheckSquare,
    TrendingUp,
    PlusCircle,
    ArrowRight,
    Activity,
    CalendarClock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import EmptyState from './ui/EmptyState';
import Button from './ui/Button';
import { useAppStore, useStoreHydrated } from '../lib/store';
import { useSeasonScoped } from '../lib/season-scope';
import { sprintProgress } from '../lib/sprint-progress';
import { useAuth } from '../lib/auth';
import { pathFor } from '../lib/navigation';
import MeetingWidget from './meetings/MeetingWidget';
import OpenCheckIns from './meetings/OpenCheckIns';
import { dateOnlyDay, dateOnlyMonthShort, todayAsDateOnly } from '../lib/date-only';

export default function DashboardHome() {
    const { user } = useAuth();
    const navigate = useNavigate();

    // Was `setActiveTab(id)`, a prop threaded down from the tab switch. The tiles below name
    // the same view ids they always did; `pathFor` turns one into the route it now has, so
    // the dashboard's shortcuts produce real history entries and a back button that works.
    const goTo = (id: string) => navigate(pathFor(id));
    const { tasks: allTasks, matchPlans: allMatchPlans, scoutingReports: allScoutingReports } = useAppStore();

    // One definition of "belongs to the season on screen", shared with App and MatchPlanner.
    const tasks = useSeasonScoped(allTasks);
    const matchPlans = useSeasonScoped(allMatchPlans);
    const scoutingReports = useSeasonScoped(allScoutingReports);

    const firstName = user?.user_metadata?.full_name?.split(' ')[0] || 'Team Member';

    /**
     * "Welcome back" is a claim, and on the first screen a new coach ever sees it is false
     * (WALK-B-06).
     *
     * The header greeted everybody with `Welcome back, Pat! 👋` and `You have 0 open tasks for
     * this sprint` — above four stat tiles reading zero, on a team created ninety seconds
     * earlier. It is the first sentence FalconForge says to a coach and it is about a visit
     * that never happened.
     *
     * THE TEST IS THE TEAM'S CONTENT, NOT A CLOCK. The fix direction offered "team created < N
     * minutes ago" as an alternative, and `docs/failure-modes.md` §10 is four sprints of
     * defects from deriving behaviour from wall-clock arithmetic — a coach who comes back after
     * lunch on day one would get "welcome back" over the same four zeros. Whether the team has
     * any work in it is the thing the sentence is actually wrong about, and it needs no clock.
     *
     * The three collections are the ones the four stat tiles count. The pre-match checklist is
     * deliberately NOT one of them: every team is seeded with eight checklist items at
     * creation (B20), so counting it would make every team look used from the first second.
     *
     * HYDRATING IS NOT EMPTY, AND NEITHER IS PULLING (§4). Two different kinds of "not yet",
     * and the first version of this fix only handled one.
     *
     *   - Before IndexedDB has rehydrated, every collection is `[]`.
     *   - On a device that has never seen this team — a new laptop, a cleared browser, the
     *     shared pit tablet — rehydration finishes instantly with nothing in it and the data
     *     arrives from the SERVER a moment later.
     *
     * The second was found by running the app, not by the five tests written for the first:
     * signing in on a cold device and sampling the header every 100 ms showed the new-team copy
     * at 102 ms and "Welcome back" at 212 ms. A tenth of a second on localhost is a wink; the
     * same window on venue wifi is the whole of a coach's first impression, and what it says is
     * "Nothing has been added yet" to a team with a season of work in it.
     *
     * `isLoading` is set for the duration of `fetchTeamData` (`server-pull.ts`), so it is the
     * pull's own signal rather than a timer or a guess.
     */
    const hydrated = useStoreHydrated();
    const isPulling = useAppStore((s) => s.isLoading);
    const hasAnyWork =
        tasks.length > 0 || scoutingReports.length > 0 || matchPlans.length > 0;
    const greetingState: 'loading' | 'new' | 'returning' = !hydrated || isPulling
        ? 'loading'
        : hasAnyWork
            ? 'returning'
            : 'new';

    /*
     * ONE definition of progress, shared with the sidebar (FEAT-09). This side of the pair was
     * the correct one and it stays the correct one; what changed is that there is now only one
     * place that says what "in the sprint" means.
     */
    const progress = sprintProgress(tasks);
    const backlogCount = tasks.filter(t => t.status === 'Backlog').length;

    const stats = [
        { label: 'Sprint Progress', value: `${progress.done} / ${progress.total}`, icon: CheckSquare, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', link: 'kanban' },
        { label: 'Backlog Items', value: backlogCount, icon: LayoutDashboard, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', link: 'kanban' },
        { label: 'Scouting Reports', value: scoutingReports.length, icon: ClipboardCheck, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20', link: 'scouting' },
        { label: 'Match Plans', value: matchPlans.length, icon: Gamepad2, color: 'text-forge-600', bg: 'bg-forge-50 dark:bg-forge-900/20', link: 'planner' },
    ];

    const quickActions = [
        { id: 'kanban', label: 'Sprint Planning', desc: 'Track your team\'s progress', icon: LayoutDashboard, color: 'bg-blue-500' },
        { id: 'checklist', label: 'Pre-Match Checklist', desc: 'Always be competition ready', icon: CheckSquare, color: 'bg-teal-500' },
        { id: 'scouting', label: 'Scouting Reports', desc: 'Know your competition', icon: ClipboardCheck, color: 'bg-green-500' },
        { id: 'planner', label: 'Match Planner', desc: 'Plan with your allies', icon: Gamepad2, color: 'bg-forge-500' },
    ];

    // Get 3 most recent activities
    const recentActivity = [
        ...matchPlans.map(p => ({ type: 'plan', title: p.title, date: p.updatedAt, id: p.id })),
        ...scoutingReports.map(r => ({ type: 'scout', title: `Team ${r.teamNumber}`, date: r.createdAt || 0, id: r.id })),
        ...tasks.map(t => ({ type: 'task', title: t.title, date: t.createdAt, id: t.id }))
    ].sort((a, b) => b.date - a.date).slice(0, 5);

    const openCount = tasks.filter(t => ['To Do', 'In Progress', 'Testing'].includes(t.status)).length;

    // The next five dated, unfinished tasks. This panel exists because the dashboard used
    // to end after Quick Actions — the lower two-thirds of a desktop screen was empty while
    // the one thing a team actually plans around (what's due) lived two clicks away.
    const upcomingDeadlines = tasks
        .filter(t => t.dueDate && t.status !== 'Done')
        .sort((a, b) => (a.dueDate || 0) - (b.dueDate || 0))
        .slice(0, 5);
    /*
     * Compared against a DATE-ONLY value, so it has to be one (FEAT-12).
     *
     * `new Date().setHours(0,0,0,0)` is local midnight, and a due date is UTC midnight of the
     * day chosen. At a negative offset those are five or six hours apart, which made "overdue"
     * wrong by up to a day in both directions on the panel whose whole job is saying what is
     * late.
     */
    const startOfToday = todayAsDateOnly();

    return (
        <div className="space-y-4">
            {/* Header / Welcome */}
            <div className="relative overflow-hidden bg-gradient-to-r from-forge-600 to-forge-500 rounded-2xl px-5 py-4 text-white shadow-raised">
                <div className="relative z-10">
                    <h1 data-testid="dashboard-greeting" className="text-xl sm:text-2xl font-bold mb-0.5">
                        {greetingState === 'returning' ? 'Welcome back' : 'Welcome'}, {firstName}! 👋
                    </h1>
                    <p data-testid="dashboard-greeting-sub" className="text-forge-100 text-sm opacity-90 max-w-prose">
                        {greetingState === 'returning' && (
                            <>Your robotics Command Center is ready. You have {openCount} open {openCount === 1 ? 'task' : 'tasks'} for this sprint.</>
                        )}
                        {greetingState === 'new' && (
                            <>Your team is set up and this is its hub. Nothing has been added yet — plan your first sprint below, or{' '}
                                <button
                                    type="button"
                                    onClick={() => goTo('help')}
                                    className="underline underline-offset-2 font-semibold hover:text-white"
                                >
                                    read the getting-started guide
                                </button>.
                            </>
                        )}
                        {greetingState === 'loading' && <>Your robotics Command Center is ready.</>}
                    </p>
                </div>
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 -mr-16 -mt-16 w-56 h-56 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute bottom-0 right-10 w-28 h-28 bg-forge-400/20 rounded-full blur-2xl" />
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {stats.map((stat) => (
                    <button
                        key={stat.label}
                        onClick={() => goTo(stat.link)}
                        className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card text-left hover:shadow-raised hover:border-forge-300 dark:hover:border-forge-600 transition-all"
                    >
                        <div className="flex items-center gap-2 mb-1.5">
                            <div className={`${stat.bg} ${stat.color} p-1.5 rounded-md shrink-0`}>
                                <stat.icon size={15} />
                            </div>
                            {/* Wraps rather than truncates. `truncate` here clipped "SPRINT
                                PROGRESS" and "SCOUTING REPORTS" to "SPRINT PROGR…" on a 375px
                                phone in the two-column grid — a label you cannot read is worse
                                than a tile one line taller. */}
                            <span className="text-2xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider leading-tight">{stat.label}</span>
                        </div>
                        <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stat.value}</div>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Quick Actions */}
                <div className="lg:col-span-2 space-y-2.5">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <PlusCircle size={16} className="text-forge-500" />
                        Quick Actions
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {quickActions.map((action) => (
                            <button
                                key={action.id}
                                onClick={() => goTo(action.id)}
                                className="group relative bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card hover:shadow-raised hover:border-forge-500/50 transition-all text-left overflow-hidden"
                            >
                                <div className="relative z-10 flex items-start gap-3">
                                    <div className={`${action.color} text-white w-9 h-9 rounded-lg flex items-center justify-center shrink-0 shadow-card group-hover:scale-105 transition-transform`}>
                                        <action.icon size={18} />
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{action.label}</h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{action.desc}</p>
                                    </div>
                                </div>
                                <ArrowRight size={16} className="absolute top-3.5 right-3 text-slate-300 dark:text-slate-600 group-hover:text-forge-500 group-hover:translate-x-0.5 transition-all" />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recent Activity, and above it the meetings card (1k).
                    The card renders nothing at all when the team has no upcoming event, so
                    the column keeps its existing shape for a team that does not use the
                    feature rather than gaining an empty box. */}
                <div className="space-y-2.5">
                    {/* Above the next-meeting card: if check-in is open RIGHT NOW that is the
                        most time-sensitive thing on the whole dashboard. Renders nothing when
                        nothing is open, which is most of the time. */}
                    <OpenCheckIns />
                    <MeetingWidget />
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <Activity size={16} className="text-forge-500" />
                        Recent Activity
                    </h2>
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card overflow-hidden">
                        {recentActivity.length > 0 ? (
                            <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                {recentActivity.map((item) => (
                                    <button
                                        key={`${item.type}-${item.id}`}
                                        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                        onClick={() => goTo(item.type === 'plan' ? 'planner' : item.type === 'scout' ? 'scouting' : 'kanban')}
                                    >
                                        <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${item.type === 'plan' ? 'bg-forge-500' :
                                            item.type === 'scout' ? 'bg-green-500' : 'bg-blue-500'
                                            }`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                                                {item.type === 'plan' ? 'Match Plan: ' :
                                                    item.type === 'scout' ? 'Scouting: ' : 'Task: '}
                                                {item.title}
                                            </p>
                                            <p className="text-2xs text-slate-500 dark:text-slate-400">
                                                {new Date(item.date).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="px-4 py-8 text-center">
                                <TrendingUp className="mx-auto text-slate-300 dark:text-slate-600 mb-2" size={26} />
                                <p className="text-xs text-slate-500 dark:text-slate-400">No activity yet. Start by adding a task or scouting report!</p>
                            </div>
                        )}
                        <div className="px-3 py-2 bg-slate-50 dark:bg-slate-700/50 border-t border-slate-100 dark:border-slate-700">
                            <button
                                onClick={() => goTo('kanban')}
                                className="w-full text-center text-2xs font-bold text-forge-600 dark:text-forge-400 hover:underline"
                            >
                                View all project updates
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Upcoming Deadlines */}
            <div className="space-y-2.5">
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <TrendingUp size={16} className="text-forge-500" />
                    Upcoming Deadlines
                </h2>
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card divide-y divide-slate-100 dark:divide-slate-700">
                    {upcomingDeadlines.length === 0 ? (
                        /*
                         * The panel used to disappear entirely when it had nothing to show, which
                         * put the dashboard's lower two-thirds straight back to the dead space
                         * this panel was added to fill -- and it did so for exactly the teams
                         * that see it first. A brand-new team has no tasks by definition, so
                         * every beta team's first impression was the state with the hole in it.
                         *
                         * Recent Activity, directly above, already had an empty state; this is
                         * the same screen disagreeing with itself.
                         *
                         * The two ways of being empty are not the same question, so they do not
                         * get the same sentence: a team with no tasks needs somewhere to go, and
                         * a team whose tasks simply carry no dates needs to know that is why.
                         */
                        <EmptyState
                            icon={CalendarClock}
                            title={allTasks.length === 0 ? 'No tasks yet' : 'Nothing due'}
                            body={
                                allTasks.length === 0
                                    ? 'Tasks with a due date show up here, soonest first, so the team can see what is coming.'
                                    : 'None of your open tasks have a due date. Add one and it will appear here, soonest first.'
                            }
                            action={
                                <Button size="sm" onClick={() => goTo('kanban')}>
                                    {allTasks.length === 0 ? 'Plan your first sprint' : 'Open Sprint Planning'}
                                </Button>
                            }
                        />
                    ) : (
                        upcomingDeadlines.map(task => {
                            const overdue = (task.dueDate || 0) < startOfToday;
                            return (
                                <button
                                    key={task.id}
                                    onClick={() => goTo('kanban')}
                                    className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                                >
                                    <span
                                        className={`flex flex-col items-center justify-center w-10 shrink-0 rounded-lg py-1 tabular-nums ${
                                            overdue
                                                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                        }`}
                                    >
                                        <span className="text-2xs uppercase font-bold leading-none">
                                            {dateOnlyMonthShort(task.dueDate!)}
                                        </span>
                                        <span className="text-base font-bold leading-tight">{dateOnlyDay(task.dueDate!)}</span>
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-medium text-slate-900 dark:text-white truncate">{task.title}</span>
                                        <span className={`block text-2xs ${overdue ? 'text-red-500 font-semibold' : 'text-slate-500 dark:text-slate-400'}`}>
                                            {overdue ? 'Overdue' : task.status}
                                        </span>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
