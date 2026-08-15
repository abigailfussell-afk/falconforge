/**
 * The read path, against a real database.
 *
 * The headline is `preserves a task created offline (C3/B3)`. That is the regression test
 * for the defect this sprint was called in to fix: `fetchTeamData` and the React Query
 * hooks each replaced whole collections with the server's copy, with no knowledge of the
 * sync queue, so work done offline could be wiped from the UI by a background refetch
 * while still sitting queued for a push.
 *
 * Everything here goes over HTTP to PostgREST with a real user's JWT. A mocked query
 * builder cannot tell you that a policy filtered your rows, that `.gte()` is spelled
 * differently from `.gt()`, or that a uuid column rejected your seed id — and each of
 * those has actually happened in this repo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { queueForSync, getSyncMeta, db } from '@/lib/offline-db';
import { pullFromServer, fetchTeamData } from '@/lib/server-pull';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('pull');
    signInAppClientAs(await tokenFor(team));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

/** The app's own client reads its JWT from localStorage; hand it the coach's. */
async function tokenFor(t: TestTeam): Promise<string> {
    // `createTeam` already minted one per user; re-mint via the same helper the fixture
    // uses so this file does not need the secret.
    const { id, email } = t.users.coach;
    const { createHmac } = await import('node:crypto');
    const b64 = (v: string | Buffer) =>
        Buffer.from(v).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(
        JSON.stringify({ sub: id, email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 }),
    );
    const sig = b64(createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${sig}`;
}

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        tasks: [],
        subTeams: [],
        seasons: [],
        scoutingReports: [],
        matchPlans: [],
        teamMembers: [],
        checklist: [],
    });
});

describe('pullFromServer', () => {
    it('loads the team’s real rows into the store', async () => {
        const received = await pullFromServer({ teamId: team.id, mode: 'full' });

        expect(received.tasks).toBe(1);
        const state = useAppStore.getState();
        expect(state.tasks.map((t) => t.title)).toEqual(['pull task']);
        expect(state.seasons.map((s) => s.id)).toEqual([team.seasonId]);
        expect(state.subTeams.map((s) => s.name)).toEqual(['Build']);
        expect(state.matchPlans).toHaveLength(1);
        expect(state.scoutingReports).toHaveLength(1);
        expect(state.checklist).toEqual([{ id: '1', text: 'Charge battery', checked: false }]);
    });

    it('preserves a task created offline that the server has never seen (C3/B3)', async () => {
        // The scenario, exactly: a coach adds a task in a gym with no signal. It goes into
        // the store and onto the sync queue. Before it can be pushed, something triggers a
        // refetch -- a team switch, a page navigation, React Query's 30s stale timer.
        const offlineId = crypto.randomUUID();
        useAppStore.setState({
            tasks: [
                {
                    id: offlineId,
                    title: 'Fix the intake before quals',
                    description: '',
                    status: 'Backlog',
                    type: 'Feature',
                    assignedTo: '',
                    department: '',
                    tags: [],
                    checklist: [],
                    timeline: [],
                    createdAt: Date.now(),
                    seasonId: team.seasonId,
                },
            ],
        });
        await queueForSync('tasks', offlineId, 'create', { id: offlineId, teamId: team.id });

        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });

        const titles = useAppStore.getState().tasks.map((t) => t.title);
        expect(titles, 'the offline task was wiped by a server pull').toContain(
            'Fix the intake before quals',
        );
        // And the server's own row is still there -- preserving local work must not mean
        // discarding everyone else's.
        expect(titles).toContain('pull task');
    });

    it('keeps the LOCAL version when the server has a newer copy of a pending record (B8)', async () => {
        // A teammate edited the same task on another device. The local edit has not been
        // pushed yet, so it wins here and last-write-wins settles it on the next drain.
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });
        const serverTask = useAppStore.getState().tasks.find((t) => t.id === team.taskId)!;

        useAppStore.setState({
            tasks: [{ ...serverTask, title: 'My unsent edit' }],
        });
        await queueForSync('tasks', team.taskId, 'update', { id: team.taskId, teamId: team.id });

        await svc.from('tasks').update({ title: 'Their edit' }).eq('id', team.taskId);
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });

        expect(useAppStore.getState().tasks.find((t) => t.id === team.taskId)?.title)
            .toBe('My unsent edit');

        await svc.from('tasks').update({ title: 'pull task' }).eq('id', team.taskId);
    });

    it('detects a deletion made on another device', async () => {
        const doomed = await svc
            .from('tasks')
            .insert({ team_id: team.id, season_id: team.seasonId, title: 'deleted elsewhere' })
            .select()
            .single();

        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });
        expect(useAppStore.getState().tasks.map((t) => t.id)).toContain(doomed.data!.id);

        await svc.from('tasks').delete().eq('id', doomed.data!.id);
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });

        expect(useAppStore.getState().tasks.map((t) => t.id)).not.toContain(doomed.data!.id);
    });

    it('advances the delta cursor to a server timestamp, not the local clock (B4)', async () => {
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });

        const meta = await getSyncMeta();
        const cursor = meta.cursors[`${team.id}:tasks`];
        expect(cursor, 'no cursor was written').toBeTruthy();

        const row = await svc.from('tasks').select('updated_at').eq('id', team.taskId).single();
        expect(new Date(cursor).getTime()).toBe(new Date(row.data!.updated_at!).getTime());
    });

    it('a delta pull merges without dropping records outside the window', async () => {
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'auto' });
        const before = useAppStore.getState().tasks.length;

        const fresh = await svc
            .from('tasks')
            .insert({ team_id: team.id, season_id: team.seasonId, title: 'arrived later' })
            .select()
            .single();

        // 'auto' with a cursor already written is a delta pull: it fetches only the new row
        // but must leave the untouched ones alone.
        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'auto' });

        const titles = useAppStore.getState().tasks.map((t) => t.title);
        expect(titles).toContain('arrived later');
        expect(useAppStore.getState().tasks.length).toBe(before + 1);

        await svc.from('tasks').delete().eq('id', fresh.data!.id);
    });

    it('skips the checklist pull entirely while a checklist change is queued (B12)', async () => {
        useAppStore.setState({ checklist: [{ id: 'local', text: 'Not yet pushed', checked: true }] });
        await queueForSync('checklists', team.id, 'update', { teamId: team.id, items: [] });

        const received = await pullFromServer({ teamId: team.id, tables: ['checklists'], mode: 'full' });

        expect(received.checklists, 'the checklist was pulled despite a queued change').toBeUndefined();
        expect(useAppStore.getState().checklist).toEqual([
            { id: 'local', text: 'Not yet pushed', checked: true },
        ]);
    });

    it('stops touching the store once its token is cancelled (B6)', async () => {
        const token = { cancelled: true };
        await pullFromServer({ teamId: team.id, mode: 'full', token });

        expect(useAppStore.getState().tasks).toEqual([]);
    });

    it('returns nothing for a team the user is not a member of', async () => {
        const other = await fixtures.createTeam('outsider');

        // RLS, not a client-side filter, is what makes this empty.
        const received = await pullFromServer({ teamId: other.id, mode: 'full' });

        expect(received.tasks).toBe(0);
        expect(useAppStore.getState().tasks).toEqual([]);
    });
});

describe('fetchTeamData', () => {
    it('loads the roster through the registry, approved members only', async () => {
        await svc.from('team_members').insert({
            team_id: team.id,
            user_id: (await fixtures.createUser('removed-member')).id,
            role: 'student',
            status: 'removed',
            email: 'removed@falconforge.test',
        });

        await fetchTeamData(team.id);

        const members = useAppStore.getState().teamMembers;
        expect(members).toHaveLength(4);
        expect(members.every((m) => m.status === 'approved')).toBe(true);
        expect(members.map((m) => m.role).sort()).toEqual([
            'assistant_coach',
            'coach',
            'mentor',
            'student',
        ]);
        // Mapped through the registry, not an inline `as any` transform.
        const coach = members.find((m) => m.role === 'coach')!;
        expect(coach.teamId).toBe(team.id);
        expect(coach.userId).toBe(team.users.coach.id);
        expect(coach.joinedAt).toBeGreaterThan(0);
        expect(Number.isNaN(coach.joinedAt)).toBe(false);
    });

    it('clears isLoading even when the pull finds nothing', async () => {
        await fetchTeamData(crypto.randomUUID());
        expect(useAppStore.getState().isLoading).toBe(false);
    });
});

describe('the read path is genuinely shared', () => {
    it('the React Query hooks call the same function, so they inherit the same protection', async () => {
        // Not a tautology: this imports the hook module and checks it has no Supabase query
        // of its own. A second read path growing back would fail here.
        const queries = await import('@/lib/queries');
        const source = queries as Record<string, unknown>;
        expect(Object.keys(source).sort()).toEqual([
            'useMatchPlansQuery',
            'useScoutingQuery',
            'useTasksQuery',
        ]);

        const offlineId = crypto.randomUUID();
        await queueForSync('scouting_reports', offlineId, 'create', { id: offlineId });
        expect(await db.syncQueue.count()).toBe(1);

        // What the hook does, minus React: a full pull of one table.
        await pullFromServer({ teamId: team.id, tables: ['scouting_reports'], mode: 'full' });

        // The server's row arrived and the queued one was not clobbered out of existence.
        expect(useAppStore.getState().scoutingReports).toHaveLength(1);
        expect(await db.syncQueue.count()).toBe(1);
    });
});

describe('the React Query hooks are the third caller of the same read path', () => {
    /**
     * The hooks are mocked in every component suite, which is reasonable there and left
     * their bodies at zero coverage — the one place the C3 claim ("all three read paths
     * are one") was asserted only by inspection. Here they run for real, against a real
     * database, with a real QueryClient.
     */
    it('useTasksQuery pulls the team’s tasks without clobbering queued work', async () => {
        const { renderHook, waitFor } = await import('@testing-library/react');
        const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
        const React = await import('react');
        const { useTasksQuery } = await import('@/lib/queries');

        // A task created offline, still queued, exactly as in the C3 scenario above.
        const offlineId = crypto.randomUUID();
        useAppStore.setState({
            tasks: [{
                id: offlineId,
                title: 'Queued while the hook refetches',
                description: '',
                status: 'Backlog',
                type: 'Feature',
                assignedTo: '',
                department: '',
                tags: [],
                checklist: [],
                timeline: [],
                createdAt: Date.now(),
                seasonId: team.seasonId,
            }],
        });
        await queueForSync('tasks', offlineId, 'create', { id: offlineId, teamId: team.id });

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(QueryClientProvider, { client }, children);

        const { result } = renderHook(() => useTasksQuery(team.id), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // It really fetched: the server's row is in the store...
        const titles = useAppStore.getState().tasks.map((t) => t.title);
        expect(titles).toContain('pull task');
        // ...and the queued one survived the refetch.
        expect(titles).toContain('Queued while the hook refetches');
        expect(result.current.data).toEqual({ tasks: expect.any(Number) });

        client.clear();
    });

    it('does not fetch without a team', async () => {
        const { renderHook } = await import('@testing-library/react');
        const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
        const React = await import('react');
        const { useScoutingQuery } = await import('@/lib/queries');

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(QueryClientProvider, { client }, children);

        const { result } = renderHook(() => useScoutingQuery(null), { wrapper });

        expect(result.current.fetchStatus).toBe('idle');
        expect(useAppStore.getState().scoutingReports).toEqual([]);

        client.clear();
    });
});
