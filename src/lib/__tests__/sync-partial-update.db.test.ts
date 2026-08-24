/**
 * SYNC-06 — an offline edit to one field no longer reverts a teammate's change to another.
 *
 * WHAT WAS WRONG. An `update` sent `toRemote(fullLocalRow)` — every column — with no
 * precondition. Device A, offline, renames a task; device B, online, moves the same task to
 * Done; A reconnects and its stale `status` overwrites B's. Silent, invisible, and the loser
 * never knows. A kanban board at a competition is precisely two people touching the same card,
 * which is the case this app exists for.
 *
 * WHY THESE ARE db TESTS. The whole defect is what arrives at Postgres, and the previous test
 * that a mock could have expressed — "the drain called `.update()`" — is true of both the broken
 * and the fixed version. Two clients, one row, real RLS: the only place the property is visible
 * is the row afterwards.
 *
 * WHAT IS STILL LAST-WRITE-WINS, stated here so nobody reads more into this than it does: two
 * people editing THE SAME FIELD. The later push wins, as before. Removing that needs a
 * precondition (`.eq('updated_at', seen)`), a conflict path, a re-pull, a re-apply and a
 * decision about what the user is shown — and until that path exists a failed precondition
 * would send the work round the retry ladder into the dead-letter store, turning a silent field
 * revert into a loud failure a coach cannot act on. Different fields is the reported case and
 * the case this fixes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { db, queueForSync } from '@/lib/offline-db';
import { drainSyncQueue, changedRemoteColumns } from '@/lib/sync';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('partial');
    signInAppClientAs(mintAccessToken(team.users.coach.id, team.users.coach.email));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(async () => {
    await db.syncQueue.clear();
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        seasons: [
            {
                id: team.seasonId,
                name: 'Test',
                gameTitle: '',
                fieldImageData: '',
                isArchived: false,
                createdAt: 1,
                teamId: team.id,
            },
        ],
        tasks: [],
    });
});

const task = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    title: 'Tune the shooter',
    description: '',
    status: 'To Do',
    type: 'Feature',
    assignedTo: '',
    department: '',
    tags: [],
    checklist: [],
    timeline: [],
    createdAt: 1_000,
    teamId: team.id,
    seasonId: team.seasonId,
    ...over,
});

/** Put a row on the server the way a first push would, then read it back. */
const seedOnServer = async (row: Record<string, unknown>) => {
    await queueForSync('tasks', row.id as string, 'create', row);
    const result = await drainSyncQueue();
    expect(result.pushed).toBe(1);
};

describe('SYNC-06 — two devices, one row, different fields', () => {
    it('does not revert a teammate’s field when a stale device pushes its own edit', async () => {
        const original = task();
        await seedOnServer(original);

        // Device B, online: moves it to Done. Straight to the database, because that is what
        // "another device already pushed" means.
        const { error: bError } = await svc
            .from('tasks')
            .update({ status: 'Done' } as never)
            .eq('id', original.id as string);
        expect(bError).toBeNull();

        /*
         * Device A, offline the whole time: renames it. Its local copy still says 'To Do',
         * because it never saw B's change — which is the point. The queue carries the row
         * before the edit alongside the row after it.
         */
        const renamed = { ...original, title: 'Tune the shooter properly' };
        await queueForSync('tasks', original.id as string, 'update', renamed, original);

        const drain = await drainSyncQueue();
        expect(drain.pushed).toBe(1);

        const { data } = await svc
            .from('tasks')
            .select('title, status')
            .eq('id', original.id as string)
            .single();

        const row = data as { title: string; status: string };
        expect(row.title, 'A’s rename did not land').toBe('Tune the shooter properly');
        expect(row.status, 'A’s stale row reverted B’s status').toBe('Done');
    });

    it('sends every column when it has no pre-edit row to compare against', async () => {
        /*
         * The compatibility path, and it matters on the day this ships: a device that has not
         * reloaded still has queue entries written by the old bundle, with no `previousData`.
         * Those must push as they always did rather than throw or send nothing.
         */
        const original = task({ status: 'To Do' });
        await seedOnServer(original);

        await svc.from('tasks').update({ status: 'Done' } as never).eq('id', original.id as string);

        // No fifth argument — an old queue entry.
        await queueForSync('tasks', original.id as string, 'update', {
            ...original,
            title: 'Renamed by an old bundle',
        });
        await drainSyncQueue();

        const { data } = await svc
            .from('tasks')
            .select('title, status')
            .eq('id', original.id as string)
            .single();
        const row = data as { title: string; status: string };
        expect(row.title).toBe('Renamed by an old bundle');
        // The old behaviour, unchanged and deliberately asserted: the whole row goes.
        expect(row.status, 'the fallback stopped sending the whole row').toBe('To Do');
    });

    it('collapses three offline edits into one push of everything they touched', async () => {
        const original = task({ title: 'First', description: 'none' });
        await seedOnServer(original);
        await svc.from('tasks').update({ status: 'Done' } as never).eq('id', original.id as string);

        // Three edits while offline, each queued against the row as it was a moment earlier.
        const afterOne = { ...original, title: 'Second' };
        await queueForSync('tasks', original.id as string, 'update', afterOne, original);
        const afterTwo = { ...afterOne, description: 'now with detail' };
        await queueForSync('tasks', original.id as string, 'update', afterTwo, afterOne);
        const afterThree = { ...afterTwo, type: 'Bug' };
        await queueForSync('tasks', original.id as string, 'update', afterThree, afterTwo);

        expect(await db.syncQueue.count(), 'the three edits did not coalesce').toBe(1);

        await drainSyncQueue();

        const { data } = await svc
            .from('tasks')
            .select('title, description, type, status')
            .eq('id', original.id as string)
            .single();
        const row = data as { title: string; description: string; type: string; status: string };

        /*
         * All three edits landed — the collapsed entry keeps the EARLIEST pre-edit row, so the
         * diff is measured from what the server last saw rather than from one edit ago. Keeping
         * the newest instead would push only `type` and silently drop the other two, which is
         * SYNC-06 again one layer down.
         */
        expect(row.title).toBe('Second');
        expect(row.description).toBe('now with detail');
        expect(row.type).toBe('Bug');
        expect(row.status, 'the collapsed diff still reverted the teammate').toBe('Done');
    });
});

describe('changedRemoteColumns', () => {
    it('returns only the columns the edit touched, in the server’s key space', () => {
        const before = task({ title: 'A', description: 'x' });
        const after = { ...before, title: 'B' };

        const diff = changedRemoteColumns('tasks', before, after)!;

        expect(Object.keys(diff)).toContain('title');
        expect(Object.keys(diff)).not.toContain('description');
        // camelCase in, snake_case out: the diff is taken AFTER the transform, so it speaks the
        // database's names and needs no second key map to drift out of step with the first.
        expect(Object.keys(diff)).not.toContain('seasonId');
    });

    it('compares by value, not by reference', () => {
        /*
         * `checklist`, `timeline`, `tags` and a scouting report's `data` are objects. Reference
         * equality would call every one of them changed on every edit, the diff would be the
         * whole row, and this fix would quietly do nothing at all — green tests, defect intact.
         */
        const before = task({ checklist: [{ id: 'c1', text: 'x', completed: false }] });
        const after = { ...before, checklist: [{ id: 'c1', text: 'x', completed: false }], title: 'B' };

        const diff = changedRemoteColumns('tasks', before, after)!;

        expect(Object.keys(diff)).not.toContain('checklist');
        expect(Object.keys(diff)).toContain('title');
    });

    it('returns null when there is nothing to compare against', () => {
        expect(changedRemoteColumns('tasks', undefined, task())).toBeNull();
    });

    it('never includes `id`, which is the filter rather than a change', () => {
        const before = task();
        const diff = changedRemoteColumns('tasks', before, { ...before, title: 'B' })!;
        expect(Object.keys(diff)).not.toContain('id');
    });
});
