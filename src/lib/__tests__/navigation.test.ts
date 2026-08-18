/**
 * The one navigation definition, and the two properties that keep it honest.
 *
 * `Dashboard.test.tsx` asserts every nav entry appears exactly once in the DOM — the ratchet
 * that stops the duplicated-sidebar problem Sprint 5 deleted from coming back. This file guards
 * the layer under it: that adding a capability-gated view cannot leak into someone else's nav,
 * and that the route table and the nav list stay the same array.
 *
 * Sprint 6 added the first view gated on something other than a team role, which is exactly the
 * kind of change that historically drifted the rail and the drawer apart.
 */
import { describe, it, expect } from 'vitest';
import { APP_VIEWS, navViewsFor, pathFor, APP_ROOT, DEFAULT_VIEW_PATH } from '../navigation';

describe('capability gating', () => {
    it('hides the admin view from a member who cannot manage the team', () => {
        const ids = navViewsFor(false).map((v) => v.id);

        expect(ids).not.toContain('admin');
        expect(ids).toContain('dashboard');
    });

    it('shows the admin view to an admin or coach', () => {
        expect(navViewsFor(true).map((v) => v.id)).toContain('admin');
    });

    /*
     * THE OPERATOR PAGE SEEN BY SOMEBODY WHO IS NOT AN OPERATOR — the nav half of it.
     *
     * Managing a team does not make you the platform operator, and the two capabilities are
     * unrelated: a team admin runs their tenant, the operator runs the platform. Conflating them
     * would put a gifting page in front of every coach.
     */
    it('does not show the operator view to a team admin', () => {
        expect(navViewsFor(true).map((v) => v.id)).not.toContain('operator');
    });

    it('shows the operator view only when the caller is an operator', () => {
        expect(navViewsFor(false, true).map((v) => v.id)).toContain('operator');
        expect(navViewsFor(true, true).map((v) => v.id)).toContain('operator');
    });

    /*
     * Defaulting `isOperator` to false is what let this view be added without touching any
     * existing caller — and without putting a second `nav-operator` node into the tests that
     * assert every entry appears exactly once.
     */
    it('treats an unspecified operator status as "not an operator"', () => {
        expect(navViewsFor(true).map((v) => v.id)).toEqual(navViewsFor(true, false).map((v) => v.id));
    });

    it('an operator who is not a coach still does not get the admin view', () => {
        const ids = navViewsFor(false, true).map((v) => v.id);

        expect(ids).toContain('operator');
        expect(ids).not.toContain('admin');
    });
});

describe('the definition stays one definition', () => {
    it('has no duplicate ids or paths', () => {
        const ids = APP_VIEWS.map((v) => v.id);
        const paths = APP_VIEWS.map((v) => v.path);

        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(paths).size).toBe(paths.length);
    });

    it('resolves every view to a route under the app root', () => {
        for (const view of APP_VIEWS) {
            expect(pathFor(view.id)).toBe(`${APP_ROOT}/${view.path}`);
        }
    });

    it('falls back to the default view for an unknown id rather than throwing', () => {
        // A stale link should drop somebody on the dashboard, not on a blank screen.
        expect(pathFor('gemini-summaries')).toBe(`${APP_ROOT}/${DEFAULT_VIEW_PATH}`);
    });

    it('keeps profile out of the nav while leaving it a real route', () => {
        expect(navViewsFor(true, true).map((v) => v.id)).not.toContain('profile');
        expect(pathFor('profile')).toBe(`${APP_ROOT}/profile`);
    });
});

describe('a guardian has no team, and the nav must survive that', () => {
    /*
     * FOUND IN THE BROWSER, as `guardian@falconforge.test`. A guardian holds a roster row on a
     * child's behalf and no membership of their own, so `currentTeamId` is null permanently —
     * and every view except their own is team- and season-scoped. The rail offered Dashboard,
     * Sprint Planning, Checklist, Scouting, Match Planner and Meetings to a parent who would
     * have got an empty screen from each, because RLS returns them nothing.
     *
     * Plan section 3 forbids that shape directly: a guardian "never renders the team as the
     * child".
     */
    it('shows a guardian only their own view when they have no team', () => {
        const views = navViewsFor(false, false, true, false);

        // `help` joined this list deliberately: it is the one view with no `requiresTeam`,
        // because a guardian who will never have a team still needs to read how any of this
        // works. Kept as an exact list rather than loosened to `not.toContain('dashboard')` —
        // the literal is what makes a sixth team view added without `requiresTeam` fail here.
        expect(views.map((v) => v.id)).toEqual(['guardian', 'help']);
    });

    /*
     * The property the list above is standing in for, stated directly.
     *
     * The exact list catches a regression but does not say WHY those two are allowed, so a
     * future edit could satisfy it by renaming rather than by reasoning. This asserts the rule:
     * nothing team-scoped reaches an account with no team, whatever it is called.
     */
    it('offers a teamless guardian nothing that needs a team', () => {
        const shown = navViewsFor(false, false, true, false);

        expect(shown.length).toBeGreaterThan(0);
        expect(shown.filter((v) => v.requiresTeam)).toEqual([]);
    });

    it('still shows the team views to a member who has one', () => {
        const views = navViewsFor(false, false, false, true);

        expect(views.map((v) => v.id)).toContain('dashboard');
        expect(views.map((v) => v.id)).not.toContain('guardian');
    });

    it('shows both to a coach who is also a parent', () => {
        // The case that makes `requiresTeam` and `requiresGuardian` independent rather than
        // two spellings of one flag.
        const views = navViewsFor(true, false, true, true).map((v) => v.id);

        expect(views).toContain('dashboard');
        expect(views).toContain('admin');
        expect(views).toContain('guardian');
    });

    it('defaults to having a team, so existing callers are unchanged', () => {
        expect(navViewsFor(false).map((v) => v.id)).toContain('dashboard');
    });
});
