/**
 * SYNC-08 — asking the browser not to evict the offline copy.
 *
 * The queue, the dead letters and the whole offline dataset were under best-effort storage,
 * which browsers discard under pressure — a full phone on Android, seven days of a school
 * holiday on Safari. The failure is silent and unrecoverable: the queue is simply empty
 * afterwards, which is exactly what "everything synced" looks like.
 *
 * These cases are mostly about NOT throwing. This runs inside an auth callback, from a
 * `setTimeout` nobody awaits, and a storage permission that rejects while reporting on storage
 * would take the sign-in with it (failure-modes §11 — every await in a callback you do not own).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getStoragePersistence,
    requestStoragePersistence,
    resetStoragePersistence,
} from '../storage-persistence';

const withStorage = (storage: unknown) => {
    vi.stubGlobal('navigator', { storage });
};

beforeEach(() => {
    resetStoragePersistence();
    vi.restoreAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('asking for persistent storage', () => {
    it('asks, and reports what the browser said', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        withStorage({
            persisted: vi.fn().mockResolvedValue(false),
            persist,
            estimate: vi.fn().mockResolvedValue({ usage: 1024, quota: 4096 }),
        });

        const result = await requestStoragePersistence();

        expect(persist, 'the app never asked to keep the offline copy').toHaveBeenCalled();
        expect(result).toEqual({ persisted: true, usage: 1024, quota: 4096 });
        expect(getStoragePersistence().persisted).toBe(true);
    });

    it('does not ask again when it is already persistent', async () => {
        // In Firefox `persist()` prompts. Asking for something already granted is a second
        // prompt the user did not trigger.
        const persist = vi.fn().mockResolvedValue(true);
        withStorage({
            persisted: vi.fn().mockResolvedValue(true),
            persist,
            estimate: vi.fn().mockResolvedValue({}),
        });

        const result = await requestStoragePersistence();

        expect(persist, 'it re-requested a permission it already had').not.toHaveBeenCalled();
        expect(result.persisted).toBe(true);
    });

    it('carries on when the browser says no', async () => {
        // A denial is a normal outcome — Chrome decides silently on engagement — and the app
        // works either way. What matters is that it is recorded rather than mistaken for a
        // grant.
        withStorage({
            persisted: vi.fn().mockResolvedValue(false),
            persist: vi.fn().mockResolvedValue(false),
            estimate: vi.fn().mockResolvedValue({ usage: 5, quota: 10 }),
        });

        const result = await requestStoragePersistence();

        expect(result.persisted).toBe(false);
        expect(console.info).toHaveBeenCalled();
    });

    it('reports null — not false — where the API does not exist', async () => {
        // "The browser refused" and "we could not ask" are different facts, and the dead-letter
        // dialog would say different things about them (failure-modes §4).
        withStorage(undefined);
        expect((await requestStoragePersistence()).persisted).toBeNull();
    });

    it('survives a browser that has `storage` but not `persist`', async () => {
        withStorage({ estimate: vi.fn().mockResolvedValue({}) });
        const result = await requestStoragePersistence();
        expect(result.persisted).toBe(false);
    });

    it('never rejects when the API throws', async () => {
        // It is called from an auth callback nobody awaits. A rejection here is an unhandled
        // rejection at sign-in.
        withStorage({
            persisted: vi.fn().mockRejectedValue(new Error('SecurityError')),
            persist: vi.fn(),
        });

        await expect(requestStoragePersistence()).resolves.toEqual({ persisted: null });
        expect(console.warn).toHaveBeenCalled();
    });
});

describe('the auth path asks for it (SYNC-08)', () => {
    it('is wired into the sign-in handler', async () => {
        /*
         * A source check rather than a rendered-auth test, in the spirit of the
         * `harness-invariants` ratchets: `auth.tsx` needs a real Supabase client, a real
         * `onAuthStateChange` and a deferred `setTimeout` to reach the call, and a test that
         * mocked all three would be asserting its own scaffolding — which is the class this
         * sprint has been removing, not adding to.
         *
         * What it pins is the thing that would actually regress: somebody deleting the call
         * while tidying the callback.
         */
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const source = readFileSync(resolve(__dirname, '../auth.tsx'), 'utf8');

        expect(source, 'auth.tsx no longer imports the storage request').toContain(
            'storage-persistence',
        );
        expect(source, 'nothing calls requestStoragePersistence on sign-in').toContain(
            'requestStoragePersistence()',
        );
    });
});
