/**
 * The sync drain loop, against a real database.
 *
 * `sync.ts` had 13% branch coverage. The queue mechanics were well tested — coalescing,
 * ordering, dead-lettering — but always against a hand-written mock of the Supabase query
 * builder, so what the drain *sends* had never been checked against a schema that could
 * reject it. That distinction is not academic: the mock stubbed `.gt()` while the code
 * calls `.gte()`, and nobody found out for months, because a mock cannot fail the way a
 * database does.
 *
 * Here a push either lands in Postgres, satisfying every constraint and policy, or it
 * doesn't. The failures exercised below are real ones: a CHECK constraint rejecting a
 * value, a foreign key pointing at another tenant, RLS refusing a write.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import {
    db,
    queueForSync,
    getPendingSyncItems,
    getSyncFailures,
    retrySyncFailures,
} from '@/lib/offline-db';
import { drainSyncQueue, processSyncItem, MAX_SYNC_RETRIES } from '@/lib/sync';
import { pullFromServer } from '@/lib/server-pull';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('drain');

    // Sign the APP's own client in as the coach, so the drain under test pushes with a real
    // JWT and is subject to RLS exactly as the browser is.
    signInAppClientAs(mintAccessToken(team.users.coach.id, team.users.coach.email));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        tasks: [],
        scoutingReports: [],
        matchPlans: [],
    });
});

/** A local task payload shaped the way the store's slices queue one. */
function localTask(overrides: Record<string, unknown> = {}) {
    return {
        id: crypto.randomUUID(),
        title: 'Tune the shooter',
        description: 'Ranges are inconsistent past 3m',
        status: 'To Do',
        type: 'Feature',
        assignedTo: '',
        department: '',
        tags: ['build'],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
        teamId: team.id,
        seasonId: team.seasonId,
        ...overrides,
    };
}

describe('drainSyncQueue pushes to a real database', () => {
    it('creates a row that satisfies the real schema', async () => {
        const task = localTask();
        await queueForSync('tasks', task.id as string, 'create', task);

        const result = await drainSyncQueue();

        expect(result).toEqual({ pushed: 1, retried: 0, deadLettered: 0, terminal: 0, cancelled: false });
        expect(await db.syncQueue.count()).toBe(0);

        const row = await svc.from('tasks').select('*').eq('id', task.id as string).single();
        expect(row.error).toBeNull();
        expect(row.data!.title).toBe('Tune the shooter');
        expect(row.data!.team_id).toBe(team.id);
        expect(row.data!.season_id).toBe(team.seasonId);
        expect(row.data!.tags).toEqual(['build']);
    });

    it('round-trips a task back through the pull unchanged', async () => {
        // The registry's round-trip property, but with Postgres in the middle: column
        // types, defaults and triggers all get a say.
        const task = localTask({ dueDate: Date.UTC(2026, 2, 1), tags: ['build', 'urgent'] });
        await queueForSync('tasks', task.id as string, 'create', task);
        await drainSyncQueue();

        await pullFromServer({ teamId: team.id, tables: ['tasks'], mode: 'full' });

        const pulled = useAppStore.getState().tasks.find((t) => t.id === task.id)!;
        expect(pulled.title).toBe(task.title);
        expect(pulled.description).toBe(task.description);
        expect(pulled.status).toBe('To Do');
        expect(pulled.tags).toEqual(['build', 'urgent']);
        expect(pulled.dueDate).toBe(Date.UTC(2026, 2, 1));
        expect(pulled.seasonId).toBe(team.seasonId);
    });

    it('applies an update and then a delete, in the order the user made them (B1)', async () => {
        const task = localTask();
        await queueForSync('tasks', task.id as string, 'create', task);
        await drainSyncQueue();

        await queueForSync('tasks', task.id as string, 'update', { ...task, title: 'Renamed' });
        expect((await drainSyncQueue()).pushed).toBe(1);
        let row = await svc.from('tasks').select('title').eq('id', task.id as string).maybeSingle();
        expect(row.data!.title).toBe('Renamed');

        await queueForSync('tasks', task.id as string, 'delete', null);
        expect((await drainSyncQueue()).pushed).toBe(1);
        row = await svc.from('tasks').select('title').eq('id', task.id as string).maybeSingle();
        expect(row.data).toBeNull();
    });

    it('pushes a scouting report with its jsonb payload intact', async () => {
        const id = crypto.randomUUID();
        await queueForSync('scouting_reports', id, 'create', {
            id,
            teamId: team.id,
            seasonId: team.seasonId,
            teamNumber: '7777',
            matchNumber: 12,
            eventName: 'League Meet 3',
            // The game's fields, in the bag the column has always held them in (P-01 phase S).
            // This test's own name says "jsonb payload" — that has always been true of the
            // COLUMN; what changed is that the local type says so too, so the registry passes
            // the bag through instead of enumerating ten DECODE keys.
            data: {
                hasAutonomous: true,
                autoScore: 18,
                intakeType: 'Automatic',
                autoAim: true,
                farShooting: false,
                shotsTaken: 9,
                shotsMissed: 2,
                parking: 'Full Park',
                rating: 4,
                endGameNotes: 'Quick cycles',
            },
        });

        expect((await drainSyncQueue()).pushed).toBe(1);

        const row = await svc.from('scouting_reports').select('*').eq('id', id).single();
        expect(row.data!.match_number).toBe(12);
        expect(row.data!.data).toMatchObject({ autoScore: 18, parking: 'Full Park', rating: 4 });
    });

    it('sends match_number as NULL rather than 0 when it was not recorded (B18)', async () => {
        // The CHECK constraint is `match_number IS NULL OR match_number > 0`. A client that
        // invents 0 for "not recorded" is rejected by the database, which is the whole
        // reason the column became nullable.
        const id = crypto.randomUUID();
        await queueForSync('scouting_reports', id, 'create', {
            id,
            teamId: team.id,
            seasonId: team.seasonId,
            teamNumber: '8888',
            matchNumber: undefined,
        });

        expect((await drainSyncQueue()).pushed).toBe(1);

        const row = await svc.from('scouting_reports').select('match_number').eq('id', id).single();
        expect(row.data!.match_number).toBeNull();
    });
});

describe('a failure in the middle of a drain', () => {
    it('does not stop the items behind it from being pushed', async () => {
        const good1 = localTask({ title: 'First' });
        // Violates tasks_title_check (`char_length(trim(title)) > 0`) -- a real constraint,
        // failing the way it would in production rather than via a mocked rejection.
        const bad = localTask({ title: '   ' });
        const good2 = localTask({ title: 'Third' });

        await queueForSync('tasks', good1.id as string, 'create', good1);
        await queueForSync('tasks', bad.id as string, 'create', bad);
        await queueForSync('tasks', good2.id as string, 'create', good2);

        const result = await drainSyncQueue();

        expect(result.pushed).toBe(2);
        expect(result.retried).toBe(1);
        expect(result.deadLettered).toBe(0);

        const titles = await svc.from('tasks').select('title').in('title', ['First', 'Third']);
        expect(titles.data).toHaveLength(2);

        // The failure is still queued with its error recorded, not silently dropped.
        const remaining = await getPendingSyncItems();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].recordId).toBe(bad.id);
        expect(remaining[0].retryCount).toBe(1);
        expect(remaining[0].lastError).toBeTruthy();
    });

    it('escalates to the dead-letter store after MAX_SYNC_RETRIES, never dropping the work (B2)', async () => {
        const bad = localTask({ title: '   ' });
        await queueForSync('tasks', bad.id as string, 'create', bad);

        for (let attempt = 1; attempt < MAX_SYNC_RETRIES; attempt++) {
            const result = await drainSyncQueue();
            expect(result.retried, `attempt ${attempt}`).toBe(1);
            expect(result.deadLettered, `attempt ${attempt}`).toBe(0);
        }

        const final = await drainSyncQueue();
        expect(final.deadLettered).toBe(1);
        expect(await db.syncQueue.count()).toBe(0);

        const parked = await getSyncFailures();
        expect(parked).toHaveLength(1);
        expect(parked[0].recordId).toBe(bad.id);
        expect(parked[0].data.title).toBe('   ');
        expect(parked[0].lastError).toBeTruthy();

        // And a user-visible retry puts it back, which is the point of parking it.
        expect(await retrySyncFailures()).toBe(1);
        expect(await db.syncQueue.count()).toBe(1);
        expect((await getPendingSyncItems())[0].retryCount).toBe(0);
    });

    it('parks a write RLS refuses, rather than losing it', async () => {
        // A task aimed at another tenant. The client cannot know the policy will refuse it,
        // so the only acceptable outcome is that the change survives somewhere visible.
        const other = await fixtures.createTeam('drain-other');
        const trespass = localTask({ teamId: other.id, seasonId: other.seasonId });
        await queueForSync('tasks', trespass.id as string, 'create', trespass);

        const result = await drainSyncQueue();

        expect(result.pushed).toBe(0);
        expect(result.retried).toBe(1);
        const row = await svc.from('tasks').select('id').eq('id', trespass.id as string);
        expect(row.data, 'RLS let a cross-tenant write through').toEqual([]);
    });
});

describe('cancellation (B6)', () => {
    it('stops between items and leaves the rest queued', async () => {
        const first = localTask({ title: 'Pushed before cancel' });
        const second = localTask({ title: 'Should stay queued' });
        await queueForSync('tasks', first.id as string, 'create', first);
        await queueForSync('tasks', second.id as string, 'create', second);

        // Cancel at a precise point rather than racing a timer: the drain deletes a queue
        // row immediately after pushing it, so this fires exactly once the first item has
        // landed and before the loop re-checks the token. That is the branch under test --
        // a run whose overall timeout fired while it was still working (B6).
        const token = { cancelled: false };
        const cancelOnFirstPush = () => { token.cancelled = true; };
        db.syncQueue.hook('deleting', cancelOnFirstPush);

        let result;
        try {
            result = await drainSyncQueue(token);
        } finally {
            db.syncQueue.hook('deleting').unsubscribe(cancelOnFirstPush);
        }

        expect(result.cancelled).toBe(true);
        expect(result.pushed).toBe(1);

        // The second item is untouched: still queued, and never sent.
        const remaining = await getPendingSyncItems();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].recordId).toBe(second.id);

        const landed = await svc
            .from('tasks')
            .select('title')
            .in('title', ['Pushed before cancel', 'Should stay queued']);
        expect(landed.data!.map((r) => r.title)).toEqual(['Pushed before cancel']);
    });

    it('does nothing at all when cancelled before it starts', async () => {
        const task = localTask();
        await queueForSync('tasks', task.id as string, 'create', task);

        const result = await drainSyncQueue({ cancelled: true });

        expect(result).toEqual({ pushed: 0, retried: 0, deadLettered: 0, terminal: 0, cancelled: true });
        expect(await db.syncQueue.count()).toBe(1);
        const row = await svc.from('tasks').select('id').eq('id', task.id as string);
        expect(row.data).toEqual([]);
    });
});

describe('processSyncItem', () => {
    it('refuses a table that is not in the registry, so the item retries rather than vanishing', async () => {
        await expect(
            processSyncItem({
                id: 'q1',
                tableName: 'portfolio_entries',
                recordId: crypto.randomUUID(),
                operation: 'create',
                data: { id: 'x' },
                timestamp: Date.now(),
                retryCount: 0,
            }),
        ).rejects.toThrow(/Refusing to sync unknown table/);
    });

    it('upserts rather than failing when the row already exists', async () => {
        const task = localTask();
        await queueForSync('tasks', task.id as string, 'create', task);
        await drainSyncQueue();

        // A create replayed after a partial failure must not 409 the queue into a loop.
        await queueForSync('tasks', task.id as string, 'create', { ...task, title: 'Replayed' });
        expect((await drainSyncQueue()).pushed).toBe(1);

        const row = await svc.from('tasks').select('title').eq('id', task.id as string).single();
        expect(row.data!.title).toBe('Replayed');
    });

    it('creates the checklist row on first push and updates it after (blob sync)', async () => {
        // Checklists are the one table where `update` upserts: the row may not exist yet.
        const checklistId = crypto.randomUUID();
        await svc.from('checklists').delete().eq('id', checklistId);

        await queueForSync('checklists', team.id, 'update', {
            id: checklistId,
            teamId: team.id,
            seasonId: team.seasonId,
            items: [{ id: '1', text: 'Charge driver hub', checked: false }],
        });

        expect((await drainSyncQueue()).pushed).toBe(1);

        const row = await svc.from('checklists').select('*').eq('team_id', team.id).eq('name', 'Pre-Match Checklist').single();
        expect(row.data!.items).toEqual([{ id: '1', text: 'Charge driver hub', checked: false }]);
    });
});
