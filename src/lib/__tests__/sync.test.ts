import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Unmock the modules we want to test with real implementations
// (setup.ts globally mocks these, but we need the real exports here)
vi.unmock('@/lib/sync');

import { withTimeout, transformToSupabaseSchema } from '../sync';
import { updateLocalDatabase } from '../server-pull';
import { useAppStore } from '../store';

describe('withTimeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should resolve when promise completes before timeout', async () => {
        const promise = Promise.resolve('success');
        const result = withTimeout(promise, 5000, 'test');
        await vi.advanceTimersByTimeAsync(0);
        await expect(result).resolves.toBe('success');
    });

    it('should reject when timeout fires before promise completes', async () => {
        const neverResolves = new Promise(() => { /* intentionally never resolves */ });
        const result = withTimeout(neverResolves, 1000, 'slow-query');

        vi.advanceTimersByTime(1001);

        await expect(result).rejects.toThrow('Timeout: slow-query after 1000ms');
    });

    it('should work with PromiseLike (thenable) objects', async () => {
        // Simulates Supabase PostgREST filter builder (thenable, not a true Promise)
        const thenable = {
            then: (resolve: (val: string) => void) => {
                resolve('thenable-result');
                return thenable;
            },
        };
        const result = withTimeout(thenable as PromiseLike<string>, 5000, 'test');
        await vi.advanceTimersByTimeAsync(0);
        await expect(result).resolves.toBe('thenable-result');
    });
});

describe('transformToSupabaseSchema', () => {
    it('should return null/undefined data as-is', () => {
        expect(transformToSupabaseSchema('tasks', null)).toBeNull();
        expect(transformToSupabaseSchema('tasks', undefined)).toBeUndefined();
    });

    it('should transform task camelCase to snake_case', () => {
        const localTask = {
            id: 'task-1',
            title: 'Test Task',
            description: 'A test',
            status: 'To Do',
            type: 'Feature',
            assignedTo: 'member-1',
            department: 'programming',
            checklist: [{ id: 'c1', text: 'item', completed: false }],
            timeline: [],
            createdAt: 1000,
            dueDate: null,
            teamId: 'team-1',
            seasonId: 'season-1',
        };

        const result = transformToSupabaseSchema('tasks', localTask);

        expect(result.id).toBe('task-1');
        expect(result.assigned_to).toBe('member-1');
        expect(result.team_id).toBe('team-1');
        expect(result.season_id).toBe('season-1');
        expect(result.sub_team_id).toBe('programming');
        expect(result.title).toBe('Test Task');
        expect(result.status).toBe('To Do');
        expect(result.due_date).toBeNull();
    });

    it('should transform scouting report camelCase to snake_case', () => {
        const report = {
            id: 'sr-1',
            teamNumber: '12345',
            matchNumber: 1,
            eventName: 'League Meet #3',
            /*
             * The game's fields, in the bag (P-01 phase S). This test's own comment already
             * said "most fields are nested under 'data'" — that has always been true of the
             * COLUMN, and what changed is that the local type now says so too, so `toRemote`
             * passes the bag through instead of enumerating ten DECODE keys.
             */
            data: {
                hasAutonomous: true,
                autoScore: 25,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 10,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Great!',
            },
            createdBy: 'user-abc-123',
            teamId: 'team-1',
            seasonId: 'season-1',
        };

        const result = transformToSupabaseSchema('scouting_reports', report);

        // Scouting reports use opponent_team_number and nest data fields
        expect(result.opponent_team_number).toBe('12345');
        expect(result.match_number).toBe(1);
        expect(result.event_name).toBe('League Meet #3');
        expect(result.created_by).toBe('user-abc-123');
        expect(result.team_id).toBe('team-1');
        // Most fields are nested under 'data'
        expect(result.data.hasAutonomous).toBe(true);
        expect(result.data.autoScore).toBe(25);
        expect(result.data.intakeType).toBe('Automatic');
        expect(result.data.autoAim).toBe(true);
        expect(result.data.farShooting).toBe(false);
        expect(result.data.shotsTaken).toBe(10);
        expect(result.data.shotsMissed).toBe(2);
        expect(result.data.endGameNotes).toBe('Great!');
    });

    it('should transform checklist camelCase to Supabase format', () => {
        // Checklists are stored as a blob with items array
        const checklist = {
            id: 'c-1',
            teamId: 'team-1',
            seasonId: 'season-1',
            items: [{ id: 'i1', text: 'Check battery', checked: true }],
        };

        const result = transformToSupabaseSchema('checklists', checklist);

        // The row id is the SEASON id, not the team id (C6): one checklist per season, and
        // an id two offline devices can both arrive at without talking to each other.
        expect(result.id).toBe('season-1');
        expect(result.season_id).toBe('season-1');
        expect(result.team_id).toBe('team-1');
        expect(result.name).toBe('Pre-Match Checklist');
        expect(result.items).toHaveLength(1);
    });

    it('should transform match plan camelCase to snake_case', () => {
        const plan = {
            id: 'mp-1',
            matchNumber: '1',
            notes: 'Focus on auto',
            drawingData: '{"lines":[]}',
            teamId: 'team-1',
            seasonId: 'season-1',
        };

        const result = transformToSupabaseSchema('match_plans', plan);

        expect(result.match_number).toBe('1');
        expect(result.drawing_data).toBe('{"lines":[]}');
        expect(result.team_id).toBe('team-1');
    });
});

describe('updateLocalDatabase', () => {
    beforeEach(() => {
        useAppStore.setState({
            currentTeamId: 'test-team',
            tasks: [
                {
                    id: 'old-task',
                    title: 'Old Task',
                    description: '',
                    status: 'To Do' as const,
                    type: 'Feature' as const,
                    assignedTo: '',
                    department: '',
                    checklist: [],
                    timeline: [],
                    createdAt: 1000,
                    dueDate: undefined,
                    seasonId: 'season-1',
                },
            ],
            scoutingReports: [],
            checklistsBySeason: {},
            matchPlans: [],
        });
    });

    it('should update tasks from Supabase snake_case data', () => {
        const supabaseData = [
            {
                id: 'task-1',
                title: 'New Task',
                description: 'From server',
                status: 'In Progress',
                type: 'Bug',
                assigned_to: 'member-1',
                team_id: 'test-team',
                season_id: 'season-1',
                checklist: [],
                timeline: [],
                created_at: '2026-01-01T00:00:00Z',
                due_date: null,
            },
        ];

        updateLocalDatabase('tasks', supabaseData);

        const tasks = useAppStore.getState().tasks;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe('task-1');
        expect(tasks[0].title).toBe('New Task');
        expect(tasks[0].assignedTo).toBe('member-1');
    });

    it('should clear tasks when server returns empty array (deletion propagation)', () => {
        // Verify we start with data
        expect(useAppStore.getState().tasks).toHaveLength(1);

        // Simulate server returning empty results (all tasks were deleted by another client)
        updateLocalDatabase('tasks', []);

        // Store should now have empty tasks, NOT the old data
        expect(useAppStore.getState().tasks).toHaveLength(0);
    });

    it('should handle null records gracefully', () => {
        // Should not throw or crash
        updateLocalDatabase('tasks', null as any);

        // Original data should remain unchanged
        expect(useAppStore.getState().tasks).toHaveLength(1);
    });
});

describe('sync timestamp management', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('should store and retrieve timestamps from localStorage', () => {
        const key = 'falconforge-sync-timestamps';
        const entityKey = 'test-team:tasks';
        const timestamp = Date.now();

        const current = JSON.parse(localStorage.getItem(key) || '{}');
        current[entityKey] = timestamp;
        localStorage.setItem(key, JSON.stringify(current));

        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        expect(stored[entityKey]).toBe(timestamp);
    });

    it('should preserve existing timestamps when adding new ones', () => {
        const key = 'falconforge-sync-timestamps';
        localStorage.setItem(key, JSON.stringify({ 'team:tasks': 1000 }));

        const current = JSON.parse(localStorage.getItem(key) || '{}');
        current['team:checklists'] = 2000;
        localStorage.setItem(key, JSON.stringify(current));

        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        expect(stored['team:tasks']).toBe(1000);
        expect(stored['team:checklists']).toBe(2000);
    });
});
