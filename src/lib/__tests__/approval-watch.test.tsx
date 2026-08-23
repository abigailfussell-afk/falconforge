/**
 * WALK-B-05 — the pending student finds out they were approved.
 *
 * Exit criterion: *"pending screen advances to the team within 30 s of approval without a
 * manual reload (poll or realtime); a signed-in approved member hitting `/join/CODE` is sent
 * into the team."*
 *
 * The second half is `join_team_with_invite`'s new `already_member` result and lives in
 * `src/test/db/`. This is the first half.
 *
 * WHAT THE HOOK HAS TO GET RIGHT, and it is not "does it poll":
 *
 *   1. It reports a TRANSITION, not a state. Firing for a membership that was already approved
 *      when the watch started would teleport anybody who opened the join page from inside the
 *      app straight back out of it.
 *   2. It does not run when there is nothing outstanding — otherwise it is a query every eight
 *      seconds, per signed-in visitor, for as long as the tab is open.
 *   3. It ignores the guardian's managed rows. A guardian's `team_members` row carries THEIR
 *      user id and the child's profile; treating that as the guardian's own approval would
 *      walk them into their child's team, which is the act-as mode plan §3 rules out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const db = vi.hoisted(() => ({
    rows: [] as { team_id: string; status: string }[],
    /** Every `.eq('user_id', …)`/`.is('managed_profile_id', …)` pair the hook issued. */
    calls: [] as { userId: unknown; managedIsNull: boolean }[],
}));

vi.mock('@/lib/supabase', () => ({
    isSupabaseConfigured: () => true,
    supabaseSync: {
        from: () => ({
            select: () => ({
                eq: (_col: string, userId: unknown) => ({
                    is: (col: string, value: unknown) => {
                        db.calls.push({ userId, managedIsNull: col === 'managed_profile_id' && value === null });
                        return Promise.resolve({ data: db.rows, error: null });
                    },
                }),
            }),
        }),
    },
}));

import { useApprovalWatch, APPROVAL_POLL_MS } from '@/lib/approval-watch';

beforeEach(() => {
    db.rows = [];
    db.calls = [];
});

afterEach(() => {
    vi.useRealTimers();
});

const flush = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('watching for the approval', () => {
    /*
     * THE RED TEST. Without the hook, the "Request Submitted" screen never changes — which is
     * precisely what the walkthrough recorded: the student's open page did not move, and a
     * reload gave them an empty join form.
     */
    it('reports the team when a pending membership turns approved', async () => {
        db.rows = [{ team_id: 'team-1', status: 'pending' }];
        vi.useFakeTimers();

        const { result } = renderHook(() => useApprovalWatch('user-1', true));
        await flush();
        expect(result.current).toBeNull();

        // The coach approves.
        db.rows = [{ team_id: 'team-1', status: 'approved' }];
        await act(async () => {
            vi.advanceTimersByTime(APPROVAL_POLL_MS);
        });
        // Flushed by hand rather than with `waitFor`, which schedules its own real-clock
        // retries and therefore hangs for its full timeout while fake timers are installed --
        // the first version of this test sat there for fifteen seconds and then failed.
        await flush();

        expect(result.current).toEqual({ teamId: 'team-1' });
    });

    /*
     * (1) A TRANSITION, NOT A STATE. This is the assertion that stops the fix becoming the
     * next defect: the join page is reachable from inside the app, so most people who see it
     * already hold an approved membership, and a hook that fired on "you are approved
     * somewhere" would eject them from the page they deliberately opened.
     */
    it('does not fire for a membership that was already approved', async () => {
        db.rows = [{ team_id: 'team-1', status: 'approved' }];
        vi.useFakeTimers();

        const { result } = renderHook(() => useApprovalWatch('user-1', true));
        await flush();

        await act(async () => {
            vi.advanceTimersByTime(APPROVAL_POLL_MS * 3);
            await Promise.resolve();
        });

        expect(result.current).toBeNull();
    });

    /*
     * (2) A poll that runs when nothing is outstanding is a query every eight seconds per
     * visitor, for ever. Asserted on the call log rather than on a spy count, because
     * "was called" is true of both the correct and the broken version once the interval fires.
     */
    it('issues no query at all when it is switched off', async () => {
        db.rows = [{ team_id: 'team-1', status: 'pending' }];
        vi.useFakeTimers();

        renderHook(() => useApprovalWatch('user-1', false));
        await flush();
        await act(async () => {
            vi.advanceTimersByTime(APPROVAL_POLL_MS * 5);
            await Promise.resolve();
        });

        expect(db.calls).toHaveLength(0);
    });

    it('issues no query without a signed-in user', async () => {
        vi.useFakeTimers();
        renderHook(() => useApprovalWatch(null, true));
        await flush();

        expect(db.calls).toHaveLength(0);
    });

    /*
     * (3) The guardian filter, asserted at the QUERY rather than at the result — the rows the
     * mock returns cannot express `managed_profile_id`, so checking the shape of the request
     * is the only thing here that could actually fail. `docs/failure-modes.md` §2: a mock that
     * cannot represent the property under test makes the assertion decoration.
     */
    it('asks only for this account own memberships, not its children', async () => {
        db.rows = [{ team_id: 'team-1', status: 'pending' }];
        vi.useFakeTimers();

        renderHook(() => useApprovalWatch('guardian-1', true));
        await flush();

        expect(db.calls.length).toBeGreaterThan(0);
        expect(db.calls[0].userId).toBe('guardian-1');
        expect(
            db.calls[0].managedIsNull,
            'the query would have matched the guardian rows for their children',
        ).toBe(true);
    });

    /* Stops when the screen goes. An interval that outlives its component is §11's shape. */
    it('stops polling once unmounted', async () => {
        db.rows = [{ team_id: 'team-1', status: 'pending' }];
        vi.useFakeTimers();

        const { unmount } = renderHook(() => useApprovalWatch('user-1', true));
        await flush();
        const before = db.calls.length;

        unmount();
        await act(async () => {
            vi.advanceTimersByTime(APPROVAL_POLL_MS * 4);
            await Promise.resolve();
        });

        expect(db.calls.length).toBe(before);
    });

    /* Well inside the criterion's thirty seconds, and the number is the product decision. */
    it('polls fast enough for a coach standing next to the student', () => {
        expect(APPROVAL_POLL_MS).toBeLessThanOrEqual(30_000);
    });
});
