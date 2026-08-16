import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        removeChannel: vi.fn(),
    },
    supabaseSync: null,
    isSupabaseConfigured: () => true,
}));

// Realtime writes to the store through the shared read path, not through sync.ts (C3).
const mockMergeIntoStore = vi.fn();
const mockUpdateLocalDatabase = vi.fn();

vi.mock('@/lib/server-pull', () => ({
    mergeIntoStore: (...args: any[]) => mockMergeIntoStore(...args),
    updateLocalDatabase: (...args: any[]) => mockUpdateLocalDatabase(...args),
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
} from '../realtime';
import { supabase } from '../supabase';
import { useAppStore } from '../store';

// The queue is not this suite's subject: `getPendingRecordIds` is driven through the mock.
vi.mock('@/lib/offline-db');

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
            const tables = mockOn.mock.calls.map((call: any[]) => call[1]?.table);
            const distinct = [...new Set(tables)];

            expect(distinct.sort()).toEqual([
                'checklists', 'match_plans', 'scouting_reports', 'seasons', 'sub_teams', 'tasks',
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
            expect((supabase!.channel as any).mock.calls.length).toBe(firstCallCount);
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
});
