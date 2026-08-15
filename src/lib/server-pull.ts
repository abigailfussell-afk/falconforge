/**
 * THE READ PATH.
 *
 * Every server read in this application goes through `pullFromServer`. There is exactly
 * one, and it is this one.
 *
 * WHY THIS EXISTS
 *
 * There used to be three, and two of them destroyed offline work (C3):
 *
 *   1. `sync.pullChangesFromServer()` -- consulted `getPendingRecordIds()` before writing
 *      to the store, so a record edited offline and still sitting in the queue survived a
 *      pull. This is the correct behaviour.
 *   2. `store.fetchTeamData()` -- 145 lines of seven copy-pasted try/catch blocks, each
 *      ending in `set({ tasks: ... })`. It replaced every collection wholesale and had
 *      never heard of the sync queue. It ran on every team switch and on Dashboard mount.
 *   3. The `queries.ts` React Query hooks -- same wholesale replacement, on a 30s stale
 *      timer, per page.
 *
 * So a coach who created three tasks in a school gym with no signal, then walked past a
 * window, could watch them vanish: the refetch landed first, replaced `tasks` with the
 * server's copy, and the local records were gone from the UI while still queued for a push
 * that would never be reflected back. That is B3 -- the exact data-loss class the sync
 * engine was hardened against -- reintroduced by a second and third read path that did not
 * know the first one's rules.
 *
 * The rule that makes a pull safe: a record with an unpushed local change keeps its LOCAL
 * version. It is newer by definition -- it has not been sent yet. `getPendingRecordIds()`
 * is read AFTER the query returns, so anything queued while the request was in flight is
 * still covered.
 *
 * Making that rule impossible to forget means having one function that applies it, rather
 * than three that are each supposed to remember.
 */
import {
    db,
    getPendingRecordIds,
    getSyncMeta,
    setSyncCursor,
    bumpSyncCounter,
} from './offline-db';
import { supabaseSync } from './supabase';
import { useAppStore } from './store';
import { findEntity, SYNCED_ENTITIES, type RemoteTable } from './entity-registry';
import { withTimeout, PER_QUERY_TIMEOUT_MS, type SyncToken } from './timeout';

/**
 * How often a pull does a full reconciliation instead of a delta (every Nth pull).
 * Full pulls detect cross-client deletions; delta pulls only get new/updated records.
 */
const FULL_SYNC_INTERVAL = 5;

/**
 * Tables the background sync loop pulls: every pushable entity, plus the checklist blob.
 *
 * Derived from the registry rather than restated, so adding an entity means adding one
 * definition rather than remembering to update a second list (B16).
 */
export const SYNC_PULL_TABLES: readonly string[] = [
    ...SYNCED_ENTITIES.map((e) => e.remoteTable),
    // Blob-synced, not a registry entity: one row per team holding the whole array.
    'checklists',
];

/**
 * Tables loaded when the user opens a team: everything the sync loop pulls, plus the
 * roster, which the client reads but never pushes.
 */
export const TEAM_DATA_TABLES: readonly string[] = ['team_members', ...SYNC_PULL_TABLES];

export interface PullOptions {
    teamId: string;
    /** Which tables to pull. Defaults to {@link SYNC_PULL_TABLES}. */
    tables?: readonly string[];
    /**
     * `'auto'` — cursor-driven: a delta pull unless this is the Nth run for the team, in
     * which case a full reconciliation. What the background sync loop wants.
     *
     * `'full'` — always a complete replace. What a team switch and a page-level refresh
     * want: the user is looking at the screen and expects to see deletions made elsewhere.
     */
    mode?: 'auto' | 'full';
    token?: SyncToken;
}

/** Rows received per table. Zero is meaningful — it is how a deletion is detected. */
export type PullResult = Record<string, number>;

/**
 * Fetch server state for a team and merge it into the store without discarding unpushed
 * local work.
 *
 * Never throws: a table that fails to load is warned about and skipped, because one broken
 * table must not stop the others from loading. Individual failures show up as a missing key
 * in the returned {@link PullResult}.
 */
export async function pullFromServer(options: PullOptions): Promise<PullResult> {
    const { teamId, tables = SYNC_PULL_TABLES, mode = 'auto', token = { cancelled: false } } = options;

    const received: PullResult = {};
    if (!supabaseSync || !teamId) return received;

    // The counter decides when 'auto' does a full reconciliation. It is per-team, so
    // switching teams no longer shifts which entity lands on the reconciliation cycle
    // (B15). Only 'auto' advances it -- a page-level refresh must not perturb the
    // background loop's schedule.
    let isFullPull = mode === 'full';
    if (mode === 'auto') {
        const counter = await bumpSyncCounter(teamId);
        isFullPull = counter % FULL_SYNC_INTERVAL === 0;
    }

    const meta = await getSyncMeta();

    for (const table of tables) {
        // A timed-out run must stop touching the store instead of racing the next one (B6).
        if (token.cancelled) return received;

        try {
            const entityKey = `${teamId}:${table}`;

            // Checklists are blob-synced (the entire array lives in one row per team). If
            // there are pending local changes still queued, skip the pull entirely rather
            // than overwriting newer local state with stale server data. The per-record
            // pendingIds protection below cannot help here: the blob has no per-record
            // identity, so "keep the local version of these ids" has nothing to key on.
            if (table === 'checklists') {
                const pendingChecklistItems = await db.syncQueue
                    .where('tableName')
                    .equals('checklists')
                    .count();
                if (pendingChecklistItems > 0) continue;
            }

            let query = supabaseSync.from(table as RemoteTable).select('*').eq('team_id', teamId);

            // Checklists are one row per SEASON now (C6), and every one of them is pulled:
            // the store keys them by season, so switching seasons does not have to wait for
            // a round trip. Templates are a team-level library, not a working checklist, and
            // are excluded.
            //
            // (B12 was "the active checklist flips between syncs because row order is
            // unspecified and the code took records[0]". Nothing takes records[0] any more —
            // each row is filed under its own season — so the ambiguity is gone rather than
            // ordered around. The explicit order is kept because it costs nothing and makes
            // the delta cursor deterministic.)
            if (table === 'checklists') {
                query = query.eq('is_template', false).order('created_at', { ascending: true });
            }

            // Removed members and unapproved join requests are not the team's roster.
            // Preserved from `fetchTeamData`, which applied the same filter.
            if (table === 'team_members') {
                query = query.eq('status', 'approved');
            }

            // Delta pulls filter on the cursor. Checklists are excluded: blob sync is
            // always full, because a delta of a single blob row is meaningless.
            const cursor = meta.cursors[entityKey];
            const isDelta = !isFullPull && !!cursor && table !== 'checklists';

            if (isDelta) {
                query = query.gte('updated_at', cursor);
            }

            const result: { data: unknown[] | null; error: { message: string } | null } =
                await withTimeout((async () => query)(), PER_QUERY_TIMEOUT_MS, `pull ${table}`);

            if (result.error) {
                console.warn(`Pull for ${table} failed:`, result.error.message);
                continue;
            }

            if (token.cancelled) return received;

            const rows = result.data || [];
            received[table] = rows.length;

            // Records with unpushed local changes must survive the pull (B3). Read this
            // AFTER the query so anything queued while it was in flight is still covered.
            const pendingIds = await getPendingRecordIds(table);

            if (isDelta) {
                // Delta: merge new/updated records into existing state.
                mergeIntoStore(table, rows, pendingIds);
            } else {
                // Full: replace the collection (which is how deletions propagate), keeping
                // pending records.
                updateLocalDatabase(table, rows, pendingIds);
            }

            // Advance the cursor to the newest SERVER timestamp actually seen, never to the
            // local clock (B4). No rows means nothing newer exists, so the cursor stays put
            // rather than jumping forward over records that were never received.
            const newest = newestUpdatedAt(rows);
            if (newest) {
                meta.cursors[entityKey] = newest;
                await setSyncCursor(entityKey, newest);
            }
        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }

    return received;
}

/**
 * Load everything for a team: roster, then the season-scoped entities.
 *
 * Runs on team switch and on Dashboard mount. This is a full pull by design -- the user
 * has just arrived at the screen and expects to see what other devices have done, including
 * deletions.
 *
 * Deliberately NOT a store action. It lived in the store as `fetchTeamData` and grew a
 * private copy of the read path there; keeping it in the module that owns reads is what
 * stops that happening again.
 */
export async function fetchTeamData(teamId: string): Promise<void> {
    if (!teamId || !supabaseSync) return;

    const store = useAppStore.getState();
    store.setIsLoading(true);
    try {
        await pullFromServer({ teamId, tables: TEAM_DATA_TABLES, mode: 'full' });
        // Both are read on arrival at a team rather than on the background loop's schedule.
        // Neither changes on its own between pulls: a licence is granted or revoked by an
        // operator, and a template is saved by a person. Putting them in the sync loop would
        // cost two queries every few seconds to answer a question whose answer is the same.
        await Promise.all([
            pullChecklistTemplates(teamId),
            pullEntitlement(teamId),
        ]);
    } finally {
        useAppStore.getState().setIsLoading(false);
    }
}

/**
 * The team's saved checklist templates.
 *
 * Templates live in `checklists` alongside working checklists, separated by `is_template`.
 * The main pull filters them OUT (a template is not any season's working list and would
 * otherwise overwrite one), so they need their own read.
 *
 * Not part of the delta loop and not cursor-tracked: this is always a full replace, which is
 * how a template deleted on another device disappears here.
 */
export async function pullChecklistTemplates(teamId: string): Promise<number> {
    if (!supabaseSync || !teamId) return 0;

    try {
        const { data, error } = await withTimeout(
            (async () =>
                supabaseSync
                    .from('checklists')
                    .select('*')
                    .eq('team_id', teamId)
                    .eq('is_template', true)
                    .order('created_at', { ascending: true }))(),
            PER_QUERY_TIMEOUT_MS,
            'pull checklist templates',
        );

        if (error) {
            console.warn('Pull for checklist templates failed:', error.message);
            return 0;
        }

        const rows = data ?? [];
        const store = useAppStore.getState();

        // A template saved offline is still in the queue and has never been sent, so the
        // server cannot know about it. Same rule as every other collection replace (B3).
        const pendingIds = await getPendingRecordIds('checklists');
        const preserved = store.checklistTemplates.filter((t) => pendingIds.has(t.id));

        const incoming = rows
            .filter((row: any) => !pendingIds.has(row.id))
            .map((row: any) => ({
                id: row.id,
                name: row.name,
                items: Array.isArray(row.items) ? row.items : [],
                seasonId: row.season_id,
            }));

        store.setChecklistTemplates([...incoming, ...preserved]);
        return rows.length;
    } catch (err) {
        console.warn('Error pulling checklist templates:', err);
        return 0;
    }
}

/**
 * The team's licensing state, from the `team_entitlement` view.
 *
 * Read so the client can stop OFFERING writes a lapsed team cannot make — Sprint 3 found
 * that an unlicensed team's writes fail silently: the row appears, the server refuses it,
 * and the sync indicator says "1 pending" with no reason. Enforcement itself is server-side
 * and stays there; this is only what lets a button be disabled instead of misleading.
 *
 * A failure leaves the previous answer in place rather than clearing it. "We could not ask"
 * is not the same as "the team is licensed", and treating it as such is how an offline
 * client talks itself back into queueing refused writes.
 */
export async function pullEntitlement(teamId: string): Promise<void> {
    if (!supabaseSync || !teamId) return;

    try {
        const { data, error } = await withTimeout(
            (async () =>
                supabaseSync
                    .from('team_entitlement')
                    .select('*')
                    .eq('team_id', teamId)
                    .maybeSingle())(),
            PER_QUERY_TIMEOUT_MS,
            'pull entitlement',
        );

        if (error || !data) {
            if (error) console.warn('Pull for team_entitlement failed:', error.message);
            return;
        }

        const row = data as any;
        useAppStore.getState().setEntitlement({
            teamId: row.team_id,
            status: row.status === 'active' ? 'active' : 'read_only',
            seatsTotal: row.seats_total ?? null,
            seatsUnlimited: row.seats_unlimited ?? false,
            seatsUsed: Number(row.seats_used ?? 0),
            validUntil: row.valid_until ?? null,
            lapsedAt: row.lapsed_at ?? null,
        });
    } catch (err) {
        console.warn('Error pulling team entitlement:', err);
    }
}

/**
 * Newest server `updated_at` across a set of rows, as an ISO string.
 *
 * This is the delta cursor. It has to come from the DATA, not from `Date.now()`:
 * `updated_at` is written by a Postgres trigger on the server clock, so a client running
 * even slightly fast would skip every record written inside the skew window, and would do
 * so silently until the next full reconciliation (B4).
 */
export function newestUpdatedAt(rows: any[]): string | null {
    let newest: number | null = null;
    let newestISO: string | null = null;

    for (const row of rows) {
        const raw = row?.updated_at ?? row?.created_at;
        if (!raw) continue;
        const ms = new Date(raw).getTime();
        if (Number.isNaN(ms)) continue;
        if (newest === null || ms > newest) {
            newest = ms;
            newestISO = new Date(ms).toISOString();
        }
    }

    return newestISO;
}

/**
 * Replace an entity's collection in the store with what the server has.
 *
 * Full-pull semantics: a record the server no longer has is a record deleted on another
 * device, so replacement is how deletions propagate.
 */
export function updateLocalDatabase(
    tableName: string,
    records: any[],
    /**
     * Ids with unpushed local changes. Their local version is kept and the server's copy is
     * ignored, because the local one is newer by definition -- it has not been sent yet (B3).
     */
    pendingIds: Set<string> = new Set(),
): void {
    if (!records) return;

    const store = useAppStore.getState();

    const entity = findEntity(tableName);
    if (entity) {
        const incoming = records.map((r) => entity.fromRemote(r));

        // Records with a pending queue entry are carried over so that replacement does not
        // delete work that has never been sent.
        let next = incoming;
        if (pendingIds.size > 0) {
            const preserved = entity.getFromStore(store).filter((e: any) => pendingIds.has(e.id));
            next = [...incoming.filter((r: any) => !pendingIds.has(r.id)), ...preserved];
        }

        entity.setInStore(store, next);
        return;
    }

    if (tableName === 'checklists') {
        // Blob-synced, one row per season (C6). Each row is filed under its own season, so
        // a team with three seasons ends up with three lists and switching between them is
        // instant rather than a round trip.
        for (const row of records) {
            // TEMPLATES SHARE THIS TABLE AND ARE NOT ANY SEASON'S WORKING LIST.
            //
            // A template's `season_id` records where it was captured from, so filing one by
            // that column would replace that season's real checklist with a saved copy.
            // `pullFromServer` filters `is_template = false` server-side and never sends one
            // here — but realtime does not filter, and hands every checklist UPDATE for the
            // team straight to this function. Templates arrive through
            // `pullChecklistTemplates` instead.
            if (row?.is_template) continue;
            if (row?.season_id && Array.isArray(row.items)) {
                store.setChecklistForSeason(row.season_id, row.items);
            }
        }

        // NO ROWS IS NOT AN EMPTY CHECKLIST (B20).
        //
        // This used to `setChecklist([])`, reading zero rows as "cleared on another
        // client". For a team that has never pushed a checklist there was no row to find --
        // so every brand-new team had its eight seeded pre-match items deleted the first
        // time the dashboard loaded, with nothing to replace them. Iterating over the rows
        // received keeps that fixed by construction: zero rows is zero writes.
        //
        // A checklist genuinely emptied elsewhere still propagates, because the row
        // continues to exist with `items: []`. Nothing in the app deletes the row itself.
        return;
    }
}

/**
 * Merge delta-synced records into the existing store state.
 *
 * Upserts by `id` — existing records are updated, new records are added, and records NOT in
 * the delta set are preserved (unlike {@link updateLocalDatabase}, which replaces).
 * Checklists are excluded from delta sync, so this function never handles them.
 */
export function mergeIntoStore(
    tableName: string,
    records: any[],
    /**
     * Ids with unpushed local changes. Incoming rows for these are dropped so a teammate's
     * update cannot overwrite an edit the user has not sent yet (B3/B8). The local change
     * is pushed on the next drain, and last-write-wins settles it there.
     */
    pendingIds: Set<string> = new Set(),
): void {
    if (!records || records.length === 0) return;

    const entity = findEntity(tableName);
    // Checklists are always full-synced (blob), never delta, so they never reach here.
    if (!entity) return;

    const store = useAppStore.getState();
    const existing = entity.getFromStore(store);

    const byId = new Map(existing.map((item: any) => [item.id, item]));
    for (const row of records) {
        const item = entity.fromRemote(row);
        if (pendingIds.has(item.id)) continue;
        byId.set(item.id, item);
    }

    entity.setInStore(store, Array.from(byId.values()));
}
