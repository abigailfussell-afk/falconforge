/**
 * SEC-07 — the device must notice its own licence running out, without being reloaded.
 *
 * `fetchTeamData` reads `team_entitlement` once, on arrival at a team, and `server-pull.ts`
 * says why in as many words: *"Neither changes on its own between pulls: a licence is granted
 * or revoked by an operator."*
 *
 * **D3 makes that sentence false.** Under a 30-day probation the ordinary way a licence ends
 * is that a date passes — which nobody does, so nothing prompts a re-read. A team whose cover
 * ends at 14:00 on a competition Saturday goes on being offered every New/Edit/Save control
 * until somebody reloads the tab, and nobody reloads a tab at a venue. That is WALK-B-12
 * again, arriving through the clock instead of through the operator.
 *
 * THE DESIGN CONSTRAINT, and it is the interesting half. The obvious fix — "if `validUntil`
 * is in the past, treat the team as read-only" — compares a SERVER-written timestamp against
 * the DEVICE's clock. A school Chromebook running two days fast would lock a perfectly
 * licensed team out of their own data at a competition. That is B4's skew defect pointed at a
 * coach rather than at a sync cursor, and it is precisely the failure `entitlement.ts` exists
 * to prevent ("FAIL OPEN. EVERY TIME.").
 *
 * So the client clock triggers a QUESTION, never an ANSWER. Past `validUntil` means "ask the
 * server again", and the server's reply is the only thing that ever sets `read_only`. The
 * tests below pin both halves: that it asks when it should, and — the ones that matter — that
 * it never answers on its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const pulls = vi.hoisted(() => ({ entitlement: [] as string[], full: 0 }));

vi.mock('@/lib/auth');

vi.mock('@/lib/server-pull', () => ({
    pullFromServer: async () => {
        pulls.full += 1;
        return { ok: true };
    },
    pullEntitlement: async (teamId: string) => {
        pulls.entitlement.push(teamId);
    },
}));

vi.mock('@/lib/supabase', () => ({
    supabaseSync: { auth: { getSession: async () => ({ data: { session: null } }) } },
    isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/offline-db', () => ({
    db: { syncQueue: { toArray: async () => [] } },
    getPendingSyncCount: async () => 0,
    getPendingSyncItems: async () => [],
    getSyncFailureCount: async () => 0,
    getTerminalFailureReasons: async () => [],
    moveToDeadLetter: async () => {},
    retrySyncFailures: async () => 0,
}));

import { useAppStore } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { pullChangesFromServer, useSync, ENTITLEMENT_RECHECK_MS } from '@/lib/sync';
import type { TeamEntitlement } from '@/lib/slices/createTeamSlice';

const TEAM = 'team-1';
const HOUR = 3_600_000;

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

afterEach(() => {
    vi.useRealTimers();
});

const mockUseAuth = vi.mocked(useAuth);

beforeEach(() => {
    pulls.entitlement = [];
    pulls.full = 0;
    useAppStore.setState({ currentTeamId: TEAM, entitlement: null });
    mockUseAuth.mockReturnValue({
        session: { access_token: 't' },
        isLoading: false,
    } as unknown as ReturnType<typeof useAuth>);
});

const pull = () => pullChangesFromServer();

describe('it asks again once the cover it was told about has run out', () => {
    /*
     * THE RED TEST. Remove the `reAskEntitlementIfCoverLooksOver` call from
     * `pullChangesFromServer` and this fails: the device keeps its stale `active` row, keeps
     * `canEdit` true, and keeps offering writes that will be refused — for as long as the tab
     * stays open, which at a venue is all day.
     */
    it('re-reads team_entitlement when validUntil is in the past', async () => {
        useAppStore.setState({
            entitlement: entitlement({ validUntil: new Date(Date.now() - HOUR).toISOString() }),
        });

        await pull();

        expect(pulls.entitlement).toEqual([TEAM]);
    });

    it('does not ask while cover is still running', async () => {
        useAppStore.setState({
            entitlement: entitlement({ validUntil: new Date(Date.now() + HOUR).toISOString() }),
        });

        await pull();

        expect(pulls.entitlement).toEqual([]);
    });

    it('does not ask about an open-ended grant, which never ends', async () => {
        useAppStore.setState({ entitlement: entitlement({ validUntil: null }) });

        await pull();

        expect(pulls.entitlement).toEqual([]);
    });

    /*
     * Once the server has said `read_only`, asking again every few seconds achieves nothing:
     * only an operator changes that answer, and arriving at the team is what re-reads it.
     * Without this the app would issue a query on every sync tick for the whole time a team is
     * lapsed — which is the state a lapsed team is in by definition, i.e. permanently.
     */
    it('does not ask again once the server has already said read_only', async () => {
        useAppStore.setState({
            entitlement: entitlement({
                status: 'read_only',
                validUntil: new Date(Date.now() - HOUR).toISOString(),
            }),
        });

        await pull();

        expect(pulls.entitlement).toEqual([]);
    });

    it('does not ask when nothing has ever been read — there is nothing to doubt', async () => {
        useAppStore.setState({ entitlement: null });

        await pull();

        expect(pulls.entitlement).toEqual([]);
    });

    /*
     * A stale row belonging to the team the user has just left must not provoke a query about
     * the team they have just arrived at. `fetchTeamData` is what reads the new team's licence.
     */
    it('ignores an entitlement row for a different team', async () => {
        useAppStore.setState({
            entitlement: entitlement({
                teamId: 'some-other-team',
                validUntil: new Date(Date.now() - HOUR).toISOString(),
            }),
        });

        await pull();

        expect(pulls.entitlement).toEqual([]);
    });
});

describe('the client clock asks a question and never answers one', () => {
    /*
     * THE ASSERTION THAT KEEPS THE FIX SAFE, and the one that would have caught B4 three
     * sprints early. A device whose clock is two days fast now sits past `validUntil` for a
     * team whose cover has NOT ended. It may ask; it must not decide. If a future change ever
     * short-circuits to `status: 'read_only'` locally, this goes red — and the symptom it
     * stands in for is a coach locked out of their own team at a competition because a school
     * Chromebook's time sync is bad.
     */
    it('leaves the stored status alone; only the server writes it', async () => {
        useAppStore.setState({
            entitlement: entitlement({ validUntil: new Date(Date.now() - 2 * 24 * HOUR).toISOString() }),
        });

        await pull();

        expect(pulls.entitlement).toEqual([TEAM]);
        // The mocked `pullEntitlement` writes nothing, which is the point: with no reply from
        // the server the device's answer is unchanged, and the team keeps working.
        expect(useAppStore.getState().entitlement?.status).toBe('active');
    });
});

describe('an app that is merely OPEN notices too', () => {
    /*
     * THE SECOND HALF, and the one the probe found. Wiring the re-ask into
     * `pullChangesFromServer` alone is not enough: `sync()` runs only when
     * `getPendingSyncCount() > 0`, so a client with an empty queue never pulls ANYTHING. A
     * coach who has the board open and is not typing — which at a competition is most of the
     * day — would go on being shown live New/Edit/Save controls until they queued something or
     * reloaded the tab, and `license_grants` has no realtime subscription to tell them either.
     *
     * Watched failing with the interval effect removed: the queue stays empty, `sync()` never
     * fires, and `pulls.entitlement` stays `[]` for ever.
     */
    it('re-asks on its own schedule with nothing queued', async () => {
        vi.useFakeTimers();
        useAppStore.setState({
            entitlement: entitlement({ validUntil: new Date(Date.now() - HOUR).toISOString() }),
        });

        const { unmount } = renderHook(() => useSync());

        // The effect asks once on mount, before any interval has elapsed — a coach who opens
        // the tab after cover ended must not wait a minute to be told.
        await act(async () => {
            await Promise.resolve();
        });
        expect(pulls.entitlement).toEqual([TEAM]);
        expect(pulls.full, 'nothing was queued, so no sync should have run').toBe(0);

        await act(async () => {
            vi.advanceTimersByTime(ENTITLEMENT_RECHECK_MS);
            await Promise.resolve();
        });
        expect(pulls.entitlement.length).toBeGreaterThan(1);

        unmount();
        vi.useRealTimers();
    });

    /*
     * The interval must be a local question, not a poll of the server. Nothing here should
     * reach the network for a team whose cover is still running — otherwise this is a request
     * every sixty seconds, per device, for every team, for ever.
     */
    it('costs nothing while cover is still running', async () => {
        vi.useFakeTimers();
        useAppStore.setState({
            entitlement: entitlement({ validUntil: new Date(Date.now() + 30 * 24 * HOUR).toISOString() }),
        });

        const { unmount } = renderHook(() => useSync());
        await act(async () => {
            vi.advanceTimersByTime(ENTITLEMENT_RECHECK_MS * 10);
            await Promise.resolve();
        });

        expect(pulls.entitlement).toEqual([]);

        unmount();
        vi.useRealTimers();
    });
});
