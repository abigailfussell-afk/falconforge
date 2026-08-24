/**
 * SYNC-09 — one drain at a time, across every tab on this device.
 *
 * `useSync`'s `syncingRef` is per module instance and every tab is its own instance, so two tabs
 * on the same team drained the same IndexedDB queue together. The visible cost is a coach's
 * change parked two failures earlier than the engine intends, because both tabs increment the
 * same item's `retryCount`.
 *
 * WHY THIS FILE EXISTS RATHER THAN AN ASSERTION IN `sync.integration`. `navigator.locks` does not
 * exist in jsdom, so the code under test takes its fallback path there — and a test that only
 * ever exercises the fallback is `docs/environment-divergences.md`'s exact subject: the thing
 * being verified is not the thing that ships. Both branches are driven here, with a stub that
 * behaves the way the Web Locks API actually does.
 *
 * WHAT WOULD MAKE THESE FAIL: dropping `ifAvailable`, waiting instead of declining, or running
 * the work when the lock was not granted. Each is a plausible way to write this and each is
 * wrong in a different direction.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { withSyncLock, locksAvailable, SYNC_LOCK } from '../sync-lock';

/** The real API's shape: `ifAvailable` hands the callback `null` when the lock is held. */
const stubLocks = (opts: { held: boolean }) => {
    const request = vi.fn(
        async (
            _name: string,
            _options: { ifAvailable?: boolean },
            cb: (lock: unknown) => Promise<unknown>,
        ) => cb(opts.held ? null : { name: _name }),
    );
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    return request;
};

afterEach(() => {
    // `delete` rather than a value: `locksAvailable()` asks whether the API is there at all.
    Reflect.deleteProperty(navigator, 'locks');
    vi.restoreAllMocks();
});

describe('withSyncLock', () => {
    it('runs the work directly where the Web Locks API does not exist', async () => {
        expect(locksAvailable()).toBe(false);
        const work = vi.fn().mockResolvedValue('drained');

        await expect(withSyncLock(work)).resolves.toBe('drained');
        expect(work).toHaveBeenCalledTimes(1);
    });

    it('runs the work under the lock when it is free, and returns its result', async () => {
        const request = stubLocks({ held: false });
        const work = vi.fn().mockResolvedValue('drained');

        await expect(withSyncLock(work)).resolves.toBe('drained');
        expect(work).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(SYNC_LOCK, { ifAvailable: true }, expect.any(Function));
    });

    it('DOES NOT run the work when another tab holds the lock', async () => {
        stubLocks({ held: true });
        const work = vi.fn().mockResolvedValue('drained');

        // `undefined`, not a thrown error and not a wait: the other tab is draining the same
        // queue, so there is nothing to do and nothing to report.
        await expect(withSyncLock(work)).resolves.toBeUndefined();
        expect(work, 'both tabs drained the queue').not.toHaveBeenCalled();
    });

    it('asks not to wait', async () => {
        /*
         * `ifAvailable: true` is the whole design. Without it a second tab QUEUES behind the
         * first, and when the lock is finally released it drains a queue the first tab has
         * already emptied — a pointless round trip, and a waiter per tab per retry tick.
         */
        const request = stubLocks({ held: false });
        await withSyncLock(async () => 'x');

        const [, options] = request.mock.calls[0];
        expect(options).toEqual({ ifAvailable: true });
    });

    it('lets the work’s own failure through rather than swallowing it', async () => {
        // The drain never throws, but this helper must not become the reason a future caller's
        // error disappears — a swallowed rejection here would be invisible in exactly the way
        // B2's silent deletion was.
        stubLocks({ held: false });
        await expect(withSyncLock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    });
});
