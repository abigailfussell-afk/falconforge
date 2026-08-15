/**
 * C5 — seed and default ids must be real UUIDs.
 *
 * `'season-2025-2026'` and `'subteam-programming'` read nicely and are fatal on contact
 * with the database: every id column in this schema is `uuid`, so the push fails with
 * `invalid input syntax for type uuid`, retries five times and parks in the dead-letter
 * store. The user sees their season and sub-teams locally and none of it ever syncs.
 *
 * A unit test on the string shape would pass against ids Postgres still rejects — the
 * question is not "does it look like a uuid" but "does it insert". So this pushes the real
 * seed constants through the real drain into a real table.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { db, getSyncFailures } from '@/lib/offline-db';
import { drainSyncQueue } from '@/lib/sync';
import { DEFAULT_SUBTEAMS } from '@/constants';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('seed');

    const { createHmac } = await import('node:crypto');
    const b64 = (v: string | Buffer) =>
        Buffer.from(v).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(
        JSON.stringify({
            sub: team.users.coach.id,
            email: team.users.coach.email,
            role: 'authenticated',
            aud: 'authenticated',
            iat: now,
            exp: now + 3600,
        }),
    );
    const sig = b64(
        createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(`${header}.${payload}`).digest(),
    );
    signInAppClientAs(`${header}.${payload}.${sig}`);
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(() => {
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        subTeams: [],
        checklist: [],
    });
});

describe('default sub-teams (C5)', () => {
    it('all five push to Postgres and none dead-letter', async () => {
        const store = useAppStore.getState();
        for (const subTeam of DEFAULT_SUBTEAMS) {
            store.setSubTeams([...useAppStore.getState().subTeams, subTeam]);
            await db.syncQueue.add({
                id: crypto.randomUUID(),
                tableName: 'sub_teams',
                recordId: subTeam.id,
                operation: 'create',
                data: { ...subTeam, teamId: team.id, seasonId: team.seasonId },
                timestamp: Date.now(),
                retryCount: 0,
            });
        }

        const result = await drainSyncQueue();

        expect(result.pushed, 'a seeded sub-team was rejected by the database').toBe(5);
        expect(result.retried).toBe(0);
        expect(await getSyncFailures()).toEqual([]);

        // Check by id, not by name: the fixture already created its own 'Build' sub-team,
        // and matching on names would let a missing seeded row hide behind it.
        const rows = await svc
            .from('sub_teams')
            .select('id')
            .in('id', DEFAULT_SUBTEAMS.map((s) => s.id));
        expect(rows.data!.map((r) => r.id).sort()).toEqual(DEFAULT_SUBTEAMS.map((s) => s.id).sort());
    });

    it('a task can reference a seeded sub-team, which is the FK that used to break', async () => {
        // `tasks.sub_team_id` is a uuid FK. Before C5 the sub-team never reached the
        // server, so every task assigned to one failed too -- one bad seed id taking a
        // whole board down with it.
        const subTeam = DEFAULT_SUBTEAMS[0];
        await db.syncQueue.add({
            id: crypto.randomUUID(),
            tableName: 'sub_teams',
            recordId: subTeam.id,
            operation: 'create',
            data: { ...subTeam, teamId: team.id, seasonId: team.seasonId },
            timestamp: Date.now(),
            retryCount: 0,
        });
        const taskId = crypto.randomUUID();
        await db.syncQueue.add({
            id: crypto.randomUUID(),
            tableName: 'tasks',
            recordId: taskId,
            operation: 'create',
            data: {
                id: taskId,
                title: 'Assigned to a seeded sub-team',
                department: subTeam.id,
                teamId: team.id,
                seasonId: team.seasonId,
                tags: [],
                checklist: [],
                timeline: [],
            },
            timestamp: Date.now() + 1,
            retryCount: 0,
        });

        const result = await drainSyncQueue();

        expect(result.pushed).toBe(2);
        const row = await svc.from('tasks').select('sub_team_id').eq('id', taskId).single();
        expect(row.data!.sub_team_id).toBe(subTeam.id);
    });
});

describe('checklist blob (C5)', () => {
    it('queues nothing when no team is selected, instead of a push that cannot succeed', async () => {
        // The old code queued under the record id `'default'`, which is not a uuid.
        useAppStore.setState({ currentTeamId: null, checklist: [] });

        useAppStore.getState().addChecklistItem('Charge the battery');
        // The store queues without awaiting. Without this wait the assertion runs before
        // the Dexie transaction commits and would pass even if a row were being written.
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(useAppStore.getState().checklist).toHaveLength(1);
        expect(await db.syncQueue.count(), 'queued a checklist push with no team to push it to').toBe(0);
    });

    it('pushes cleanly once a team is selected', async () => {
        useAppStore.setState({ currentTeamId: team.id, currentSeasonId: team.seasonId, checklist: [] });

        useAppStore.getState().addChecklistItem('Charge the battery');
        // The store queues without awaiting; let the Dexie transaction commit.
        await new Promise((resolve) => setTimeout(resolve, 50));

        const result = await drainSyncQueue();

        expect(result.pushed).toBe(1);
        expect(await getSyncFailures()).toEqual([]);

        const row = await svc.from('checklists').select('items').eq('id', team.id).single();
        expect(row.data!.items).toEqual([
            expect.objectContaining({ text: 'Charge the battery', checked: false }),
        ]);
    });
});
