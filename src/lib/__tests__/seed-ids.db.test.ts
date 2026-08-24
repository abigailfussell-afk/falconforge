/**
 * The ids a new team starts life with (C5, and what came after it).
 *
 * C5 was `'season-2025-2026'` and `'subteam-programming'`: seed ids that read nicely and are
 * fatal on contact with the database, because every id column in this schema is `uuid`. The
 * push fails with `invalid input syntax for type uuid`, retries five times and parks in the
 * dead-letter store, and the user sees their season and sub-teams locally while none of it
 * ever syncs. Sprint 2 made them real UUIDs.
 *
 * That fixed the cast and left the deeper problem: the ids were HARDCODED, so they were the
 * same on every device of every team. The second team to push sub-team `657c8820-…` upserts
 * onto a row belonging to the first; RLS refuses the UPDATE branch of that upsert, and their
 * sub-teams dead-letter permanently. Under the V2 schema a seeded SEASON is worse again --
 * `season_id` is NOT NULL with a composite foreign key, so every task created under a season
 * that exists only on the client is unpushable too.
 *
 * So the seeds moved to the server. `create_team_as_admin` creates the first season, its
 * sub-teams and its checklist inside the transaction that creates the team, with fresh
 * per-team uuids. This file asserts the property that matters and did not hold before:
 * EVERYTHING A NEW TEAM STARTS WITH CAN BE EDITED AND PUSHED, and two teams' starting rows
 * never collide.
 *
 * A unit test on the string shape would pass against ids Postgres still rejects — the
 * question is not "does it look like a uuid" but "does it insert". So this registers real
 * teams through the real RPC and pushes edits through the real drain.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures } from '@/test/db/fixtures';
import { serviceClient, userClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore, selectChecklist } from '@/lib/store';
import { db, getSyncFailures } from '@/lib/offline-db';
import { drainSyncQueue } from '@/lib/sync';
import { pullFromServer } from '@/lib/server-pull';

let fixtures: Fixtures;
const svc = serviceClient();

interface RegisteredTeam {
    teamId: string;
    seasonId: string;
    token: string;
}

/** Register a team the way the app does: attest, then call the RPC as a real user. */
async function registerTeam(label: string): Promise<RegisteredTeam> {
    const account = await fixtures.createUser(label);
    await fixtures.attest(account.id);

    const client = userClient(account.token);
    const { data, error } = await client.rpc('create_team_as_admin', {
        team_name: `${label} Robotics`,
        season_name: '2026-2027 Season',
    });
    if (error) throw new Error(`create_team_as_admin failed: ${error.message}`);

    const result = data as { success: boolean; team_id?: string; season_id?: string; error?: string };
    expect(result.success, `create_team_as_admin refused: ${result.error}`).toBe(true);

    createdTeamIds.push(result.team_id!);
    return { teamId: result.team_id!, seasonId: result.season_id!, token: account.token };
}

const createdTeamIds: string[] = [];
let teamA: RegisteredTeam;
let teamB: RegisteredTeam;

beforeAll(async () => {
    fixtures = new Fixtures();
    teamA = await registerTeam('seed-a');
    teamB = await registerTeam('seed-b');
});

afterAll(async () => {
    signOutAppClient();
    for (const id of createdTeamIds) await svc.from('teams').delete().eq('id', id);
    await fixtures.cleanup();
});

beforeEach(async () => {
    await db.syncQueue.clear();
    signInAppClientAs(teamA.token);
    useAppStore.setState({
        currentTeamId: teamA.teamId,
        currentSeasonId: teamA.seasonId,
        subTeams: [],
        tasks: [],
        checklistsBySeason: {},
    });
});

describe('what a new team is seeded with', () => {
    it('has a season, five sub-teams and a checklist, all created server-side', async () => {
        await pullFromServer({ teamId: teamA.teamId, mode: 'full' });

        const state = useAppStore.getState();
        expect(state.seasons.map((s) => s.id)).toEqual([teamA.seasonId]);
        expect(state.subTeams.map((s) => s.name).sort()).toEqual(
            ['Build', 'Drive', 'Outreach', 'Programming', 'Scouting'],
        );
        expect(selectChecklist(state)).toHaveLength(8);
        expect(selectChecklist(state)[0].text).toBe('Turn off robot');
    });

    it('gives every seeded row an id no other team shares', async () => {
        // THE BUG HARDCODED SEEDS CAUSED. Team B seeding sub-team `657c8820-…` while team A
        // already owns that row means an upsert across a tenant boundary, which RLS refuses
        // — so the second team's sub-teams dead-letter with an error the coach cannot act on
        // and never appear on any other device.
        const [a, b] = await Promise.all([
            svc.from('sub_teams').select('id').eq('team_id', teamA.teamId),
            svc.from('sub_teams').select('id').eq('team_id', teamB.teamId),
        ]);

        const idsA = new Set(a.data!.map((r) => r.id));
        const idsB = b.data!.map((r) => r.id);

        expect(idsA.size).toBe(5);
        expect(idsB).toHaveLength(5);
        for (const id of idsB) {
            expect(idsA.has(id), 'two teams were seeded with the same sub-team id').toBe(false);
        }

        expect(teamA.seasonId).not.toBe(teamB.seasonId);
    });

    it('checklists are seeded per season, and the row id is the season id', async () => {
        // Blob sync has no per-record identity to merge on, so two offline devices have to
        // arrive at the same row id without talking to each other. Deriving it from the
        // season is what makes that work — and the client, the RPC and the fixtures all
        // have to agree on it or a second row appears and `checklists_one_per_season`
        // rejects it.
        const { data } = await svc
            .from('checklists')
            .select('id, season_id')
            .eq('team_id', teamA.teamId);

        expect(data).toHaveLength(1);
        expect(data![0].id).toBe(teamA.seasonId);
        expect(data![0].season_id).toBe(teamA.seasonId);
    });
});

describe('everything a new team starts with can be edited and pushed', () => {
    it('an edit to a seeded sub-team pushes without dead-lettering', async () => {
        await pullFromServer({ teamId: teamA.teamId, tables: ['sub_teams'], mode: 'full' });
        const subTeam = useAppStore.getState().subTeams.find((s) => s.name === 'Programming')!;
        expect(subTeam, 'the seeded sub-team never reached the client').toBeDefined();

        await db.syncQueue.add({
            id: crypto.randomUUID(),
            tableName: 'sub_teams',
            recordId: subTeam.id,
            operation: 'update',
            data: { ...subTeam, name: 'Software', teamId: teamA.teamId },
            timestamp: Date.now(),
            retryCount: 0,
        });

        const result = await drainSyncQueue();

        expect(result.pushed, 'the edit to a seeded sub-team was rejected').toBe(1);
        expect(result.retried).toBe(0);
        expect(await getSyncFailures()).toEqual([]);

        const row = await svc.from('sub_teams').select('name').eq('id', subTeam.id).single();
        expect(row.data!.name).toBe('Software');
    });

    it('a task can reference a seeded sub-team, which is the FK that used to break', async () => {
        // `tasks.sub_team_id` is a composite FK to (id, team_id). Before the seeds moved
        // server-side the sub-team never reached the server for the second team onwards, so
        // every task assigned to one failed too — one bad seed taking a whole board down.
        await pullFromServer({ teamId: teamA.teamId, tables: ['sub_teams'], mode: 'full' });
        const subTeam = useAppStore.getState().subTeams[0];

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
                teamId: teamA.teamId,
                seasonId: teamA.seasonId,
                checklist: [],
                timeline: [],
            },
            timestamp: Date.now(),
            retryCount: 0,
        });

        const result = await drainSyncQueue();

        expect(result.pushed).toBe(1);
        expect(await getSyncFailures()).toEqual([]);
        const row = await svc.from('tasks').select('sub_team_id').eq('id', taskId).single();
        expect(row.data!.sub_team_id).toBe(subTeam.id);
    });

    it('a checklist edit pushes onto the seeded row rather than creating a second one', async () => {
        await pullFromServer({ teamId: teamA.teamId, tables: ['checklists'], mode: 'full' });

        useAppStore.getState().addChecklistItem('Charge the spare battery');
        // The store queues without awaiting; let the Dexie transaction commit.
        await new Promise((resolve) => setTimeout(resolve, 50));

        const result = await drainSyncQueue();
        expect(result.pushed).toBe(1);
        expect(await getSyncFailures()).toEqual([]);

        const { data } = await svc
            .from('checklists')
            .select('id, items')
            .eq('team_id', teamA.teamId);

        // One row still, not two — the upsert landed on the seeded row.
        expect(data, 'a second checklist row was created for the same season').toHaveLength(1);
        expect(data![0].items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ text: 'Charge the spare battery', checked: false }),
            ]),
        );
    });
});

describe('the checklist queues nothing it cannot push', () => {
    it('queues nothing with no team selected', async () => {
        // The old code queued under the record id `'default'`, which is not a uuid, so every
        // toggle became a push that could never succeed.
        useAppStore.setState({ currentTeamId: null, checklistsBySeason: {} });

        useAppStore.getState().addChecklistItem('Charge the battery');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(selectChecklist(useAppStore.getState())).toHaveLength(1);
        expect(await db.syncQueue.count(), 'queued a checklist push with no team to push it to')
            .toBe(0);
    });

    it('queues nothing, and changes nothing, with no season selected (C6)', async () => {
        // `checklists.season_id` is NOT NULL. V1 wrote `seasonId || null` into it, so a
        // change made before a season was chosen queued a push that failed its not-null
        // constraint, retried five times and parked in the dead-letter store.
        useAppStore.setState({
            currentTeamId: teamA.teamId,
            currentSeasonId: null,
            checklistsBySeason: {},
        });

        useAppStore.getState().addChecklistItem('Charge the battery');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(useAppStore.getState().checklistsBySeason, 'an item was filed under no season')
            .toEqual({});
        expect(await db.syncQueue.count()).toBe(0);
    });
});
