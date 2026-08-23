import {
    LayoutDashboard,
    Activity,
    CalendarDays,
    CheckSquare,
    ClipboardCheck,
    Gamepad2,
    Settings,
    User,
    Gift,
    LifeBuoy,
    Baby,
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
    /**
     * Only for an account that holds a managed child profile.
     *
     * Same status as {@link requiresManage}: UX, not security. The route renders its own
     * explanation for anybody else, and every guardian row the page reads is behind
     * `guardian_user_id = auth.uid()` in RLS.
     *
     * A guardian is NOT a team member — `is_team_member` and `get_user_team_ids` both exclude
     * managed rows deliberately — so this is the one nav entry that can be the ONLY one a
     * signed-in account sees.
     */
    requiresGuardian?: boolean;
    /**
     * Needs an open team to mean anything. True for every view except the guardian's.
     *
     * A guardian holds a roster row on a child's behalf and no membership of their own, so
     * `currentTeamId` is null for them permanently — and every view below is season- and
     * team-scoped, so each one would render an empty screen. Worse than empty: RLS returns
     * nothing to a guardian for tasks, seasons or the roster, so the app would be showing a
     * parent a plausible-looking but blank version of a team they are not on. Plan section 3
     * forbids exactly that shape ("never renders the team as the child").
     */
    requiresTeam?: boolean;
    /** Draw a separator above this item. Groups the board/competition tools apart. */
    startsGroup?: boolean;
}

/** Every app view lives under this prefix, so `/app/*` is one route in the top-level table. */
export const APP_ROOT = '/app';

export const APP_VIEWS: AppView[] = [
    { id: 'dashboard', path: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, inNav: true, requiresTeam: true },
    { id: 'kanban', path: 'board', label: 'Sprint Planning', icon: Activity, inNav: true, requiresTeam: true, startsGroup: true },
    { id: 'checklist', path: 'checklist', label: 'Pre-Match Checklist', icon: CheckSquare, inNav: true, requiresTeam: true },
    { id: 'scouting', path: 'scouting', label: 'Scouting Reports', icon: ClipboardCheck, inNav: true, requiresTeam: true },
    { id: 'planner', path: 'planner', label: 'Match Planner', icon: Gamepad2, inNav: true, requiresTeam: true },
    /*
     * Meetings is visible to EVERYBODY, unlike Admin Settings.
     *
     * The schedule is the whole of the student experience of this feature — hiding the nav
     * item from students would leave them with no way to find out when anything is, and no
     * route to the check-in screen a QR scan lands on. The page itself renders the manager or
     * the read-only schedule depending on `can_manage_meetings`, which is the first capability
     * in the app that separates a mentor from a student.
     */
    { id: 'meetings', path: 'meetings', label: 'Meetings', icon: CalendarDays, inNav: true, requiresTeam: true },
    { id: 'guardian', path: 'guardian', label: 'My children', icon: Baby, inNav: true, requiresGuardian: true, startsGroup: true },
    { id: 'admin', path: 'admin', label: 'Admin Settings', icon: Settings, inNav: true, requiresTeam: true, requiresManage: true, startsGroup: true },
    { id: 'operator', path: 'operator', label: 'Operator', icon: Gift, inNav: true, requiresTeam: true, requiresOperator: true },
    /*
     * Help carries NO `requiresTeam`, unlike every other view here.
     *
     * The two people most likely to need instructions are a coach who has not created a team
     * yet and a guardian who never will have one -- `requiresTeam` would hide the page from
     * exactly them. It renders no team- or season-scoped data, so there is nothing for RLS to
     * return empty and nothing of the "plausible-looking blank team" shape the guardian rules
     * above exist to prevent.
     */
    { id: 'help', path: 'help', label: 'Getting started', icon: LifeBuoy, inNav: true, startsGroup: true },
    /*
     * Profile carries NO `requiresTeam` either, and for the same reason Help does not
     * (WALK-B-01).
     *
     * It edits the SIGNED-IN USER — their name, their age classification — and reads no team
     * data at all. Marking it as needing a team meant the shell's no-team redirect bounced
     * every guardian off it one second after arriving, so a guardian could not rename
     * themselves and the "Edit Profile" link their own sidebar renders led to
     * "Welcome! Let's get you set up."
     */
    { id: 'profile', path: 'profile', label: 'Edit Profile', icon: User, inNav: false },
];

/** The view the app opens on, and what `/app` and `/dashboard` redirect to. */
export const DEFAULT_VIEW_PATH = 'dashboard';

/**
 * Does this `/app/*` path need an open team to mean anything? (WALK-B-01)
 *
 * The shell's no-team redirect used to ask a different question — "is this anything other
 * than `/app/guardian`?" — which is the same answer only while the guardian view is the sole
 * team-free page. It has not been for a while: `help` was added without `requiresTeam` in the
 * beta-prep branch, and `profile` never needed one. So a guardian was bounced off both, one
 * second after arriving, by a rule that was true when it was written.
 *
 * Reading {@link AppView.requiresTeam} keeps the two in step by construction, which is the
 * countermeasure for a hand-kept list that must track another list
 * (`docs/failure-modes.md` section 12).
 *
 * A path with no registered view — the meeting detail pages, check-in — needs a team, and
 * that default is the safe one: every unregistered route under `/app` reads team data, and
 * being wrong the other way renders a plausible-looking empty screen to somebody who is not
 * on the team.
 */
export function pathNeedsTeam(pathname: string): boolean {
    if (!pathname.startsWith(APP_ROOT)) return false;
    const segment = pathname.slice(APP_ROOT.length).replace(/^\/+/, '').split('/')[0] ?? '';
    const view = APP_VIEWS.find((v) => v.path === segment);
    return view ? view.requiresTeam === true : true;
}

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
export function navViewsFor(
    canManageTeam: boolean,
    isOperator = false,
    isGuardian = false,
    hasTeam = true,
): AppView[] {
    return APP_VIEWS.filter(
        (v) =>
            v.inNav &&
            (!v.requiresManage || canManageTeam) &&
            (!v.requiresOperator || isOperator) &&
            (!v.requiresGuardian || isGuardian) &&
            (!v.requiresTeam || hasTeam),
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

/**
 * Where to send somebody after they sign in, when they asked for somewhere specific.
 *
 * WHY THIS EXISTS
 *
 * A QR poster encodes `…/#/app/checkin/0842`. Scanning it while signed out used to hit the
 * `user ? … : <Navigate to="/" />` guard on `/app`, which threw the destination away and left
 * a student on the marketing page with no idea that the answer was "press Log In, then find
 * Meetings again". Rule 4 of the design brief says a scan while logged out routes through
 * login and then COMPLETES the check-in; it did not.
 *
 * The destination rides through login as a query parameter and is consumed once.
 */
export const RETURN_TO_PARAM = 'next';

/**
 * Build the login URL that will come back to `path` afterwards.
 *
 * `path` is an in-app path like `/app/checkin/0842` — the part after the `#`.
 */
export function loginWithReturnTo(path: string): string {
    // The landing page is nobody's destination; it is where you end up having lost one.
    if (!path || path === '/' || path.startsWith('/login')) return '/login';
    return `/login?${RETURN_TO_PARAM}=${encodeURIComponent(path)}`;
}

/**
 * Read a return-to target back, refusing anything that is not an in-app path.
 *
 * The value arrives from the URL, so it is attacker-controlled in the ordinary sense: a link
 * of the form `#/login?next=https://elsewhere.example` must not become an open redirect. Only
 * a single-slash-prefixed relative path is accepted, which excludes `//host` and any scheme.
 */
export function readReturnTo(search: string): string | null {
    const raw = new URLSearchParams(search).get(RETURN_TO_PARAM);
    if (!raw) return null;
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    return raw;
}
