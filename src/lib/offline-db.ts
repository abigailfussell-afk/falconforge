import Dexie, { Table } from 'dexie';

/**
 * Local database for offline-first functionality
 * Uses IndexedDB via Dexie for:
 *   1. syncQueue — tracks pending changes to be pushed to Supabase
 *   2. appState — Zustand persisted state (replaces localStorage to avoid 5 MB limit)
 *
 * Lightweight metadata (sync timestamps, sync counter, theme) stays in localStorage.
 */

export interface SyncQueueItem {
    id: string;
    tableName: string;
    recordId: string;
    operation: 'create' | 'update' | 'delete';
    data: any;
    timestamp: number;
    retryCount: number;
    lastError?: string;
}

/** Simple key-value row used by the appState table. */
export interface AppStateRow {
    key: string;
    value: string;
}

/**
 * A change that exhausted its retries and could not be pushed to the server.
 *
 * Previously these were deleted from the queue outright, so the user's work was destroyed
 * with nothing but a console.error to show for it (B2). They are parked here instead, so
 * the change still exists and the UI can tell somebody about it.
 */
export interface SyncFailure extends SyncQueueItem {
    /** When the change was moved out of the retry queue. */
    failedAt: number;
    /** Error text from the final attempt. */
    lastError: string;
    /**
     * Why retrying is pointless, in words a coach can act on — set only for a change parked
     * WITHOUT exhausting its retries (B24).
     *
     * Absent means the change failed five times for reasons nobody could name, which is a
     * different thing to tell somebody than "your team's licence has lapsed". The raw
     * `lastError` for these is always the same sentence — PostgREST reports every policy
     * refusal as "new row violates row-level security policy for table x" whatever the
     * policy's reason was — so this is the only place the actual cause survives.
     */
    terminalReason?: string;
}

class FalconForgeDatabase extends Dexie {
    syncQueue!: Table<SyncQueueItem, string>;
    appState!: Table<AppStateRow, string>;
    syncFailures!: Table<SyncFailure, string>;

    constructor() {
        super('FalconForgeDB');

        // Version 1: Original schema (entity tables + syncQueue)
        this.version(1).stores({
            teams: 'id, ownerId, syncStatus',
            teamMembers: 'id, teamId, userId, syncStatus',
            subTeams: 'id, teamId, seasonId, syncStatus',
            tasks: 'id, teamId, subTeamId, seasonId, status, syncStatus, updatedAt',
            checklists: 'id, teamId, seasonId, syncStatus',
            scoutingReports: 'id, teamId, seasonId, opponentTeamNumber, matchNumber, syncStatus',
            matchPlans: 'id, teamId, seasonId, syncStatus',
            syncQueue: 'id, tableName, timestamp, retryCount',
        });

        // Version 2: Remove unused entity tables (data lives in Zustand store)
        this.version(2).stores({
            teams: null,
            teamMembers: null,
            subTeams: null,
            tasks: null,
            checklists: null,
            scoutingReports: null,
            matchPlans: null,
            syncQueue: 'id, tableName, timestamp, retryCount',
        });

        // Version 3: Add appState table for Zustand persistence (replaces localStorage)
        this.version(3).stores({
            syncQueue: 'id, tableName, timestamp, retryCount',
            appState: 'key',
        });

        // Version 4: Dead-letter store for changes that exhausted their retries (B2).
        this.version(4).stores({
            syncQueue: 'id, tableName, timestamp, retryCount',
            appState: 'key',
            syncFailures: 'id, tableName, failedAt',
        });
    }
}

export const db = new FalconForgeDatabase();

// ---------------------------------------------------------------------------
// IndexedDB storage adapter for Zustand's `persist` middleware
// ---------------------------------------------------------------------------

/**
 * Zustand-compatible async storage adapter backed by IndexedDB.
 * Works with `createJSONStorage(() => indexedDBStorage)`.
 */
export const indexedDBStorage = {
    getItem: async (name: string): Promise<string | null> => {
        const row = await db.appState.get(name);
        return row?.value ?? null;
    },
    setItem: async (name: string, value: string): Promise<void> => {
        await db.appState.put({ key: name, value });
    },
    removeItem: async (name: string): Promise<void> => {
        await db.appState.delete(name);
    },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sync metadata (delta cursors + full-pull counters)
// ---------------------------------------------------------------------------

/**
 * Bookkeeping for incremental pulls.
 *
 * This used to live in localStorage under two separate keys, which sign-out never cleared
 * (B5): the next user on a shared laptop inherited the previous user's cursors and silently
 * received an incomplete dataset. Keeping it in `appState` means `clearAppState()` on
 * sign-out is the single cleanup path.
 */
export interface SyncMeta {
    /**
     * Last seen server `updated_at`, keyed by `${teamId}:${table}`.
     *
     * SERVER time, as an ISO string, taken from the rows themselves -- never `Date.now()`.
     * `updated_at` is written by a Postgres trigger, so comparing it against the client
     * clock skips every record inside the skew window (B4).
     */
    cursors: Record<string, string>;
    /** Pull counter per team, deciding when to do a full reconciliation (B15). */
    counters: Record<string, number>;
}

const SYNC_META_KEY = 'falconforge-sync-meta';

/**
 * Fresh empty metadata.
 *
 * Must be a factory, not a shared constant. Callers mutate the returned object
 * (`meta.cursors[key] = ...`), and a spread of a shared constant is only a SHALLOW copy --
 * `cursors` and `counters` would stay the same references, so the "empty" default would
 * quietly accumulate every cursor ever written and never read as empty again.
 */
function emptyMeta(): SyncMeta {
    return { cursors: {}, counters: {} };
}

export async function getSyncMeta(): Promise<SyncMeta> {
    try {
        const row = await db.appState.get(SYNC_META_KEY);
        if (!row?.value) return emptyMeta();
        const parsed = JSON.parse(row.value);
        return {
            cursors: parsed.cursors ?? {},
            counters: parsed.counters ?? {},
        };
    } catch {
        return emptyMeta();
    }
}

async function writeSyncMeta(meta: SyncMeta): Promise<void> {
    try {
        await db.appState.put({ key: SYNC_META_KEY, value: JSON.stringify(meta) });
    } catch {
        // Metadata is an optimisation; losing it costs a full pull, not correctness.
    }
}

/** Record the newest server timestamp seen for an entity. */
export async function setSyncCursor(entityKey: string, updatedAtISO: string): Promise<void> {
    const meta = await getSyncMeta();
    meta.cursors[entityKey] = updatedAtISO;
    await writeSyncMeta(meta);
}

/** Advance and return this team's pull counter. Per-team, so switching teams cannot shift
 *  which entity happens to land on the full-reconciliation cycle (B15). */
export async function bumpSyncCounter(teamId: string): Promise<number> {
    const meta = await getSyncMeta();
    const next = (meta.counters[teamId] ?? 0) + 1;
    meta.counters[teamId] = next;
    await writeSyncMeta(meta);
    return next;
}

// Helper to generate UUIDs
export function generateId(): string {
    return crypto.randomUUID();
}

/**
 * Strictly increasing queue timestamps.
 *
 * The drain orders by `timestamp` (B1), but `Date.now()` has millisecond resolution and a
 * burst of edits easily lands inside one tick. Equal timestamps mean the tie is broken
 * arbitrarily -- which is the same undefined ordering B1 set out to remove, just narrower.
 *
 * Nudging forward on a collision keeps ordering deterministic without a second index. The
 * value stays within a millisecond or two of wall-clock, and it is only ever used for
 * relative ordering, never displayed or compared against server time.
 */
let lastIssuedTimestamp = 0;

function nextQueueTimestamp(): number {
    const now = Date.now();
    lastIssuedTimestamp = now > lastIssuedTimestamp ? now : lastIssuedTimestamp + 1;
    return lastIssuedTimestamp;
}

/**
 * Queue a change for the server, coalescing redundant entries (B14).
 *
 * Every edit used to append a new row, so twenty tweaks to one task meant twenty full
 * upserts of the same record. Checklist toggles were the pathological case -- each one
 * queued the entire blob.
 *
 * Coalescing rules, in terms of what the server actually needs:
 *
 *   - `update` after a pending `create`  -> keep the create, with the newer data. The
 *     server has never seen this record, so it still has to be an insert.
 *   - `update` after a pending `update`  -> replace it. Only the latest state matters.
 *   - `delete` after a pending `create`  -> drop both. The server never saw it, so there
 *     is nothing to delete; sending a delete for an unknown id just fails and retries.
 *   - `delete` after a pending `update`  -> replace with the delete.
 *
 * The surviving entry keeps the ORIGINAL timestamp, so relative ordering against other
 * records is preserved and B1's drain order still holds.
 */
export async function queueForSync(
    tableName: string,
    recordId: string,
    operation: 'create' | 'update' | 'delete',
    data: any
) {
    /*
     * ORDER IS FIXED HERE, AT CALL TIME — NOT INSIDE THE TRANSACTION.
     *
     * Almost every caller is a store action that fires this and moves on
     * (`queueForSync(...).catch(console.error)`), so a burst of writes issued in one tick
     * produces a set of Dexie transactions that are IN FLIGHT SIMULTANEOUSLY. Allocating
     * the timestamp inside the transaction callback made the queue's order depend on the
     * order IndexedDB happened to schedule those transactions in, which nothing guarantees.
     *
     * B1 exists because draining in the wrong order applies a delete before its create, or
     * an update before the row exists. Sprint 4's rollover leans on that guarantee harder
     * than anything before it: one click queues a season, its sub-teams and its checklist,
     * and `season_id` is NOT NULL with a composite foreign key, so the season row MUST be
     * pushed first. Deleting a season leans on it in the other direction — the children's
     * deletes have to precede the parent's.
     *
     * Taking the number before awaiting anything makes the order the one the caller wrote,
     * which is the order the user acted in. A collapsed entry (below) discards its
     * allocation and keeps the original; timestamps only have to increase, not be dense.
     */
    const timestamp = nextQueueTimestamp();

    await db.transaction('rw', db.syncQueue, async () => {
        const pending = await db.syncQueue
            .where('tableName')
            .equals(tableName)
            .filter((i) => i.recordId === recordId)
            .toArray();

        if (pending.length === 0) {
            await db.syncQueue.add({
                id: generateId(),
                tableName,
                recordId,
                operation,
                data,
                timestamp,
                retryCount: 0,
            });
            return;
        }

        // Oldest entry defines the operation the server still needs and the ordering.
        pending.sort((a, b) => a.timestamp - b.timestamp);
        const first = pending[0];
        const hadCreate = pending.some((i) => i.operation === 'create');

        // A create that never reached the server, now deleted locally: nothing to send.
        if (operation === 'delete' && hadCreate) {
            await db.syncQueue.bulkDelete(pending.map((i) => i.id));
            return;
        }

        // Collapse to a single entry carrying the latest data.
        await db.syncQueue.bulkDelete(pending.map((i) => i.id));
        await db.syncQueue.add({
            id: first.id,
            tableName,
            recordId,
            // A pending create stays a create -- the row still does not exist server-side.
            operation: hadCreate && operation !== 'delete' ? 'create' : operation,
            data,
            timestamp: first.timestamp,
            retryCount: 0,
        });
    });
}

// Get pending sync count
export async function getPendingSyncCount(): Promise<number> {
    return await db.syncQueue.count();
}

/**
 * Queued operations, in the order the user performed them.
 *
 * Must NOT be `db.syncQueue.toArray()`. Dexie returns rows in primary-key order, and the
 * primary key is `generateId()` -> `crypto.randomUUID()`, so a plain toArray() drains the
 * queue in an order unrelated to what the user did: a delete can be applied before its
 * create (the record comes back), or an update before its create (it targets a row that
 * does not exist, fails, and is eventually discarded).
 *
 * `timestamp` is indexed in the schema above precisely so this ordering is cheap.
 */
export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
    return await db.syncQueue.orderBy('timestamp').toArray();
}

/**
 * Park a change that cannot be pushed, instead of deleting it.
 *
 * The queue entry is removed so the drain can make progress, but the change itself is
 * preserved so it can be retried later or inspected. Losing a scouting report entered at a
 * competition because five pushes happened to fail is not an acceptable outcome (B2).
 *
 * `terminalReason` distinguishes the two ways a change gets here: it exhausted five attempts
 * (absent), or it was refused by a rule that retrying cannot satisfy and was parked on the
 * first attempt (present, B24). Both keep the work; only the second can explain itself.
 */
export async function moveToDeadLetter(
    item: SyncQueueItem,
    error: unknown,
    terminalReason?: string,
): Promise<void> {
    await db.transaction('rw', db.syncQueue, db.syncFailures, async () => {
        await db.syncFailures.put({
            ...item,
            failedAt: Date.now(),
            lastError: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
            ...(terminalReason ? { terminalReason } : {}),
        });
        await db.syncQueue.delete(item.id);
    });
}

/**
 * Record ids for a table that still have unpushed local changes.
 *
 * A server pull must not overwrite these. A full pull replaces the whole collection, so
 * without this a record created offline disappears from the UI the moment a pull lands,
 * while still sitting in the queue waiting to be pushed (B3).
 *
 * `tableName` is the snake_case name as queued, e.g. 'scouting_reports'.
 */
export async function getPendingRecordIds(tableName: string): Promise<Set<string>> {
    const items = await db.syncQueue.where('tableName').equals(tableName).toArray();
    return new Set(items.map((i) => i.recordId));
}

export async function getSyncFailureCount(): Promise<number> {
    return await db.syncFailures.count();
}

/**
 * The distinct reasons among parked changes that were refused rather than unreachable (B24).
 *
 * De-duplicated: one lapsed licence stops every queued change, and eleven copies of the same
 * sentence is worse than one. Order follows `failedAt`, so the oldest explanation reads first.
 */
export async function getTerminalFailureReasons(): Promise<string[]> {
    const failures = await db.syncFailures.orderBy('failedAt').toArray();
    const reasons = failures
        .map((f) => f.terminalReason)
        .filter((r): r is string => typeof r === 'string' && r.length > 0);
    return [...new Set(reasons)];
}

export async function getSyncFailures(): Promise<SyncFailure[]> {
    return await db.syncFailures.orderBy('failedAt').toArray();
}

/**
 * Put every parked change back on the queue with its retry count reset.
 * Ordering is preserved because the original `timestamp` travels with the item.
 */
export async function retrySyncFailures(): Promise<number> {
    return await db.transaction('rw', db.syncQueue, db.syncFailures, async () => {
        const failures = await db.syncFailures.toArray();
        for (const failure of failures) {
            const { failedAt: _failedAt, lastError: _lastError, ...item } = failure;
            await db.syncQueue.put({ ...item, retryCount: 0 });
        }
        await db.syncFailures.clear();
        return failures.length;
    });
}

/** Give up on parked changes. Only ever called from an explicit user action. */
export async function discardSyncFailures(): Promise<void> {
    await db.syncFailures.clear();
}

/**
 * Put ONE parked change back on the queue, leaving the rest parked.
 *
 * The all-or-nothing versions above are what the sync indicator's "Retry them" uses, and they
 * are wrong for a review screen: the common case is a handful of parked changes where one is
 * genuinely dead (a task belonging to an archived season) and the others would go through
 * perfectly well. Retrying everything to clear the one is how somebody ends up discarding
 * everything to clear the one.
 *
 * Returns false if the id is not there, which is not an error -- two devices, or a bulk retry
 * that has already swept it up.
 */
export async function retrySyncFailure(id: string): Promise<boolean> {
    return await db.transaction('rw', db.syncQueue, db.syncFailures, async () => {
        const failure = await db.syncFailures.get(id);
        if (!failure) return false;
        // Same unwrapping as retrySyncFailures: the dead-letter-only fields come off, the
        // original `timestamp` travels with the item so queue ordering is preserved (B1).
        const { failedAt: _failedAt, lastError: _lastError, terminalReason: _reason, ...item } = failure;
        await db.syncQueue.put({ ...item, retryCount: 0 });
        await db.syncFailures.delete(id);
        return true;
    });
}

/**
 * Give up on ONE parked change.
 *
 * This is the only operation in the app that destroys the user's work on purpose, so it exists
 * precisely so that discarding is a DELIBERATE, itemised act rather than the side effect of
 * clearing a red badge. The caller is expected to confirm first and to show what is being
 * thrown away.
 */
export async function discardSyncFailure(id: string): Promise<boolean> {
    const existing = await db.syncFailures.get(id);
    if (!existing) return false;
    await db.syncFailures.delete(id);
    return true;
}

// Clear sync queue (for logout)
export async function clearLocalDatabase() {
    await db.syncQueue.clear();
    await db.syncFailures.clear();
}

// Clear persisted app state from IndexedDB (for logout)
export async function clearAppState() {
    await db.appState.clear();
}
