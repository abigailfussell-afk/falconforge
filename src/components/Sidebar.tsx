import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Sun, Moon, LogOut, User, ChevronDown, ArrowRightLeft, Menu, X, MessageSquare } from 'lucide-react';
import SyncStatusIndicator from './SyncStatusIndicator';
import { useFeedbackLink } from '../lib/use-feedback-link';
import Wordmark from './Wordmark';
import { useAuth } from '../lib/auth';
import { useAppStore } from '../lib/store';
import { useSeasonScoped } from '../lib/season-scope';
import { navViewsFor, pathFor } from '../lib/navigation';

/**
 * The navigation, once.
 *
 * WHAT THIS REPLACED
 *
 * There were two Sidebars in this file: a `hidden lg:flex` rail and a `lg:hidden` fixed
 * overlay, each with its own copy of the nav list, its own season `<select>`, its own theme
 * toggle, its own user card and its own team switcher. Ten-ish controls, rendered twice, with
 * two sets of test ids — and they had drifted: the rail grouped the nav with separators and
 * the drawer did not, the rail's sign-out carried `title="Sign out"` and the drawer's did not.
 * Every label in the app appeared twice in the DOM, which is the only reason
 * `Dashboard.test.tsx` had to assert `getAllByText(...).length > 0`; those assertions are
 * `getByText` now, and that tightening is the real proof this rewrite worked.
 *
 * ONE ELEMENT, TWO PRESENTATIONS. The `<aside>` below is a single instance. At `lg` it is a
 * static rail in the flex row; below `lg` it is a fixed off-canvas drawer that slides in. The
 * nav list, the season picker and the footer are written once and rendered once — the
 * breakpoint changes where the panel sits, not what is inside it.
 *
 * THE SEASON PICKER IS NOT OPTIONAL AT ANY WIDTH. It is the only season control in the entire
 * app: rollover, archival and read-only browsing of a prior season are all reachable only
 * through it. Losing it below `lg` would make last season unreachable on a phone at a
 * competition, which is the exact venue this app exists for. Because there is now one picker
 * rather than two, that property holds by construction instead of by remembering.
 */
interface SidebarProps {
    /** Mirrors the server's `can_manage_roster` capability: the admin or a coach. */
    canManageTeam: boolean;
    /** Platform operator — reveals the operator view. UX only; the route self-gates. */
    isOperator?: boolean;
    /**
     * Holds a managed child profile — reveals "My children".
     *
     * Defaults to false so that adding this view did not change what any existing caller
     * renders, for the same reason `isOperator` does: `Dashboard.test.tsx` asserts every nav
     * entry appears EXACTLY ONCE, which is the only thing standing between this app and the
     * duplicated-sidebar problem Sprint 5 deleted.
     */
    isGuardian?: boolean;
    onSignOut: () => void;
    onSwitchTeam: () => void;
}

export default function Sidebar({
    canManageTeam,
    isOperator = false,
    isGuardian = false,
    onSignOut,
    onSwitchTeam,
}: SidebarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const location = useLocation();
    const { user, isConfigured } = useAuth();
    // Built from what the app knows now — route, queue depth, whether the server is
    // answering — rather than from a constant fixed when the module loaded (OPS-05).
    const feedbackLink = useFeedbackLink();

    const theme = useAppStore((s) => s.theme);
    const setTheme = useAppStore((s) => s.setTheme);
    const seasons = useAppStore((s) => s.seasons);
    const currentSeasonId = useAppStore((s) => s.currentSeasonId);
    const setCurrentSeason = useAppStore((s) => s.setCurrentSeason);
    const teams = useAppStore((s) => s.teams);
    const currentTeamId = useAppStore((s) => s.currentTeamId);
    const allTasks = useAppStore((s) => s.tasks);

    // `useSeasonScoped` rather than an inline `t.seasonId === currentSeasonId`: the progress
    // meter below counts this season's work, and six copies of that filter were deleted in
    // Sprint 4 for good reason.
    const tasks = useSeasonScoped(allTasks);
    const currentTeam = teams.find((t) => t.id === currentTeamId);
    // `!!currentTeamId` — a guardian has none, and every team view would be an empty screen.
    const views = navViewsFor(canManageTeam, isOperator, isGuardian, !!currentTeamId);

    const doneCount = tasks.filter((t) => t.status === 'Done').length;
    const donePercent = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;

    // Close the drawer whenever the route changes. This covers the nav links, the profile
    // link, and the Dashboard tiles that navigate from inside the main region — every one of
    // which used to need its own `setIsMobileMenuOpen(false)` call, and one of which
    // (the drawer's Edit Profile) was the only one that had it.
    useEffect(() => {
        setIsOpen(false);
    }, [location.pathname]);

    // Escape closes the drawer. A full-screen overlay with no keyboard dismissal is a trap
    // for anyone using a Bluetooth keyboard on a tablet, which is a normal setup in a pit.
    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen]);

    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        `w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
            isActive
                ? 'bg-forge-50 dark:bg-forge-900/20 text-forge-600 dark:text-forge-400 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-slate-200 font-medium'
        }`;

    return (
        <>
            {/* App bar — below `lg` only. Deliberately thin: the hamburger, the mark, and the
                sync state. Sync is the one thing worth seeing without opening anything, because
                "did my scouting report upload" is the question people actually have at a venue. */}
            <header
                data-testid="mobile-header"
                className="lg:hidden fixed top-0 inset-x-0 h-header bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-2 z-30 safe-area-top"
            >
                <button
                    data-testid="mobile-menu-button"
                    onClick={() => setIsOpen(true)}
                    className="touch-target p-2 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                    aria-label="Open navigation menu"
                    aria-expanded={isOpen}
                >
                    <Menu size={20} />
                </button>
                <Wordmark size="sm" logo />
                <div className="px-2">
                    <SyncStatusIndicator variant="icon" />
                </div>
            </header>

            {/* Scrim. Below `lg` only, and only while the drawer is open. */}
            {isOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40"
                    onClick={() => setIsOpen(false)}
                    aria-hidden="true"
                />
            )}

            <aside
                data-testid="sidebar"
                aria-label="Main navigation"
                className={`fixed lg:static inset-y-0 left-0 z-50 w-72 lg:w-56 shrink-0 flex flex-col
                    bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700
                    safe-area-top transition-transform duration-200 ease-out lg:transition-none
                    ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
            >
                <div className="flex items-center justify-between gap-2 px-3 h-header shrink-0 border-b border-slate-100 dark:border-slate-700">
                    <Wordmark size="md" logo />
                    <button
                        data-testid="mobile-menu-close"
                        onClick={() => setIsOpen(false)}
                        className="lg:hidden touch-target p-2 -mr-1 text-slate-500 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                        aria-label="Close navigation menu"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* The one season picker. */}
                <div className="px-3 pt-3">
                    <label
                        htmlFor="season-selector"
                        className="text-2xs font-bold text-slate-400 uppercase tracking-wider mb-1 block"
                    >
                        Season
                    </label>
                    <div className="relative">
                        <select
                            id="season-selector"
                            data-testid="season-selector"
                            value={currentSeasonId || ''}
                            onChange={(e) => setCurrentSeason(e.target.value)}
                            className="w-full appearance-none bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg pl-2.5 pr-7 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                        >
                            {seasons.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                    {s.isArchived ? ' (archived)' : ''}
                                </option>
                            ))}
                        </select>
                        <ChevronDown
                            size={14}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                        />
                    </div>
                </div>

                {/*
                 * Nav and footer share ONE scroll region, with the nav first.
                 *
                 * They used to be siblings: `<nav className="flex-1 scroll-region">` and a
                 * `shrink-0` footer. That gives the footer its full height unconditionally and
                 * makes the NAV absorb every shortfall — so with a phone keyboard open
                 * (~375x350) the navigation was a 24px scrolling sliver underneath a
                 * full-size progress meter and two profile cards. Sharing one scroller and
                 * pushing the footer down with `mt-auto` keeps it pinned to the bottom when
                 * there is room, and lets it scroll off the end when there is not — so the
                 * thing you opened the drawer FOR is the thing you see first.
                 */}
                <div className="flex-1 min-h-0 scroll-region flex flex-col">
                <nav data-testid="app-nav" className="p-3 space-y-0.5">
                    {views.map((view) => (
                        <div key={view.id}>
                            {view.startsGroup && (
                                <div className="my-2 border-t border-slate-100 dark:border-slate-700" />
                            )}
                            <NavLink
                                data-testid={`nav-${view.id}`}
                                to={pathFor(view.id)}
                                className={navLinkClass}
                            >
                                <view.icon size={17} className="shrink-0" />
                                <span className="truncate">{view.label}</span>
                            </NavLink>
                        </div>
                    ))}
                </nav>

                {/* `pb-3` as well as `safe-area-bottom`: the safe-area rule sits outside
                    Tailwind's utilities layer and overrides padding rather than adding to it,
                    so this is the gutter a browser gets when the `@supports` test fails. */}
                <div className="mt-auto px-3 pt-0 pb-3 space-y-2 safe-area-bottom">
                    {/* The progress meter is the first thing to go when the viewport is short
                        — see `.hide-when-short` in index.css. With a phone keyboard open this
                        footer was crowding the nav out of its own drawer. */}
                    <div className="hide-when-short bg-slate-100 dark:bg-slate-700/60 rounded-lg px-3 py-2">
                        <div className="flex justify-between items-baseline text-xs text-slate-600 dark:text-slate-300">
                            <span className="font-medium">Tasks Done</span>
                            <span className="font-bold tabular-nums">
                                {doneCount}
                                <span className="text-slate-400 dark:text-slate-300">/{tasks.length}</span>
                            </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-1 mt-1.5">
                            <div
                                className="bg-green-500 h-1 rounded-full transition-[width] duration-300"
                                style={{ width: `${donePercent}%` }}
                            />
                        </div>
                    </div>

                    {isConfigured && user && (
                        <>
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                <div className="w-7 h-7 bg-forge-100 dark:bg-forge-900/50 rounded-full flex items-center justify-center shrink-0">
                                    <User size={14} className="text-forge-600 dark:text-forge-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p
                                        data-testid="user-display-name"
                                        className="text-xs font-bold text-slate-900 dark:text-white truncate"
                                    >
                                        {user.user_metadata?.full_name || user.email}
                                    </p>
                                    <NavLink
                                        data-testid="edit-profile-button"
                                        to={pathFor('profile')}
                                        className="text-2xs text-slate-500 hover:text-forge-600 dark:text-slate-400 dark:hover:text-forge-400 font-medium transition-colors"
                                    >
                                        Edit Profile
                                    </NavLink>
                                </div>
                                <button
                                    data-testid="sign-out-button"
                                    onClick={onSignOut}
                                    className="touch-target p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                    title="Sign out"
                                    aria-label="Sign out"
                                >
                                    <LogOut size={15} />
                                </button>
                            </div>

                            <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
                                <div className="w-7 h-7 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                                    <span className="text-2xs font-bold text-slate-500 dark:text-slate-300">
                                        {currentTeam?.teamNumber ? `#${currentTeam.teamNumber.slice(0, 2)}` : 'T'}
                                    </span>
                                </div>
                                <p
                                    data-testid="team-display-name"
                                    className="flex-1 min-w-0 text-xs font-medium text-slate-900 dark:text-white truncate"
                                >
                                    {currentTeam?.name || 'Select Team'}
                                </p>
                                <button
                                    data-testid="switch-team-button"
                                    onClick={onSwitchTeam}
                                    className="touch-target p-1.5 text-slate-400 hover:text-forge-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                    title="Switch team"
                                    aria-label="Switch team"
                                >
                                    <ArrowRightLeft size={15} />
                                </button>
                            </div>

                            <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <SyncStatusIndicator variant="full" />
                                </div>
                                <button
                                    data-testid="theme-toggle"
                                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                                    className="touch-target p-2 text-slate-400 hover:text-forge-500 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                                    title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                                    aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                                >
                                    {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                                </button>
                                {/*
                                  * Beta feedback, one click from anywhere in the app.
                                  *
                                  * A mailto rather than a form, deliberately: a form needs an
                                  * endpoint, and the only backend is Supabase, so it would mean a
                                  * table anyone may INSERT into -- an unauthenticated write on the
                                  * database holding every team's data. For a beta of a handful of
                                  * teams, the coach's own mail client is the right amount of
                                  * machinery, and it carries their address so a reply is possible.
                                  *
                                  * The subject is pre-filled with the app version so a report
                                  * arrives attached to a build rather than to "last Tuesday".
                                  */}
                                <a
                                    data-testid="feedback-link"
                                    href={feedbackLink}
                                    className="touch-target p-2 text-slate-400 hover:text-forge-500 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                                    title="Send feedback about the beta"
                                    aria-label="Send feedback about the beta"
                                >
                                    <MessageSquare size={15} />
                                </a>
                            </div>
                        </>
                    )}
                </div>
                </div>
            </aside>
        </>
    );
}
