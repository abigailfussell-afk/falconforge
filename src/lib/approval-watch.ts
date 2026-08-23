/**
 * "You're in" — told to the student, without anybody telling them (WALK-B-05).
 *
 * WHAT WAS BROKEN. A student joins with an invite code, lands on "Pending Coach Approval", and
 * that screen never changes. The coach approves; nothing happens. Reloading gives an EMPTY JOIN
 * FORM, which reads as "it did not work". The only way in is to navigate to some `/app/*` URL
 * by hand and discover a team picker that now lists the team. The walkthrough's summary is the
 * cost: *"at a kickoff meeting with 12 students that is 12 verbal instructions."*
 *
 * A POLL, NOT REALTIME, and the choice is not laziness.
 *
 * `team_members` IS in the realtime publication, so a subscription would work — and would be
 * the wrong tool here. The subscription in `realtime.ts` is scoped to a team the user is
 * already in, which is exactly what a pending member is not; standing one up for a row the
 * user may not be able to filter on server-side means a channel per pending membership, torn
 * down on approval, on a screen that lives for ninety seconds. A `select` every eight seconds
 * costs one small query per student per kickoff meeting and has no teardown to get wrong —
 * `docs/failure-modes.md` §11 is four sprints of "the safety timeout was bound to the wrong
 * event", and this has no timeout to bind.
 *
 * Eight seconds because the exit criterion says thirty and the coach is standing next to the
 * student: the difference between "it just happened" and "it eventually happened" is what this
 * ID is about.
 *
 * IT STOPS ITSELF. The interval is cleared on approval and on unmount, and it does not run at
 * all when there is nothing pending — a student sitting on this screen with no membership is
 * not a case worth a query every eight seconds for as long as the tab is open.
 */
import { useEffect, useRef, useState } from 'react';
import { supabaseSync } from './supabase';

/** How often to ask. Well inside the criterion's 30 s, and cheap enough to be boring. */
export const APPROVAL_POLL_MS = 8_000;

export interface ApprovedTeam {
    teamId: string;
}

/**
 * Watch this account's own memberships and report the first one that turns `approved`.
 *
 * @param userId  the signed-in account, or null/undefined to do nothing
 * @param enabled false switches the poll off entirely — pass the "is a request outstanding"
 *                condition, so the query does not run on screens that have nothing to wait for
 */
export function useApprovalWatch(
    userId: string | null | undefined,
    enabled: boolean,
): ApprovedTeam | null {
    const [approved, setApproved] = useState<ApprovedTeam | null>(null);

    /*
     * WHICH MEMBERSHIPS WERE ALREADY APPROVED WHEN THE WATCH STARTED.
     *
     * Without this the hook fires immediately for anybody who is already on a team, which is
     * most people — the join screen is reachable from inside the app. What it is watching for
     * is a TRANSITION, and a transition needs a "before". `docs/failure-modes.md` §4 in its
     * other direction: a value read as an event.
     */
    const alreadyApproved = useRef<Set<string> | null>(null);

    useEffect(() => {
        if (!supabaseSync || !userId || !enabled) return;

        let cancelled = false;

        const check = async () => {
            if (cancelled || !supabaseSync) return;
            const { data, error } = await supabaseSync
                .from('team_members')
                .select('team_id, status')
                .eq('user_id', userId)
                // The guardian's rows carry the guardian's user id and the CHILD's profile.
                // They are not this account's memberships, and a guardian being teleported
                // into their child's team is the act-as mode plan §3 rules out.
                .is('managed_profile_id', null);

            if (cancelled || error || !data) return;

            const approvedIds = data
                .filter((m) => m.status === 'approved')
                .map((m) => m.team_id)
                .filter((id): id is string => !!id);

            if (alreadyApproved.current === null) {
                alreadyApproved.current = new Set(approvedIds);
                return;
            }

            const fresh = approvedIds.find((id) => !alreadyApproved.current!.has(id));
            if (fresh) setApproved({ teamId: fresh });
        };

        void check();
        const interval = setInterval(() => void check(), APPROVAL_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [userId, enabled]);

    /*
     * Reset the baseline when the watch is switched off, so a second wait on the same mounted
     * screen — join one team, get approved, join another — starts from the memberships as they
     * are now rather than from the ones it saw the first time.
     */
    useEffect(() => {
        if (!enabled) {
            alreadyApproved.current = null;
            setApproved(null);
        }
    }, [enabled]);

    return approved;
}
