# FalconForge — Refactor & Bug-Fix Gauntlet

> **Prepared:** 2026-08-14 · Focus: **code cleanup + bug fixing**. Production/infra work is deferred to `production-gauntlet-plan.md`.
> **Reviewed at commit:** `566bc1d` · **Status:** plan only, no code changed.

---

## The headline

I read the data layer line by line and found **16 concrete bugs**. Fifteen of them are in four files totalling ~1,000 lines:

```
src/lib/sync.ts          576 lines   ← 9 bugs
src/lib/realtime.ts      195 lines   ← 3 bugs
src/lib/transformers.ts   82 lines   ← 3 bugs
src/lib/offline-db.ts    132 lines   ← 1 bug
```

**Zero bugs found in the large UI components.** `Landing.tsx`, `SprintPlanning.tsx`, and the rest are oversized and hard to read, but they are not where things are broken.

**This inverts the round order from the earlier plan.** Component decomposition was Round 5, sync correctness was Round 6. For a bug-fixing focus that's backwards. The data layer goes first — it's 6% of your code and ~94% of the defects.

Four of these are silent-data-loss bugs. If your users have ever said "my task disappeared" or "my edit reverted," B1, B2, B3, and B8 below are almost certainly why.

---

## Round A progress — 2026-08-14, branch `refactor/data-layer`

**Done**

- **A3 · flaky test fixed.** `Dashboard.test.tsx` did a cold `await import('../../App')` inside `beforeEach`; under 22 parallel workers that blew the 10s hook timeout. All `vi.mock` calls are hoisted and there is no `vi.resetModules()`, so the dynamic import was redundant — made it a static import. Suite: **23 files / 229 passing / 0 failures** (was 222 + 1 failure), and **34.4s → 9.2s**. Green on three consecutive runs.
- **A3 · mock-drift guard.** `src/test/__tests__/mock-drift.test.ts` fails when a global mock declares an export the real module lacks. Removed the phantom `useSyncStatus` / `SyncProvider`; `@/lib/sync` now spreads `importActual`. Verified the guard fails on an injected phantom before trusting it.
- **A1 · local stack running.** `supabase init` + `supabase start`. API on `:54321`, Postgres on `:54322`.
- **A1 · schema is in git and rebuildable.** `supabase db reset` reconstructs everything from `supabase/migrations/` alone — 12 tables, RLS on all 12, 43 policies, 9 functions, 4 triggers. This was impossible before: history began at `009` and `001`–`008` were never committed.
- **A1 · schema assertions.** `supabase/tests/schema_assertions.sql` — every expected table exists, RLS enabled everywhere, no RLS-enabled table without policies, every delta-synced table has `updated_at`. Run with `npm run db:assert`.
- **A4 · CI.** `.github/workflows/ci.yml` — typecheck → unit → integration → build, plus a `schema` job that runs `db reset` and the assertions.
- **B1 proof.** `src/lib/__tests__/sync-queue-order.integration.test.ts` demonstrates the random drain order against real Dexie + IndexedDB: `toArray()` returns `['delete','update','create']` for operations performed in the opposite order. Marked `it.fails`, so it goes **red the moment B1 is fixed** and forces the fixer to flip it.

**Two findings that came out of the rebuild — both about the backups**

1. **The backup script produces SQL that has never been runnable.** `07_restore.sql` emits `PRIMARY KEY (id, id)` for `public.users` (Postgres 42701) and orders tables alphabetically with inline FK constraints, so `checklists` references `seasons` before it exists. Any attempt to restore from these backups would have failed at the first statement.
2. **The backup silently omits a table.** `sub_team_members` exists in production — `013` creates it and the security audit alters it — but it is absent from the backup. Restoring would have produced a database quietly missing a table and its four policies. Captured in `00000000000001_backup_gap_sub_team_members.sql`.

Together: **the backups you have are not restorable.** Worth knowing before the free tier's lack of PITR ever gets tested.

**Verified against the hosted project — 2026-08-14**

The baseline was inferred from a 5-month-old backup, so it was checked against the live project before being trusted. No service-role key or DB password was available, but PostgREST resolves the `select=` column list *before* RLS filters rows, which makes it a read-only existence probe: unknown table → `PGRST205`, unknown column → `42703`, valid column → `200 []`.

Result: **11 tables, 92 columns — local now matches production exactly at the table/column level**, with no production-only columns found among a candidate sweep (soft-delete, audit, billing and app-type-implied names).

Two things this settled:

1. **`015` *was* applied to production.** `seasons`, `sub_teams`, and `scouting_reports` all have `updated_at` upstream. The backup simply predated the migration by a few hours. Delta sync for those tables is working — the earlier worry is closed.
2. **`sub_team_members` does not exist in production.** `PGRST205 — Could not find the table 'public.sub_team_members' in the schema cache`. `013_create_missing_entities.sql` creates it, so **013 was never applied in full**. The gap migration written earlier that day has been deleted; it invented a table production does not have.

**CONFIRMED by `supabase db diff --linked` — the security audit never applied to production**

With the CLI authenticated and linked, the full diff (policies, functions, constraints, types) came back. `db diff --linked` emits the SQL that would make **local** match **production**, so every `drop constraint` in its output means production does not have that constraint.

**Production is missing every constraint from `20260317000000_database_security_audit.sql`:**

| Missing upstream | Objects |
|---|---|
| `CHECK` constraints | `teams_name_check`, `seasons_name_check`, `sub_teams_name_check`, `tasks_title_check`, `checklists_name_check`, `invites_code_check`, `invites_use_count_check`, `match_plans_match_number_check`, `scouting_reports_match_number_check` |
| Composite `UNIQUE (id, team_id)` + indexes | `team_members`, `seasons`, `sub_teams` |
| **Composite tenant-isolation foreign keys** | `tasks_sub_team_team_fkey`, `tasks_assigned_to_team_fkey`, `scouting_reports_created_by_team_fkey` |

The last row is the one that matters. Those foreign keys are what stop a task from referencing another team's sub-team or member. **They are not in production.** The migration failed on its `ALTER TABLE sub_team_members` statement — the table was never created upstream because `013` never fully applied — and rolled back, taking everything else with it. The `sub_team_members` block has since been removed from the migration file with a comment recording why.

**One correction in the other direction:** the diff also showed the baseline carrying `invites_select_all` (the `USING (true)` policy that exposes every team's invite codes) while production correctly has `invites_select_team_members`. `014_fix_invites_rls.sql` *did* apply upstream; the backup predated it. `014` has been restored to the migration chain.

**Current state: local matches production exactly, except for the security-audit constraints** — which is now a deliberate, documented difference rather than an unknown.

**Preflight RUN against real production data — 2026-08-14**

Rather than querying production directly, the whole database was pulled down with the CLI and restored locally:

```
supabase db dump --linked --schema public -f schema.sql   # 1,143 lines
supabase db dump --linked --data-only     -f data.sql     # 344 KB
```

Both loaded into a scratch `prod_audit` database **with zero errors** — which incidentally proves these two commands produce the restorable backup that `backup-full.mjs` never did. Production is small: 4 teams, 7 members, 11 tasks, 9 scouting reports, 7 match plans, 5 seasons, 3 sub-teams, 11 invites, 6 users.

Preflight result — **15 of 16 checks clean**:

- ✅ **No cross-tenant violations.** Checks 6–8 all zero: no task references another team's sub-team or member, no scouting report was created by another team's member, nothing dangling. The missing foreign keys have not let anything through. This was the outcome that mattered.
- ✅ No blank names, no negative use counts, no duplicate composite keys.
- ❌ **5 scouting reports with `match_number = 0`** — see **B18**. This is the sole blocker.

**So applying the security audit needs one decision first (B18), not a data cleanup of any breadth.** Once that is settled, the sequence is: fresh `db dump` → apply to staging → apply to production. Belongs in **Round C**, alongside B7's `REPLICA IDENTITY FULL`, so production takes one schema change instead of two.

The local `prod_audit` database and the dump files hold real user emails and names. They live in the session scratchpad, outside the repo, and should be deleted once Round C is done.

**Still to do in Round A**

- **A2** — repoint the integration suite at local Postgres and delete the hand-written Supabase query-builder mock (the one whose `.gt()`/`.gte()` mismatch proved the delta path was never exercised).
- **A2** — the `test:rls` cross-tenant suite: two users, two teams, assert isolation per table.
- **A3** — characterization tests pinning current transformer/merge behaviour before Round B changes it.

---

## Part 0 — Can the current test loop catch these bugs? **No. Not one of them.**

This was checked, not assumed.

### `sync.ts` is at 10% coverage — and the bugs live in the other 90%

```
src/lib/sync.ts    10.29% stmts | 18.62% branch | 9.47% lines
                   uncovered: 175-467, 490-573
```

`sync.test.ts` tests four pure functions — `withTimeout`, `transformToSupabaseSchema`, `updateLocalDatabase`, and the localStorage timestamp helpers. It never touches `useSync`, `processSyncItem`, `pullChangesFromServer`, or `mergeIntoStore`. **The entire orchestration layer — every line where B1–B8, B12, and B15 live — has zero test coverage.**

`mergeIntoStore`, which Realtime calls on every inbound event, is at 0%.

### The global setup mocks out every module that contains a bug

[src/test/setup.ts](src/test/setup.ts) applies `vi.mock` to **`@/lib/supabase`, `@/lib/offline-db`, `@/lib/realtime`, `@/lib/sync`, and `@/lib/queries`** for the whole unit suite. `db.syncQueue.toArray()` is hardcoded to return `[]`. `queueForSync` is a no-op.

So B1 — the random queue ordering — is *unfalsifiable* by construction: the suite that would catch it has replaced the queue with an empty array. The 222 passing tests are not passing despite these bugs. They are passing because the buggy code never runs.

### The mocks have silently drifted from the real modules

Two proofs, both verified:

1. The unit mock declares `@/lib/sync` exports **`useSyncStatus`** and **`SyncProvider`**. Neither exists in the real `sync.ts` (real exports: `withTimeout`, `useSync`, `transformToSupabaseSchema`, `updateLocalDatabase`, `mergeIntoStore`), and nothing in the app imports them. The mock describes an API that has never existed.
2. The *integration* mock ([setup-integration.ts](src/test/setup-integration.ts)) provides `.gt()`. `sync.ts:440` calls **`.gte()`**. Any integration test reaching the delta-pull path throws `gte is not a function` — which is proof the delta-sync path has never once been exercised, in either suite.

Hand-written mocks that nothing validates will always drift. These already have.

### 100% coverage on a file with three bugs

`transformers.ts` reports **100% statement coverage** — and contains B9, B10, and B11.

That's the most important number in this report. Coverage measures *execution*, not *correctness*. Raising coverage is the wrong goal; asserting the right **properties** is the goal. One round-trip property test (`fromRemote(toRemote(x)) === x`) catches all three today and every future one for free. A hundred more line-coverage tests would catch none of them.

### What else is dark

| File | Coverage | Note |
|---|---|---|
| `Onboarding.tsx` | **0%** | 436 lines, auth-critical, entirely untested |
| `EditProfile.tsx` | 3.7% | |
| `MemberManager.tsx` | 13.8% | team management |
| `InviteManager.tsx` | 20.8% | the subsystem that already had an RLS hole |
| `auth.tsx` | 47.5% | |
| `store.ts` | 91.9% | genuinely good |

No E2E exists. `.agent/skills/e2e-testing/` and `.agent/workflows/e2e-testing.md` describe a Playwright setup that is **not installed** — `package.json` has zero Playwright dependencies. Those docs are aspirational and should be marked as such or deleted; right now they read as if coverage exists that doesn't.

### The Supabase side — better news than expected

You said schema changes have had little automation. Confirmed: no `supabase/config.toml`, no CLI link, migrations start at `009` (001–008 exist only in the cloud), mixed naming. The authoritative schema lives in the cloud and cannot be rebuilt from this repo.

**But the tooling to fix that is already on this machine:**

```
Supabase CLI   2.77.0   ✅ (v2.114.0 available)
Docker         29.2.1   ✅
pg (node)      8.20.0   ✅ devDependency
psql           ❌ not on PATH — the local stack's container provides it
```

Docker plus the CLI means **`supabase start` gives you a complete local stack** — Postgres, Auth, Realtime, Studio — on your machine. That single capability changes what's testable:

- Migrations get verified locally before they ever touch a hosted project.
- RLS policies become testable for real, instead of by inspection.
- **B7 becomes testable at all.** `REPLICA IDENTITY FULL` and logical-replication delete payloads cannot be verified against a hand-written mock — you need a real Postgres.
- Integration tests can run against real Postgres, which kills the mock-drift problem at the root.
- Schema changes stop being irreversible experiments on production.

This is the highest-leverage thing available to you, it's already installed, and it costs nothing.

### Verdict

**Yes — resolve this first.** Not because the tooling is imperfect, but because the current loop would report green through every bug in Part 1. Refactoring a data layer under a suite that mocks away the data layer means the gauntlet gate is decorative.

Round A below is rewritten to close this. It grew from ~1–2 days to ~3–4, and it is the best-spent time in the plan.

---

## Part 1 — The bugs

### 🔴 Silent data loss

**B1. The sync queue is processed in random order.** [sync.ts:130](src/lib/sync.ts:130)
```js
const queueItems = await db.syncQueue.toArray();
```
Dexie returns rows in **primary-key order**. The primary key is `generateId()` → `crypto.randomUUID()`. So queued operations are applied in *random* order, not the order the user performed them.

Consequences: a `delete` can be processed before its `create` (the record resurrects); an `update` can be processed before its `create` (targets a nonexistent row, fails, retries 5×, then gets discarded by B2). The `timestamp` field is even indexed in the schema ([offline-db.ts:64](src/lib/offline-db.ts:64)) — it's just never used for ordering.

*Fix:* `db.syncQueue.orderBy('timestamp').toArray()`. One line. This is likely the single highest-value fix in the codebase.

**B2. Failed items are silently deleted after 5 retries.** [sync.ts:142-144](src/lib/sync.ts:142)
```js
if (newRetryCount >= 5) {
    console.error(`Sync item ${item.id} failed after 5 retries. Removing from queue.`, err);
    await db.syncQueue.delete(item.id);
}
```
The user's change is **thrown away**, and the only trace is a `console.error` nobody reads. A scouting report entered at a competition can vanish with no UI signal at all. The comment says "to prevent stuck state" — the intent is right, the remedy destroys data.

*Fix:* move to a dead-letter table, surface a persistent "N changes failed to sync" banner with a retry action.

**B3. A full pull wipes local records that haven't synced yet.** [sync.ts:460](src/lib/sync.ts:460)
`updateLocalDatabase` **replaces** the entire array (`store.setTasks(...)`). Only checklists check the pending queue first ([sync.ts:419-427](src/lib/sync.ts:419)) — tasks, scouting reports, match plans, seasons, and sub-teams have no such guard.

Sequence: create a task offline → sync runs → the push fails or times out → the item stays queued → `pullChangesFromServer` does its every-5th full pull → the store is replaced with server data → **the task disappears from the UI** while still sitting in the sync queue.

*Fix:* extend the pending-queue guard to every entity, or reconcile rather than replace.

**B8. Realtime overwrites edits you're still typing.** [realtime.ts:126,145](src/lib/realtime.ts:126)
Incoming `INSERT`/`UPDATE` events merge into the store by `id` with no check for a pending local change on that record. Another client's update lands on top of the user's unsynced edit. Then the queued local edit later pushes and overwrites theirs. Symptom: "my changes reverted while I was working."

*Fix:* skip the merge when the record has a pending queue entry; reconcile on drain.

---

### 🟠 Sync correctness

**B4. The delta cursor uses the client clock against server timestamps.** [sync.ts:464](src/lib/sync.ts:464) vs [sync.ts:440](src/lib/sync.ts:440)
`setSyncTimestamp(entityKey, Date.now())` records the **client's** clock, then the next pull filters `gte('updated_at', lastSyncISO)` against a column written by a **server-side** trigger. Any client running ahead of the server permanently skips every record in the skew window, recovering only on the 5th-cycle full pull. School Chromebooks and tablets with bad time sync make this routine.

There's a second, unconditional leak: the timestamp is stamped *after* the query returns, so anything written between query execution and `Date.now()` is missed on every single pull.

*Fix:* use `max(updated_at)` from the returned rows as the next cursor. Never the local clock.

**B5. Stale delta cursors survive sign-out.** [sync.ts:348,372](src/lib/sync.ts:348) vs [App.tsx:91-99](src/App.tsx:91)
`falconforge-sync-timestamps` and `falconforge-sync-counter` live in **localStorage**. Sign-out clears IndexedDB (`clearLocalDatabase` + `clearAppState`) and nothing else. The next user on that device inherits the previous user's cursors and silently receives an incomplete dataset. Shared team laptops make this a when, not an if.

*Fix:* clear both keys on sign-out. Better: move them into the `appState` IndexedDB table so there's one cleanup path instead of two.

**B6. The overall timeout doesn't actually stop the sync.** [sync.ts:127-159](src/lib/sync.ts:127)
`withTimeout` rejects at 30s, but the inner async IIFE **keeps running** — still deleting queue rows and mutating the store. `syncingRef.current = false` runs in `finally`, so a second sync can start and run *concurrently with the orphaned first one*. Two loops racing over the same queue, double-processing items and racing `delete(item.id)`.

*Fix:* thread an `AbortController` through, and check a cancellation flag at each loop iteration.

**B7. Realtime DELETE events never arrive.** [realtime.ts:151-164](src/lib/realtime.ts:151)
The DELETE subscription filters on `team_id=eq.${teamId}`. Postgres logical replication only sends the **replica identity** columns in the old-record payload — under the default replica identity that's the primary key alone, so `team_id` is absent and the filter can never match. Deletions made on another device don't propagate until the 5th-cycle full pull.

*Fix:* `ALTER TABLE … REPLICA IDENTITY FULL` on the synced tables, or drop the filter for DELETE and verify team membership client-side. Worth a test that asserts a delete actually propagates.

**B12. The checklist blob picks an arbitrary row.** [sync.ts:503](src/lib/sync.ts:503) / [sync.ts:430](src/lib/sync.ts:430)
`records[0]` is taken from a query with no `ORDER BY`. Postgres row order is unspecified. With more than one checklist row per team — templates (`is_template`) or season-scoped rows — the active checklist can flip between syncs. Note `transformToSupabaseSchema` writes `id: data.teamId || data.id` ([sync.ts:313](src/lib/sync.ts:313)), so the row ID *is* the team ID, meaning any extra row is unreachable-but-interfering.

**B15. The full-pull counter is global, not per-team.** [sync.ts:372](src/lib/sync.ts:372)
Switching teams shifts which entity happens to land on the 5th-cycle reconciliation. Reconciliation coverage becomes a function of navigation history.

---

### 🟡 Round-trip data loss in transformers

**B9. `partnerAutonomous` and `partnerPark` are never saved.** [sync.ts:300-309](src/lib/sync.ts:300) / [transformers.ts:60-61](src/lib/transformers.ts:60)
Both fields exist on `MatchPlan` ([types.ts:152-153](src/types.ts:152)). The to-Supabase transform doesn't send them; the from-Supabase transform hardcodes both to `false`. Set them in the UI, sync, and they silently reset.

**B10. `match_number` is read from a field that doesn't exist.** [sync.ts:305](src/lib/sync.ts:305)
`data.matchNumber || null` — but `MatchPlan` has no `matchNumber` property. Always writes `null`.

**B18. A blank match number is silently stored as `0`.** [ScoutingReports.tsx:34](src/components/ScoutingReports.tsx:34)
`saveScoutingReport` validates only `teamNumber` ([line 30](src/components/ScoutingReports.tsx:30)). The match-number input runs `parseInt(e.target.value)`, so clearing it yields `NaN`, and `newScout.matchNumber || 0` turns that into **0**. The column is `NOT NULL` with no CHECK, so Postgres accepts it, and the card then renders "Match 0" ([line 135](src/components/ScoutingReports.tsx:135)).

**This is live in production: 5 of 9 scouting reports have `match_number = 0`**, created between 2026-02-07 and 2026-02-28 (verified against a local restore of the production dump, 2026-08-14).

It is also the one thing blocking the security-audit migration, which adds `CHECK (match_number > 0)` with no backfill for this table. Applying it today fails on those five rows.

The modelling is the actual bug: the UI treats match number as optional while the schema treats it as required, and `|| 0` invents a sentinel to bridge the gap. Fixing it is a decision — make the column nullable with `CHECK (match_number IS NULL OR match_number > 0)` and send `null` for blank, or make the field genuinely required and backfill the five rows. Either way, drop the `|| 0`.

**B17. `Task.archivedAt` has no column to live in.** [SprintPlanning.tsx:195](src/components/SprintPlanning.tsx:195) / [types.ts:115](src/types.ts:115)
The app sets `archivedAt: Date.now()` when archiving a task and renders it in [SprintArchived.tsx:49](src/components/SprintArchived.tsx:49), sorting the archived list by it. There is **no `archived_at` column** in production or in the migrations (verified 2026-08-14), and neither transform direction touches the field.

So the value lives only in local state: archive a task, let it round-trip through the server, and the timestamp is gone. The archive itself survives — that is carried by `status = 'Archived'` — but the "Archived <date>" label vanishes and the list's sort key collapses to `0` for every task that has been pulled back from the server.

Fix is a decision, not just a patch: either add an `archived_at` column and carry it through the registry, or derive the date from the task timeline and drop the field. Either way it belongs in Round D, and it is the **third** instance of the same round-trip asymmetry (with B9 and B10) — which is the argument for the registry in one sentence.

**B11. `NaN` timestamps whenever a date column is null.** [transformers.ts:27,63,72](src/lib/transformers.ts:27)
`new Date(t.created_at).getTime()` unguarded in the task, match-plan, and season transforms. A null column yields `NaN`, which sorts unpredictably and renders as "Invalid Date". `transformScoutingReportFromSupabase` [guards correctly](src/lib/transformers.ts:49) — the same 82-line file is inconsistent with itself, which is exactly the kind of thing a refactor should collapse.

---

### 🔵 Reliability and hygiene

**B13. `withTimeout` leaks its timer.** [sync.ts:23-30](src/lib/sync.ts:23) never clears the `setTimeout`, so every query leaves a pending timer alive for up to 30 seconds. Harmless in production, a plausible contributor to slow and hanging tests.

**B14. No coalescing in the sync queue.** [offline-db.ts:101-117](src/lib/offline-db.ts:101) appends a new row per edit. Twenty edits to one task means twenty full-record upserts. Checklist toggles are the pathological case (this is old checklist item #12).

**B16. Inconsistent table-name conventions inside one loop.** [realtime.ts:126](src/lib/realtime.ts:126) passes camelCase `localTable` to `mergeIntoStore`, while [realtime.ts:161](src/lib/realtime.ts:161) passes snake_case `table` to `handleRealtimeDelete`. Both are correct today. It is a trap for the next change.

**B0. One failing test.** `Dashboard.test.tsx:95` — `beforeEach` times out at 10s. Must be fixed before any of this, for the reason in Round A.

---

## Part 2 — What this tells us about the refactor

The pattern behind almost every bug above is the same: **the same concept is expressed differently in four places.**

- Table names exist as camelCase and snake_case, converted ad hoc, in `sync.ts`, `realtime.ts`, and the store.
- The Supabase↔local mapping lives in `transformers.ts` in one direction and inside a `switch` in `sync.ts` in the other — which is exactly how B9, B10, and B11 got in. Nothing forces the two directions to agree.
- Store mutation happens through `updateLocalDatabase`, `mergeIntoStore`, `handleRealtimeDelete`, and direct `store.setX` calls, each with slightly different semantics around replace-vs-merge.
- Sync metadata is split across localStorage and IndexedDB, which is how B5 got in.

So the refactor isn't cosmetic tidying — **the right refactor makes whole classes of these bugs unrepresentable.** One entity registry (table name, both transform directions, store setter) turns B9/B10/B11/B16 into compile-time impossibilities rather than things you fix once and reintroduce later.

That's the goal for Rounds C and D: not "smaller files," but *one definition per concept.*

---

## Part 3 — Round A is not optional

Part 0 is the argument. A gauntlet gate that runs a suite which mocks away the code under test is a gate that always opens. Every round below depends on a regression being *visible*, and today it wouldn't be.

Skipping this means finding out you broke sync at a competition.

---

## The Gate (runs after every round)

```
1. npx tsc --noEmit                     → exit 0
2. npm run test:run                     → all green, no new skips
3. npm run test:integration             → pass, against LOCAL POSTGRES (after A)
4. npm run test:rls                     → tenant-isolation suite passes (after A)
5. npm run build                        → succeed
6. supabase db reset --local            → schema rebuilds clean from migrations
7. Manual smoke, 6 flows:                 login · sprint · checklist ·
                                          scouting · match planner ·
                                          offline→online sync
8. Two-browser sync check                (Rounds B–D): edit in A → appears in B;
                                          delete in A → disappears in B
```

Gates 3, 4, and 6 don't exist yet. Round A builds them.

Lighter than the production gauntlet on purpose — no Lighthouse, no bundle budget, no secret scan. Those live in the other plan.

---

## The rounds

### Round A — Build a feedback loop that can actually fail · **prerequisite**

Four workstreams. A1 and A2 are the ones that matter.

#### A1 · Stand up the local Supabase stack

Docker and the CLI are already installed. This is mostly configuration.

- `supabase init` → commit `config.toml`. `supabase link` to the hosted project.
- `supabase db pull` → the real schema lands in git. **Reconcile the missing 001–008** and normalize the mixed migration naming.
- `supabase start` → local Postgres + Auth + Realtime + Studio.
- Verify `supabase db reset` rebuilds the schema from `supabase/migrations/` alone. Until that passes, your schema isn't really in git.
- Add npm scripts: `db:start`, `db:reset`, `db:diff`, `db:push`.
- Document the loop: **change → test locally → apply to the second free project (staging) → apply to prod.** Never prod first.

This is what makes B7's `REPLICA IDENTITY FULL` change safe, and it retires "schema changes are irreversible experiments on production" permanently.

#### A2 · Point the integration suite at real Postgres

The mock-drift problem doesn't get fixed by better mocks. Delete the mocks from the path that matters.

- `setup-integration.ts` connects to the local stack (`pg` is already a devDependency) instead of the hand-written Supabase mock. Keep `fake-indexeddb` — that part is already right.
- Seed and truncate per test.
- **Delete the hand-rolled query-builder mock.** It's the thing that produced `.gt()`-vs-`.gte()` and the phantom `SyncProvider` export.
- Write the first real integration tests over the paths that are currently at 0%: `processSyncItem`, `pullChangesFromServer`, `mergeIntoStore`, and the full queue drain.
- **New `test:rls` suite:** sign in as two users on two teams against the local stack and assert Team A cannot read or write Team B's rows — for every table. This is the check that would have caught the invite-code hole in `014` before it shipped.
- Narrow `src/test/setup.ts`. Component tests can keep mocking the data layer; **data-layer tests must not.** Move the global `vi.mock` calls into the component tests that actually need them.

#### A3 · Make the unit suite trustworthy

- **Fix** `Dashboard.test.tsx:95`'s hook timeout — find the slow async setup, don't raise the limit. (B13's leaked timers are the first suspect.)
- Delete the phantom `useSyncStatus` / `SyncProvider` mock exports.
- Add a lint rule or test asserting every `vi.mock` factory matches the real module's exports, so drift fails CI instead of rotting.
- Run the suite three times; quarantine and file anything else that flakes.
- **Characterization tests before touching anything** — pin the *current* behavior of both transform directions, `mergeIntoStore`, and `updateLocalDatabase`, wrong behavior included. Rounds B–D will deliberately flip some of these; that's the point. A test that changes deliberately is a decision. A test that changes accidentally is a regression.

#### A4 · CI

- GitHub Actions on every PR: `tsc --noEmit` → `test:run` → `test:integration` (against a Postgres service container) → `test:rls` → `build`.
- Deployment stays manual for now. This is purely a guard.

**Explicitly not doing:** Playwright/E2E. It's the natural next ask, but integration tests against real Postgres catch the Part 1 bugs at a fraction of the cost and flake. Revisit after Round D. Meanwhile, mark `.agent/skills/e2e-testing/` and `.agent/workflows/e2e-testing.md` as aspirational or delete them — they currently describe coverage that doesn't exist.

**Gate:**
- `supabase db reset` rebuilds prod's schema from migrations alone
- Integration tests run green against local Postgres with the Supabase mock deleted
- `test:rls` proves cross-team isolation
- Unit suite green three runs in a row
- CI goes red on a deliberately broken PR
- **The proof it worked:** write a failing test for B1 (queue ordering) *before* fixing it. If the loop can't express that failure, Round A isn't finished.

**~3–4 days.** Up from the 1–2 I estimated before Part 0. It's the best-spent time in the plan.

---

### Round B — Kill the data-loss bugs
Fixes **B1, B2, B3, B8** — the four that destroy user work. **Highest value in the plan.**

- **B1:** `orderBy('timestamp')` on the queue drain. Add a test asserting create→update→delete on one record applies in that order.
- **B2:** dead-letter table instead of `delete()`. Surface a persistent "N changes couldn't sync" banner with retry. A failure must never be invisible.
- **B3:** extend the pending-queue guard from checklists to every entity. Test: queue an offline create, force a full pull, assert the record survives.
- **B8:** skip realtime merges for records with a pending local change; reconcile when the queue drains. Test: pending local edit + inbound realtime update for the same id → local edit wins until it's pushed.

Do these as **four separate commits** with the gate between each. If something breaks in the following weeks you want to know which one.

**Gate:** full gate including the two-browser check. Plus a deliberate failure drill — force a sync error five times and confirm the change is preserved and the banner appears.
**~2–3 days.**

---

### Round C — Correct the sync protocol
Fixes **B4, B5, B6, B7, B12, B15**

- **B4:** cursor from `max(updated_at)` of returned rows. Test with a client clock deliberately skewed ±10 minutes.
- **B5:** move sync metadata into the `appState` IndexedDB table so sign-out has exactly one cleanup path. Test: user A signs out, user B signs in, B gets a complete dataset.
- **B6:** `AbortController` through the sync path; check cancellation each iteration. Test: force a 30s timeout, assert no second sync overlaps.
- **B7:** `REPLICA IDENTITY FULL` migration (**apply to the staging project first** — prod has no PITR), or drop the DELETE filter and check membership client-side. Test: delete propagates cross-client.
- **B12:** deterministic checklist selection — `ORDER BY` plus an explicit `is_template = false` predicate.
- **B15:** make the full-pull counter per-team.

B7 needs a schema change. Back up first.

**Gate:** full gate. Plus the clock-skew, user-switch, and cross-client-delete tests all passing.
**~3–4 days.**

---

### Round D — The refactor that prevents recurrence
Fixes **B9, B10, B11, B13, B14, B16** — and makes them unrepresentable

This is the structural work Part 2 argues for. Build **one entity registry** as the single source of truth:

```ts
// one entry per entity — the only place these facts exist
{
  localKey: 'matchPlans',
  remoteTable: 'match_plans',
  toRemote:   (p: MatchPlan) => MatchPlanRow,
  fromRemote: (r: MatchPlanRow) => MatchPlan,
  setInStore: (s, xs) => s.setMatchPlans(xs),
}
```

Then:
- `sync.ts`, `realtime.ts`, and the store all consume the registry — no more ad-hoc camel/snake conversion (**B16**).
- **Round-trip property tests:** for every entity, `fromRemote(toRemote(x))` deep-equals `x`. This test fails today on match plans, which is exactly **B9** and **B10** — and it catches the next one for free.
- One shared `toEpochMillis(value)` helper for every date field (**B11**), replacing four inconsistent inlines.
- Fix `withTimeout` to clear its timer (**B13**).
- Coalesce queue entries by `(tableName, recordId)`, keeping the newest, plus debounce checklist writes 300–500 ms (**B14**).
- Type the registry properly — this is where most of the 30 `as any` casts dissolve, since `from(tableName)` becomes a typed lookup instead of a cast.

**Gate:** full gate. Round-trip property test passes for every entity. `as any` count in `src/` (excluding tests) drops below 10.
**~3–4 days.**

---

### Round E — UI component cleanup · *now genuinely lower priority*
No known bugs. Readability and future-bug-prevention only.

Actual line counts (I over-estimated these from file size earlier — Tailwind class strings inflate bytes):

| File | Lines |
|---|---|
| `Landing.tsx` | 812 |
| `SprintPlanning.tsx` | 558 |
| `PortfolioAI.tsx` | 439 |
| `Onboarding.tsx` | 436 |
| `MatchPlanner.tsx` | 422 |
| `ScoutingReports.tsx` | 382 |
| `Login.tsx` | 350 |
| `Sidebar.tsx` | 315 |

**One component per iteration, gate between each. Do not batch.** Characterization tests before each split.

Order by value, not size: `SprintPlanning` and `MatchPlanner` first — they touch the data layer you just fixed and are where the next bug would land. `Landing.tsx` is the biggest but it's static marketing markup; it's the *lowest*-risk and lowest-value split. Do it last, or don't do it at all this pass.

**Gate:** full gate per component. Test count goes up, never down.
**~3–4 days**, and the easiest round to stop partway through.

---

### Round F — Sweep and loop

Re-read the data layer with fresh eyes now that it's restructured, plus the areas I haven't audited line-by-line yet: `store.ts` (695 lines), `auth.tsx`, `user-context.tsx`, `attestations.ts`, and the three slices. Anything found becomes Round G.

Also worth pulling forward from the production plan, because they're *debugging* tools rather than ops work:
- **Error boundary** — a white screen tells you nothing; a caught error tells you where.
- **`src/lib/logger.ts`** — 76 `console.*` calls in production paths, currently unsearchable and unstructured.

**Stop when two consecutive sweeps find nothing new.**

---

## Timeline

| Round | Focus | Effort |
|---|---|---|
| A | **Feedback loop + local Supabase** (prerequisite) | 3–4 days |
| B | **Data-loss bugs** | 2–3 days |
| C | Sync protocol correctness | 3–4 days |
| D | Registry refactor + round-trip tests | 3–4 days |
| E | UI decomposition (optional) | 3–4 days |
| F | Sweep + loop | 1–2 days |
| **Total** | | **~3–4 weeks** |

**If you only do two rounds: A and B.** That's ~6 days and it stops the app from destroying user work — the difference between "buggy" and "untrustworthy."

Rounds A–D are ~12–15 days and get the data layer genuinely correct. Round E is cosmetic and safely deferrable.

Round A is now the largest single investment before any bug gets fixed. That ordering is deliberate: it is the round that makes every following round's gate mean something.

---

## Two notes

**The one production item I'd still not defer:** the live Supabase DB password in `.agent/scaling-next-steps.md:9`. Rotating it is a 15-minute dashboard task, it's unrelated to any of the work above, and it doesn't get safer while it waits. Everything else in the production plan can genuinely wait.

**Round C touches the database schema** (B7's `REPLICA IDENTITY FULL`). On the free tier there's no point-in-time recovery, so run `backup-full.mjs` before applying it — with the rotated password.

---

## Running this as an automated gauntlet

Each round fits the loop shape: fan out fixers per bug → gate after each → an independent agent tries to **refute** each fix by writing a test that should now fail → commit. The round order is fixed here because the dependencies are real: A gates everything, B before C (don't rework logic you're about to change), C before D (the registry should encode the *corrected* protocol, not the current one).

Say the word and I'll write it.
