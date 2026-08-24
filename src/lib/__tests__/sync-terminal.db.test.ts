/**
 * B24, against a real database — a refusal that retrying cannot satisfy is parked at once.
 *
 * The unit companion (`sync-failure-classification.test.ts`) tests the rule in isolation with
 * hand-written errors. This file exists because those hand-written errors are only worth
 * anything if they match what Postgres and PostgREST actually send, and the whole design turns
 * on a measurement: an unlicensed write, an archived-season write and a cross-tenant write all
 * arrive as `42501` with one identical message. Assert that here, so a future PostgREST upgrade
 * that changes it fails loudly rather than quietly disabling the classification.
 *
 * The three cases parked below are the ones Sprints 3, 4 and 5 each deferred:
 *   - a write by a team whose licence has lapsed,
 *   - a write into an archived season,
 *   - a write queued by a device that was offline when the season rolled over.
 *
 * Each used to burn five attempts over ~9 minutes and arrive with no explanation. What must
 * NOT change is B2: the work is still preserved and still retryable.
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
import { drainSyncQueue, MAX_SYNC_RETRIES } from '@/lib/sync';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

function localTask(overrides: Record<string, unknown> = {}) {
    return {
        id: crypto.randomUUID(),
        title: 'Tune the shooter',
        description: '',
        status: 'To Do',
        type: 'Feature',
        assignedTo: '',
        department: '',
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
        teamId: team.id,
        seasonId: team.seasonId,
        ...overrides,
    };
}

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('terminal');
    signInAppClientAs(mintAccessToken(team.users.coach.id, team.users.coach.email));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
    useAppStore.setState({
        currentTeamId: team.id,
        currentSeasonId: team.seasonId,
        tasks: [],
        seasons: [
            {
                id: team.seasonId,
                teamId: team.id,
                name: 'terminal Season',
                isArchived: false,
                createdAt: Date.now(),
            } as never,
        ],
        entitlement: {
            teamId: team.id,
            status: 'active',
            seatsTotal: null,
            seatsUnlimited: true,
            seatsUsed: 4,
            validUntil: null,
            lapsedAt: null, isProbation: false,
        },
    });
});

describe('the measurement the classification rests on', () => {
    /*
     * If this ever fails, the classification silently stops working: every branch keyed on
     * '42501' becomes dead code and the three cases below go back to burning five retries. The
     * test is here rather than in a comment because a comment cannot fail.
     */
    it('an unlicensed write and an archived-season write are indistinguishable from the error', async () => {
        const { supabaseSync } = await import('@/lib/supabase');

        await fixtures.revokeLicense(team.id);
        const { error: lapsed } = await supabaseSync!
            .from('tasks')
            .insert({ team_id: team.id, season_id: team.seasonId, title: 'while lapsed' } as never);
        await fixtures.restoreLicense(team.id);

        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);
        const { error: archived } = await supabaseSync!
            .from('tasks')
            .insert({ team_id: team.id, season_id: team.seasonId, title: 'while archived' } as never);
        await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);

        // A season that does not exist yet — the case that makes `42501 -> terminal` unsafe.
        const { error: missingSeason } = await supabaseSync!
            .from('tasks')
            .insert({
                team_id: team.id,
                season_id: '00000000-0000-0000-0000-000000000000',
                title: 'parent not synced yet',
            } as never);

        expect(lapsed?.code).toBe('42501');
        expect(archived?.code).toBe('42501');
        expect(missingSeason?.code).toBe('42501');
        expect(archived?.message).toBe(lapsed?.message);
        expect(missingSeason?.message).toBe(lapsed?.message);
    });
});

describe('a lapsed licence parks the change immediately', () => {
    it('spends no retries, and keeps the work with a reason attached', async () => {
        await fixtures.revokeLicense(team.id);
        useAppStore.setState({
            entitlement: {
                teamId: team.id,
                status: 'read_only',
                seatsTotal: 10,
                seatsUnlimited: false,
                seatsUsed: 4,
                isProbation: false,
                validUntil: new Date(Date.now() - 864e5).toISOString(),
                lapsedAt: new Date(Date.now() - 864e5).toISOString(),
            },
        });

        try {
            const task = localTask();
            await queueForSync('tasks', task.id as string, 'create', task);

            const result = await drainSyncQueue();

            expect(result.terminal).toBe(1);
            expect(result.retried).toBe(0);
            expect(result.deadLettered).toBe(0);

            // B2 is intact: the queue drained, and the work survived.
            expect(await getPendingSyncItems()).toHaveLength(0);
            const failures = await getSyncFailures();
            expect(failures).toHaveLength(1);
            expect(failures[0].recordId).toBe(task.id);
            expect(failures[0].data.title).toBe('Tune the shooter');
            expect(failures[0].terminalReason).toMatch(/licence has lapsed/i);
        } finally {
            await fixtures.restoreLicense(team.id);
        }
    });

    /*
     * The nine minutes, measured. Before B24 this same drain left the item queued with
     * retryCount 1 and needed four more passes to reach the dead-letter store.
     */
    it('reaches the dead-letter store in one pass rather than five', async () => {
        await fixtures.revokeLicense(team.id);
        useAppStore.setState({
            entitlement: {
                teamId: team.id, status: 'read_only', seatsTotal: null,
                seatsUnlimited: true, seatsUsed: 4, validUntil: null, lapsedAt: null, isProbation: false,
            },
        });

        try {
            const task = localTask();
            await queueForSync('tasks', task.id as string, 'create', task);
            await drainSyncQueue();

            expect(await getSyncFailures()).toHaveLength(1);
            expect(MAX_SYNC_RETRIES).toBe(5); // the ladder this used to climb
        } finally {
            await fixtures.restoreLicense(team.id);
        }
    });

    /*
     * The only thing that can change the answer is the licence being restored — so the retry
     * affordance has to still work. A parked change that cannot be recovered would be B2 all
     * over again, dressed up as a feature.
     */
    it('is recoverable once the licence is restored', async () => {
        await fixtures.revokeLicense(team.id);
        useAppStore.setState({
            entitlement: {
                teamId: team.id, status: 'read_only', seatsTotal: null,
                seatsUnlimited: true, seatsUsed: 4, validUntil: null, lapsedAt: null, isProbation: false,
            },
        });
        const task = localTask({ title: 'Survives a lapse' });
        await queueForSync('tasks', task.id as string, 'create', task);
        await drainSyncQueue();
        expect(await getSyncFailures()).toHaveLength(1);

        // The licence comes back, and so does the entitlement the device has read.
        await fixtures.restoreLicense(team.id);
        useAppStore.setState({
            entitlement: {
                teamId: team.id, status: 'active', seatsTotal: null,
                seatsUnlimited: true, seatsUsed: 4, validUntil: null, lapsedAt: null, isProbation: false,
            },
        });

        const restored = await retrySyncFailures();
        expect(restored).toBe(1);

        const result = await drainSyncQueue();
        expect(result.pushed).toBe(1);

        const { data } = await svc.from('tasks').select('title').eq('id', task.id as string).single();
        expect(data?.title).toBe('Survives a lapse');
    });
});

describe('an archived season parks the change immediately', () => {
    it('parks a write into a season this device knows is archived', async () => {
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);
        useAppStore.setState({
            seasons: [
                {
                    id: team.seasonId, teamId: team.id, name: 'terminal Season',
                    isArchived: true, createdAt: Date.now(),
                } as never,
            ],
        });

        try {
            const task = localTask({ title: 'Into last year' });
            await queueForSync('tasks', task.id as string, 'create', task);

            const result = await drainSyncQueue();

            expect(result.terminal).toBe(1);
            const failures = await getSyncFailures();
            expect(failures[0].terminalReason).toMatch(/archived/i);
            expect(failures[0].terminalReason).toMatch(/switch to the current season/i);
        } finally {
            await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);
        }
    });

    /*
     * THE DEVICE THAT WAS OFFLINE DURING THE ROLLOVER — the third parking-lot case, and the
     * one the classification handles a beat later rather than immediately.
     *
     * Its copy of `is_archived` is stale, so on the first attempt local state cannot explain
     * the refusal and the item keeps its retries. That is the correct conservative answer: the
     * same 42501 is what a not-yet-synced season produces, and parking it would destroy a
     * rollover. `sync()` pulls before it drains, so the archive is local by the next pass and
     * the item is parked with a reason then — one or two retries instead of five.
     */
    it('retries once while its copy of the archive is stale, then parks with a reason', async () => {
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);
        // The device still believes last season is current.
        useAppStore.setState({
            seasons: [
                {
                    id: team.seasonId, teamId: team.id, name: 'terminal Season',
                    isArchived: false, createdAt: Date.now(),
                } as never,
            ],
        });

        try {
            const task = localTask({ title: 'Queued before the rollover landed' });
            await queueForSync('tasks', task.id as string, 'create', task);

            const first = await drainSyncQueue();
            expect(first.terminal).toBe(0);
            expect(first.retried).toBe(1);
            expect(await getPendingSyncItems()).toHaveLength(1);

            // The pull that brings the archive back is what changes the answer.
            useAppStore.setState({
                seasons: [
                    {
                        id: team.seasonId, teamId: team.id, name: 'terminal Season',
                        isArchived: true, createdAt: Date.now(),
                    } as never,
                ],
            });

            const second = await drainSyncQueue();
            expect(second.terminal).toBe(1);
            expect((await getSyncFailures())[0].terminalReason).toMatch(/archived/i);
        } finally {
            await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);
        }
    });
});

describe('seat capacity is the console’s error, not the drain’s', () => {
    /*
     * `enforce_seat_capacity` raises 23514 with a message written for a person, and an earlier
     * draft of the classification passed it through as terminal. It does not belong here at
     * all: seat assignment is a direct Supabase write from the admin console and never enters
     * the sync queue, so the drain will never see this error. Asserted so the reasoning is
     * recorded against the real trigger rather than in a comment.
     */
    it('the trigger really does raise 23514, and the drain never sees it', async () => {
        const { supabaseSync } = await import('@/lib/supabase');
        signOutAppClient();
        signInAppClientAs(mintAccessToken(team.admin.id, team.admin.email));

        await svc
            .from('license_grants')
            .update({ revoked_at: new Date().toISOString() } as never)
            .eq('team_id', team.id);
        const { data: grant } = await svc
            .from('license_grants')
            .insert({
                team_id: team.id, source: 'gift', seats: 1,
                created_by: team.admin.id, notes: 'terminal seat test',
            } as never)
            .select()
            .single();

        const account = await fixtures.createUser('over-capacity');
        const { data: member } = await svc
            .from('team_members')
            .insert({
                team_id: team.id, user_id: account.id, role: 'student',
                status: 'pending', full_name: 'Over Capacity', email: account.email,
            } as never)
            .select()
            .single();

        try {
            const { error } = await supabaseSync!
                .from('team_members')
                .update({ status: 'approved', seat_assigned: true } as never)
                .eq('id', (member as { id: string }).id);

            expect(error?.code).toBe('23514');
            expect(error?.message).toMatch(/no licensed seats available/i);

            // And the classification leaves 23514 alone, so nothing about this error changes
            // the drain's behaviour — see the unit suite for why widening it was unsafe.
            const { classifySyncFailure } = await import('@/lib/sync-failure-classification');
            expect(
                classifySyncFailure(
                    { id: 'q', tableName: 'team_members', recordId: 'x', operation: 'update', data: {}, timestamp: 1, retryCount: 0 },
                    error,
                    { entitlementStatus: 'active', archivedSeasonIds: new Set() },
                ).terminal,
            ).toBe(false);
        } finally {
            await svc.from('team_members').delete().eq('id', (member as { id: string }).id);
            await svc.from('license_grants').delete().eq('id', (grant as { id: string }).id);
            await svc.from('license_grants').update({ revoked_at: null } as never).eq('team_id', team.id);
            signOutAppClient();
            signInAppClientAs(mintAccessToken(team.users.coach.id, team.users.coach.email));
        }
    });
});

describe('nothing else about the drain changed', () => {
    /*
     * The engine's existing guarantees, re-asserted here because B24 added a branch to the one
     * failure path they all run through. Rule 6: a change to `sync.ts` keeps the old behaviour
     * green and adds tests for the new.
     */
    it('a transient failure still climbs the retry ladder to the dead-letter store', async () => {
        // A cross-tenant write: refused with 42501, but nothing in local state explains it, so
        // it must keep all five retries exactly as before.
        const other = await fixtures.createTeam('elsewhere');
        const task = localTask({ teamId: other.id, seasonId: other.seasonId });
        await queueForSync('tasks', task.id as string, 'create', task);

        for (let attempt = 1; attempt < MAX_SYNC_RETRIES; attempt++) {
            const result = await drainSyncQueue();
            expect(result.retried, `attempt ${attempt} should have retried`).toBe(1);
            expect(result.terminal).toBe(0);
            expect((await getPendingSyncItems())[0].retryCount).toBe(attempt);
        }

        const final = await drainSyncQueue();
        expect(final.deadLettered).toBe(1);
        expect(final.terminal).toBe(0);
        expect(await getSyncFailures()).toHaveLength(1);
        // Parked by exhaustion, so there is no reason to give — and pretending otherwise would
        // put words in the server's mouth.
        expect((await getSyncFailures())[0].terminalReason).toBeUndefined();
    });

    it('a successful push is unaffected', async () => {
        const task = localTask({ title: 'Perfectly ordinary' });
        await queueForSync('tasks', task.id as string, 'create', task);

        const result = await drainSyncQueue();

        expect(result).toMatchObject({ pushed: 1, retried: 0, deadLettered: 0, terminal: 0 });
    });

    it('one terminal item does not stop the rest of the queue draining', async () => {
        useAppStore.setState({
            entitlement: {
                teamId: team.id, status: 'active', seatsTotal: null,
                seatsUnlimited: true, seatsUsed: 4, validUntil: null, lapsedAt: null, isProbation: false,
            },
            seasons: [
                {
                    id: team.seasonId, teamId: team.id, name: 'terminal Season',
                    isArchived: true, createdAt: Date.now(),
                } as never,
            ],
        });
        await svc.from('seasons').update({ is_archived: true } as never).eq('id', team.seasonId);

        try {
            // A doomed change first, a good one behind it, in the order the user made them.
            const doomed = localTask({ title: 'Into the archive' });
            await queueForSync('tasks', doomed.id as string, 'create', doomed);

            const { data: openSeason } = await svc
                .from('seasons')
                .insert({ team_id: team.id, name: 'This year' } as never)
                .select()
                .single();
            const good = localTask({ title: 'Into this year', seasonId: (openSeason as { id: string }).id });
            await queueForSync('tasks', good.id as string, 'create', good);

            const result = await drainSyncQueue();

            expect(result.terminal).toBe(1);
            expect(result.pushed).toBe(1);
            expect(await getPendingSyncItems()).toHaveLength(0);
        } finally {
            await svc.from('seasons').update({ is_archived: false } as never).eq('id', team.seasonId);
        }
    });
});
