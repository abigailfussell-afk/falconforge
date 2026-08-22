# SYNC — data layer, offline/PWA, scale

Audited 2026-08-22 against `main` @ c1cec81. Read in full: `src/lib/sync.ts`, `offline-db.ts`,
`entity-registry.ts`, `server-pull.ts`, `store.ts` (+ persist config), `realtime.ts`, `queries.ts`,
`QueryProvider.tsx`, `AppShell.tsx` (data-loading effects), `supabase.ts`, `auth.tsx` (session
restore), `sign-out.ts`, `pwa-update.ts`, `vite.config.ts`, `SyncStatusIndicator.tsx`,
`ParkedChangesDialog.tsx`, `OfflineBanner.tsx`, `e2e/offline-sync.spec.ts`, `playwright.config.ts`,
`docs/beta-ops.md` (backups). `npx vitest run src/lib`: 19 files / 318 tests green.

Empirical work (all against the local stack only; the 1,200 seeded rows were deleted afterwards
and `git status` is clean):
- `$S/pull-size.mjs` — authenticated REST pull of every table the app pulls, as `reviewer@`.
- `$S/dist-local/` — a production build pointed at the local stack (`vite build --outDir $S/...`),
  served with `vite preview` on :5197, driven by `$S/offline-coldboot.mjs` and `$S/online-flag.mjs`.
  Screenshots: `$S/shots/sync-board-online.png`, `sync-offline-coldboot.png`, `sync-offline-scouting.png`.

---

## Architecture as built (read/write paths)

**Local state.** One Zustand store (`store.ts`), persisted by `zustand/persist` as ONE JSON string in
IndexedDB `FalconForgeDB.appState['falconforge-storage']` (whole partialized state re-serialised on
every `set()`). The sync queue is `FalconForgeDB.syncQueue`; parked changes are `syncFailures`; delta
cursors + per-team pull counters are `appState['falconforge-sync-meta']`. Nothing calls
`navigator.storage.persist()`.

**Write path.** Slice action → optimistic store mutation → `queueForSync(table, id, op, fullRow)`
(`offline-db.ts:248`), which coalesces per record (create+update→create, update+update→latest,
create+delete→drop) and orders by a per-tab monotonically-nudged timestamp. `useSync()` (mounted once,
inside `SyncStatusIndicator` in the Sidebar) drains when `pendingChanges>0` or on a self-re-arming
timer (`RETRY_BACKOFF_MS` 3s→5min, `sync.ts:88`). `drainSyncQueue` → `processSyncItem`: create =
`upsert(onConflict:'id')`, update = `update(fullRow).eq('id')`, delete = `delete().eq('id')`, each with a
10 s per-query timeout inside a 30 s overall timeout (`timeout.ts`). Failure → retry count → at 5,
`moveToDeadLetter`; 42501 refusals explained by local state (lapsed licence / archived season) park
immediately with a reason (`sync-failure-classification.ts`). The drain uses `supabaseSync`, a second
client whose `accessToken()` reads the JWT straight from localStorage and **falls back to the anon key**
when it cannot get a fresh one (`supabase.ts:67-94`).

**Read path.** Exactly one: `pullFromServer()` (`server-pull.ts:133`). Per table: `select('*')`
filtered by `team_id` (or `guardian_user_id`, or nothing for `teams`), NO `.range()`/`.limit()`, NO
season filter, optional `gte('updated_at', cursor)` for delta. Full pull = replace the collection
(keeping ids present in the queue, B3); delta = upsert-merge. Callers: (1) `fetchTeamData` — full pull
of ALL 10 tables on every AppShell mount / team change (`AppShell.tsx:169`) + templates + entitlement;
(2) React Query hooks (`queries.ts`) — full pull of `tasks` / `scouting_reports` / `match_plans` on page
mount, window focus and reconnect once >30 s stale; (3) the sync loop after every drain, `mode:'auto'`:
delta, with a full reconciliation every 5th run per team; (4) `CheckIn`/`OpenCheckIns` full pulls.
Realtime (`realtime.ts`): one channel per tab (`team-<id>`), 8 tables × 3 events = 24
`postgres_changes` bindings filtered `team_id=eq.<id>`; events merge through the same
`mergeIntoStore`/`updateLocalDatabase` with the pending-id guard. Torn down on `offline`, re-created on
`online`.

**Conflicts.** Whole-row last-write-wins at push time; no version/`updated_at` check, no field merge. A
local pending record is shielded from pulls and realtime until pushed, then its full row overwrites.

**PWA.** `vite-plugin-pwa` generateSW, `registerType:'prompt'`, `clientsClaim:true`,
`skipWaiting:false`; registration from `main.tsx` via `pwa-update.ts`; precache is the glob
`**/*.{js,css,html,ico,png,svg,woff,woff2}` — currently **45 entries / 5.01 MB** in `dist/` (built
14:29 today). No runtime caching; all API traffic is network-only.

---

## Findings

### SYNC-01 — Pulls silently truncate at PostgREST's 1,000-row cap; a full pull then DELETES rows 1,001+ from the device
- **Severity:** High
- **Type:** scale-blocker / bug
- **Status vs plan:** NEW (no mention of `max_rows`, pagination or truncation in the plan or `docs/failure-modes.md`)
- **Evidence:** `server-pull.ts:246-250` builds `select('*').eq('team_id', …)` with no `.range()`; nothing in `src/lib` calls `.range(`/`.limit(` (grep). `supabase/config.toml:18` `max_rows = 1000` (the hosted default is the same). Measured with 1,200 tasks seeded into Iron Falcons (`$S/pull-size.mjs`):
  ```
  tasks                rows  1000 bytes   637894
  tasks exact count on server: 1200
  ```
  The built app then rendered the board with exactly 1,000 cards and the sidebar "Tasks Done 0/1000" (`$S/shots/sync-board-online.png`). No error, no warning — `result.error` is null, `received.tasks = 1000`.
- **Repro / how observed:** `insert into tasks … generate_series(1,1200)` for a team, sign in, open the board.
- **Impact:** Which 200 rows vanish is whatever order Postgres returns — unspecified, so the set changes between pulls and the user sees records flicker in and out. Worse than a display bug: `updateLocalDatabase` REPLACES the collection (`server-pull.ts:539`), so the 200 missing rows are removed from the persisted offline copy; and `newestUpdatedAt` advances the delta cursor past rows never received (`:287-291`), so delta pulls cannot recover them either. `meeting_attendance` has no `season_id` and is never season-filtered, so a 15-member team meeting 3×/week (≈90 meetings × 15 = 1,350 rows) crosses the cap **inside the first season** — attendance summaries go silently wrong for beta teams. Tasks cross it in season 2–3 because the pull fetches every season's tasks forever (principle 5 says prior seasons are read-only, but they are pulled in full on every app open).
- **Fix direction:** In `pullFromServer`, page with `.order('updated_at').order('id').range(from, to)` until a short page, or raise `max_rows` AND page (raising alone just moves the cliff). Independently, scope the team pull to the current season for season-scoped tables (`tasks`, `scouting_reports`, `match_plans`, `meetings`, `meeting_attendance` via join or by adding `season_id`) and load archived seasons on demand — that is also the egress fix (SYNC-03). Add a db test that seeds 1,001 rows and asserts the store holds 1,001 (would fail today).
- **Effort:** M

### SYNC-02 — A pull made with the anon-key fallback returns `[]` with no error and empties the device's local copy
- **Severity:** High
- **Type:** bug (data-integrity of the offline cache)
- **Status vs plan:** NEW
- **Evidence:** `supabase.ts:67-94` — `supabaseSync.accessToken()` returns `supabaseAnonKey` when the stored JWT is expired and `supabase.auth.getSession()` yields no session. `@supabase/auth-js` (2.89.0, `GoTrueClient.js:1226-1229`) returns `{session:null, error}` when the refresh call fails, including on a *retryable* network error. `anon` holds SELECT on every table (`information_schema.role_table_grants` on the local stack lists `anon|SELECT` for `tasks`), so the request succeeds: `curl …/rest/v1/tasks?team_id=eq.<iron falcons> -H "Authorization: Bearer <anon>"` → `200 []`. `pullFromServer` treats that as a successful full pull and calls `updateLocalDatabase(table, [], pendingIds)` → `setTasks([])` (`server-pull.ts:270-279, 539-560`). Zero rows is explicitly "meaningful — how a deletion is detected" (`:118`).
- **Repro / how observed:** Code path traced; not reproduced end-to-end (needs an expired access token + a refresh that fails + a REST call that succeeds — the captive-portal / "WiFi came back for two seconds" shape). B20 (`docs/failure-modes.md` §4, "absence read as a value") is this exact class, already paid for once with checklists.
- **Impact:** A device that has been open >1 h (JWT lifetime) at a venue with flapping WiFi can have every collection replaced by `[]` on the next `fetchTeamData`, 30 s focus refetch, or 5th sync. Server data is intact; un-pushed local records survive (B3); but everything else the team relied on reading offline is gone until a real pull succeeds — and the persisted copy is overwritten, so a reload does not bring it back.
- **Fix direction:** Never pull as anon: in `accessToken()` throw (or return `null` and have `pullFromServer` skip) when there is no usable user JWT; additionally assert in `pullFromServer` that the token's `role` claim is `authenticated` before replacing a collection. Add a test: pull with anon credentials must leave the store untouched.
- **Effort:** S

### SYNC-03 — Egress: every app open re-downloads the entire team history; this is the first free-tier limit a modest user base hits
- **Severity:** High (at ~20–40 active teams), Medium for beta
- **Type:** scale-blocker
- **Status vs plan:** NEW (plan §3 "Hosting" says traffic "will not come close to any limit" — not measured)
- **Evidence:** `fetchTeamData` (`server-pull.ts:312`) pulls all 10 tables with `mode:'full'` on every `AppShell` mount (`AppShell.tsx:169`), i.e. every cold open / reload / team switch. `queries.ts` re-pulls `tasks`, `scouting_reports`, `match_plans` in full on page mount, window focus and reconnect after 30 s (`QueryProvider.tsx:17-22`). No season filter anywhere. Measured wire JSON: ~640 B/task (200-char description), 440 B/attendance row, 670 B/meeting, 410 B/member; a season's `field_image_data` is inline base64 up to 500 KB (`SeasonManager.tsx:115`, →~670 KB text) and rides along with every `seasons` pull.
- **Estimate (stated assumptions):** mid-season team: 300 tasks (~200 KB), 60 meetings + 900 attendance (~440 KB), 60 scouting reports (~60 KB), roster/seasons (~15 KB) ≈ **0.7 MB per full pull uncompressed** (+0.67 MB if a field image is set). 15 devices × 6 opens/day × 30 days = 2,700 full pulls ≈ **1.9 GB/month per team** uncompressed, before the focus refetches. PostgREST gzips JSON ~5–8×, so ~250–400 MB/team/month on the wire. Supabase Free egress is 5 GB/month (the brief says 2 GB; Supabase's published figure as of my knowledge is 5 GB — verify in the dashboard). Either way: **roughly 10–20 active teams exhaust it**; by season 2 the prior season doubles every number. DB size (500 MB) is not the constraint — ~0.5–1 MB per team-season of heap+indexes measured on the local stack (`pg_total_relation_size`), so hundreds of teams fit.
- **Impact:** Free-tier egress overage on Supabase throttles/pauses the project — every team goes read-only-ish at once, mid-season.
- **Fix direction:** Same change as SYNC-01: season-scope the pull and fetch archived seasons lazily. Make `fetchTeamData` a delta pull when a cursor exists (full only when no cursor or explicitly requested); move `field_image_data` to Supabase Storage (or at least exclude it from the `seasons` select and fetch once per season). Drop the 30 s focus refetch when realtime is `connected` (it already delivers the same rows).
- **Effort:** M

### SYNC-04 — Realtime: one WebSocket per open tab, 24 bindings each; 200 concurrent peak is the second cliff
- **Severity:** Medium
- **Type:** scale-blocker
- **Status vs plan:** NEW
- **Evidence:** `realtime.ts:113-186` — `supabase.channel('team-<id>')` with `SYNCED_TABLES` (7 entities + checklists) × INSERT/UPDATE/DELETE = 24 `postgres_changes` bindings per client; one channel per tab (module state, but each tab is its own module instance). Every row change is fanned out to every subscriber on the team, and Supabase evaluates RLS per subscriber per change for `postgres_changes`.
- **Impact:** Free tier allows 200 concurrent peak connections. A team meeting = ~8–15 devices; ~15–25 teams meeting on the same weekday evening saturates it and later joiners get `CHANNEL_ERROR` — the app degrades to the 30 s focus refetch, which is fine functionally but is exactly what SYNC-03 cannot afford. The 2 M messages/month quota is not at risk for beta (a task edit = ~15 messages; 50 teams × 500 edits/month × 15 = 375 k) but grows with fan-out squared-ish.
- **Fix direction:** Cheap wins: subscribe only to tables the current route reads (or tasks+meetings+attendance only) and skip `seasons`/`sub_teams`; tear down the channel when the tab is hidden >N minutes (`visibilitychange`). The real answer at scale is Pro tier (500 connections) or a broadcast-based design; note that for the plan rather than build it now.
- **Effort:** S (trim) / L (redesign)

### SYNC-05 — Signing out destroys queued and parked changes with no warning
- **Severity:** High
- **Type:** bug (data loss)
- **Status vs plan:** NEW
- **Evidence:** `Sidebar.tsx:270-278` — the sign-out button calls `onSignOut` directly, no confirm. `sign-out.ts:67-72` → `clearLocalDatabase()` which `syncQueue.clear()` + `syncFailures.clear()` (`offline-db.ts:462-465`). No call site reads `getPendingSyncCount()` before sign-out (grep `src/components/Sidebar.tsx`, `src/lib/sign-out.ts`). The sign-out is deliberately "best-effort and time-boxed" and runs offline.
- **Repro / how observed:** Offline, create a task, click the sidebar sign-out icon. The task is gone from queue, failures and store.
- **Impact:** The shared-team-laptop case this project repeatedly designs for: a student scouts three matches offline, signs out so the next student can sign in, and the reports are gone. Principle 2 ("failed sync work is never silently dropped") is violated on the one path that is an explicit user action but does not say so.
- **Fix direction:** In the sign-out handler, read `getPendingSyncCount()` + `getSyncFailureCount()`; if >0 show a confirm naming the count ("3 changes haven't reached the server — sign out anyway?"); when online, offer "sync then sign out". Test: sign-out with a non-empty queue must not clear it without confirmation.
- **Effort:** S

### SYNC-06 — Whole-row last-write-wins: an offline edit to one field reverts a teammate's change to another
- **Severity:** Medium
- **Type:** bug / design gap
- **Status vs plan:** NEW (B3/B8 protect the *local* pending copy; nothing addresses the push)
- **Evidence:** `sync.ts:392-399` — `update` sends `entity.toRemote(fullLocalRow)` via `.update(...).eq('id')`; `toRemote` emits every column (`entity-registry.ts:151-168`). `mergeIntoStore`/realtime skip incoming rows for pending ids (`server-pull.ts:589`, `realtime.ts:147`), so the local copy never learns the server's newer fields before it overwrites them. No `updated_at` precondition on the update.
- **Repro / how observed:** Device A offline edits task title; device B (online) moves the same task to "Done". A reconnects: status reverts to A's stale value. Traced in code; not run.
- **Impact:** Kanban at a competition is precisely two people touching the same card. Silent and invisible — the loser never knows.
- **Fix direction:** Minimal: queue a diff (changed keys only) for `update` ops and send a partial `update` — `queueForSync` already coalesces, so merge diffs on coalesce. Better: add `.eq('updated_at', seenUpdatedAt)` and treat 0 rows affected as a conflict to re-pull and re-apply. Needs a regression test with two clients against the db stack.
- **Effort:** M

### SYNC-07 — Status says "Synced" (green tick, no banner) when the network is up but the server is unreachable
- **Severity:** Medium
- **Type:** ux / bug
- **Status vs plan:** NEW
- **Evidence:** `$S/shots/sync-offline-coldboot.png`: the built app, cold-booted with the network cut, shows "Synced" while 37 requests failed (`$S/offline-coldboot.mjs` output: every REST call `ERR_INTERNET_DISCONNECTED`, realtime WebSocket failed). `$S/online-flag.mjs`: after the offline reload `navigator.onLine === true` (a Chromium emulation quirk on reload — but it is exactly the captive-portal/"connected, no internet" state on real venue WiFi). `SyncStatusIndicator.tsx:47-59` derives the label from `navigator.onLine` + `syncStatus`; `pullFromServer` swallows every failure as `console.warn` (`server-pull.ts:263, 297`), `sync()` only runs when the queue is non-empty, and `fetchTeamData` failures are `console.error`ed (`AppShell.tsx:169`). `OfflineBanner` keys off the same `navigator.onLine`.
- **Impact:** A coach reading "Synced" assumes the board reflects other devices. The `lastSyncTime` exists (`sync.ts:120`) but is not shown.
- **Fix direction:** Track "last successful server contact" (any pull/push success) in `useSync`; show "Synced · 2 min ago" / "Can't reach server" when the last attempt failed even though `onLine` is true; make `pullFromServer` return per-table errors so `fetchTeamData` can surface one. Assert in the e2e pack that the indicator is not "Synced" after an offline reload.
- **Effort:** S

### SYNC-08 — No storage persistence request; IndexedDB (queue + offline copy) is evictable
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** grep `navigator.storage` / `storage.persist` in `src` → nothing. Everything (queue, dead letters, the whole offline dataset) is in `FalconForgeDB` under best-effort storage.
- **Impact:** Chrome/Android evicts best-effort origins under storage pressure (students' phones are full); Safari deletes all script-writable storage for a site not used in 7 days unless it is installed to the home screen (that also covers Safari tab use of the site). A parked change that sits for a week over a school holiday can be evicted, and nothing will ever report it (see SYNC-10). Not verified on a device.
- **Fix direction:** Call `navigator.storage.persist()` after sign-in (and show the `estimate()` in the dead-letter dialog). Document "install to home screen on iOS" in Getting Started as the mitigation for the 7-day rule; consider surfacing "N changes waiting for X days" in the indicator.
- **Effort:** S

### SYNC-09 — Two tabs drain the same queue independently; per-tab timestamp allocator
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** NEW
- **Evidence:** `useSync` state (`syncingRef`, `failedDrainsRef`) and `lastIssuedTimestamp` (`offline-db.ts:203`) are per-module-instance; no `navigator.locks` or BroadcastChannel. Zustand `persist` has no cross-tab sync, so each tab overwrites `appState` with its own copy.
- **Impact:** Double pushes (idempotent upserts/updates, so correct but 2× egress and 2× realtime connections), double retry-count increments (a flaky item dead-letters after ~3 real failures instead of 5), and possible timestamp ties across tabs (B1's ordering is only guaranteed within a tab). A record created in tab B is absent from tab A's persisted state; after reload it returns via the push+pull, so no loss.
- **Fix direction:** Wrap `drainSyncQueue` in `navigator.locks.request('falconforge-sync', …)` (falls back to no lock where unsupported); optional `storage`-event/BroadcastChannel nudge so the other tab re-reads counts.
- **Effort:** S

### SYNC-10 — Zero server-side observability: a beta device stuck in dead-letter is invisible to Kevin
- **Severity:** Medium (High the week of the first competition)
- **Type:** unfinished
- **Status vs plan:** KNOWN (plan §8 / Sprint 7: "error logging story (even just structured console + Supabase log review cadence)") — assessed here as a gap for running at scale
- **Evidence:** `error-reporting.ts` is `console.error` only, by explicit decision (no insertable table; default-deny). Dead letters live only in `syncFailures` on the device (`offline-db.ts`); `feedback.ts` is a `mailto:`. The only server signal of a refused write is a PostgREST 42501 in Supabase's API logs, retained 1 day on Free.
- **Impact:** "My scouting never uploaded" arrives as an email, days later, with no device state. With 5 teams that is survivable; with 50 it is not, and the 1-day log retention means the evidence is gone by the time the email arrives.
- **Fix direction:** A narrow, RLS-safe table: `client_events(user_id default auth.uid(), team_id, kind, payload jsonb, created_at)` with INSERT-only for `authenticated` where `user_id = auth.uid()` and `is_team_member(team_id)`, SELECT for operators. Write one row when an item is dead-lettered (table, op, error code, reason, app build) and a daily heartbeat with pending/failed counts. Show it in the operator console. Rate-limit by a CHECK on payload size + a per-user count trigger if abuse is a concern.
- **Effort:** M

### SYNC-11 — Backups: manual `db dump` only; realistic restore after a bad migration is "lose everything since the last dump"
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** KNOWN (plan Sprint 7 "backup: scheduled pg_dump … documented"; `docs/beta-ops.md` §Backups) — the *scheduled* half never landed
- **Evidence:** `docs/beta-ops.md:8-40` documents the one-liner and "weekly during the season" as a human habit; no cron/GitHub Action in `.github/workflows` runs it (grep `db dump` → only the doc). Free tier: no PITR, daily backups are Pro-only. Restore is `psql -f` of a full dump — there is no partial/one-team restore and the doc itself flags two traps (squashed migrations via `db push`, `platform_operators` shipping empty).
- **Impact:** A forward migration that corrupts rows post-beta (Sept onward, frozen schema) loses up to a week of every team's work; a Sunday competition's scouting is the likeliest casualty. Dumps also contain every minor's name — storage of the dump itself is a privacy question the doc acknowledges but does not solve.
- **Fix direction:** A GitHub Actions schedule (nightly during the season) running `supabase db dump` with the DB URL from a secret, encrypting the artefact (age/gpg) and pushing to a private bucket or encrypted artefact with 30-day retention; plus a "restore one team" SQL snippet in the runbook (dump is plain SQL, so `COPY` per-team is feasible with the FK order). Migrations: run against a restored dump in CI before `db push` (the CI schema job proves migrations build an EMPTY DB, not that they survive real rows).
- **Effort:** S (schedule) / M (rehearsed restore)

### SYNC-12 — Precache is still 5.01 MB, 3.06 MB of it one PNG four times
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** KNOWN (plan §8: "The precache is 60% one image") — confirmed unchanged in today's build
- **Evidence:** `dist/sw.js` (built 14:29 today, after the last commit): 45 entries, 42 unique URLs, 5,257,605 bytes; `logo.png`, `falcon_logo.png`, `icon-192.png`, `icon-512.png` all revision `f74e417a…`, 802,825 bytes each; `hero_bg.png` 595,652. `icon-192.png`, `icon-512.png`, `DecodeField.png` appear twice in the manifest (`includeAssets` + glob) — harmless.
- **Impact:** First venue load and every update pays 5 MB before the app is usable offline; the update prompt (`skipWaiting:false`) means the 5 MB is downloaded in the background, so it is bandwidth not latency — but on venue WiFi bandwidth is the latency.
- **Fix direction:** As recorded in the plan: one 512 and one 192 icon, drop the aliases, compress `hero_bg`, exclude `DecodeField.png` from the glob if it is only a fallback. Target <1.5 MB.
- **Effort:** S

### SYNC-13 — Large queue after a day offline: the 30 s overall timeout cancels the drain mid-way and reports "Sync failed"
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `sync.ts:231-250` — drain + pull wrapped in `OVERALL_SYNC_TIMEOUT_MS = 30_000` (`timeout.ts:32`); items are pushed sequentially, each a round trip. On cancel, `token.cancelled` stops the loop (progress made so far is kept — items already pushed are deleted) and status becomes `'error'`.
- **Impact:** At ~500 ms/request on venue WiFi, ~60 items fit; a device with more shows "Sync failed" repeatedly while actually making progress, until the queue fits in one window. A day of scouting by one student is 20–40 rows, so beta will mostly not see it; a coach's bulk sprint edit might.
- **Fix direction:** Make the overall timeout per-item-progress-based (reset while items keep succeeding) or skip the `'error'` state when `drain.pushed > 0`; batch same-table creates into one `upsert([...])`.
- **Effort:** S

### SYNC-14 — Season rollover / archive / licence lapse / removal while offline
- **Severity:** Low (already parked work, explained in two of four cases)
- **Type:** ux
- **Status vs plan:** KNOWN (plan §8: "A device offline during a rollover can still queue writes to the now-archived season" and "A coach who is offline while a student checks in ONLINE will dead-letter their override"); new detail below
- **Evidence:** `sync-failure-classification.ts:118-166` — 42501 is terminal-with-reason only when local state explains it (entitlement `read_only`, or `seasonId` in `archivedSeasonIds`). A **removed member** (`status='removed'`) gets a 42501 that local state cannot explain → retried 5× over ~9 min → parked with the raw "new row violates row-level security policy" (`ParkedChangesDialog.tsx:138-142` shows `lastError` when no reason). Entitlement is only refreshed on `fetchTeamData` (`server-pull.ts:330`), so a device open across a lapse learns of it on the next reload — fine, the server enforces.
- **Fix direction:** On a 42501 that is not explained, do one `pullEntitlement` + `team_members` self-check before the next retry and classify from the refreshed state ("you are no longer a member of this team"). Small addition to the classifier with a db test.
- **Effort:** S

### SYNC-15 — Cross-team leakage of a pending record after a team switch
- **Severity:** Low
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `updateLocalDatabase` preserves `pendingIds` from whatever is in the store (`server-pull.ts:548-552`); local records carry no `teamId` (`fromRemote` drops `team_id`, `entity-registry.ts:170-185`). Switching teams while a task is queued keeps it in the new team's `tasks` collection until it is pushed and the next full pull evicts it.
- **Impact:** A coach on two teams briefly sees Team A's queued task on Team B's board. Cosmetic, short-lived, but it is a tenant boundary in the UI.
- **Fix direction:** Keep `teamId` on local records (it is already in the queue payload) and filter `preserved` by the pulled team.
- **Effort:** S

### SYNC-16 — The smoke pack does not prove an offline COLD boot; it does work (verified here)
- **Severity:** Low
- **Type:** debt (test truth)
- **Status vs plan:** KNOWN-adjacent (plan §8 records the "switched off mid-boot" scenario as real and untested)
- **Evidence:** `e2e/offline-sync.spec.ts`: test 1 goes offline, creates a task, goes back ONLINE and only then reloads (`:63-72`); test 2 navigates between hash routes offline without a reload (`:85-97`) — that exercises precached lazy chunks through a controlling SW, but never `index.html`, session restore, or store hydration with the network down. Verified manually with the production build on the local stack (`$S/offline-coldboot.mjs`): reload with the network cut → `app-nav` rendered, 1,000 cards from IndexedDB, lazy `scouting` route rendered (`$S/shots/sync-offline-coldboot.png`, `sync-offline-scouting.png`). Session restore hit the 5 s auth timeout path (`auth.tsx:183`) and proceeded. Only artefact: the status label (SYNC-07).
- **Fix direction:** Add a third spec: load online → `setOffline(true)` → `page.reload()` → assert nav + cached data + an honest status label. One test, ~20 lines, using the existing helpers.
- **Effort:** S

---

## Summary

1. **The read path has no pagination** (`select('*')` + 1,000-row cap) and no season scoping; a full pull that truncates *deletes* the overflow from the device and advances the cursor past it. `meeting_attendance` crosses the cap in one season for a normal team. (SYNC-01, High.)
2. **Egress, not DB size, is the first free-tier wall**: ~0.7 MB per app open per device, ~1–2 GB/team/month uncompressed at season pace; ~10–20 active teams exhaust the quota. Season-scoping and delta-on-mount fix both 1 and 2. (SYNC-03.)
3. **A pull with the anon-key fallback succeeds with `[]` and wipes the offline copy** — the B20 class again, on every table. One-line guard. (SYNC-02, High.)
4. **Sign-out clears the queue and dead letters with no warning** — the shared-laptop data-loss case. (SYNC-05, High.)
5. Realtime is one socket per tab with 24 bindings; 200 concurrent connections ≈ 15–25 teams meeting simultaneously. Degrades gracefully but onto the expensive pull path. (SYNC-04.)
6. Conflicts are whole-row LWW; a stale offline edit reverts a teammate's field. (SYNC-06.)
7. "Synced" is shown whenever `navigator.onLine` is true, including when every request fails. (SYNC-07.)
8. Nothing on the server knows a device is stuck; logs live 1 day; backups are a manual weekly habit with no schedule and no rehearsed restore. (SYNC-10, SYNC-11.)
9. Offline cold boot of the built app with a stored session genuinely works (verified), queue survives reload (existing e2e + B-tests), precache is still 5.01 MB (known).
10. Sync regression suite (`src/lib`, 318 tests) is green; its coverage is real for ordering/retry/dead-letter/cursors and absent for pagination, auth-fallback, multi-tab and conflicts.

## Confidence / not checked

- Free-tier numbers: I used the brief's limits; Supabase's published Free egress is 5 GB (not 2 GB) to my knowledge and realtime messages/heartbeat accounting was not verified — check the dashboard usage page. Egress estimates assume gzip on PostgREST responses (standard) and stated per-row sizes measured locally.
- SYNC-02 traced in code and confirmed at each link (auth-js source, grants, `curl` as anon, `updateLocalDatabase`), but not reproduced as one end-to-end run.
- SYNC-06 and SYNC-15 are code-traced, not executed with two browsers.
- iOS Safari 7-day eviction, home-screen behaviour and real-device storage pressure: not tested on a device (no iOS here); stated from platform behaviour.
- Realtime `postgres_changes` per-subscriber RLS cost and the exact point `CHANNEL_ERROR` appears under load: not load-tested.
- Supabase realtime payload-size behaviour for a `seasons` UPDATE carrying a ~670 KB base64 image: not checked (may exceed the per-message limit and be dropped or error).
- `db:verify`/`test:db`/`test:rls` were not run (per brief); only `npx vitest run src/lib`.
- The e2e pack itself was not executed (it rebuilds `dist/`); I built to `$S/dist-local` instead and drove it with a Playwright script.
