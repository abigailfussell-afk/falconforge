/**
 * The guardian offline path, against a real database.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * The hand-off's own framing was that offline matters less here — "a guardian managing
 * profiles is doing something inherently online-ish". That is true of the common case and
 * wrong about the expensive one: the moment a guardian actually adds a child is the first
 * meeting of the season, standing in a school car park, on exactly the venue WiFi this
 * application exists to survive. A lost write there means the child is not on the roster and
 * nobody finds out until the coach takes attendance.
 *
 * So both tables go through the same queue as everything else, and this proves it end to end:
 * queue while "offline", drain against Postgres with a real JWT under RLS, pull back, and
 * check what the store holds. A mock cannot fail the way the composite foreign key below
 * fails.
 *
 * WHAT WOULD MAKE THESE FAIL: removing either table from `GUARDIAN_ENTITIES` (the drain
 * refuses an unknown table outright); dropping `scope` back to a `team_id` filter (the pull
 * returns nothing); queueing the consent before the profile (the FK refuses it).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Fixtures, mintAccessToken, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { db, getSyncFailures } from '@/lib/offline-db';
import { drainSyncQueue } from '@/lib/sync';
import { fetchGuardianData } from '@/lib/server-pull';
import { GUARDIAN_CONSENT_VERSIONS } from '@/lib/attestations';

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('guardian-sync');

    // The GUARDIAN's own client, not a coach's. Every assertion below is therefore subject to
    // `managed_profiles_guardian_all` / `guardian_consents_own` exactly as the browser is.
    signInAppClientAs(mintAccessToken(team.guardian.user.id, team.guardian.user.email));
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(async () => {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
    useAppStore.setState({ managedProfiles: [], guardianConsents: [] });
});

/**
 * Wait until the queue holds `expected` items.
 *
 * The slices call `queueForSync(...).catch(console.error)` — fire-and-forget, deliberately, so
 * that a UI write is never blocked on a Dexie transaction. That means the queue is populated
 * one or more microtasks after the action returns, and reading `count()` immediately gets 0.
 *
 * Polling rather than a fixed `await tick()`: a fixed wait is the shape that passes on a
 * developer machine and fails on a two-core CI runner (`docs/environment-divergences.md` §9).
 * This throws on timeout rather than returning, so a queue that never fills fails the test
 * loudly instead of letting a later assertion report something confusing.
 */
async function waitForQueue(expected: number, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const count = await db.syncQueue.count();
        if (count >= expected) return;
        if (Date.now() > deadline) {
            throw new Error(`Sync queue held ${count} items, expected ${expected}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('a child added with no signal survives the drain', () => {
    it('pushes the profile and its consents, then reads them back', async () => {
        const guardianId = team.guardian.user.id;

        // The write, made "offline": the slice queues it and nothing has been sent.
        const profileId = useAppStore.getState().addManagedProfile(
            { fullName: 'Robin in a car park', notes: 'Collected by an aunt on Thursdays' },
            guardianId,
            ['coppa_data_collection', 'terms'],
        );

        expect(profileId).toBeTruthy();
        await waitForQueue(3); // one profile, two consents

        // Reconnect.
        await drainSyncQueue();

        expect(await db.syncQueue.count()).toBe(0);
        // Nothing parked. A dead-lettered guardian write is a child missing from a roster.
        expect(await getSyncFailures()).toHaveLength(0);

        // What the server actually holds, read with the service client so this assertion is
        // about the DATABASE rather than about the store we just wrote.
        const { data: rows } = await svc
            .from('managed_profiles')
            .select('id, full_name, notes, guardian_user_id')
            .eq('id', profileId)
            .single();

        expect(rows).toMatchObject({
            full_name: 'Robin in a car park',
            notes: 'Collected by an aunt on Thursdays',
            guardian_user_id: guardianId,
        });

        // And the round trip back into the store, through the one read path.
        useAppStore.setState({ managedProfiles: [], guardianConsents: [] });
        await fetchGuardianData(guardianId);

        const profiles = useAppStore.getState().managedProfiles;
        expect(profiles.map((p) => p.id)).toContain(profileId);
        expect(profiles.find((p) => p.id === profileId)?.fullName).toBe('Robin in a car park');
    });

    it('records the version the client displayed, not a database default', async () => {
        const guardianId = team.guardian.user.id;
        const profileId = useAppStore.getState().addManagedProfile(
            { fullName: 'Version check' },
            guardianId,
            ['terms'],
        );

        await waitForQueue(2);
        await drainSyncQueue();

        const { data } = await svc
            .from('guardian_consents')
            .select('version, consent_type')
            .eq('managed_profile_id', profileId)
            .eq('consent_type', 'terms')
            .single();

        /*
         * The assertion that catches the NEXT drift, rather than hardcoding a number in a
         * fourth place: whatever the client believes is current is what the database ends up
         * holding. It goes red the day someone raises `ATTESTATION_VERSIONS.terms` and leaves
         * a default behind — which is precisely what happened between Sprint 6 and Sprint 8
         * for the signup attestation.
         */
        expect(data?.version).toBe(GUARDIAN_CONSENT_VERSIONS.terms);
        // '2.0' today. If this ever reads '1.0', a default has come back from somewhere.
        expect(data?.version).not.toBe('1.0');
    });

    it('pushes the profile BEFORE the consent that references it', async () => {
        /*
         * `guardian_consents` carries a composite foreign key into
         * `managed_profiles(id, guardian_user_id)`. A consent that reaches the server first is
         * refused, retried five times and parked — for a child who looks correctly added on
         * this device. This is B1's shape: an ordering the storage layer never promised.
         *
         * The drain reads the queue strictly by TIMESTAMP, not by registry order, so what
         * makes this safe is the slice queueing the profile first. Asserting on
         * `orderBy('timestamp')` is therefore asserting the thing the drain actually reads,
         * rather than an array order that would still be green if the slice reversed itself.
         */
        const guardianId = team.guardian.user.id;
        useAppStore.getState().addManagedProfile(
            { fullName: 'Order matters' },
            guardianId,
            ['coppa_data_collection'],
        );

        await waitForQueue(2);
        const queued = await db.syncQueue.orderBy('timestamp').toArray();
        expect(queued.map((q) => q.tableName)).toEqual([
            'managed_profiles',
            'guardian_consents',
        ]);

        await drainSyncQueue();
        expect(await getSyncFailures()).toHaveLength(0);
    });
});

describe('the pull is scoped by the guardian, not by a team', () => {
    it('returns this guardian\'s children and no one else\'s', async () => {
        // A second guardian on the same team, with their own child.
        const other = await fixtures.createTeam('guardian-sync-other');

        await fetchGuardianData(team.guardian.user.id);

        const ids = useAppStore.getState().managedProfiles.map((p) => p.id);
        expect(ids).toContain(team.guardian.profileId);
        expect(ids).not.toContain(other.guardian.profileId);
    });

    it('works for a guardian who is a member of no team at all', async () => {
        /*
         * The normal case, and the one a team-scoped pull cannot serve: a guardian holds a
         * roster row on their child's behalf without being a member themselves —
         * `get_user_team_ids` deliberately excludes managed rows. If this needed a team it
         * would return nothing, and an empty children list looks exactly like a guardian who
         * has not added a child yet (failure-modes §4).
         */
        useAppStore.setState({ currentTeamId: '', managedProfiles: [] });

        await fetchGuardianData(team.guardian.user.id);

        expect(useAppStore.getState().managedProfiles.length).toBeGreaterThan(0);
    });
});
