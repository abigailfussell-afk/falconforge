import {
    LayoutDashboard,
    Activity,
    CheckSquare,
    ClipboardCheck,
    Gamepad2,
    Settings,
    User,
    Gift,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * The app's views, defined once.
 *
 * WHY THIS FILE EXISTS
 *
 * Until Sprint 5 the navigation existed in three places that had to be kept in agreement by
 * hand: the desktop rail's list of `<NavItem>`s, the mobile drawer's copy of the same list,
 * and `App.tsx`'s chain of `activeTab === '...' &&` expressions. Adding a view meant editing
 * all three, and the drawer had already drifted — the desktop rail put separators around the
 * Dashboard and the Admin group, the drawer did not, and `Dashboard.test.tsx` could only
 * assert `getAllByText(...).length > 0` because every label genuinely appeared twice.
 *
 * Now the rail, the drawer and the route table are three renderings of THIS array. A view
 * added here appears in all three or in none of them, which is the property that makes
 * `getByText` (singular) a meaningful assertion in the test suite.
 *
 * WHY `id` AND `path` ARE BOTH HERE AND DIFFERENT
 *
 * `id` is the internal name a view has always had (`kanban`, `planner`), and it is baked into
 * `data-testid="nav-kanban"` across the suite and into `DashboardHome`'s tiles. `path` is what
 * a person sees in the address bar and puts in a bookmark, so it is spelled the way the plan
 * asks for (`#/app/board`) rather than after the internal name. Renaming the ids to match
 * would have been churn in the tests for no user-visible gain; letting the URL inherit
 * `kanban` would have shipped an internal name to users forever.
 */
export interface AppView {
    /** Stable internal id. Used for `data-testid="nav-<id>"` and by DashboardHome's tiles. */
    id: string;
    /** The URL segment under {@link APP_ROOT}. This is what a bookmark holds. */
    path: string;
    label: string;
    icon: LucideIcon;
    /**
     * Reachable from the sidebar. `profile` is false: it is a real route with a real deep
     * link, but it is reached from the user card rather than from the nav list, and putting
     * it in the rail would push the actual work down a row.
     */
    inNav: boolean;
    /**
     * Mirrors the server's `can_manage_roster` capability (admin or coach).
     *
     * This is UX, not security — hiding a nav item does not stop anyone typing the URL, and
     * it is not supposed to. The route renders its own Access Denied for that case and the
     * database refuses the writes regardless. Both halves are deliberate.
     */
    requiresManage?: boolean;
    /**
     * Mirrors `is_platform_operator()` — the platform's own operator, not a team role.
     *
     * Same status as {@link requiresManage}: UX, not security. The route self-gates by asking
     * the database the same question, and every operator RPC refuses a caller with no operator
     * identity. `platform_operators` ships EMPTY with no API path that can write it, so this
     * cannot be granted from a browser however the nav is rendered.
     */
    requiresOperator?: boolean;
    /** Draw a separator above this item. Groups the board/competition tools apart. */
    startsGroup?: boolean;
}

/** Every app view lives under this prefix, so `/app/*` is one route in the top-level table. */
export const APP_ROOT = '/app';

export const APP_VIEWS: AppView[] = [
    { id: 'dashboard', path: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, inNav: true },
    { id: 'kanban', path: 'board', label: 'Sprint Planning', icon: Activity, inNav: true, startsGroup: true },
    { id: 'checklist', path: 'checklist', label: 'Pre-Match Checklist', icon: CheckSquare, inNav: true },
    { id: 'scouting', path: 'scouting', label: 'Scouting Reports', icon: ClipboardCheck, inNav: true },
    { id: 'planner', path: 'planner', label: 'Match Planner', icon: Gamepad2, inNav: true },
    { id: 'admin', path: 'admin', label: 'Admin Settings', icon: Settings, inNav: true, requiresManage: true, startsGroup: true },
    { id: 'operator', path: 'operator', label: 'Operator', icon: Gift, inNav: true, requiresOperator: true },
    { id: 'profile', path: 'profile', label: 'Edit Profile', icon: User, inNav: false },
];

/** The view the app opens on, and what `/app` and `/dashboard` redirect to. */
export const DEFAULT_VIEW_PATH = 'dashboard';

/**
 * The sidebar's list for a given user.
 *
 * Both the rail and the drawer call this, so a capability check cannot apply to one and not
 * the other — which is the class of bug a duplicated nav invites.
 *
 * `isOperator` defaults to false so that adding the operator view did not change what any
 * existing caller renders. That matters for more than tidiness: `Dashboard.test.tsx` asserts
 * every nav entry appears EXACTLY ONCE, which is the only thing standing between this app and
 * the duplicated-sidebar problem Sprint 5 deleted. A view that appears for nobody by default
 * cannot break that property while it is being wired up.
 */
export function navViewsFor(canManageTeam: boolean, isOperator = false): AppView[] {
    return APP_VIEWS.filter(
        (v) =>
            v.inNav &&
            (!v.requiresManage || canManageTeam) &&
            (!v.requiresOperator || isOperator),
    );
}

/**
 * The absolute route for a view id, e.g. `pathFor('kanban') === '/app/board'`.
 *
 * Falls back to the default view rather than throwing: an unknown id here means a stale
 * link, and dropping someone on the dashboard is a better answer than a blank screen.
 */
export function pathFor(id: string): string {
    const view = APP_VIEWS.find((v) => v.id === id);
    return `${APP_ROOT}/${view?.path ?? DEFAULT_VIEW_PATH}`;
}
