/**
 * B24 — classifying a sync failure that retrying cannot fix.
 *
 * The rule under test is narrow on purpose, and the tests that matter most are the ones
 * asserting a refusal is NOT terminal. Parking something that would have succeeded destroys a
 * user's work; leaving something on the retry ladder that was never going to succeed wastes
 * nine minutes. Those are not symmetric mistakes, and this file is weighted accordingly.
 *
 * The codes here are not invented: they were measured against the real local stack (see the
 * db-level companion, `sync-terminal.db.test.ts`). Every policy refusal — cross-tenant,
 * unlicensed, archived season, and a season that does not exist yet — comes back as 42501
 * with one identical message, which is the whole reason this needs local state rather than
 * just the error.
 */
import { describe, it, expect } from 'vitest';
import {
    classifySyncFailure,
    type SyncFailureContext,
} from '../sync-failure-classification';
import type { SyncQueueItem } from '../offline-db';

/** The refusal PostgREST actually returns for every policy denial. */
const policyRefusal = {
    code: '42501',
    details: null,
    hint: null,
    message: 'new row violates row-level security policy for table "tasks"',
};

function item(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
    return {
        id: 'queue-1',
        tableName: 'tasks',
        recordId: 'task-1',
        operation: 'create',
        data: { id: 'task-1', teamId: 'team-1', seasonId: 'season-current', title: 'Wire the arm' },
        timestamp: 1_000,
        retryCount: 0,
        ...overrides,
    };
}

function context(overrides: Partial<SyncFailureContext> = {}): SyncFailureContext {
    return {
        entitlementStatus: 'active',
        archivedSeasonIds: new Set<string>(),
        ...overrides,
    };
}

describe('a lapsed licence is terminal, and says so', () => {
    it('parks the change and explains it in terms of the licence', () => {
        const result = classifySyncFailure(item(), policyRefusal, context({ entitlementStatus: 'read_only' }));

        expect(result.terminal).toBe(true);
        expect(result.reason).toMatch(/licence has lapsed/i);
        // "Nothing has been lost" is the part that stops this reading as data loss, which is
        // what B2 spent a sprint making true.
        expect(result.reason).toMatch(/nothing has been lost/i);
    });
});

describe('an archived season is terminal for its own records only', () => {
    it('parks a change belonging to a season this device knows is archived', () => {
        const result = classifySyncFailure(
            item({ data: { id: 't', seasonId: 'season-last-year', title: 'x' } }),
            policyRefusal,
            context({ archivedSeasonIds: new Set(['season-last-year']) }),
        );

        expect(result.terminal).toBe(true);
        expect(result.reason).toMatch(/archived/i);
    });

    it('reads the snake_case spelling too, since the queue holds either', () => {
        const result = classifySyncFailure(
            item({ data: { id: 't', season_id: 'season-last-year', title: 'x' } }),
            policyRefusal,
            context({ archivedSeasonIds: new Set(['season-last-year']) }),
        );

        expect(result.terminal).toBe(true);
    });

    it('does NOT park a change for a different, still-open season', () => {
        const result = classifySyncFailure(
            item({ data: { id: 't', seasonId: 'season-current', title: 'x' } }),
            policyRefusal,
            context({ archivedSeasonIds: new Set(['season-last-year']) }),
        );

        expect(result.terminal).toBe(false);
    });
});

describe('a refusal nobody can account for keeps its retries', () => {
    /*
     * THE CASE THAT MAKES `42501 -> terminal` A BUG RATHER THAN A FIX.
     *
     * Sprint 4's rollover creates a season client-side and queues its sub-teams and checklist
     * behind it. The policy on those children calls `season_is_open(season_id)`, which is false
     * for a season the server has not got yet — so a merely-slow parent push makes every child
     * fail with the same 42501 an expired licence produces. The existing retry ladder recovers
     * from that; dead-lettering on the first attempt would destroy the rollover.
     */
    it('does not park a child whose parent season has simply not synced yet', () => {
        const result = classifySyncFailure(
            item({
                tableName: 'sub_teams',
                data: { id: 'sub-1', seasonId: 'season-created-offline', name: 'Build' },
            }),
            policyRefusal,
            // Licence fine, and the season is not archived — it is not here at all yet.
            context(),
        );

        expect(result.terminal).toBe(false);
        expect(result.reason).toBeUndefined();
    });

    it('does not park a cross-tenant refusal either — same code, unknown cause', () => {
        expect(classifySyncFailure(item(), policyRefusal, context()).terminal).toBe(false);
    });

    it('treats an unread entitlement as no reason to park anything', () => {
        // `null` is "we have never asked", which is not "read_only". A device that has just
        // installed the app must not start dead-lettering work because it has no answer yet.
        const result = classifySyncFailure(item(), policyRefusal, context({ entitlementStatus: null }));

        expect(result.terminal).toBe(false);
    });
});

describe('transient failures are untouched', () => {
    it('a timeout keeps its retries', () => {
        const result = classifySyncFailure(item(), new Error('upsert tasks timed out'), context());
        expect(result.terminal).toBe(false);
    });

    it('a network error keeps its retries', () => {
        const result = classifySyncFailure(item(), new TypeError('Failed to fetch'), context());
        expect(result.terminal).toBe(false);
    });

    /*
     * Both of these depend on OTHER ROWS, so they can come good once a queued sibling lands.
     * The rule is "could anything change this answer without the user acting?", which is why
     * they are excluded from the deterministic set even though they look fatal.
     */
    it('a foreign-key violation keeps its retries', () => {
        const result = classifySyncFailure(
            item(),
            { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint' },
            context(),
        );
        expect(result.terminal).toBe(false);
    });

    it('a unique violation keeps its retries', () => {
        const result = classifySyncFailure(
            item(),
            { code: '23505', message: 'duplicate key value violates unique constraint' },
            context(),
        );
        expect(result.terminal).toBe(false);
    });
});

describe('a constraint violation keeps its retries, because queued data is mutable', () => {
    /*
     * THE WIDENING THIS SPRINT TRIED AND THE SUITE REFUSED.
     *
     * An earlier draft parked 23514 / 22P02 / 23502 on the reasoning that a retry sends the
     * same bytes. `queueForSync` coalesces a later edit into an existing queue entry, so a
     * queued change's payload is mutable by design — B19's own test models an outage with a
     * CHECK-rejected title and then corrects it in place. Parking on the first attempt would
     * discard a correction the user has already made.
     *
     * These tests exist to stop that widening being re-attempted, which is why they assert the
     * un-obvious direction.
     */
    it('a CHECK constraint violation stays retryable', () => {
        const result = classifySyncFailure(
            item(),
            { code: '23514', message: 'new row for relation "tasks" violates check constraint "tasks_title_check"' },
            context(),
        );

        expect(result.terminal).toBe(false);
    });

    it('a malformed uuid stays retryable', () => {
        const result = classifySyncFailure(
            item(),
            { code: '22P02', message: 'invalid input syntax for type uuid: "user-1"' },
            context(),
        );

        expect(result.terminal).toBe(false);
    });

    it('a missing NOT NULL column stays retryable', () => {
        const result = classifySyncFailure(
            item(),
            { code: '23502', message: 'null value in column "title" violates not-null constraint' },
            context(),
        );

        expect(result.terminal).toBe(false);
    });

    /*
     * Seat capacity raises 23514 as well, and its message IS worth showing — but seat
     * assignment is a direct Supabase write that never enters the queue, so rendering it is
     * the admin console's job. The drain is not where that error is seen.
     */
    it('even the seat-capacity refusal stays retryable here, since it never reaches the queue', () => {
        const result = classifySyncFailure(
            item({ tableName: 'team_members' }),
            { code: '23514', message: 'No licensed seats available for this team (10 of 10 in use)' },
            context(),
        );

        expect(result.terminal).toBe(false);
    });
});

describe('a queue entry naming a table this build does not have is terminal', () => {
    /*
     * The one exception to the mutability argument: no edit to the payload can make a missing
     * table present, because the table list is compiled in. The work is still preserved, so a
     * build that does know the table can recover it.
     */
    it('parks a queue entry naming a table this build does not have', () => {
        const result = classifySyncFailure(
            item({ tableName: 'gemini_summaries' }),
            new Error('Refusing to sync unknown table "gemini_summaries"'),
            context(),
        );

        expect(result.terminal).toBe(true);
        expect(result.reason).toMatch(/no longer stores/i);
    });
});

describe('malformed errors do not crash the classifier', () => {
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'something went wrong'],
        ['a number', 500],
        ['an object with a numeric code', { code: 42501 }],
        ['an object with no message', { code: '42501' }],
    ])('survives %s', (_label, thrown) => {
        // The queue is persisted, so a stored item can be older than the code reading it, and
        // whatever `processSyncItem` throws is not under this function's control. A classifier
        // that throws would take the whole drain down with it.
        expect(() => classifySyncFailure(item(), thrown, context())).not.toThrow();
    });

    it('classifies an unrecognised throw as retryable', () => {
        expect(classifySyncFailure(item(), 'mystery', context()).terminal).toBe(false);
    });

    it('survives a queue item with no data at all', () => {
        const result = classifySyncFailure(
            item({ data: null }),
            policyRefusal,
            context({ archivedSeasonIds: new Set(['season-last-year']) }),
        );
        expect(result.terminal).toBe(false);
    });
});
