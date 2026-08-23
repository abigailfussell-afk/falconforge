/**
 * SYNC-07 — what the app has actually observed about the server.
 *
 * The distinctions here are the whole finding, and each one is a way the old
 * `navigator.onLine` answer was wrong:
 *
 *  - never asked  ≠  asked and failed. A cold start knows nothing; shouting "can't reach
 *    server" at it is the absence-as-a-value mistake pointed the other way (§4).
 *  - refused      ≠  unreachable. A 42501 is the server answering. Treating it as unreachable
 *    would put a "can't reach server" warning on a lapsed licence, which already has its own
 *    explanation (B24).
 *  - reachable    ≠  recently reachable. "Synced" from evidence an hour old is the sentence
 *    the built app printed over 37 failed requests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    CONTACT_STALE_AFTER_MS,
    describeLastContact,
    getServerReachability,
    isContactStale,
    onServerReachabilityChange,
    recordServerContact,
    resetServerReachability,
} from '../server-reachability';

beforeEach(() => {
    resetServerReachability();
});

describe('the three states, kept apart', () => {
    it('starts at "we have not asked", which is not "we cannot reach it"', () => {
        expect(getServerReachability().reachable, 'a cold start claimed to know').toBeNull();
        expect(getServerReachability().lastContactAt).toBeNull();
    });

    it('records a success', () => {
        recordServerContact(true, 1_000);
        expect(getServerReachability()).toEqual({
            lastContactAt: 1_000,
            lastFailureAt: null,
            reachable: true,
        });
    });

    it('records a failure without forgetting when it last worked', () => {
        // The age is what "Last synced 20 min ago" is made of, so a failure must not erase it.
        recordServerContact(true, 1_000);
        recordServerContact(false, 5_000);

        expect(getServerReachability()).toEqual({
            lastContactAt: 1_000,
            lastFailureAt: 5_000,
            reachable: false,
        });
    });

    it('recovers when the server answers again', () => {
        recordServerContact(false, 1_000);
        recordServerContact(true, 2_000);
        expect(getServerReachability().reachable).toBe(true);
    });
});

describe('subscribers', () => {
    it('are told when the answer changes', () => {
        const seen: (boolean | null)[] = [];
        const stop = onServerReachabilityChange((next) => seen.push(next.reachable));

        recordServerContact(true, 1_000);
        recordServerContact(false, 2_000);
        stop();
        recordServerContact(true, 3_000);

        expect(seen).toEqual([true, false]);
    });

    it('are not woken for a repeat of the same answer at the same moment', () => {
        // The pull reports once per page of every table. Re-rendering the sidebar for each of
        // those would be a lot of noise for one fact.
        let calls = 0;
        const stop = onServerReachabilityChange(() => { calls += 1; });

        recordServerContact(true, 1_000);
        recordServerContact(true, 1_000);
        recordServerContact(true, 1_000);
        stop();

        expect(calls).toBe(1);
    });
});

describe('how old the last contact is', () => {
    it('is stale when nothing has ever been contacted', () => {
        expect(isContactStale(getServerReachability(), 10_000)).toBe(true);
        expect(describeLastContact(getServerReachability(), 10_000)).toBeNull();
    });

    it('is fresh inside the window and stale outside it', () => {
        recordServerContact(true, 0);
        expect(isContactStale(getServerReachability(), CONTACT_STALE_AFTER_MS - 1)).toBe(false);
        expect(isContactStale(getServerReachability(), CONTACT_STALE_AFTER_MS + 1)).toBe(true);
    });

    it.each([
        [0, 'just now'],
        [30_000, 'just now'],
        [60_000, '1 min ago'],
        [5 * 60_000, '5 min ago'],
        [90 * 60_000, '1 h ago'],
        [50 * 60 * 60_000, '2 d ago'],
    ])('describes %ims ago as "%s"', (elapsed, expected) => {
        recordServerContact(true, 0);
        expect(describeLastContact(getServerReachability(), elapsed)).toBe(expected);
    });

    it('never reports a negative age from a clock that went backwards', () => {
        recordServerContact(true, 10_000);
        expect(describeLastContact(getServerReachability(), 5_000)).toBe('just now');
    });
});

describe('resetting', () => {
    it('forgets everything, so the next person on a shared laptop starts clean', () => {
        recordServerContact(true, 1_000);
        resetServerReachability();
        expect(getServerReachability()).toEqual({
            lastContactAt: null,
            lastFailureAt: null,
            reachable: null,
        });
    });
});
