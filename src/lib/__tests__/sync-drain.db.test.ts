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
import { progressDeadline } from '@/lib/timeout';
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

        /*
         * `stalled` (SYNC-13) added to the expectation rather than the assertion loosened to
         * `toMatchObject`. Sprint 25 changed `DrainResult`'s SHAPE, not its behaviour, and a
         * whole-object `toEqual` cannot help noticing that — which is the point of writing it
         * this way. Relaxing it here would trade a real property (no field is unexpectedly
         * non-zero) for the convenience of never having to touch this line again.
         */
        expect(result).toEqual({ pushed: 1, retried: 0, deadLettered: 0, terminal: 0, cancelled: false, stalled: false });
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

        expect(result).toEqual({ pushed: 0, retried: 0, deadLettered: 0, terminal: 0, cancelled: true, stalled: false });
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
/**
 * SYNC-13 — a long drain that is working is not a failed one.
 *
 * The overall sync timeout used to cap drain-plus-pull at a flat thirty seconds. A device back
 * from a day offline has a large queue and each item is a round trip; at the ~500 ms a venue
 * connection manages, about sixty items fit. The rest was cancelled mid-way and the run reported
 * "Sync failed" — having pushed sixty items successfully, and about to push sixty more. The user
 * is told they have failed, over and over, for as long as the queue is longer than one window.
 *
 * The budget now measures IDLE time rather than total time, and only a successful push resets it.
 * That draws the line the flat timeout could not: between a run that is SLOW and one that is
 * STUCK. They want opposite treatment.
 *
 * THE CLOCK IS SCRIPTED, not raced. A test that waits thirty real seconds to prove a
 * thirty-second budget is a test that gets skipped, and one that advances a clock from a Dexie
 * hook is asserting on where in the drain that hook happens to fire — which is not the property
 * under test and was wrong twice while this was written. `now()` returns the next value in a
 * list, so each call site's reading is stated outright:
 *
 *     construction ->  reading 0        (`progressDeadline` starts its clock immediately)
 *     item N:  expired()  ->  the next reading
 *              progress() ->  the one after   (only on success)
 *
 * The constructor's reading is easy to forget and this test forgot it twice: without it every
 * sequence is off by one and the drain pushes one item more than the script says. Written out
 * because an off-by-one in a scripted clock does not look like an off-by-one — it looks like the
 * behaviour being wrong.
 *
 * `docs/failure-modes.md` §10 is four sprints of defects from reading the wrong clock; the fix
 * for a test is to own the clock rather than to sleep against it.
 */
describe('SYNC-13 — the drain is bounded by progress, not by the clock', () => {
    /** A clock that returns the next scripted reading, then repeats the last one for ever. */
    const scriptedClock = (readings: number[]) => {
        let i = 0;
        return () => readings[Math.min(i++, readings.length - 1)];
    };

    const queueTasks = async (n: number, prefix: string) => {
        for (let i = 0; i < n; i++) {
            const task = localTask({ title: `${prefix} ${i}` });
            await queueForSync('tasks', task.id as string, 'create', task);
        }
    };

    it('keeps draining for as long as pushes keep landing, however long that takes', async () => {
        await queueTasks(5, 'Catch-up');

        /*
         * Five items, 25 seconds of gap between each success — 125 seconds in total, four times
         * the flat budget that used to cancel this run after two items. No single gap reaches
         * 30s, so nothing stalls.
         */
        const deadline = progressDeadline(30_000, scriptedClock([
            0,                // construction
            0, 0,             // item 0: expired at 0 (last 0), then progress sets last = 0
            25_000, 25_000,   // item 1: 25s since the last success
            50_000, 50_000,
            75_000, 75_000,
            100_000, 100_000,
        ]));

        const result = await drainSyncQueue({ cancelled: false, deadline });

        expect(result.pushed, 'the drain gave up while it was still working').toBe(5);
        expect(result.stalled).toBe(false);
        expect(await db.syncQueue.count()).toBe(0);

        const landed = await svc.from('tasks').select('title').like('title', 'Catch-up%');
        expect(landed.data).toHaveLength(5);
    });

    it('spends the budget from the last SUCCESS, not from the start of the run', async () => {
        await queueTasks(3, 'Mixed');

        /*
         * Two succeed 10 seconds apart, then 35 seconds pass with nothing landing. Total elapsed
         * is 45s — over the old flat budget before the second item — and the drain gets to the
         * third anyway, which is the whole change. It stops there because THAT gap is over 30.
         */
        const deadline = progressDeadline(30_000, scriptedClock([
            0,                // construction
            0, 0,             // item 0: pushes
            10_000, 10_000,   // item 1: 10s later, pushes
            45_000,           // item 2: 35s since the last success -> stalled, never attempted
        ]));

        const result = await drainSyncQueue({ cancelled: false, deadline });

        expect(result.pushed).toBe(2);
        expect(result.stalled).toBe(true);
        expect(await db.syncQueue.count()).toBe(1);
    });

    it('stops when nothing has succeeded for the whole budget', async () => {
        await queueTasks(3, 'Doomed');
        // The budget is already spent when the run starts: nothing has succeeded, ever.
        // Construction reads 0; the first `expired()` reads 31_000.
        const deadline = progressDeadline(30_000, scriptedClock([0, 31_000]));

        const result = await drainSyncQueue({ cancelled: false, deadline });

        expect(result.stalled, 'the drain kept going with nothing succeeding').toBe(true);
        expect(result.pushed).toBe(0);
        /*
         * AND IT STOPPED BEFORE TOUCHING ANYTHING. The check is before the item, so nothing
         * spent a retry on a run that had already run out of budget — which matters because five
         * retries is what stands between a coach's work and the dead-letter store.
         */
        expect(result.retried).toBe(0);
        expect(result.deadLettered).toBe(0);
        const queued = await getPendingSyncItems();
        expect(queued).toHaveLength(3);
        expect(queued.every((q) => (q.retryCount ?? 0) === 0)).toBe(true);
    });

    it('has no deadline at all when it is not given one', async () => {
        // Every existing caller and every B-test passes a bare token. The drain must behave
        // exactly as it always did for them — no budget, no stall, no new branch.
        const task = localTask({ title: 'No deadline' });
        await queueForSync('tasks', task.id as string, 'create', task);

        const result = await drainSyncQueue({ cancelled: false });

        expect(result.pushed).toBe(1);
        expect(result.stalled).toBe(false);
    });
});
