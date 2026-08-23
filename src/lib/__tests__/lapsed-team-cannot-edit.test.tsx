/**
 * SEC-07 / WALK-B-12 — a lapsed team is not offered the writes it cannot make.
 *
 * WHAT WAS WRONG. `useSeasonScope().canEdit` was `!!currentSeasonId && !isArchived`, and every
 * content screen in the app disabled its New/Edit/Save controls on it. Entitlement was not an
 * input, so a team whose licence had lapsed saw a red banner across the top of the page saying
 * "read only" and, underneath it, a fully live New Item button. The write queued, the database
 * refused it with a 42501 (`team_can_write` is in every write policy), and it landed in the
 * dead-letter store. The walkthrough caught the button — `[lapsed] New Item enabled=true` —
 * and never confirmed what happened after, because its probe clicked the wrong control.
 *
 * The server half was already right. `sync-failure-classification.ts` has classified that
 * 42501 as TERMINAL with a renew-and-retry reason since Sprint 6, and `SyncStatusIndicator`
 * renders it. So the entire defect was the client offering the write.
 *
 * WHY THESE TESTS ARE ABOUT `useAccessState` AND NOT `useSeasonScope`. The exit criterion says
 * "`useSeasonScope().canEdit` includes entitlement". It cannot: `entitlement.ts` imports
 * `season-scope.ts`, so the reverse import is a cycle, and the only way to write it inside
 * `season-scope.ts` would be a SECOND copy of "is this team read-only" — the defect class this
 * project has hit eighteen times. The substance of the criterion is met and then some: there
 * is now exactly ONE `canEdit` in the app, it is entitlement-aware, and the season-only
 * boolean was renamed `seasonAcceptsWrites` so that nothing can reach for the old meaning by
 * the old name. The rename is the load-bearing half — it is what makes the six call sites a
 * compile error rather than a silent behaviour difference.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAccessState, EDIT_REFUSAL_TEXT } from '@/lib/entitlement';
import { useSeasonScope } from '@/lib/season-scope';
import { useAppStore } from '@/lib/store';
import type { Season } from '@/types';
import type { TeamEntitlement } from '@/lib/slices/createTeamSlice';

const TEAM = 'team-1';
const SEASON = 'season-1';

const season = (over: Partial<Season> = {}): Season => ({
    id: SEASON,
    name: '2026-2027 Season',
    gameTitle: 'DECODE',
    fieldImageData: '',
    teamId: TEAM,
    isArchived: false,
    createdAt: 1000,
    ...over,
});

const entitlement = (over: Partial<TeamEntitlement> = {}): TeamEntitlement => ({
    teamId: TEAM,
    status: 'active',
    seatsTotal: null,
    seatsUnlimited: true,
    seatsUsed: 4,
    validUntil: null,
    lapsedAt: null,
    ...over,
});

/** Put the store in one of the four states, then read the composed answer. */
function accessWith(opts: {
    seasons?: Season[];
    currentSeasonId?: string | null;
    entitlement?: TeamEntitlement | null;
}) {
    useAppStore.setState({
        seasons: opts.seasons ?? [season()],
        currentSeasonId: opts.currentSeasonId === undefined ? SEASON : opts.currentSeasonId,
        entitlement: opts.entitlement === undefined ? entitlement() : opts.entitlement,
    });
    return renderHook(() => useAccessState()).result.current;
}

beforeEach(() => {
    useAppStore.setState({ seasons: [], currentSeasonId: null, entitlement: null });
});

describe('canEdit on a lapsed licence (WALK-B-12)', () => {
    /*
     * THE RED TEST the exit criteria name. Reverting the change to `useAccessState` — putting
     * `canEdit` back to `editRefusal` ignoring `isReadOnly`, or restoring `canEdit` on
     * `useSeasonScope` and pointing the components at it — turns this red. Watched red before
     * it was watched green.
     */
    it('is FALSE on an open season when the licence has lapsed', () => {
        const access = accessWith({
            entitlement: entitlement({
                status: 'read_only',
                seatsUnlimited: false,
                seatsTotal: null,
                lapsedAt: '2026-08-21T00:00:00Z',
            }),
        });

        expect(access.isReadOnly).toBe(true);
        expect(access.canEdit).toBe(false);
    });

    /*
     * The reason, not just the boolean. A disabled control with no title is
     * `docs/failure-modes.md` §8, and a disabled control with the WRONG title is worse: the
     * old hard-coded string sent a coach whose licence had lapsed to the season picker.
     */
    it('names the licence, not the season, as the reason', () => {
        const access = accessWith({
            entitlement: entitlement({ status: 'read_only' }),
        });

        expect(access.editRefusal).toBe('lapsed-licence');
        expect(access.editRefusalReason).toBe(EDIT_REFUSAL_TEXT['lapsed-licence']);
        expect(access.editRefusalReason).not.toBe(EDIT_REFUSAL_TEXT['archived-season']);
    });

    /*
     * FAILS OPEN, and this is the assertion that stops the fix becoming the next defect.
     * `isReadOnly` is positive knowledge from the server; a device that has never read the
     * entitlement view must still be able to work. Writing the predicate as `!== 'active'`
     * would pass every test above and lock out a coach at a venue whose pull timed out.
     */
    it('leaves a device that has never read the entitlement able to edit', () => {
        const access = accessWith({ entitlement: null });

        expect(access.isKnown).toBe(false);
        expect(access.canEdit).toBe(true);
        expect(access.editRefusal).toBeNull();
        expect(access.editRefusalReason).toBeUndefined();
    });
});

describe('the other two refusals still have their own words', () => {
    it('an archived season says so, and does not mention the licence', () => {
        const access = accessWith({
            seasons: [season({ isArchived: true })],
        });

        expect(access.canEdit).toBe(false);
        expect(access.editRefusal).toBe('archived-season');
        expect(access.editRefusalReason).toBe(EDIT_REFUSAL_TEXT['archived-season']);
    });

    /*
     * The case that had no words at all. With no season selected `canEdit` was false and every
     * control still said "This season is archived and read-only" — about a season that does
     * not exist. Two components hand-rolled a "Select a season first" branch around it; four
     * did not.
     */
    it('no season selected says no season, not "archived"', () => {
        const access = accessWith({ seasons: [], currentSeasonId: null });

        expect(access.canEdit).toBe(false);
        expect(access.editRefusal).toBe('no-season');
        expect(access.editRefusalReason).toBe(EDIT_REFUSAL_TEXT['no-season']);
    });

    /*
     * BOTH AT ONCE, and the ordering is a decision rather than an accident: the archived
     * season wins, because switching season is a click and renewing a licence is a
     * conversation. Same rule the banner already follows, so the disabled control and the
     * banner above it cannot name different problems.
     */
    it('archived season wins over a lapsed licence, matching the banner', () => {
        const access = accessWith({
            seasons: [season({ isArchived: true })],
            entitlement: entitlement({ status: 'read_only' }),
        });

        expect(access.canEdit).toBe(false);
        expect(access.editRefusal).toBe('archived-season');
        expect(access.refusal).toBe('archived-season');
        expect(access.isBothRefusals).toBe(true);
    });

    it('permits editing on an open season with an active licence — the control', () => {
        const access = accessWith({});

        expect(access.canEdit).toBe(true);
        expect(access.editRefusalReason).toBeUndefined();
    });
});

describe('there is exactly one canEdit', () => {
    /*
     * THE RATCHET FOR THIS WHOLE CHANGE, and the reason the rename matters more than the new
     * boolean. `useSeasonScope` must not grow a `canEdit` back: two booleans of that name that
     * disagree on a team's worst day is `docs/failure-modes.md` §1 in its purest form, and the
     * app had precisely that for five sprints without anybody comparing them.
     *
     * A source-level check would also work, but this one cannot go stale against a rename.
     */
    it('useSeasonScope answers about the season and nothing else', () => {
        useAppStore.setState({
            seasons: [season()],
            currentSeasonId: SEASON,
            entitlement: entitlement({ status: 'read_only' }),
        });

        const scope = renderHook(() => useSeasonScope()).result.current;

        expect(scope.seasonAcceptsWrites).toBe(true);
        expect(scope).not.toHaveProperty('canEdit');
    });
});
