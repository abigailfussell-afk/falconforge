/**
 * B19 — a failed push must be retried without the user doing anything.
 *
 * Found by running the app, not by the suite. A task created while requests were failing
 * stayed queued for over a minute after connectivity returned, across several `online`
 * events, and only went up when the sync indicator was clicked by hand.
 *
 * The cause was that retrying was left to an effect which fires only when a dependency
 * CHANGES, and after a failed drain nothing does: the failure is caught inside
 * `drainSyncQueue`, so `sync()` resolves, `syncStatus` returns to 'idle', and
 * `pendingChanges` holds steady at the same number.
 *
 * These tests use REAL timers against a REAL database. Fake timers would let the schedule
 * pass while the thing being scheduled never actually reached Postgres, which is the same
 * class of half-truth as the mocked query builder this sprint deleted.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Fixtures, type TestTeam } from '@/test/db/fixtures';
import { serviceClient } from '@/test/db/stack';
import { signInAppClientAs, signOutAppClient } from '@/test/db/setup';
import { useAppStore } from '@/lib/store';
import { db, queueForSync, getPendingSyncItems } from '@/lib/offline-db';
import { useSync } from '@/lib/sync';

// useSync reads auth readiness from the AuthProvider; this suite is about scheduling, so
// it opts into the manual mock rather than standing up a provider.
vi.mock('@/lib/auth');

let fixtures: Fixtures;
let team: TestTeam;
const svc = serviceClient();

beforeAll(async () => {
    fixtures = new Fixtures();
    team = await fixtures.createTeam('retry');

    const { createHmac } = await import('node:crypto');
    const b64 = (v: string | Buffer) =>
        Buffer.from(v).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64(JSON.stringify({
        sub: team.users.coach.id, email: team.users.coach.email,
        role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600,
    }));
    const sig = b64(createHmac('sha256', process.env.SUPABASE_JWT_SECRET!)
        .update(`${header}.${payload}`).digest());
    signInAppClientAs(`${header}.${payload}.${sig}`);
});

afterAll(async () => {
    signOutAppClient();
    await fixtures.cleanup();
});

beforeEach(() => {
    useAppStore.setState({ currentTeamId: team.id, currentSeasonId: team.seasonId, tasks: [] });
});

function queuedTask(overrides: Record<string, unknown> = {}) {
    return {
        id: crypto.randomUUID(),
        title: 'Retryable task',
        description: '',
        status: 'To Do',
        type: 'Feature',
        assignedTo: '',
        department: '',
        tags: [],
        checklist: [],
        timeline: [],
        createdAt: Date.now(),
        teamId: team.id,
        seasonId: team.seasonId,
        ...overrides,
    };
}

describe('a queued change that failed to push is retried on its own (B19)', () => {
    it('re-attempts without any user action or state change', async () => {
        // Violates tasks_title_check, so the first attempt fails for real.
        const task = queuedTask({ title: '   ' });
        await queueForSync('tasks', task.id as string, 'create', task);

        const { unmount } = renderHook(() => useSync());

        // The first attempt comes from the fast path (pendingChanges 0 -> 1).
        await waitFor(
            async () => expect((await getPendingSyncItems())[0]?.retryCount).toBe(1),
            { timeout: 10_000 },
        );

        // Nothing is touched from here. Before this fix the count stayed at 1 forever:
        // pendingChanges is still 1, syncStatus is back to 'idle', and no dependency of
        // the auto-sync effect changes, so it never re-runs.
        await waitFor(
            async () => expect((await getPendingSyncItems())[0]?.retryCount).toBeGreaterThan(1),
            { timeout: 15_000 },
        );

        unmount();
    });

    it('pushes a change that failed once, as soon as the obstacle clears', async () => {
        // The real scenario: the push fails while the network is unreachable, then works.
        // Modelled with a title the CHECK constraint rejects, corrected in place -- the
        // queue entry and its retry count survive, exactly as they would across an outage.
        const task = queuedTask({ title: '   ' });
        await queueForSync('tasks', task.id as string, 'create', task);

        const { unmount } = renderHook(() => useSync());

        await waitFor(
            async () => expect((await getPendingSyncItems())[0]?.retryCount).toBeGreaterThan(0),
            { timeout: 10_000 },
        );

        // "Connectivity returns." No user action, no new edit, no click.
        const queued = (await getPendingSyncItems())[0];
        await db.syncQueue.update(queued.id, {
            data: { ...queued.data, title: 'Pushed by the retry schedule' },
        });

        await waitFor(async () => expect(await db.syncQueue.count()).toBe(0), { timeout: 20_000 });

        const row = await svc.from('tasks').select('title').eq('id', task.id as string).single();
        expect(row.data?.title).toBe('Pushed by the retry schedule');

        unmount();
    });

    it('does not retry while the browser reports itself offline', async () => {
        // Genuine offline periods must not burn attempts: five failures dead-letter the
        // change, and a walk out of WiFi range should not cost the user their work.
        const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        try {
            const task = queuedTask();
            await queueForSync('tasks', task.id as string, 'create', task);

            const { unmount } = renderHook(() => useSync());
            await new Promise((resolve) => setTimeout(resolve, 8000));

            const items = await getPendingSyncItems();
            expect(items).toHaveLength(1);
            expect(items[0].retryCount, 'an offline period consumed retry attempts').toBe(0);

            const row = await svc.from('tasks').select('id').eq('id', task.id as string);
            expect(row.data).toEqual([]);
            unmount();
        } finally {
            offline.mockRestore();
        }
    });
});
