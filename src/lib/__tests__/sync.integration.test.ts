import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSync, mergeIntoStore } from '../sync';
import { useAppStore } from '../store';
import { db, queueForSync } from '../offline-db';
import { supabaseSync } from '../supabase';
import { useAuth } from '../auth';

// Mock Supabase to test Sync Queue without network
vi.mock('../supabase', () => {
    function createMockQuery() {
        const obj: any = {};
        obj.select = vi.fn().mockReturnValue(obj);
        obj.eq = vi.fn().mockReturnValue(obj);
        obj.gte = vi.fn().mockReturnValue(obj);
        obj.update = vi.fn().mockReturnValue(obj);
        obj.delete = vi.fn().mockReturnValue(obj);
        obj.upsert = vi.fn().mockReturnValue(obj);
        
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
    };
});

vi.mock('../auth', () => ({
    useAuth: vi.fn(),
}));

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
                    tags: [],
                    checklist: [],
                    timeline: [],
                    createdAt: 1000,
                    seasonId: 'test-season-456'
                }
            ],
            scoutingReports: [],
            matchPlans: [],
            subTeams: [],
            checklist: [],
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
            expect(store.scoutingReports[0].hasAutonomous).toBe(true);

            expect(store.subTeams.length).toBe(1);
            expect(store.subTeams[0].name).toBe('Programming');
            expect(store.subTeams[0].memberIds).toEqual(['u1', 'u2']);
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
                    gte: vi.fn().mockReturnThis(),
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
