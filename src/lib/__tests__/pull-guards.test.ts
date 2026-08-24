/**
 * The three things a pull must refuse to do (SYNC-01, SYNC-02, SYNC-15).
 *
 * Each one is the same shape of defect: a full pull REPLACES the collection, so anything that
 * makes the server's answer smaller than the truth deletes rows from the device. The server is
 * mocked here — deliberately, because these are cases a real database will not produce on
 * demand: an anon-key response, a page that fails halfway through, a queue entry belonging to
 * a team that is not open. What the real database does prove lives in
 * `pull-paging-seasons.db.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Rows a table will return, page by page, or an Error to fail that page with. */
const responses = new Map<string, (any[] | Error)[]>();
/** Every `select(...)` spec the pull asked for, per table. */
const selects: { table: string; spec: string }[] = [];
/** Set by the tests: what `resolveSyncAccessTokenAsync` answers. */
let token: string | null = 'a-user-jwt';

vi.mock('../supabase', () => {
    const makeQuery = (table: string) => {
        const q: any = {};
        for (const method of ['eq', 'in', 'gte', 'or', 'order']) {
            q[method] = vi.fn().mockReturnValue(q);
        }
        q.select = vi.fn((spec: string) => {
            selects.push({ table, spec });
            return q;
        });
        q.limit = vi.fn().mockReturnValue(q);
        q.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        q.then = (resolve: (value: any) => void) => {
            const queued = responses.get(table) ?? [];
            const next = queued.shift() ?? [];
            resolve(
                next instanceof Error
                    ? { data: null, error: { message: next.message } }
                    : { data: next, error: null },
            );
            return q;
        };
        return q;
    };

    return {
        supabaseSync: { from: vi.fn((table: string) => makeQuery(table)) },
        supabase: null,
        supabaseAnonKey: 'the-anon-key',
        isSupabaseConfigured: () => true,
        resolveSyncAccessTokenAsync: vi.fn(async () => token),
        resolveSyncAccessToken: vi.fn(() => token),
        isAuthenticatedToken: vi.fn((t: string) => t === 'a-user-jwt'),
    };
});

import { pullFromServer, updateLocalDatabase, mergeIntoStore } from '../server-pull';
import { useAppStore } from '../store';
import { db, queueForSync, getSyncMeta } from '../offline-db';
import type { Task } from '@/types';

const TEAM_A = '11111111-1111-4111-8111-111111111111';
const TEAM_B = '22222222-2222-4222-8222-222222222222';
const SEASON = '33333333-3333-4333-8333-333333333333';

const localTask = (over: Partial<Task> = {}): Task => ({
    id: 'local-1',
    title: 'A task',
    description: '',
    status: 'Backlog',
    type: 'Feature',
    assignedTo: '',
    department: '',
    checklist: [],
    timeline: [],
    createdAt: 1000,
    seasonId: SEASON,
    teamId: TEAM_A,
    ...over,
});

const serverTask = (id: string, teamId = TEAM_A, updatedAt = '2026-08-20T10:00:00.000Z') => ({
    id,
    title: `server ${id}`,
    description: '',
    status: 'Backlog',
    type: 'Feature',
    assigned_to: null,
    sub_team_id: null,
    checklist: [],
    timeline: [],
    created_at: updatedAt,
    updated_at: updatedAt,
    season_id: SEASON,
    team_id: teamId,
});

beforeEach(async () => {
    responses.clear();
    selects.length = 0;
    token = 'a-user-jwt';
    await db.syncQueue.clear();
    await db.appState.clear();
    useAppStore.setState({
        currentTeamId: TEAM_A,
        currentSeasonId: SEASON,
        tasks: [],
        seasons: [],
        meetings: [],
        meetingAttendance: [],
    });
});

describe('a pull made without a signed-in user is skipped, not applied (SYNC-02)', () => {
    it('does not empty the collections when the token resolver has nothing to give', async () => {
        useAppStore.setState({ tasks: [localTask({ id: 'kept', title: 'A whole season of work' })] });
        const setTasks = vi.spyOn(useAppStore.getState(), 'setTasks');

        // The captive-portal shape: the stored JWT expired, the refresh failed, and the
        // client would have fallen back to the anon key — which `anon` holds SELECT for, so
        // PostgREST answers 200 [] and the old code read that as "everything was deleted".
        token = null;
        responses.set('tasks', [[]]);

        const received = await pullFromServer({
            teamId: TEAM_A,
            tables: ['tasks'],
            mode: 'full',
        });

        expect(setTasks, 'the collection was replaced with an anonymous request’s answer').not.toHaveBeenCalled();
        expect(useAppStore.getState().tasks.map((t) => t.id)).toEqual(['kept']);
        expect(received, 'the pull reported tables it never read').toEqual({});
    });

    it('does not even reach the server', async () => {
        const { supabaseSync } = await import('../supabase');
        token = null;

        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        expect(supabaseSync!.from).not.toHaveBeenCalled();
    });

    it('pulls normally once there is a user token again', async () => {
        useAppStore.setState({ tasks: [localTask({ id: 'kept' })] });
        responses.set('tasks', [[serverTask('server-1')]]);

        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        expect(useAppStore.getState().tasks.map((t) => t.id)).toEqual(['server-1']);
    });
});

describe('a table whose pagination fails is abandoned, not half-applied (SYNC-01)', () => {
    /** A full page, so the pull asks for another one. */
    const fullPage = (offset: number) =>
        Array.from({ length: 1000 }, (_, i) => serverTask(`p${offset + i}`));

    it('leaves the collection and the cursor alone when a later page errors', async () => {
        // First: a clean pull, so there is a cursor and a populated collection to damage.
        responses.set('tasks', [[serverTask('a', TEAM_A, '2026-08-01T00:00:00.000Z')]]);
        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        const cursorKey = `${TEAM_A}:tasks:season:${SEASON}`;
        const cursorBefore = (await getSyncMeta()).cursors[cursorKey];
        expect(cursorBefore, 'no cursor to compare against').toBeTruthy();
        expect(useAppStore.getState().tasks).toHaveLength(1);

        // Now a pull whose first page is full and whose second page fails.
        responses.set('tasks', [fullPage(0), new Error('connection reset')]);
        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        expect(
            useAppStore.getState().tasks.map((t) => t.id),
            'page one was applied on its own, deleting everything page two would have brought',
        ).toEqual(['a']);
        expect(
            (await getSyncMeta()).cursors[cursorKey],
            'the cursor advanced past rows that never arrived',
        ).toBe(cursorBefore);
    });

    it('stops at the page ceiling rather than looping for ever', async () => {
        // Every page full, for ever: a filter that stopped filtering.
        responses.set('tasks', Array.from({ length: 400 }, (_, i) => fullPage(i * 1000)));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        expect(useAppStore.getState().tasks, 'a runaway pull was applied to the store').toEqual([]);
        expect(warn.mock.calls.flat().join(' ')).toContain('incomplete');
        warn.mockRestore();
    }, 30_000);
});

describe('the season is asked for on the wire, not filtered afterwards', () => {
    it('sends an embedded inner join for meeting_attendance, which has no season_id', async () => {
        responses.set('meeting_attendance', [[]]);
        await pullFromServer({
            teamId: TEAM_A,
            seasonId: SEASON,
            tables: ['meeting_attendance'],
            mode: 'full',
        });

        const spec = selects.find((s) => s.table === 'meeting_attendance')!.spec;
        expect(spec, 'attendance was pulled for every season there has ever been').toContain('meetings!inner()');
    });

    it('never selects field_image_data with the season list', async () => {
        responses.set('seasons', [[]]);
        await pullFromServer({ teamId: TEAM_A, tables: ['seasons'], mode: 'full', seasonId: null });

        const spec = selects.find((s) => s.table === 'seasons')!.spec;
        expect(spec).not.toContain('field_image_data');
        expect(spec, 'the season pull went back to select(*)').not.toBe('*');
    });
});

describe('another team’s rows never sit in this team’s collection (SYNC-15)', () => {
    it('drops a pending record belonging to the team that is not open', async () => {
        // A coach on two teams: a task queued on Team A, then a switch to Team B.
        const queued = localTask({ id: 'queued-on-a', title: 'Team A’s card', teamId: TEAM_A });
        useAppStore.setState({ tasks: [queued], currentTeamId: TEAM_B });
        await queueForSync('tasks', queued.id, 'create', { id: queued.id, teamId: TEAM_A });

        responses.set('tasks', [[serverTask('b-task', TEAM_B)]]);
        await pullFromServer({ teamId: TEAM_B, tables: ['tasks'], mode: 'full' });

        expect(
            useAppStore.getState().tasks.map((t) => t.id),
            'Team A’s queued task is on Team B’s board',
        ).toEqual(['b-task']);

        // ...and it is still queued. Dropping it from the board must not drop the work: the
        // push reads the queue's own payload, not the store.
        expect(await db.syncQueue.count(), 'the queued change was destroyed, not just hidden').toBe(1);
    });

    it('keeps a pending record of the team that IS open (B3 is untouched)', async () => {
        const queued = localTask({ id: 'queued-on-a', teamId: TEAM_A });
        useAppStore.setState({ tasks: [queued] });
        await queueForSync('tasks', queued.id, 'create', { id: queued.id, teamId: TEAM_A });

        responses.set('tasks', [[serverTask('a-task', TEAM_A)]]);
        await pullFromServer({ teamId: TEAM_A, tables: ['tasks'], mode: 'full' });

        expect(useAppStore.getState().tasks.map((t) => t.id).sort()).toEqual(['a-task', 'queued-on-a']);
    });

    it('evicts another team’s rows on a DELTA pull too, which is what a team switch now is', () => {
        useAppStore.setState({ tasks: [localTask({ id: 'from-team-a', teamId: TEAM_A })] });

        mergeIntoStore('tasks', [serverTask('from-team-b', TEAM_B)], new Set(), { teamId: TEAM_B });

        expect(
            useAppStore.getState().tasks.map((t) => t.id),
            'a delta pull after a team switch left both teams on the board',
        ).toEqual(['from-team-b']);
    });

    it('keeps a row that does not say which team it belongs to', () => {
        // Persisted by an older build. Unknown is not a mismatch — dropping these would empty
        // the board of anybody who upgraded and had not re-pulled yet.
        const legacy = { ...localTask({ id: 'legacy' }), teamId: undefined };
        useAppStore.setState({ tasks: [legacy] });

        mergeIntoStore('tasks', [serverTask('fresh', TEAM_A)], new Set(), { teamId: TEAM_A });

        expect(useAppStore.getState().tasks.map((t) => t.id).sort()).toEqual(['fresh', 'legacy']);
    });

    it('keeps another SEASON’s rows, which is the opposite rule and deliberately so', () => {
        const lastYear = localTask({ id: 'last-year', seasonId: 'another-season', teamId: TEAM_A });
        useAppStore.setState({ tasks: [lastYear] });

        updateLocalDatabase('tasks', [serverTask('this-year', TEAM_A)], new Set(), {
            teamId: TEAM_A,
            seasonId: SEASON,
        });

        expect(useAppStore.getState().tasks.map((t) => t.id).sort()).toEqual(['last-year', 'this-year']);
    });
});
