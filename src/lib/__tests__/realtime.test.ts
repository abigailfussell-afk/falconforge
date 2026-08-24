import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unmock realtime so we can test the real implementation
vi.unmock('@/lib/realtime');

// We need fine-grained control over supabase and sync mocks
vi.unmock('@/lib/supabase');
vi.unmock('@/lib/sync');

// Create mock channel
const mockOn = vi.fn().mockReturnThis();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();

const mockChannel = {
    on: mockOn,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
};

// Mock supabase with channel support
vi.mock('@/lib/supabase', () => ({
    supabase: {
        channel: vi.fn(() => mockChannel),
        // Resolves, because the real `removeChannel` returns a Promise. The stub used to
        // return undefined, so teardown could not have its rejection handled without the
        // suite throwing TypeError — mock drift of exactly the kind mock-drift.test.ts
        // exists to catch, in a shape it cannot see (a return value, not a missing export).
        removeChannel: vi.fn().mockResolvedValue('ok'),
    },
    supabaseSync: null,
    isSupabaseConfigured: () => true,
}));

// Realtime writes to the store through the shared read path, not through sync.ts (C3).
const mockMergeIntoStore = vi.fn();
const mockUpdateLocalDatabase = vi.fn();
/*
 * `fetchTeamData` is here because SYNC-04's resume calls it to close the gap the disconnection
 * left. A factory mock throws when an omitted export is ACCESSED rather than when it is
 * imported, so leaving it out would have been invisible until a test drove a resume.
 */
const mockFetchTeamData = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/server-pull', () => ({
    mergeIntoStore: (...args: any[]) => mockMergeIntoStore(...args),
    updateLocalDatabase: (...args: any[]) => mockUpdateLocalDatabase(...args),
    fetchTeamData: (...args: any[]) => mockFetchTeamData(...args),
}));

vi.mock('@/lib/sync', () => ({
    useSync: vi.fn(() => ({
        isOnline: true,
        syncStatus: 'idle',
        pendingChanges: 0,
        failedChanges: 0,
        lastSyncTime: null,
        sync: vi.fn(),
        retryFailedChanges: vi.fn().mockResolvedValue(0),
        error: null,
    })),
}));

// Mock store
vi.mock('@/lib/store', () => {
    const state = {
        tasks: [{ id: 'task-1', title: 'Test' }],
        scoutingReports: [{ id: 'sr-1' }],
        matchPlans: [{ id: 'mp-1' }],
        subTeams: [{ id: 'st-1' }],
        checklistsBySeason: { 'season-1': [{ id: 'cl-1', text: 'Test', checked: false }] },
        // Templates share the `checklists` table, so a DELETE has to work out which of the
        // two it names before it can act on it.
        checklistTemplates: [{ id: 'tpl-1', name: 'Standard', items: [], seasonId: 'season-1' }],
        setTasks: vi.fn(),
        setScoutingReports: vi.fn(),
        setMatchPlans: vi.fn(),
        setSubTeams: vi.fn(),
        setChecklistForSeason: vi.fn(),
        setChecklistTemplates: vi.fn(),
    };
    return {
        useAppStore: {
            getState: () => state,
            setState: vi.fn(),
        },
    };
});

import {
    setupRealtimeSubscription,
    teardownRealtimeSubscription,
    getRealtimeStatus,
    onRealtimeStatusChange,
    handleRealtimeDelete,
    handleVisibilityChange,
    resetVisibilityStateForTests,
    HIDDEN_TEARDOWN_MS,
} from '../realtime';
import { supabase } from '../supabase';
import { useAppStore } from '../store';

// The queue is not this suite's subject: `getPendingRecordIds` is driven through the mock.
vi.mock('@/lib/offline-db');

/**
 * The stubbed client's spies, typed once.
 *
 * The same escape-hatch cast was written five times while SYNC-04's tests were added, and the
 * type-escape ratchet in `harness-invariants.test.ts` counts test files too — correctly, since a
 * cast is a cast wherever it is. One `asSpy` keeps the count where it was.
 *
 * (And the ratchet counts COMMENTS, which is why this one describes the cast rather than
 * quoting it. Discovered by writing the quote and watching the count go up by two.)
 */
const asSpy = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>;

describe('realtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset module state by tearing down
        teardownRealtimeSubscription();
    });

    describe('setupRealtimeSubscription', () => {
        it('should subscribe to a channel for the given team', () => {
            setupRealtimeSubscription('team-123');

            expect(supabase!.channel).toHaveBeenCalledWith('team-team-123');
            expect(mockOn).toHaveBeenCalled();
            expect(mockSubscribe).toHaveBeenCalled();
        });

        it('should subscribe to every synced table (INSERT, UPDATE, DELETE each)', () => {
            setupRealtimeSubscription('team-123');

            // The subscription list is derived from the entity registry plus checklists,
            // rather than being a second hand-maintained list that can drift from the
            // first (B16). That added `seasons`, which was previously omitted -- so this
            // is 6 tables x 3 events, not the old 5 x 3. Season renames now propagate live
            // instead of waiting for the next pull; the table is tiny and rarely written.
            //
            // Sprint 8 made it 8: registering `meetings` and `meeting_attendance` enrolled
            // them here as a consequence of the same derivation, which is the point of it.
            // A cancelled meeting has to reach the phones of the people who were going to
            // turn up to it, and a check-in has to appear in the coach's live feed. Both
            // tables were given REPLICA IDENTITY FULL in the same migration, because a
            // subscription filtered on `team_id` cannot see a DELETE without it (B7/B22) --
            // and this list is what assertion 5 in `schema_assertions.sql` mirrors.
            const tables = mockOn.mock.calls.map((call: any[]) => call[1]?.table);
            const distinct = [...new Set(tables)];

            expect(distinct.sort()).toEqual([
                'checklists', 'competition_events', 'event_matches', 'match_participants',
                'match_plans', 'meeting_attendance', 'meetings', 'scouting_reports', 'seasons',
                'sub_teams', 'tasks', 'team_game_overrides',
            ]);
            expect(mockOn).toHaveBeenCalledTimes(distinct.length * 3);
        });

        it('should filter subscriptions by team_id', () => {
            setupRealtimeSubscription('team-abc');

            const filters = mockOn.mock.calls.map((call: any[]) => call[1]?.filter);
            for (const filter of filters) {
                expect(filter).toBe('team_id=eq.team-abc');
            }
        });

        it('should no-op when already subscribed to the same team', () => {
            setupRealtimeSubscription('team-123');
            const firstCallCount = (supabase!.channel as any).mock.calls.length;

            setupRealtimeSubscription('team-123');
            // Should not create a new channel
            expect(asSpy(supabase!.channel).mock.calls.length).toBe(firstCallCount);
        });

        it('should teardown and re-subscribe when team changes', () => {
            setupRealtimeSubscription('team-123');
            setupRealtimeSubscription('team-456');

            expect(supabase!.removeChannel).toHaveBeenCalled();
            expect(supabase!.channel).toHaveBeenCalledWith('team-team-456');
        });

        it('should set status to connecting on setup', () => {
            const listener = vi.fn();
            const unsub = onRealtimeStatusChange(listener);

            setupRealtimeSubscription('team-123');

            expect(listener).toHaveBeenCalledWith('connecting');
            unsub();
        });
    });

    describe('teardownRealtimeSubscription', () => {
        it('should remove the channel and set status to disconnected', () => {
            setupRealtimeSubscription('team-123');
            teardownRealtimeSubscription();

            expect(supabase!.removeChannel).toHaveBeenCalled();
            expect(getRealtimeStatus()).toBe('disconnected');
        });

        it('should be safe to call when not subscribed', () => {
            expect(() => teardownRealtimeSubscription()).not.toThrow();
        });
    });

    describe('getRealtimeStatus / onRealtimeStatusChange', () => {
        it('should start as disconnected', () => {
            expect(getRealtimeStatus()).toBe('disconnected');
        });

        it('should notify listeners on status change', () => {
            const listener = vi.fn();
            const unsub = onRealtimeStatusChange(listener);

            setupRealtimeSubscription('team-123');
            expect(listener).toHaveBeenCalledWith('connecting');

            unsub();
        });

        it('should unsubscribe listener when unsub is called', () => {
            const listener = vi.fn();
            const unsub = onRealtimeStatusChange(listener);
            unsub();

            setupRealtimeSubscription('team-123');
            // Listener was removed, should not be called
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe('handleRealtimeDelete', () => {
        it('should remove a task by ID', () => {
            handleRealtimeDelete('tasks', 'task-1');
            const store = useAppStore.getState();
            expect(store.setTasks).toHaveBeenCalledWith([]);
        });

        it('should remove a scouting report by ID', () => {
            handleRealtimeDelete('scouting_reports', 'sr-1');
            const store = useAppStore.getState();
            expect(store.setScoutingReports).toHaveBeenCalledWith([]);
        });

        it('should remove a match plan by ID', () => {
            handleRealtimeDelete('match_plans', 'mp-1');
            const store = useAppStore.getState();
            expect(store.setMatchPlans).toHaveBeenCalledWith([]);
        });

        it('should remove a sub team by ID', () => {
            handleRealtimeDelete('sub_teams', 'st-1');
            const store = useAppStore.getState();
            expect(store.setSubTeams).toHaveBeenCalledWith([]);
        });

        it('should clear the deleted season’s checklist', () => {
            // The checklist row id IS the season id (blob sync has no per-record identity,
            // so the id has to be derived from something two offline devices already agree
            // on). A DELETE therefore names the season whose list went away.
            handleRealtimeDelete('checklists', 'season-1');
            const store = useAppStore.getState();
            expect(store.setChecklistForSeason).toHaveBeenCalledWith('season-1', []);
        });

        it('should remove a deleted TEMPLATE from the library, not a season’s checklist', () => {
            // Templates live in the same table as working checklists but carry their own
            // generated id. Treating one as a season id would file an empty list under a key
            // that is not a season AND leave the template in the library.
            handleRealtimeDelete('checklists', 'tpl-1');
            const store = useAppStore.getState();
            expect(store.setChecklistTemplates).toHaveBeenCalledWith([]);
            expect(store.setChecklistForSeason).not.toHaveBeenCalledWith('tpl-1', []);
        });

        it('should not throw for unknown table names', () => {
            expect(() => handleRealtimeDelete('unknown_table', 'id-1')).not.toThrow();
        });
    });

    describe('Realtime event callbacks', () => {
        it('should call mergeIntoStore for INSERT events', async () => {
            setupRealtimeSubscription('team-123');

            // Find the INSERT callback for tasks
            const insertCall = mockOn.mock.calls.find(
                (call: any[]) => call[1]?.event === 'INSERT' && call[1]?.table === 'tasks'
            );
            expect(insertCall).toBeDefined();

            // Simulate an INSERT event
            const callback = insertCall![2];
            await callback({ new: { id: 'new-task', title: 'New Task', team_id: 'team-123' } });

            expect(mockMergeIntoStore).toHaveBeenCalledWith(
                'tasks',
                [{ id: 'new-task', title: 'New Task', team_id: 'team-123' }],
                expect.any(Set),
            );
        });

        it('should call mergeIntoStore for UPDATE events on non-checklist tables', async () => {
            setupRealtimeSubscription('team-123');

            const updateCall = mockOn.mock.calls.find(
                (call: any[]) => call[1]?.event === 'UPDATE' && call[1]?.table === 'tasks'
            );
            const callback = updateCall![2];
            await callback({ new: { id: 'task-1', title: 'Updated', team_id: 'team-123' } });

            expect(mockMergeIntoStore).toHaveBeenCalledWith(
                'tasks',
                [{ id: 'task-1', title: 'Updated', team_id: 'team-123' }],
                expect.any(Set),
            );
        });

        it('should call updateLocalDatabase for UPDATE events on checklists', async () => {
            setupRealtimeSubscription('team-123');

            const updateCall = mockOn.mock.calls.find(
                (call: any[]) => call[1]?.event === 'UPDATE' && call[1]?.table === 'checklists'
            );
            const callback = updateCall![2];
            await callback({ new: { id: 'cl-1', items: [{ id: '1', text: 'Updated', checked: true }] } });

            expect(mockUpdateLocalDatabase).toHaveBeenCalledWith(
                'checklists',
                [{ id: 'cl-1', items: [{ id: '1', text: 'Updated', checked: true }] }],
                expect.any(Set),
            );
        });

        it('should handle DELETE events by removing the record', async () => {
            setupRealtimeSubscription('team-123');

            const deleteCall = mockOn.mock.calls.find(
                (call: any[]) => call[1]?.event === 'DELETE' && call[1]?.table === 'tasks'
            );
            const callback = deleteCall![2];
            await callback({ old: { id: 'task-1' } });

            const store = useAppStore.getState();
            expect(store.setTasks).toHaveBeenCalledWith([]);
        });
    });

    describe('subscription status callback', () => {
        it('should set status to connected on SUBSCRIBED', () => {
            const listener = vi.fn();
            onRealtimeStatusChange(listener);

            setupRealtimeSubscription('team-123');

            // Get the callback passed to subscribe()
            const subscribeCallback = mockSubscribe.mock.calls[0][0];
            subscribeCallback('SUBSCRIBED');

            expect(listener).toHaveBeenCalledWith('connected');
        });

        it('should set status to disconnected on CHANNEL_ERROR', () => {
            const listener = vi.fn();
            onRealtimeStatusChange(listener);

            setupRealtimeSubscription('team-123');

            const subscribeCallback = mockSubscribe.mock.calls[0][0];
            subscribeCallback('CHANNEL_ERROR');

            expect(listener).toHaveBeenCalledWith('disconnected');
        });

        it('should set status to disconnected on TIMED_OUT', () => {
            const listener = vi.fn();
            onRealtimeStatusChange(listener);

            setupRealtimeSubscription('team-123');

            const subscribeCallback = mockSubscribe.mock.calls[0][0];
            subscribeCallback('TIMED_OUT');

            expect(listener).toHaveBeenCalledWith('disconnected');
        });
    });

    /**
     * SYNC-04 — a hidden tab gives up its socket.
     *
     * The constraint is CONNECTIONS, not messages. Supabase's free tier allows 200 concurrent
     * realtime connections and a team meeting is 8–15 devices, so 15–25 teams meeting on the same
     * evening saturates it; later joiners get `CHANNEL_ERROR` and fall back to the pull path,
     * which is exactly the expensive path SYNC-03 exists to avoid. A phone in a pocket with the
     * app still open is a connection nobody is reading.
     *
     * WHAT WOULD MAKE THESE FAIL: tearing down immediately rather than after the delay (the first
     * test), never tearing down (the second), not reconnecting (the third), or reconnecting
     * without closing the gap the disconnection left (the fourth). Each is a plausible way to
     * write this and each is wrong in a different direction.
     */
    describe('SYNC-04 — hidden tabs release the socket', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            resetVisibilityStateForTests();
        });

        afterEach(() => {
            vi.useRealTimers();
            resetVisibilityStateForTests();
        });

        /** jsdom's `document.hidden` is read-only; this is how the platform is simulated. */
        const setHidden = (hidden: boolean) => {
            Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
        };

        it('does NOT tear down for an ordinary tab switch', () => {
            setupRealtimeSubscription('team-123');
            asSpy(supabase!.removeChannel).mockClear();

            setHidden(true);
            handleVisibilityChange(true);
            vi.advanceTimersByTime(HIDDEN_TEARDOWN_MS - 1);

            expect(
                supabase!.removeChannel,
                'a tab switched away for under two minutes lost its socket',
            ).not.toHaveBeenCalled();
            expect(getRealtimeStatus()).not.toBe('disconnected');
        });

        it('tears down once the tab has been hidden for the whole delay', () => {
            setupRealtimeSubscription('team-123');
            asSpy(supabase!.removeChannel).mockClear();

            setHidden(true);
            handleVisibilityChange(true);
            vi.advanceTimersByTime(HIDDEN_TEARDOWN_MS);

            expect(supabase!.removeChannel).toHaveBeenCalledTimes(1);
            expect(getRealtimeStatus()).toBe('disconnected');
        });

        it('does not tear down if the tab came back before the timer fired', () => {
            /*
             * The timer is re-checked at fire time rather than trusting the flag it was armed
             * with. `docs/failure-modes.md` §11 is four sprints of timers bound to the wrong
             * moment — including one cleared by the very case it was meant to cover.
             */
            setupRealtimeSubscription('team-123');
            asSpy(supabase!.removeChannel).mockClear();

            setHidden(true);
            handleVisibilityChange(true);
            vi.advanceTimersByTime(HIDDEN_TEARDOWN_MS / 2);

            setHidden(false);
            handleVisibilityChange(false);
            vi.advanceTimersByTime(HIDDEN_TEARDOWN_MS * 2);

            expect(supabase!.removeChannel).not.toHaveBeenCalled();
        });

        it('reconnects and closes the gap when the tab comes back', () => {
            setupRealtimeSubscription('team-123');
            setHidden(true);
            handleVisibilityChange(true);
            vi.advanceTimersByTime(HIDDEN_TEARDOWN_MS);
            asSpy(supabase!.channel).mockClear();
            mockFetchTeamData.mockClear();

            setHidden(false);
            handleVisibilityChange(false);

            expect(supabase!.channel).toHaveBeenCalledWith('team-team-123');
            /*
             * And a pull, because nothing was listening while the socket was down. The periodic
             * reconciliation would catch up eventually, and "eventually" is not what somebody who
             * has just come back to the tab is looking at.
             */
            expect(mockFetchTeamData, 'came back to a stale board').toHaveBeenCalledWith('team-123');
        });

        it('does nothing on a resume that never suspended', () => {
            // A tab that was only ever visible must not reconnect to a team it did not choose,
            // or pull on every `visibilitychange` the browser happens to emit.
            setupRealtimeSubscription('team-123');
            asSpy(supabase!.channel).mockClear();
            mockFetchTeamData.mockClear();

            setHidden(false);
            handleVisibilityChange(false);

            expect(supabase!.channel).not.toHaveBeenCalled();
            expect(mockFetchTeamData).not.toHaveBeenCalled();
        });
    });
});
