/**
 * Licensing state, and the one rule that matters more than the rest: FAIL OPEN.
 *
 * Every predicate is written against a positive `'read_only'` rather than `!== 'active'`,
 * because the two differ exactly on null — the device that has never read the entitlement view.
 * The tests below are weighted towards that case, because it is the one where getting it wrong
 * locks a coach out of their own team at a competition over a query that timed out.
 *
 * The client's copy of entitlement exists to EXPLAIN a refusal, never to be the refusal.
 * `team_can_write` is in every write policy and is what actually stops an unlicensed write.
 */
import { describe, it, expect } from 'vitest';
import { deriveEntitlementState, EXPIRY_WARNING_DAYS } from '../entitlement';
import type { TeamEntitlement } from '../slices/createTeamSlice';

const NOW = new Date('2026-08-16T12:00:00Z');

function entitlement(overrides: Partial<TeamEntitlement> = {}): TeamEntitlement {
    return {
        teamId: 'team-1',
        status: 'active',
        seatsTotal: 15,
        seatsUnlimited: false,
        seatsUsed: 12,
        validUntil: null,
        lapsedAt: null,
        ...overrides,
    };
}

describe('failing open', () => {
    /*
     * THE CASE THE WHOLE FILE IS SHAPED AROUND. A brand-new install, or a pull that timed out,
     * has no answer — and "we could not ask" must never be treated as "no".
     */
    it('an unread entitlement locks nobody out', () => {
        const state = deriveEntitlementState(null, NOW);

        expect(state.isReadOnly).toBe(false);
        expect(state.isAtCapacity).toBe(false);
        expect(state.isOverCapacity).toBe(false);
        expect(state.isExpiringSoon).toBe(false);
    });

    /*
     * THIS TEST CAUGHT A REAL FAIL-OPEN BUG IN THE FIRST DRAFT OF `deriveEntitlementState`.
     *
     * With no row, `seatsTotal` is null and `seatsRemaining` floors to 0, so `isAtCapacity`
     * came out TRUE and the console would have refused every approval on a device that had
     * simply never managed to read the view. "No answer" and "no seats" are arithmetically
     * identical and semantically opposite, which is why `isKnown` exists.
     */
    it('an unread entitlement is not "no seats" — it is "we have not asked"', () => {
        const state = deriveEntitlementState(null, NOW);

        expect(state.isKnown).toBe(false);
        expect(state.seatsTotal).toBeNull();
        // Null, not 0: the console shows "—" rather than a number it did not learn.
        expect(state.seatsRemaining).toBeNull();
        expect(state.isAtCapacity).toBe(false);
        expect(state.isOverCapacity).toBe(false);
    });

    it('an unrecognised status is treated as permissive, not restrictive', () => {
        // A future status value added server-side must not lock existing clients out. Positive
        // matching on 'read_only' gives that for free; `!== 'active'` would not.
        const state = deriveEntitlementState(
            entitlement({ status: 'grace_period' as TeamEntitlement['status'] }),
            NOW,
        );

        expect(state.isReadOnly).toBe(false);
    });
});

describe('a lapsed licence', () => {
    it('is read-only, and reports when cover ended', () => {
        const state = deriveEntitlementState(
            entitlement({
                status: 'read_only',
                validUntil: '2026-08-15T00:00:00Z',
                lapsedAt: '2026-08-15T00:00:00Z',
            }),
            NOW,
        );

        expect(state.isReadOnly).toBe(true);
        expect(state.lapsedAt?.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });

    /*
     * The team whose grant expired YESTERDAY — one of the states the hand-off asked to be
     * constructed rather than imagined. Already past, so there is no countdown to show.
     */
    it('does not also claim to be expiring soon', () => {
        const state = deriveEntitlementState(
            entitlement({ status: 'read_only', validUntil: '2026-08-15T00:00:00Z' }),
            NOW,
        );

        expect(state.daysUntilExpiry).toBeNull();
        expect(state.isExpiringSoon).toBe(false);
    });
});

describe('expiry warnings', () => {
    it('warns inside the window', () => {
        const state = deriveEntitlementState(
            entitlement({ validUntil: '2026-08-30T12:00:00Z' }),
            NOW,
        );

        expect(state.daysUntilExpiry).toBe(14);
        expect(state.isExpiringSoon).toBe(true);
    });

    it('stays quiet outside it', () => {
        const state = deriveEntitlementState(
            entitlement({ validUntil: '2027-02-15T00:00:00Z' }),
            NOW,
        );

        expect(state.isExpiringSoon).toBe(false);
    });

    /*
     * `Math.floor` reported "ends in 0 days" for a licence with eleven hours left. Rounded up,
     * the count reaches 1 and stays there until it has actually lapsed — at which point
     * `daysUntilExpiry` is null and the lapsed state takes over.
     */
    it('reports a licence with hours left as one day, not zero', () => {
        const state = deriveEntitlementState(
            entitlement({ validUntil: new Date(NOW.getTime() + 11 * 3_600_000).toISOString() }),
            NOW,
        );

        expect(state.daysUntilExpiry).toBe(1);
        expect(state.isExpiringSoon).toBe(true);
    });

    it('warns on the boundary day rather than one day late', () => {
        const boundary = new Date(NOW.getTime() + EXPIRY_WARNING_DAYS * 86_400_000);
        const state = deriveEntitlementState(
            entitlement({ validUntil: boundary.toISOString() }),
            NOW,
        );

        expect(state.daysUntilExpiry).toBe(EXPIRY_WARNING_DAYS);
        expect(state.isExpiringSoon).toBe(true);
    });

    it('an open-ended grant never expires and never warns', () => {
        const state = deriveEntitlementState(entitlement({ validUntil: null }), NOW);

        expect(state.validUntil).toBeNull();
        expect(state.daysUntilExpiry).toBeNull();
        expect(state.isExpiringSoon).toBe(false);
    });

    it('a malformed date is ignored rather than rendered as Invalid Date', () => {
        const state = deriveEntitlementState(
            entitlement({ validUntil: 'not a date' }),
            NOW,
        );

        expect(state.validUntil).toBeNull();
        expect(state.isExpiringSoon).toBe(false);
    });
});

describe('seat arithmetic', () => {
    it('reports the numbers the console renders as "12 of 15 seats"', () => {
        const state = deriveEntitlementState(entitlement({ seatsUsed: 12, seatsTotal: 15 }), NOW);

        expect(state.seatsUsed).toBe(12);
        expect(state.seatsTotal).toBe(15);
        expect(state.seatsRemaining).toBe(3);
        expect(state.isAtCapacity).toBe(false);
    });

    it('is at capacity when the last seat is taken', () => {
        const state = deriveEntitlementState(entitlement({ seatsUsed: 15, seatsTotal: 15 }), NOW);

        expect(state.seatsRemaining).toBe(0);
        expect(state.isAtCapacity).toBe(true);
        expect(state.isOverCapacity).toBe(false);
    });

    /*
     * UNLIMITED IS NOT A BIG NUMBER. `null` remaining is a distinct answer the console renders
     * differently, and flattening it to a large integer is how `remaining < 1` starts lying.
     */
    it('an unlimited grant has no remaining count and is never at capacity', () => {
        const state = deriveEntitlementState(
            entitlement({ seatsUnlimited: true, seatsTotal: null, seatsUsed: 40 }),
            NOW,
        );

        expect(state.seatsRemaining).toBeNull();
        expect(state.isAtCapacity).toBe(false);
        expect(state.isOverCapacity).toBe(false);
    });

    /*
     * OVER CAPACITY IS A LEGITIMATE STATE, not a corruption.
     *
     * Reducing a grant below the current headcount is allowed on purpose: a customer must
     * always be able to lower their bill, and refusing a billing decision to protect a roster
     * decision is hostile. Nobody is removed — the team simply cannot approve anyone new until
     * it is back under.
     */
    it('reports being over capacity without any seats going negative', () => {
        const state = deriveEntitlementState(entitlement({ seatsUsed: 13, seatsTotal: 10 }), NOW);

        expect(state.isOverCapacity).toBe(true);
        expect(state.isAtCapacity).toBe(true);
        expect(state.seatsRemaining).toBe(0); // floored, never -3
    });

    /*
     * The counterpart to the fail-open test above, and the reason `isKnown` is not redundant:
     * a REAL row saying "no seats granted" IS at capacity. Same arithmetic, opposite meaning,
     * distinguished only by whether the view was read.
     */
    it('a team with a real grant of no seats is at capacity from the start', () => {
        const state = deriveEntitlementState(entitlement({ seatsUsed: 0, seatsTotal: null }), NOW);

        expect(state.isKnown).toBe(true);
        expect(state.seatsRemaining).toBe(0);
        expect(state.isAtCapacity).toBe(true);
        // Not over capacity: nobody is on the wrong side of anything, there is just no room.
        expect(state.isOverCapacity).toBe(false);
    });
});
