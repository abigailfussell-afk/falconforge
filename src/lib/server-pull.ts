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
import { supabaseSync, resolveSyncAccessTokenAsync } from './supabase';
import { useAppStore } from './store';
import {
    findEntity,
    SYNCED_ENTITIES,
    GUARDIAN_ENTITIES,
    type EntityDefinition,
    type RemoteTable,
    type SeasonScope,
} from './entity-registry';
import { withTimeout, PER_QUERY_TIMEOUT_MS, type SyncToken } from './timeout';
import { recordServerContact } from './server-reachability';

/**
 * How often a pull does a full reconciliation instead of a delta (every Nth pull).
 * Full pulls detect cross-client deletions; delta pulls only get new/updated records.
 */
const FULL_SYNC_INTERVAL = 5;

/**
 * Rows per request. PostgREST refuses to return more than `max_rows` (1,000, locally and on
 * the hosted default) and says nothing about having truncated: `error` is null, the array is
 * simply short (SYNC-01).
 *
 * Raising `max_rows` is explicitly NOT the fix. It moves the cliff to a bigger number and
 * leaves the failure mode intact, and the failure mode is the problem: a truncated FULL pull
 * REPLACES the collection, so rows 1,001+ were deleted from the device, and `newestUpdatedAt`
 * then advanced the delta cursor past records that had never arrived, so no later pull could
 * bring them back. `meeting_attendance` crosses 1,000 inside a single season for a team that
 * meets three times a week.
 */
const PULL_PAGE_SIZE = 1000;

/**
 * A ceiling on how far one table's pagination will walk before giving up.
 *
 * Not a row limit anybody should reach -- 200 pages is 200,000 rows, and the largest table in
 * the model (`meeting_attendance`, one row per member per meeting) reaches that at roughly a
 * century of practice. It exists so that a filter that silently stops filtering, or a page
 * that keeps returning full pages for a reason nobody predicted, ends as a loud warning and
 * an abandoned table rather than an infinite loop against the server.
 */
const MAX_PULL_PAGES = 200;

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
export const TEAM_DATA_TABLES: readonly string[] = ['teams', 'team_members', ...SYNC_PULL_TABLES];

/**
 * The tables a season scopes, and the tables it does not.
 *
 * Split from the registry rather than written out, because a hand-kept list that must track
 * another list is `docs/failure-modes.md` section 12 -- and the cost of a table falling off
 * this one is precisely SYNC-01: its entire history downloaded on every open, and truncated
 * at a thousand rows once it gets big enough.
 *
 * `checklists` is season-scoped and is not a registry entity, so it is named here.
 */
export const SEASON_SCOPED_TABLES: readonly string[] = [
    ...TEAM_DATA_TABLES.filter((t) => findEntity(t)?.seasonScope),
    'checklists',
];

/** Everything else the team pull loads: the tenant, its roster, its season list. */
export const TEAM_SCOPED_TABLES: readonly string[] = TEAM_DATA_TABLES.filter(
    (t) => !SEASON_SCOPED_TABLES.includes(t),
);

/**
 * The guardian's own records: their children and the consents they have given.
 *
 * Not part of {@link SYNC_PULL_TABLES} because these rows have no `team_id`. They are pulled
 * by {@link fetchGuardianData} against the signed-in user, and a guardian who is not a member
 * of any team still gets them — which is the normal case, since a guardian holds a roster row
 * on their child's behalf without being a member themselves.
 */
export const GUARDIAN_PULL_TABLES: readonly string[] = GUARDIAN_ENTITIES.map((e) => e.remoteTable);

export interface PullOptions {
    /** The open team. Required for team-scoped tables; ignored by guardian-scoped ones. */
    teamId: string;
    /**
     * The signed-in user, for guardian-scoped tables (`scope: 'guardian'`).
     *
     * Required if `tables` contains any of them, and asserted rather than assumed: pulling a
     * guardian table without it would filter on `guardian_user_id = undefined`, which
     * PostgREST answers with zero rows — indistinguishable from a guardian who has not added
     * a child yet. That is `docs/failure-modes.md` section 4 exactly, so it fails loudly instead.
     */
    guardianUserId?: string;
    /**
     * SEVERAL teams at once, for a caller that is not "in" any one of them.
     *
     * A guardian can hold children on more than one team and has no current team at all, so
     * `teamId` cannot express what they need to read. Calling `pullFromServer` once per team
     * would be worse than wrong: a full pull REPLACES each collection, so the second team's
     * pull would delete the first team's rows from the store.
     *
     * When set, team-scoped tables filter with `.in('team_id', …)` instead of `.eq`, which is
     * one query and one replace covering all of them.
     */
    teamIds?: readonly string[];
    /**
     * WHICH SEASON, for the tables that have one.
     *
     * `undefined` -- read `currentSeasonId` from the store. What almost every caller wants,
     * and stated once here rather than at six call sites (`docs/failure-modes.md` section 1
     * counted six copies of the season filter the last time this was spread out).
     *
     * A season id -- pull that season. This is how the season picker loads an archived season
     * on demand: its rows arrive, are cached offline like everything else, and the rows of
     * OTHER seasons already on the device are left alone rather than being replaced away.
     *
     * `null` -- EVERY season, deliberately. `fetchGuardianData` needs it: a guardian has no
     * current season, and a coach who is also a parent has one that has nothing to do with
     * their child's schedule on another team.
     *
     * The store's `currentSeasonId` being null (not hydrated yet, or a guardian) means the
     * same thing as `null` here: we do not know which season, so do not filter. Pulling
     * everything is the expensive answer, not the wrong one.
     */
    seasonId?: string | null;
    /** Which tables to pull. Defaults to {@link SYNC_PULL_TABLES}. */
    tables?: readonly string[];
    /**
     * `'auto'` — cursor-driven: a delta pull unless this is the Nth run for the team, in
     * which case a full reconciliation. What the background sync loop wants.
     *
     * `'full'` -- always a complete replace. What a team switch wants: the user has changed
     * tenant and expects the board to be that team's board, not a merge of two.
     *
     * `'cursor'` -- delta when a cursor exists for the table, full when one does not, and
     * WITHOUT touching the per-team counter. What a page-level refresh wants: it exists to
     * freshen a view the user is already looking at, and re-downloading a season's entire
     * task history to do that is what made every app open cost ~0.7 MB (SYNC-03). Deletions
     * still arrive -- through realtime while it is connected, and through the periodic `auto`
     * reconciliation otherwise.
     */
    mode?: 'auto' | 'full' | 'cursor';
    token?: SyncToken;
}

/** Rows received per table. Zero is meaningful — it is how a deletion is detected. */
export type PullResult = Record<string, number>;

/**
 * What a pull actually asked the server for, and therefore what its answer is evidence about.
 *
 * A full pull replaces a collection because "the server did not send this row" means "it was
 * deleted somewhere else". That inference is only sound over the rows the query COULD have
 * returned. Now that the pull is scoped to one team and one season, the rows outside that
 * scope were never candidates, so their absence says nothing -- and treating it as a deletion
 * would wipe an archived season off the device the moment the current one was refreshed.
 * This is `docs/failure-modes.md` section 4 pointed at a query rather than at a value.
 *
 * The team half is the opposite rule, and deliberately so. A row belonging to a DIFFERENT
 * team has no business in the collection the board renders whatever its season, so an
 * out-of-team row is dropped rather than kept (SYNC-15).
 *
 * Every field is optional and `undefined` means "unscoped", never "scoped to nothing".
 */
export interface PullScope {
    /** The single team this pull covered. */
    teamId?: string;
    /** The several teams this pull covered — a guardian reading across their children. */
    teamIds?: ReadonlySet<string>;
    /** The season this pull covered. Absent when the pull asked for every season. */
    seasonId?: string;
}

/**
 * Which season a LOCAL record belongs to, or `null` when this device cannot tell.
 *
 * `null` is not a failure: a record persisted by an older build, or an attendance row whose
 * meeting is no longer cached, genuinely does not say. Callers treat it as "inside whatever
 * this pull covered", which is the pre-existing behaviour and the conservative one -- it can
 * cost a re-fetch, where guessing the other way would hide rows the user is looking at.
 */
function localSeasonOf(
    entity: EntityDefinition<any>,
    item: any,
    store: ReturnType<typeof useAppStore.getState>,
): string | null {
    if (entity.seasonScope === 'column') return item?.seasonId ?? null;
    if (entity.seasonScope === 'meeting') {
        const meeting = store.meetings.find((m) => m.id === item?.meetingId);
        return meeting?.seasonId ?? null;
    }
    return null;
}

/** Is this local record one of the rows the pull was allowed to return? (see {@link PullScope}) */
function withinPulledTeam(item: any, scope: PullScope | undefined): boolean {
    const teamId = item?.teamId;
    // Unknown tenant: not evidence of a mismatch. See TENANT ON EVERY ROW in types.ts.
    if (!teamId || !scope) return true;
    if (scope.teamIds) return scope.teamIds.has(teamId);
    if (scope.teamId) return teamId === scope.teamId;
    return true;
}

/** Is this local record from a season the pull did not ask about, and so not its business? */
function outsidePulledSeason(
    entity: EntityDefinition<any>,
    item: any,
    scope: PullScope | undefined,
    store: ReturnType<typeof useAppStore.getState>,
): boolean {
    if (!scope?.seasonId || !entity.seasonScope) return false;
    const season = localSeasonOf(entity, item, store);
    return season !== null && season !== scope.seasonId;
}

/**
 * Fetch server state for a team and merge it into the store without discarding unpushed
 * local work.
 *
 * Never throws: a table that fails to load is warned about and skipped, because one broken
 * table must not stop the others from loading. Individual failures show up as a missing key
 * in the returned {@link PullResult}.
 */
export async function pullFromServer(options: PullOptions): Promise<PullResult> {
    const {
        teamId,
        teamIds,
        guardianUserId,
        tables = SYNC_PULL_TABLES,
        mode = 'auto',
        token = { cancelled: false },
    } = options;

    const received: PullResult = {};
    if (!supabaseSync) return received;

    /*
     * A team-scoped pull with no team is a no-op, as it always was. A guardian-scoped pull
     * does not need one — a guardian with no membership of their own still has children.
     *
     * Written as "is anything here team-scoped" rather than the previous "is anything here
     * NOT guardian-scoped". Those read the same while there were exactly two scopes and stop
     * being the same the moment a third exists: `teams` is `'rls'`, so the old form would have
     * made a `['teams']` pull demand a team id and return early for the guardian who most
     * needs it. Checklists are not a registry entity at all and stay team-scoped by default,
     * which is what `?? 'team'` preserves.
     */
    const wantsTeamScope = tables.some((t) => (findEntity(t)?.scope ?? 'team') === 'team');
    if (wantsTeamScope && !teamId && !teamIds?.length) return received;

    /*
     * NEVER PULL AS `anon` (SYNC-02).
     *
     * `supabaseSync`'s access-token callback falls back to the anon key when the stored JWT
     * has expired and the refresh call fails -- which is what a captive portal and "the WiFi
     * came back for two seconds" look like. `anon` holds SELECT on every table, so the
     * request does not fail: PostgREST answers `200 []`. This function then treats that as a
     * successful full pull, and zero rows is how it detects a deletion, so every collection
     * on the device was replaced with nothing. Un-pushed work survived (B3); everything the
     * team relied on reading offline did not, and the persisted copy was overwritten, so a
     * reload did not bring it back.
     *
     * The push may still legitimately use the anon key -- it gets a 42501 that the classifier
     * understands and the queue retries. Only the read has "empty means deleted" semantics,
     * so only the read refuses to run. Skipped, not emptied: the device keeps what it has.
     */
    if (!(await resolveSyncAccessTokenAsync())) {
        console.warn(
            'Pull skipped: no signed-in user token. The device keeps the copy it already has ' +
            'rather than replacing it with what an anonymous request would return.',
        );
        return received;
    }

    // The counter decides when 'auto' does a full reconciliation. It is per-team, so
    // switching teams no longer shifts which entity lands on the reconciliation cycle
    // (B15). Only 'auto' advances it -- a page-level refresh must not perturb the
    // background loop's schedule.
    let isFullPull = mode === 'full';
    if (mode === 'auto') {
        const counter = await bumpSyncCounter(teamId || teamIds?.join(',') || guardianUserId || '');
        isFullPull = counter % FULL_SYNC_INTERVAL === 0;
    }

    // `undefined` means "whatever season the user is in"; `null` means "every season".
    const scopeSeasonId =
        options.seasonId === undefined
            ? useAppStore.getState().currentSeasonId
            : options.seasonId;

    /** What this pull covered, and therefore what its results are evidence about. */
    const pullScope: PullScope = {
        teamId: teamIds?.length ? undefined : teamId || undefined,
        teamIds: teamIds?.length ? new Set(teamIds) : undefined,
        seasonId: scopeSeasonId || undefined,
    };

    const meta = await getSyncMeta();

    for (const table of tables) {
        // A timed-out run must stop touching the store instead of racing the next one (B6).
        if (token.cancelled) return received;

        try {
            /*
             * WHICH COLUMN SCOPES THIS TABLE.
             *
             * Everything before Sprint 9 was team-scoped and this was an unconditional
             * `.eq('team_id', teamId)`. Guardian tables have no such column, so the registry
             * now states the scope per entity and the pull reads it here rather than the two
             * of them being expected to agree from a distance.
             */
            const entity = findEntity(table);
            const scope = entity?.scope ?? 'team';
            const isGuardianScoped = scope === 'guardian';
            // `'rls'` sends NO predicate: the policy is the filter. See EntityScope.
            const isRlsScoped = scope === 'rls';
            const scopeColumn = isGuardianScoped ? 'guardian_user_id' : 'team_id';
            // `teamIds` wins over `teamId` for team-scoped tables; see PullOptions.
            const scopeValues = !isGuardianScoped && !isRlsScoped && teamIds?.length ? teamIds : null;
            const scopeValue = isGuardianScoped ? guardianUserId : teamId;

            if (!isRlsScoped && !scopeValue && !scopeValues) {
                // Loudly, not silently. Filtering on `undefined` returns zero rows, and zero
                // rows here is indistinguishable from "this guardian has no children" — the
                // absence-read-as-a-value class (failure-modes §4) that cost this project a
                // whole team's seeded checklist (B20).
                console.warn(
                    `Pull for ${table} skipped: no ${scopeColumn} to scope it by.`,
                );
                continue;
            }

            /*
             * SEASONS ARE FRESH STARTS, AND THE PULL IS WHERE THAT STOPS BEING FREE.
             *
             * Until this change every season-scoped table was pulled in full, for ever: a
             * team in its third year re-downloaded three years of tasks on every app open,
             * to render a board that shows one of them (principle 5 says prior seasons are
             * read-only; nothing said they were not re-read). That is half of SYNC-03's
             * ~0.7 MB per open, and it is also how `tasks` reaches the 1,000-row cap.
             *
             * `meeting_attendance` is the one season-scoped table with no `season_id`. It
             * reaches its season through its meeting, expressed as a PostgREST embedded
             * inner join. The embed spec is EMPTY on purpose -- `meetings!inner()` filters
             * the rows without attaching a nested object to each one, so scoping this table
             * costs nothing on the wire.
             */
            const seasonScope: SeasonScope = entity
                ? entity.seasonScope
                // Checklists are not a registry entity (blob-synced), and are one row per season.
                : table === 'checklists' ? 'column' : null;
            const seasonFilter = scopeSeasonId && seasonScope ? scopeSeasonId : null;
            const selectSpec =
                (entity?.pullColumns ? entity.pullColumns.join(',') : '*') +
                (seasonFilter && seasonScope === 'meeting' ? ',meetings!inner()' : '');

            // Cursors are per scope-value, not per team: a guardian's children do not belong
            // to a team, and keying them by one would reset the cursor on every team switch.
            // An RLS-scoped table has no scope value to key by, and the row set it returns
            // depends on the signed-in user rather than on a team — so it keys by the viewer.
            const entityKey = isRlsScoped
                ? `viewer:${guardianUserId ?? 'self'}:${table}`
                : `${scopeValues ? scopeValues.join(',') : scopeValue}:${table}`;

            /*
             * A CURSOR IS PER SEASON AS WELL AS PER SCOPE.
             *
             * The pull now asks for one season at a time, so one cursor per table would be a
             * lie about the others: pulling 2026-27 up to now, then switching to the archived
             * 2025-26, would start that season's first pull from a timestamp no row in it has
             * ever had -- and a delta that returns nothing looks exactly like a season with
             * nothing in it. Keying the cursor by the season it describes keeps each one an
             * honest answer to "what have I seen of THIS set of rows".
             */
            const cursorKey = seasonFilter ? `${entityKey}:season:${seasonFilter}` : entityKey;
            const cursor = meta.cursors[cursorKey];
            const isDelta = !isFullPull && !!cursor && table !== 'checklists';

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

            /**
             * One page of this table, from `after` onwards.
             *
             * Rebuilt per page rather than reused: a PostgREST builder is a one-shot
             * thenable, so a query object cannot be awaited twice.
             *
             * KEYSET, NOT OFFSET. `.range(1000, 1999)` on a table somebody is writing to
             * skips rows: a record on page 1 that is updated mid-pagination sorts to the
             * end, everything after it shifts down one, and the row that slid across the
             * page boundary is never returned -- which for a FULL pull means it is deleted
             * from the device, i.e. SYNC-01 again in a narrower window. Paging on
             * `(updated_at, id) > (last seen)` cannot skip: a row that moves, moves to
             * AFTER the cursor, so the worst case is seeing it twice, and an upsert by id
             * does not care.
             */
            const page = (after: { updatedAt: string; id: string } | null) => {
                let q = isRlsScoped
                    ? supabaseSync!.from(table as RemoteTable).select(selectSpec)
                    : scopeValues
                      ? supabaseSync!.from(table as RemoteTable).select(selectSpec).in(scopeColumn, scopeValues as string[])
                      : supabaseSync!.from(table as RemoteTable).select(selectSpec).eq(scopeColumn, scopeValue!);

                if (seasonFilter) {
                    q = seasonScope === 'meeting'
                        ? q.eq('meetings.season_id', seasonFilter)
                        : q.eq('season_id', seasonFilter);
                }

                // Checklists are one row per SEASON now (C6), and every one of them is
                // pulled. Templates are a team-level library, not a working checklist, and
                // are excluded -- filing one by its `season_id` would replace that season's
                // real checklist with a saved copy.
                if (table === 'checklists') q = q.eq('is_template', false);

                // Removed members and unapproved join requests are not the team's roster.
                // Preserved from `fetchTeamData`, which applied the same filter.
                if (table === 'team_members') q = q.eq('status', 'approved');

                // Delta pulls filter on the cursor. Checklists are excluded: blob sync is
                // always full, because a delta of a single blob row is meaningless.
                if (isDelta) q = q.gte('updated_at', cursor!);

                if (after) {
                    q = q.or(
                        `updated_at.gt.${after.updatedAt},` +
                        `and(updated_at.eq.${after.updatedAt},id.gt.${after.id})`,
                    );
                }

                return q
                    .order('updated_at', { ascending: true })
                    .order('id', { ascending: true })
                    .limit(PULL_PAGE_SIZE);
            };

            /*
             * EVERY PAGE, OR NONE OF THEM.
             *
             * Rows accumulate here and are written to the store once, after the last page.
             * Applying pages as they arrive would put back the defect this whole change is
             * about: a full pull REPLACES the collection, so page 1 landing on its own
             * deletes every row that pages 2..n were going to bring. A page that errors
             * therefore abandons the table -- the store is not touched and the cursor does
             * not move, so the device keeps what it has and the next pull tries again.
             */
            const rows: any[] = [];
            let after: { updatedAt: string; id: string } | null = null;
            let complete = false;

            for (let pageNumber = 0; pageNumber < MAX_PULL_PAGES; pageNumber++) {
                if (token.cancelled) return received;

                let result: { data: any[] | null; error: { message: string } | null };
                try {
                    result = await withTimeout((async () => page(after))(), PER_QUERY_TIMEOUT_MS, `pull ${table}`);
                } catch (err) {
                    // Never completed: a timeout, a DNS failure, a captive portal swallowing
                    // the request. That is the state the indicator has to be able to name
                    // (SYNC-07), and `navigator.onLine` cannot see it.
                    recordServerContact(false);
                    throw err;
                }

                /*
                 * AN ERROR HERE IS STILL CONTACT.
                 *
                 * PostgREST answered — with a refusal, a bad filter, whatever. The server is
                 * reachable and that is the question this records. A 42501 lighting a
                 * "can't reach server" warning would be a lapsed licence wearing the wrong
                 * explanation.
                 */
                recordServerContact(true);

                if (result.error) {
                    console.warn(`Pull for ${table} failed:`, result.error.message);
                    break;
                }

                const batch = result.data || [];
                rows.push(...batch);

                if (batch.length < PULL_PAGE_SIZE) {
                    complete = true;
                    break;
                }

                const last = batch[batch.length - 1];
                // Without both halves of the key the next page cannot be addressed, and
                // guessing would silently drop rows. Stop instead.
                if (!last?.updated_at || !last?.id) {
                    console.warn(`Pull for ${table} stopped: a full page had no (updated_at, id) to page from.`);
                    break;
                }
                after = { updatedAt: last.updated_at, id: last.id };
            }

            if (!complete) {
                console.warn(
                    `Pull for ${table} was incomplete after ${rows.length} rows; ` +
                    'leaving the local copy and the delta cursor untouched.',
                );
                continue;
            }

            if (token.cancelled) return received;

            received[table] = rows.length;

            // Records with unpushed local changes must survive the pull (B3). Read this
            // AFTER the query so anything queued while it was in flight is still covered.
            const pendingIds = await getPendingRecordIds(table);

            if (isDelta) {
                // Delta: merge new/updated records into existing state.
                mergeIntoStore(table, rows, pendingIds, pullScope);
            } else {
                // Full: replace the collection (which is how deletions propagate), keeping
                // pending records, and keeping the seasons this pull did not ask about.
                updateLocalDatabase(table, rows, pendingIds, pullScope);
            }

            // Advance the cursor to the newest SERVER timestamp actually seen, never to the
            // local clock (B4). No rows means nothing newer exists, so the cursor stays put
            // rather than jumping forward over records that were never received.
            const newest = newestUpdatedAt(rows);
            if (newest) {
                meta.cursors[cursorKey] = newest;
                await setSyncCursor(cursorKey, newest);
            }
        } catch (err) {
            console.warn(`Error pulling ${table}:`, err);
        }
    }

    return received;
}

/**
 * The team this session has already loaded, so a SWITCH can be told from a re-open.
 *
 * Module state, and deliberately not persisted: every app open is a fresh page load, so this
 * is `null` on arrival, which is exactly right. A cold open finds the store holding the rows
 * of the team it is about to load, so a delta is safe and cheap. A switch within a session
 * does not -- the store holds the previous team's rows -- so it forces a full pull, and the
 * replace is what makes the board that team's board.
 */
let teamLoadedThisSession: string | null = null;

/**
 * Load everything for a team: roster, then the current season's entities.
 *
 * Runs on team switch and on AppShell mount, i.e. on every cold open, every reload and every
 * team change. It used to be an unconditional FULL pull of all ten tables with no season
 * filter, which is the ~0.7 MB per app open of SYNC-03 -- 15 devices opening the app six
 * times a day was ~1.9 GB a month for ONE team, against a 5 GB free-tier allowance shared by
 * everybody.
 *
 * So it asks for a delta when it can (`mode: 'auto'`, which still reconciles fully every
 * FULL_SYNC_INTERVAL-th pull for the team, and does a full pull whenever there is no cursor
 * to delta from), and for a full pull when the tenant has actually changed. Deletions made
 * elsewhere still arrive: through realtime while it is connected, and through the periodic
 * reconciliation when it is not.
 *
 * Deliberately NOT a store action. It lived in the store as `fetchTeamData` and grew a
 * private copy of the read path there; keeping it in the module that owns reads is what
 * stops that happening again.
 */
export async function fetchTeamData(teamId: string): Promise<void> {
    if (!teamId || !supabaseSync) return;

    const switchedTeam = teamLoadedThisSession !== null && teamLoadedThisSession !== teamId;
    teamLoadedThisSession = teamId;

    const store = useAppStore.getState();
    store.setIsLoading(true);
    try {
        // The tables with no season: the tenant, its roster, and the season list the picker
        // is built from. Always for every season -- `seasons` is what the picker offers.
        await pullFromServer({
            teamId,
            tables: TEAM_SCOPED_TABLES,
            mode: switchedTeam ? 'full' : 'auto',
            seasonId: null,
        });

        // Both are read on arrival at a team rather than on the background loop's schedule.
        // Neither changes on its own between pulls: a licence is granted or revoked by an
        // operator, and a template is saved by a person. Putting them in the sync loop would
        // cost two queries every few seconds to answer a question whose answer is the same.
        await Promise.all([
            pullChecklistTemplates(teamId),
            pullEntitlement(teamId),
        ]);

        // ...and then the season the user is actually in. Read AFTER the pull above, because
        // that is what fills the season list on a device that has never seen this team.
        const seasonId = useAppStore.getState().currentSeasonId;
        if (seasonId) {
            await fetchSeasonData(teamId, seasonId, { mode: switchedTeam ? 'full' : 'auto' });
        }
    } finally {
        useAppStore.getState().setIsLoading(false);
    }
}

/**
 * One season's worth of a team: the tables a fresh start empties.
 *
 * Called for the current season by {@link fetchTeamData}, and for an archived season by the
 * season picker -- which is what makes "prior seasons are read-only" cost nothing until
 * somebody actually looks at one. What arrives is cached offline exactly like the current
 * season's rows, so a coach who opened 2025-26 at home can still read it in a gym.
 *
 * In-flight calls for the same (team, season) share one promise. The mount effect and the
 * season effect both fire on arrival, and two identical full pulls racing each other over
 * the same collections is how a replace lands twice with a queue drain in between.
 */
const seasonPullsInFlight = new Map<string, Promise<void>>();

export function fetchSeasonData(
    teamId: string,
    seasonId: string,
    options: { mode?: 'auto' | 'full' | 'cursor' } = {},
): Promise<void> {
    if (!teamId || !seasonId || !supabaseSync) return Promise.resolve();

    const key = `${teamId}:${seasonId}:${options.mode ?? 'auto'}`;
    const existing = seasonPullsInFlight.get(key);
    if (existing) return existing;

    const work = (async () => {
        await pullFromServer({
            teamId,
            seasonId,
            tables: SEASON_SCOPED_TABLES,
            mode: options.mode ?? 'auto',
        });
    })().finally(() => {
        seasonPullsInFlight.delete(key);
    });

    seasonPullsInFlight.set(key, work);
    return work;
}

/**
 * The field image for one season, fetched once and then left alone.
 *
 * `field_image_data` is base64 in a column, up to ~500 KB of image and so ~670 KB of text,
 * and it used to be part of `select('*')` on `seasons` -- which the app pulls on every open.
 * The pull leaves it out now (see `EntityDefinition.pullColumns`) and the two screens that
 * show it ask for it here.
 *
 * Nothing re-fetches it once the device has an answer, including `''` for "this season has no
 * image": a second fetch would be a second copy of a 670 KB string to learn what the store
 * already says. A change made on another device arrives through realtime, which carries every
 * column.
 */
export async function ensureSeasonFieldImage(seasonId: string): Promise<void> {
    if (!supabaseSync || !seasonId) return;

    const season = useAppStore.getState().seasons.find((s) => s.id === seasonId);
    // `undefined` means "never fetched". `''` means "no image", which is an answer.
    if (!season || season.fieldImageData !== undefined) return;

    try {
        const { data, error } = await withTimeout(
            (async () =>
                supabaseSync!
                    .from('seasons')
                    .select('id,field_image_data')
                    .eq('id', seasonId)
                    .maybeSingle())(),
            PER_QUERY_TIMEOUT_MS,
            'pull season field image',
        );

        // A failure leaves `undefined` in place rather than writing `''`. "We could not ask"
        // is not "there is no image", and writing the second would stop anything asking again
        // — and would then be pushed as a null the next time the season was renamed.
        if (error || !data) {
            if (error) console.warn('Pull for the season field image failed:', error.message);
            return;
        }

        const store = useAppStore.getState();
        store.setSeasons(
            store.seasons.map((s) =>
                s.id === seasonId ? { ...s, fieldImageData: data.field_image_data || '' } : s,
            ),
        );
    } catch (err) {
        console.warn('Error pulling the season field image:', err);
    }
}

/**
 * Load the signed-in user's guardian records: their children, and the consents they gave.
 *
 * Runs when the guardian view mounts, and after a drain that pushed either table — the same
 * shape as {@link fetchTeamData}, and through the same `pullFromServer`, so the rule that
 * makes a pull safe (a record with an unpushed local change keeps its LOCAL version) applies
 * here without being restated. That matters more than it looks: a guardian who adds a child in
 * a car park with no signal and then reaches a window would otherwise watch the child vanish,
 * which is B3 with a more upsetting subject.
 *
 * A FULL pull, always. There are one or two children, deletions must show up, and the guardian
 * is looking at the screen. Delta is what the background loop does for a team's hundreds of
 * tasks; there is nothing here to be incremental about.
 *
 * Returns nothing and never throws, like every other read in this module.
 */
export async function fetchGuardianData(guardianUserId: string): Promise<void> {
    if (!guardianUserId || !supabaseSync) return;

    await pullFromServer({
        // No team is involved, and that is not a degenerate case: a guardian holds a roster
        // row on their child's behalf without being a member of the team themselves.
        teamId: '',
        guardianUserId,
        tables: GUARDIAN_PULL_TABLES,
        mode: 'full',
    });

    /*
     * THE CHILD'S PLACE ON THE TEAM, WHICH IS NOT GUARDIAN-SCOPED DATA.
     *
     * Found in the browser: with only the two lines above, the guardian view rendered both
     * children as "Not on a team yet" while they were plainly on Iron Falcons. Profiles and
     * consents are keyed by `guardian_user_id`; the MEMBERSHIP is a `team_members` row keyed by
     * team, and a guardian has no current team for `fetchTeamData` to have been called with. So
     * the view was reading a collection nothing had ever filled.
     *
     * EVERY STATUS, deliberately. The team pull filters `status = 'approved'` because a roster
     * is approved members — but "waiting for the team admin to approve Sam" is one of the two
     * states this screen exists to show, and that filter would hide precisely it.
     *
     * Merged rather than replaced: a coach who is ALSO a parent has a real roster in this
     * collection, and replacing it with their own two children would empty their team's roster
     * screen. `mergeIntoStore` upserts by id and honours `getPendingRecordIds`, so this stays
     * inside the read path's rules rather than beside them.
     */
    const { data: rows, error } = await supabaseSync
        .from('team_members')
        .select('*')
        .eq('user_id', guardianUserId)
        .not('managed_profile_id', 'is', null);

    if (error) {
        console.warn('Pull for guardian memberships failed:', error.message);
        return;
    }
    if (!rows?.length) return;

    mergeIntoStore('team_members', rows, await getPendingRecordIds('team_members'));

    /*
     * ...and the teams those children are on, with their schedules.
     *
     * ONE call with `teamIds`, not one per team: a full pull replaces each collection, so a
     * loop would leave only the last team's meetings in the store — a guardian with children
     * on two teams would see one child's schedule vanish. See `PullOptions.teamIds`.
     */
    const teamIds = [...new Set(rows.map((r: { team_id: string }) => r.team_id))];
    await pullFromServer({
        teamId: '',
        teamIds,
        tables: ['meetings', 'meeting_attendance'],
        mode: 'full',
        /*
         * EVERY SEASON, EXPLICITLY.
         *
         * A guardian has no current season, and a coach who is ALSO a parent has one that
         * belongs to their own team and says nothing about their child's schedule on
         * another. Letting the default read `currentSeasonId` out of the store would filter
         * this pull by a season these teams may not even have — and an empty schedule for a
         * child with a full one is the shape this screen has already been found in once.
         */
        seasonId: null,
    });

    /*
     * ...and the teams themselves, which used to be `pullGuardianTeams` — a hand-written
     * select plus a merge-by-id, because a coach who is ALSO a parent must not have their own
     * team list replaced by their children's.
     *
     * The merge is gone rather than moved. `teams` is `scope: 'rls'` and its policy is
     * `is_team_member(id) OR is_team_guardian(id)`, so ONE unfiltered select already returns
     * that union — the case the merge existed to handle is the case the database was already
     * answering correctly. Deleting code was the whole point of registering this entity.
     */
    await pullFromServer({ teamId: '', tables: ['teams'], mode: 'full' });
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

        // `status` is a CASE expression, so the generated types widen it to `string | null`.
        // Narrowing to the union here rather than trusting it is the same reasoning as
        // `toMemberRole` in the registry: anything unrecognised falls back to the LESS
        // privileged answer, so a schema change cannot accidentally grant write access.
        useAppStore.getState().setEntitlement({
            teamId: data.team_id!,
            status: data.status === 'active' ? 'active' : 'read_only',
            seatsTotal: data.seats_total,
            seatsUnlimited: data.seats_unlimited ?? false,
            seatsUsed: Number(data.seats_used ?? 0),
            validUntil: data.valid_until,
            lapsedAt: data.lapsed_at,
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
    /**
     * What the pull covered. Omitted by realtime, which delivers one row at a time for the
     * open team and has nothing to reconcile. See {@link PullScope}.
     */
    scope?: PullScope,
): void {
    if (!records) return;

    const store = useAppStore.getState();

    const entity = findEntity(tableName);
    if (entity) {
        const incoming = records
            .map((r) => entity.fromRemote(r))
            .map((r: any) => carryDeferredFields(entity, r, store));

        /*
         * WHAT SURVIVES A REPLACE.
         *
         * Two different reasons, and they are not the same rule:
         *
         *   - a record with a pending queue entry, because the local copy is newer by
         *     definition -- it has not been sent yet (B3);
         *   - a record from a season this pull did not ask about, because the query could
         *     never have returned it, so its absence is not a deletion (SYNC-01/03).
         *
         * And one reason nothing survives: a record belonging to another team. It is not
         * this board's row whatever else is true of it, and it used to sit there until the
         * next full pull evicted it (SYNC-15).
         */
        const keep = entity.getFromStore(store).filter((e: any) =>
            withinPulledTeam(e, scope) &&
            (outsidePulledSeason(entity, e, scope, store) || pendingIds.has(e.id)),
        );

        const next = keep.length > 0
            ? [...incoming.filter((r: any) => !pendingIds.has(r.id)), ...keep]
            : incoming;

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
    /** What the pull covered. See {@link PullScope}. */
    scope?: PullScope,
): void {
    const entity = findEntity(tableName);
    // Checklists are always full-synced (blob), never delta, so they never reach here.
    if (!entity) return;
    if (!records) return;

    const store = useAppStore.getState();
    const existing = entity.getFromStore(store);

    /*
     * A MERGE STILL ENFORCES THE TENANT BOUNDARY (SYNC-15).
     *
     * `fetchTeamData` is a delta pull now, so a team SWITCH can arrive as a merge -- and a
     * merge that only ever adds would leave the previous team's rows on the board next to
     * the new team's. Filtering the survivors by tenant is what makes "delta on open" safe
     * to do at all. Rows that do not say which team they belong to are kept: unknown is not
     * a mismatch.
     */
    const byId = new Map(
        existing
            .filter((item: any) => withinPulledTeam(item, scope))
            .map((item: any) => [item.id, item]),
    );
    for (const row of records) {
        const item = carryDeferredFields(entity, entity.fromRemote(row), store);
        if (pendingIds.has(item.id)) continue;
        byId.set(item.id, item);
    }

    // A delta that brought nothing and evicted nothing must not write the store: every `set`
    // re-serialises the whole persisted blob and re-renders every subscriber, and the sync
    // loop's delta pull is the commonest call there is.
    if (records.length === 0 && byId.size === existing.length) return;

    entity.setInStore(store, Array.from(byId.values()));
}

/**
 * Put back the fields whose columns the pull did not select.
 *
 * `seasons.field_image_data` is the only one: it is up to ~670 KB of base64 and used to ride
 * along with every `seasons` read on every app open (SYNC-03). `fromRemote` reports an ABSENT
 * column as `undefined`, distinct from a present-and-null one, so this can tell "we did not
 * ask" from "there is no image" -- which is the difference between keeping the picture and
 * silently dropping it (`docs/failure-modes.md` section 4).
 *
 * A realtime row carries every column (REPLICA IDENTITY FULL), so an image replaced on
 * another device arrives and overwrites, exactly as it should.
 */
function carryDeferredFields(
    entity: EntityDefinition<any>,
    incoming: any,
    store: ReturnType<typeof useAppStore.getState>,
): any {
    if (!entity.deferredFields?.length) return incoming;
    const existing = entity.getFromStore(store).find((e: { id: string }) => e.id === incoming.id);
    if (!existing) return incoming;

    let next = incoming;
    for (const field of entity.deferredFields) {
        if (incoming[field] === undefined && existing[field] !== undefined) {
            if (next === incoming) next = { ...incoming };
            next[field] = existing[field];
        }
    }
    return next;
}
