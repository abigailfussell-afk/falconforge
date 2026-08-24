import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSync } from '../sync';
import { mergeIntoStore } from '../server-pull';
import { useAppStore } from '../store';
import { db, queueForSync } from '../offline-db';
import { supabaseSync } from '../supabase';
import { useAuth } from '../auth';

/*
 * Mock Supabase to test the sync queue without a network.
 *
 * A hand-rolled query builder is a second, worse implementation of PostgREST, and this one has
 * already drifted once: it stubbed `.gt()` while the code called `.gte()`, so the delta path
 * had never run. The builder below therefore stubs every method the read path uses —
 * `.order()`, `.limit()` and `.or()` are the pagination added for SYNC-01 — and a method it
 * does NOT stub throws rather than returning undefined, so the next drift is a failure here
 * instead of a silently skipped table.
 */
vi.mock('../supabase', () => {
    function createMockQuery() {
        const obj: any = {};
        for (const method of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit', 'update', 'delete', 'upsert']) {
            obj[method] = vi.fn().mockReturnValue(obj);
        }

        // Ensure thenable resolves correctly
        obj.then = function (resolve: (value: any) => void) {
            resolve({ data: [], error: null });
            return obj;
        };
        return obj;
    }

    return {
        supabaseSync: {
            from: vi.fn(() => createMockQuery()),
        },
        // The pull refuses to run without a signed-in user's token (SYNC-02). These tests are
        // about the queue, so they get one.
        resolveSyncAccessTokenAsync: vi.fn(async () => 'a-user-jwt'),
        resolveSyncAccessToken: vi.fn(() => 'a-user-jwt'),
        isAuthenticatedToken: vi.fn(() => true),
    };
});

vi.mock('../auth', () => ({
    useAuth: vi.fn(),
}));

/** The module mock's `from`, typed once rather than cast at each use (the type-escape ratchet). */
const fromSpy = () => supabaseSync!.from as unknown as ReturnType<typeof vi.fn>;

describe('sync.integration', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        localStorage.clear();
        await db.syncQueue.clear();
        useAppStore.setState({
            currentTeamId: 'test-team-123',
            currentSeasonId: 'test-season-456',
            tasks: [
                {
                    id: 'existing-task',
                    title: 'Existing',
                    description: '',
                    status: 'To Do',
                    type: 'Feature',
                    assignedTo: '',
                    department: '',
                    checklist: [],
                    timeline: [],
                    createdAt: 1000,
                    seasonId: 'test-season-456'
                }
            ],
            scoutingReports: [],
            matchPlans: [],
            subTeams: [],
            checklistsBySeason: {},
        });
        
        (useAuth as any).mockReturnValue({
            session: { user: { id: 'test-user' } },
            isLoading: false,
        });

        // Mock navigator online status
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('mergeIntoStore delta pulls', () => {
        it('merges new tasks and updates existing ones', () => {
            const serverRecords = [
                {
                    id: 'existing-task',
                    title: 'Updated Title',
                    status: 'In Progress',
                    type: 'Feature',
                    team_id: 'test-team-123',
                    season_id: 'test-season-456',
                    created_at: new Date(1000).toISOString(),
                },
                {
                    id: 'new-task',
                    title: 'Brand New Task',
                    status: 'To Do',
                    type: 'Bug',
                    team_id: 'test-team-123',
                    season_id: 'test-season-456',
                    created_at: new Date(2000).toISOString(),
                }
            ];

            mergeIntoStore('tasks', serverRecords);

            const store = useAppStore.getState();
            expect(store.tasks.length).toBe(2);
            
            const existing = store.tasks.find(t => t.id === 'existing-task');
            expect(existing?.title).toBe('Updated Title');
            expect(existing?.status).toBe('In Progress');

            const newTask = store.tasks.find(t => t.id === 'new-task');
            expect(newTask?.title).toBe('Brand New Task');
            expect(newTask?.type).toBe('Bug');
        });

        it('merges scouting reports and sub_teams', () => {
            const srRecords = [{
                id: 'sr-1',
                opponent_team_number: '1234',
                match_number: 1,
                data: { hasAutonomous: true, autoScore: 10 },
                team_id: 'test-team-123'
            }];

            const stRecords = [{
                id: 'st-1',
                name: 'Programming',
                member_ids: ['u1', 'u2'],
                team_id: 'test-team-123'
            }];

            mergeIntoStore('scoutingReports', srRecords);
            mergeIntoStore('subTeams', stRecords);

            const store = useAppStore.getState();
            expect(store.scoutingReports.length).toBe(1);
            expect(store.scoutingReports[0].teamNumber).toBe('1234');
            expect(store.scoutingReports[0].data.hasAutonomous).toBe(true);

            expect(store.subTeams.length).toBe(1);
            expect(store.subTeams[0].name).toBe('Programming');
            expect(store.subTeams[0].memberIds).toEqual(['u1', 'u2']);
        });
    });


    /**
     * SYNC-13 — what the user is TOLD about a long drain.
     *
     * The drain's own behaviour is covered against a real database in `sync-drain.db.test.ts`.
     * This is the other half: a run that pushed some of the queue and then stalled must not be
     * reported as a failure, because it is not one — the indicator's queue count already says
     * what is left, in amber, and "Sync Error" in red over sixty successful pushes is the whole
     * of what SYNC-13 was.
     *
     * The clock is a spy rather than a wait. `Date.now` is what `progressDeadline` reads, and the
     * mocked query advances it, so "time passed during the request" is expressed where it
     * actually passes rather than by sleeping.
     */
    describe('SYNC-13 — a stall that made progress is not a failure', () => {
        /** Advance this from the mocked query to simulate a slow request. */
        let clock = 0;

        /**
         * The module mock's own `from` implementation, put back afterwards.
         *
         * `vi.restoreAllMocks()` in the outer `afterEach` restores SPIES; it does not undo a
         * `mockImplementation` set on a `vi.fn()` that a module factory created. Without this,
         * the queries these tests install leak into every test that runs after them — which is
         * how "processes queue operations" started failing with `expected 2 to be 0` while this
         * block was being written, for reasons that had nothing to do with it.
         */
        let defaultFrom: Parameters<ReturnType<typeof fromSpy>['mockImplementation']>[0] | undefined;

        beforeEach(() => {
            clock = 0;
            defaultFrom = fromSpy().getMockImplementation();
            vi.spyOn(Date, 'now').mockImplementation(() => clock);
        });

        afterEach(() => {
            if (defaultFrom) fromSpy().mockImplementation(defaultFrom);
        });

        const queryFor = (onWrite: (n: number) => { data: unknown; error: unknown }) => {
            let writes = 0;
            return (table: string) => {
                const obj: any = {};
                let isWrite = false;
                for (const m of ['select', 'eq', 'in', 'gte', 'or', 'order', 'limit']) {
                    obj[m] = vi.fn().mockReturnValue(obj);
                }
                /*
                 * Keyed on the WRITE methods, not on a call counter.
                 *
                 * The first version counted every `then` in the run and made the first one
                 * succeed — and the first one was not a push. Nothing in the drain announces
                 * itself, so a counter over an unknown call order is a test asserting on the
                 * order rather than on the behaviour: it reported `pushed: 0` and the assertion
                 * failed for a reason that had nothing to do with SYNC-13.
                 */
                for (const m of ['update', 'delete', 'upsert', 'insert']) {
                    obj[m] = vi.fn((...args: unknown[]) => {
                        if (table === 'tasks') isWrite = true;
                        void args;
                        return obj;
                    });
                }
                obj.then = function (resolve: (v: any) => void) {
                    if (!isWrite) {
                        resolve({ data: [], error: null });
                        return obj;
                    }
                    resolve(onWrite(++writes));
                    return obj;
                };
                return obj;
            };
        };

        /**
         * Every run pushes one item, then loses the whole budget at once.
         *
         * Odd writes land; even writes are refused and burn 31 seconds, which is over the budget,
         * so the item after each refusal finds an expired deadline and the drain stops. Result:
         * EVERY run stalls, and every run has pushed something — which is the shape the fix is
         * about, held for every run rather than only the first.
         *
         * That last property is what makes the test stable. `useSync` re-arms its own retry
         * schedule, so a mock that eventually produced a run pushing NOTHING would set the error
         * state for a reason unrelated to what is being asserted, once in a while.
         *
         * The first version of this used 11-second refusals and never stalled at all — the
         * successes in between kept resetting the budget — so the test passed with the fix
         * REVERTED. Caught by the revert pass, which is the only thing that catches this.
         */
        const stallAfterOnePush = () => {
            fromSpy().mockImplementation(
                queryFor((n) => {
                    if (n % 2 === 1) return { data: [], error: null };
                    clock += 31_000;
                    return { data: null, error: { message: 'gateway timeout' } };
                }),
            );
        };

        it('reports idle, not error, when the queue is only partly drained', async () => {
            stallAfterOnePush();
            for (let i = 0; i < 6; i++) {
                await queueForSync('tasks', `slow-${i}`, 'create', {
                    id: `slow-${i}`, teamId: 'test-team-123', seasonId: 'test-season-456',
                });
            }

            /*
             * WAIT FOR THE RUN THE HOOK STARTS ITSELF, rather than starting a second one.
             *
             * `useSync` auto-syncs on mount when the queue is non-empty, and `sync()` returns
             * immediately if one is already in flight (`syncingRef`). So `await
             * result.current.sync()` inside `act` resolves against a no-op while the real run is
             * still going, and the assertion reads `'syncing'` — which is what this test did at
             * first, and it looked exactly like the fix not working.
             */
            const { result, unmount } = renderHook(() => useSync());

            // Something landed, so a run made progress — the precondition the assertion below is
            // about, and asserting it first is what stops that assertion passing before the run
            // has done anything at all.
            await waitFor(async () => expect(await db.syncQueue.count()).toBeLessThan(6), {
                timeout: 5_000,
            });

            /*
             * SAMPLED, not read once. The error state is set at the END of a run and cleared at
             * the START of the next, so a single read can land in the gap and pass against the
             * defect. Half a second covers the first retry (3s backoff), so with the rule
             * reverted at least one of these twenty samples is non-null.
             */
            const samples: (string | null)[] = [];
            for (let i = 0; i < 20; i++) {
                samples.push(result.current.error);
                await new Promise((r) => setTimeout(r, 25));
            }

            expect(
                samples.filter(Boolean),
                'a partly-drained queue was reported as a failure',
            ).toEqual([]);
            expect(result.current.syncStatus).not.toBe('error');

            unmount();
        });

        it('still reports an error when NOTHING could be pushed', async () => {
            // Every request fails and each burns 11s. Nothing lands, so there is nothing to
            // reassure anybody about and the red state is the honest one.
            fromSpy().mockImplementation(
                queryFor(() => {
                    clock += 11_000;
                    return { data: null, error: { message: 'gateway timeout' } };
                }),
            );

            for (let i = 0; i < 6; i++) {
                await queueForSync('tasks', `dead-${i}`, 'create', {
                    id: `dead-${i}`, teamId: 'test-team-123', seasonId: 'test-season-456',
                });
            }

            const { result, unmount } = renderHook(() => useSync());
            await waitFor(
                () => expect(result.current.error).toMatch(/no queued change could be pushed/i),
                { timeout: 5_000 },
            );

            expect(result.current.syncStatus).toBe('error');

            unmount();
        });
    });


    /**
     * SYNC-09 — the other tab is already draining, so this one does not.
     *
     * `sync-lock.test.ts` covers the helper. This is the assertion that the ENGINE uses it: a
     * helper nothing calls is a gate with no door (`docs/failure-modes.md` §7, four sprints and
     * seven instances), and the only way to know is to hold the lock and watch a sync decline
     * to push.
     */
    describe('SYNC-09 — one drain at a time across tabs', () => {
        afterEach(() => {
            Reflect.deleteProperty(navigator, 'locks');
        });

        it('pushes nothing while another tab holds the sync lock', async () => {
            // The real API hands the callback `null` under `ifAvailable` when the lock is held.
            Object.defineProperty(navigator, 'locks', {
                value: { request: vi.fn(async (_n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb(null)) },
                configurable: true,
            });

            await queueForSync('tasks', 'locked-out', 'create', {
                id: 'locked-out', teamId: 'test-team-123', seasonId: 'test-season-456',
            });

            const { result, unmount } = renderHook(() => useSync());
            await act(async () => {
                await result.current.sync();
            });

            // The item is untouched: still queued, and never sent.
            expect(await db.syncQueue.count()).toBe(1);
            const [item] = await db.syncQueue.toArray();
            expect(item.retryCount ?? 0, 'the locked-out tab spent a retry').toBe(0);

            unmount();
        });

        it('pushes normally when the lock is free', async () => {
            // The other half. A test that only ever holds the lock would pass against a sync
            // that had simply stopped working.
            Object.defineProperty(navigator, 'locks', {
                value: { request: vi.fn(async (n: string, _o: unknown, cb: (l: unknown) => Promise<unknown>) => cb({ name: n })) },
                configurable: true,
            });

            await queueForSync('tasks', 'lock-free', 'create', {
                id: 'lock-free', teamId: 'test-team-123', seasonId: 'test-season-456',
            });

            const { result, unmount } = renderHook(() => useSync());
            await act(async () => {
                await result.current.sync();
            });

            expect(await db.syncQueue.count()).toBe(0);

            unmount();
        });
    });

    describe('useSync hook operations', () => {
        it('processes queue operations (create, update, delete) and pulls from server', async () => {
            // Setup pending sync operations
            await queueForSync('tasks', 'new-local-task', 'create', {
                id: 'new-local-task',
                title: 'Local',
                teamId: 'test-team-123'
            });
            await queueForSync('tasks', 'existing-task', 'update', {
                id: 'existing-task',
                title: 'Local Update',
                teamId: 'test-team-123'
            });
            await queueForSync('scouting_reports', 'sr-1', 'delete', null);

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            // Verification
            const pendingCount = await db.syncQueue.count();
            expect(pendingCount).toBe(0);

            const mockFrom = supabaseSync!.from as any;
            expect(mockFrom).toHaveBeenCalledWith('tasks');
            expect(mockFrom).toHaveBeenCalledWith('scouting_reports');

            const queryInstances = mockFrom.mock.results.map((r: any) => r.value);
            
            // Check that operations were correctly mapped to Supabase methods
            const upsertCalled = queryInstances.some((q: any) => q.upsert.mock.calls.length > 0);
            expect(upsertCalled).toBe(true);
            
            const updateCalled = queryInstances.some((q: any) => q.update.mock.calls.length > 0);
            expect(updateCalled).toBe(true);
            
            const deleteCalled = queryInstances.some((q: any) => q.delete.mock.calls.length > 0);
            expect(deleteCalled).toBe(true);

            // Pull changes should also be triggered
            const selectCalled = queryInstances.some((q: any) => q.select.mock.calls.length > 0);
            expect(selectCalled).toBe(true);

            unmount();
        });

        it('uses upsert for checklist updates even on update operations', async () => {
            await queueForSync('checklists', 'test-team-123', 'update', { teamId: 'test-team-123', items: [] });
            
            const { result, unmount } = renderHook(() => useSync());
            await act(async () => {
                await result.current.sync();
            });
            
            const mockFrom = supabaseSync!.from as any;
            expect(mockFrom).toHaveBeenCalledWith('checklists');
            
            const queryInstances = mockFrom.mock.results.map((r: any) => r.value);
            const upsertCalled = queryInstances.some((q: any) => q.upsert.mock.calls.length > 0);
            expect(upsertCalled).toBe(true); // checklists update uses upsert

            unmount();
        });

        it('does not sync if offline', async () => {
            vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
            
            await queueForSync('tasks', 'new-local-task', 'create', { id: 'new-local-task', teamId: 'test-team-123' });

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            expect(result.current.syncStatus).toBe('offline');
            const pendingCount = await db.syncQueue.count();
            expect(pendingCount).toBe(1);
            
            expect(supabaseSync!.from).not.toHaveBeenCalled();

            unmount();
        });

        it('does not sync if auth is not ready', async () => {
            (useAuth as any).mockReturnValue({
                session: null,
                isLoading: true,
            });
            
            await queueForSync('tasks', 'task-1', 'create', { id: 'task-1', teamId: 'test-team-123' });

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            const pendingCount = await db.syncQueue.count();
            expect(pendingCount).toBe(1);
            expect(supabaseSync!.from).not.toHaveBeenCalled();

            unmount();
        });
        
        it('handles sync item failure (retries) and retains item if below limit', async () => {
            const mockFrom = supabaseSync!.from as any;
            mockFrom.mockImplementationOnce(() => {
                const obj: any = {};
                obj.upsert = vi.fn().mockImplementation(() => {
                    return { then: (res: any) => res({ error: new Error('Network fail for upsert') }) };
                });
                return obj;
            });

            await queueForSync('tasks', 'fail-task', 'create', { id: 'fail-task', teamId: 'test-team-123' });

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            const items = await db.syncQueue.toArray();
            expect(items.length).toBe(1);
            expect(items[0].retryCount).toBe(1);
            expect(items[0].lastError).toBe('Network fail for upsert');
            
            unmount();
        });

        it('drops sync item if retryCount >= 5', async () => {
            await db.syncQueue.add({
                id: 'fail-task',
                tableName: 'tasks',
                recordId: 'fail-task',
                operation: 'create',
                data: { id: 'fail-task', teamId: 'test-team-123' },
                timestamp: Date.now(),
                retryCount: 4, // Next fail will be 5
            });

            const mockFrom = supabaseSync!.from as any;
            mockFrom.mockImplementationOnce(() => {
                const obj: any = {};
                obj.upsert = vi.fn().mockImplementation(() => {
                    return { then: (res: any) => res({ error: new Error('Network fail for upsert') }) };
                });
                return obj;
            });

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            const items = await db.syncQueue.toArray();
            expect(items.length).toBe(0); // Item should be dropped

            unmount();
        });

        it('performs delta pull when counter is not a multiple of 5 and timestamp exists', async () => {
            localStorage.setItem('falconforge-sync-counter', '1');
            localStorage.setItem('falconforge-sync-timestamps', JSON.stringify({
                'test-team-123:tasks': 1000
            }));

            // Mocking the gte specifically
            const mockFrom = supabaseSync!.from as any;
            mockFrom.mockImplementation((tableName: string) => {
                const query: any = {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    in: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    or: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    upsert: vi.fn(),
                    update: vi.fn(),
                    delete: vi.fn(),
                    then: function(resolve: any) {
                        if (tableName === 'tasks') {
                            resolve({
                                data: [{
                                    id: 'delta-task',
                                    title: 'Delta Sync Task',
                                    status: 'To Do',
                                    type: 'Feature',
                                    team_id: 'test-team-123',
                                    season_id: 'test-season-456',
                                    created_at: new Date(2000).toISOString(),
                                }],
                                error: null
                            });
                        } else {
                            resolve({ data: [], error: null });
                        }
                        return query;
                    }
                };
                return query;
            });

            const { result, unmount } = renderHook(() => useSync());

            await act(async () => {
                await result.current.sync();
            });

            // Verify store has the new delta task
            const store = useAppStore.getState();
            expect(store.tasks.find(t => t.id === 'delta-task')).toBeDefined();
            
            unmount();
        });
    });
});
