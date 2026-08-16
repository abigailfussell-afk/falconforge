import type { SyncQueueItem } from './offline-db';

/**
 * B24 — is this refusal one that retrying could ever satisfy?
 *
 * WHY THIS EXISTS
 *
 * `drainSyncQueue` had exactly one failure path: increment the retry count, and after five
 * attempts park the change in the dead-letter store. That is the right behaviour for a
 * timeout and the wrong behaviour for a refusal. Three cases had accumulated across Sprints
 * 3, 4 and 5, all of them 403s from a policy that cannot come out differently on its own:
 *
 *   1. a write by a team whose licence has lapsed,
 *   2. a write into a season that has been archived,
 *   3. a write queued by a device that was offline when the season rolled over.
 *
 * Each burned five attempts over about nine minutes before being parked, and arrived with no
 * explanation attached. The user watched "1 pending" for nine minutes and then got a generic
 * failure.
 *
 * WHY THE ERROR ALONE CANNOT DECIDE THIS
 *
 * Measured against the real stack rather than assumed: PostgREST reports a cross-tenant
 * insert, an unlicensed write and an archived-season write with the SAME code and the SAME
 * message —
 *
 *     { code: '42501', message: 'new row violates row-level security policy for table "tasks"' }
 *
 * — because they are all one policy returning false. A `season_id` naming a season that does
 * not exist yet produces that too, since the policy's `season_is_open(season_id)` is false
 * for a missing season and denies before any foreign key is evaluated.
 *
 * That last case is why `42501 → terminal` would be a bug rather than a fix. Sprint 4's
 * rollover creates a season client-side and queues its sub-teams and checklist behind it; if
 * the season's own push is merely slow, its children get 42501, and dead-lettering them on
 * the first attempt would destroy a rollover that the existing retry ladder recovers from
 * perfectly.
 *
 * So a policy refusal is terminal only when LOCAL STATE ALREADY EXPLAINS IT: the team is
 * read-only, or the record's season is archived here. That is deliberately conservative — it
 * can leave a refusal on the retry ladder, and it can never park something that would have
 * succeeded. Case 3 above lands via the same rule one beat later: the device's copy of
 * `is_archived` is stale on the first attempt, and `sync()` pulls before it drains, so the
 * archive is local by the next pass. One or two retries instead of five, with a reason.
 */
export interface SyncFailureClassification {
    /** True when no number of retries could change the answer. */
    terminal: boolean;
    /** What to tell the user. Present only when {@link terminal}. */
    reason?: string;
}

const RETRYABLE: SyncFailureClassification = { terminal: false };

/** What the drain knows about the world when it classifies a failure. */
export interface SyncFailureContext {
    /** `team_entitlement.status` for the current team, or null if it has never been read. */
    entitlementStatus: 'active' | 'read_only' | null;
    /** Season ids this device believes are archived. */
    archivedSeasonIds: ReadonlySet<string>;
}

/** PostgREST surfaces the Postgres SQLSTATE as `code`. */
function codeOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return String(error ?? '');
}

/**
 * The season a queued change belongs to, if any.
 *
 * Reads the queued payload rather than the store, because the payload is what the server will
 * be asked to accept. Both spellings appear: `seasonId` in local records and `season_id` once
 * `transformToSupabaseSchema` has run, and the queue holds the pre-transform shape.
 */
function seasonIdOf(item: SyncQueueItem): string | undefined {
    const data = item.data as Record<string, unknown> | null | undefined;
    if (!data) return undefined;
    const value = data.seasonId ?? data.season_id;
    return typeof value === 'string' ? value : undefined;
}

/*
 * WHY CONSTRAINT VIOLATIONS ARE *NOT* HERE.
 *
 * The first draft of this also parked 23514 (CHECK / trigger), 22P02 (bad uuid) and 23502
 * (missing NOT NULL), on the reasoning that a retry sends the same bytes and must fail again.
 * The existing regression suite refused that, and it was right to:
 *
 *   * B19's test models a network outage with a title the CHECK constraint rejects, then
 *     CORRECTS THE QUEUED DATA IN PLACE and expects the retry to push it. That is not a
 *     contrivance — `queueForSync` coalesces a later edit into an existing queue entry, so a
 *     queued change's payload is mutable by design. "The same bytes forever" is simply false.
 *   * `sync-drain.db.test.ts` uses the same constraint to prove a mid-drain failure does not
 *     stop the items behind it, and that five attempts escalate to the dead-letter store.
 *
 * So a constraint violation is a refusal of THIS VERSION of the row, not of the change, and
 * parking it would discard a correction the user has already made. Left on the retry ladder.
 *
 * `enforce_seat_capacity` raises 23514 too, and its message is worth showing — but seat
 * assignment is a direct Supabase write that never enters the queue, so it is the admin
 * console's error to render, not the drain's. See `MemberManager`.
 *
 * 23503 (foreign key) and 23505 (unique) were never candidates: both depend on OTHER rows and
 * come good once a queued sibling lands.
 */

export function classifySyncFailure(
    item: SyncQueueItem,
    error: unknown,
    context: SyncFailureContext,
): SyncFailureClassification {
    const code = codeOf(error);
    const message = messageOf(error);

    /*
     * The queue named a table that does not exist in this build — a stale or corrupted entry.
     * `asSyncableTable` throws a plain Error with no code, before any request is made.
     *
     * Terminal, and the mutability argument above does not rescue it: no edit to the payload
     * can make a missing table present, because the table list is compiled in. The work is
     * still preserved, so a build that does know the table can recover it.
     */
    if (message.startsWith('Refusing to sync unknown table')) {
        return {
            terminal: true,
            reason: 'This change refers to something this version of the app no longer stores.',
        };
    }

    if (code !== '42501') return RETRYABLE;

    // A policy said no. Only local state can say which policy, and only sometimes.
    if (context.entitlementStatus === 'read_only') {
        return {
            terminal: true,
            reason:
                "Your team's licence has lapsed, so the server is not accepting changes. " +
                'Nothing has been lost — renew the licence and retry this change.',
        };
    }

    const seasonId = seasonIdOf(item);
    if (seasonId && context.archivedSeasonIds.has(seasonId)) {
        return {
            terminal: true,
            reason:
                'This change belongs to a season that has been archived, which is read-only. ' +
                'Nothing has been lost — switch to the current season to carry on working.',
        };
    }

    // A refusal we cannot account for. Could be a season that has not synced yet, so it keeps
    // its retries: guessing "terminal" here is the one mistake that loses work.
    return RETRYABLE;
}
