/**
 * Sign-out actually empties local storage — asserted against a real Dexie, not spies.
 *
 * `sign-out.test.ts` pins the *contract*: that each teardown step is called. That is
 * necessary but not sufficient, because `clearLocalDatabase()` could stop clearing the
 * dead-letter store tomorrow and every one of those assertions would still pass.
 *
 * This is the case that matters on a shared team laptop. A coach signs out, a student
 * signs in on the same device, and anything left behind belongs to the wrong person:
 *
 *   - queued changes would be pushed under the NEW user's credentials, against a team
 *     they may not even belong to;
 *   - parked dead-letter changes would surface in the new user's "failed changes" UI,
 *     showing them the previous user's data;
 *   - delta-sync cursors would make the new user's first pull silently incomplete — the
 *     server is asked for everything changed since a timestamp that has nothing to do with
 *     them, so records are skipped with no error anywhere (B5).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { performSignOut } from '../sign-out';
import {
    db,
    queueForSync,
    moveToDeadLetter,
    setSyncCursor,
    bumpSyncCounter,
    getSyncMeta,
    indexedDBStorage,
} from '../offline-db';
import { useAppStore } from '../store';

describe('performSignOut leaves nothing behind for the next user (B5)', () => {
    beforeEach(async () => {
        await db.syncQueue.clear();
        await db.syncFailures.clear();
        await db.appState.clear();
        localStorage.clear();
    });

    /** Everything a signed-in session accumulates locally. */
    async function seedASession() {
        await queueForSync('tasks', 'task-1', 'create', { id: 'task-1', title: "Coach's task" });
        await moveToDeadLetter(
            {
                id: 'failed-1',
                tableName: 'scouting_reports',
                recordId: 'report-1',
                operation: 'create',
                data: { id: 'report-1', teamNumber: '4242' },
                timestamp: Date.now(),
                retryCount: 5,
            },
            new Error('server rejected it'),
        );
        await setSyncCursor('team-1:tasks', '2026-08-15T10:00:00.000Z');
        await bumpSyncCounter('team-1');
        await indexedDBStorage.setItem('falconforge-storage', JSON.stringify({ state: { currentTeamId: 'team-1' } }));
        localStorage.setItem('sb-abcdef-auth-token', 'the-coach-jwt');
    }

    it('clears the sync queue, the dead-letter store, the cursors and the persisted state', async () => {
        await seedASession();

        // Sanity: the seed actually wrote something, so an empty assertion below means
        // "cleared" rather than "was never there".
        expect(await db.syncQueue.count()).toBe(1);
        expect(await db.syncFailures.count()).toBe(1);
        expect((await getSyncMeta()).cursors['team-1:tasks']).toBeTruthy();
        expect(await indexedDBStorage.getItem('falconforge-storage')).not.toBeNull();

        await performSignOut(vi.fn().mockResolvedValue(undefined), vi.fn());

        expect(await db.syncQueue.count(), 'queued changes survived sign-out').toBe(0);
        expect(await db.syncFailures.count(), 'parked changes survived sign-out').toBe(0);

        const meta = await getSyncMeta();
        expect(meta.cursors, 'delta cursors survived sign-out').toEqual({});
        expect(meta.counters, 'pull counters survived sign-out').toEqual({});

        expect(await indexedDBStorage.getItem('falconforge-storage')).toBeNull();
        expect(localStorage.getItem('sb-abcdef-auth-token')).toBeNull();
    });

    it('empties the in-memory store too, so nothing is readable before the reload lands', async () => {
        useAppStore.setState({
            currentTeamId: 'team-1',
            currentUserId: 'user-1',
            teamMembers: [
                {
                    id: 'm-1',
                    teamId: 'team-1',
                    userId: 'user-1',
                    role: 'coach',
                    status: 'approved',
                    seatAssigned: true,
                    fullName: 'The Coach',
                    email: 'coach@example.com',
                    avatarUrl: null,
                    joinedAt: 1000,
                },
            ],
            scoutingReports: [{ id: 'r-1', teamNumber: '4242' } as never],
        });

        await performSignOut(vi.fn().mockResolvedValue(undefined), vi.fn());

        const state = useAppStore.getState();
        expect(state.currentTeamId).toBeNull();
        expect(state.currentUserId).toBeNull();
        expect(state.teamMembers).toEqual([]);
        expect(state.scoutingReports).toEqual([]);
        expect(state.tasks).toEqual([]);
    });

    it('still clears local state when the Supabase sign-out call fails', async () => {
        // At a competition the network is often unusable. A sign-out that leaves the
        // previous user's queue on the device because a request failed is the worst
        // outcome here, so local teardown must not depend on the remote call.
        await seedASession();
        const redirect = vi.fn();

        await performSignOut(vi.fn().mockRejectedValue(new Error('no network')), redirect);

        expect(await db.syncQueue.count()).toBe(0);
        expect(await db.syncFailures.count()).toBe(0);
        expect((await getSyncMeta()).cursors).toEqual({});
        expect(redirect).toHaveBeenCalled();
    });
});
