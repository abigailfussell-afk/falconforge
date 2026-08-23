# Sprint 11 — Package B, "the read path"

**Package:** B — the read path (Phase 0), from `HANDOFF_ASSESSMENT.md` §"Sprint packages".
**IDs, in the order they were done:** SYNC-01 + SYNC-03 (one change), SYNC-02, SYNC-05, SYNC-15.
**Branch:** `v2/sprint-11-read-path`, off `main` at `60892b4`.
**Commit range:** `ee032a8..80c6c85` (five commits; a sixth adds this report and the plan lines).
**`supabase/` touched:** no. No migration, no `db:verify`. The Gate is `npm run gate`; `test:db`
was run as well because SYNC-01's red test lives there.

---

## 1. Gate output

```
$ npm run gate

> falconforge@0.1.0 gate
> npm run lint && npm run test:run && npm run test:integration && npm run build

> falconforge@0.1.0 lint
> tsc --noEmit && eslint src

> falconforge@0.1.0 test:run
> vitest run

 Test Files  58 passed (58)
      Tests  695 passed | 2 skipped (697)

> falconforge@0.1.0 test:integration
> vitest run --config vitest.config.integration.ts

 Test Files  9 passed (9)
      Tests  95 passed (95)

> falconforge@0.1.0 build
> tsc && vite build

✓ built in 5.02s
PWA v0.17.5
precache  45 entries (5140.57 KiB)
```

```
$ npm run test:db

> falconforge@0.1.0 test:db
> vitest run --config vitest.config.db.ts

 Test Files  23 passed (23)
      Tests  526 passed (526)
```

Run against a stack reset immediately beforehand (`supabase db reset && npm run seed:review`).
The Gate ran green on each commit through the pre-commit hook as well.

Counts against `main`: unit 678 → 695, integration 91 → 95, db 517 → 526. `as any` unchanged at
**56**; arbitrary Tailwind values unchanged at **2**; no `describe.skip` added. `harness-invariants`
green.

---

## 2. Per ID

### SYNC-01 + SYNC-03 — paged, season-scoped pulls (M · Gate)

> **Seed 2,500 `tasks` for one team; after `fetchTeamData` the store holds 2,500; after a delta
> pull with 1,500 changed rows it holds all of them; no row is ever removed from the device by a
> *truncated* page.**

Met. `pull-paging-seasons.db.test.ts` → *walks three pages for 2,500 rows and the store holds
every one after fetchTeamData*: seeds 2,500 into a fresh season, runs the real `fetchTeamData`,
asserts 2,500 in the store **and** 2,500 distinct ids (a paging bug that repeats a page also
reaches 2,500). It then updates 1,530 of them — asserted `> 1000` before the pull, so the case
cannot silently shrink to one page — runs a delta, and asserts the collection is still 2,500 with
1,530 changed. The 1,001-row case is separate and is the one that fails against the old code; it
first asserts that a single unpaged request returns exactly 1,000 with `error === null`, so the
test would notice if the server stopped truncating and the case stopped meaning anything.

*How verified:* `npx vitest run --config vitest.config.db.ts src/lib/__tests__/pull-paging-seasons.db.test.ts`
→ 9 passed, against real PostgREST.

> **Season-scoped tables (`tasks`, `scouting_reports`, `match_plans`, `sub_teams`, `checklists`,
> `meetings`, and `meeting_attendance` via its meeting) are pulled for the current season on
> mount; an archived season's rows load when the season picker selects it, and are then cached
> offline like everything else.**

Met, and verified in the built bundle rather than only in tests. All seven are season-scoped:
six by `season_id` (declared per entity as `seasonScope: 'column'`, derived from the registry so
the list cannot drift — `SEASON_SCOPED_TABLES` is computed, not written), and `meeting_attendance`
through `meetings!inner()` with an **empty embed spec**, which filters without attaching a nested
object to any row. Checklists are not a registry entity and are named explicitly.

*How verified:* the network log of the real build at `http://localhost:4191`, signed in as
`reviewer@`, after clearing the service worker and confirming the loaded script matched
`dist/index.html` (`index-qrYvFxSj.js`). On mount:

```
GET /rest/v1/tasks?select=*&team_id=eq.<team>&season_id=eq.<current>&order=updated_at.asc,id.asc&limit=1000
GET /rest/v1/meeting_attendance?select=*,meetings!inner()&team_id=eq.<team>&meetings.season_id=eq.<current>&order=updated_at.asc,id.asc&limit=1000
GET /rest/v1/seasons?select=id,name,team_id,game_title,is_archived,created_at,updated_at&team_id=eq.<team>&…
```

Then, selecting "2025-2026 Season (archived)" in the sidebar picker (an archived season inserted
by hand with two tasks): six requests, all `season_id=eq.690b90da…`, and the board rendered
"Last season: rebuild the arm". Switching back to the current season and reading the persisted
IndexedDB blob showed **both** seasons' rows on the device — `tasksBySeason: { "690b90da…": 2 }`
alongside the current season's — i.e. refreshing this season did not delete last season.

> **Measured … bytes per app open for the seeded mid-season team drop by ≥ 60% versus the number
> recorded in SYNC-03 (~0.7 MB).**

**Met for the open that happens six times a day; not met for the first-ever open, and the numbers
are below rather than a claim.** `scripts/pull-size.mjs` (rebuilt from the SYNC report's preamble:
an authenticated REST pull of every table the app pulls, as `reviewer@`) against the seeded
mid-season profile — the assessment's own figures, 300 tasks with 200-char descriptions, 60
meetings, 900 attendance, 60 scouting reports, in the current season **and** a prior archived one,
because a second-year team is the case the finding is about:

| shape | uncompressed | gzip | vs baseline |
|---|---|---|---|
| baseline (pre-fix request set: `select('*')`, every season, no paging) | **863.8 KB** | 63.4 KB | — |
| cold open (post-fix, a device that has never seen this team) | **637.8 KB** | 51.1 KB | −26.2% |
| warm open (post-fix, every open after that) | **13.8 KB** | 3.0 KB | **−98.4%** |

Per table, baseline → cold → warm: tasks 364.2 → 182.4 → 0.6 KB; meeting_attendance 374.5 →
383.6 → 0.4 KB; meetings 75.7 → 43.5 → 11.3 KB; scouting 42.3 → 21.1 → 0.4 KB.

Three things worth saying plainly:

1. **The baseline is 863.8 KB and it is also wrong.** `meeting_attendance` came back at exactly
   1,000 rows — truncated at `max_rows`, with no error — so the pre-fix number is *smaller* than
   the data it was supposed to fetch. That is SYNC-01, and it is why the cold-open row above goes
   slightly *up* for that one table: the fix pays for 25 rows the old code silently dropped.
2. **The cold open is −26.2%, not −60%.** What is left is the current season's own data, which a
   device has to have to work offline. There is nothing to trim there without taking the product's
   first principle away. A device pays it once per install.
3. **The warm open is what the monthly bill is made of.** At the assessment's own usage figures —
   15 devices × 6 opens/day × 30 days — the pre-fix month is ~2.28 GB uncompressed for **one
   team**, against a 5 GB free-tier allowance shared by every team. Post-fix it is 15 cold opens
   plus 2,685 warm ones ≈ **46 MB**, before the page-hook refetches, which were full pulls and are
   now deltas as well. That is the wall SYNC-03 says is the first one a modest user base hits, and
   it has moved.

The `updated_at` values in the seeded profile are **spread across the season deliberately**: rows
inserted in one statement share a timestamp to the microsecond, a `gte(cursor)` delta returns all
of them, and the warm measurement would have reported that delta pulls buy nothing. That is
recorded in the script, because it is the way this measurement can lie.

> **`field_image_data` is no longer part of the `seasons` pull on every open.**

Met. The season select is an explicit column list (`EntityDefinition.pullColumns`) and the image
is fetched once per season by `ensureSeasonFieldImage`, from the two screens that show it. Three
tests: the pull does not carry the column and does not blank an image already on the device
(db); the select spec never contains `field_image_data` (unit); and the column list is compared to
the table's actual columns, because a hand-written list that must track a schema is
`docs/failure-modes.md` §12 and nothing fails when the two drift.

A hazard this created and closed: with the column no longer pulled, `toRemote` spreading
`fieldImageData || null` would have **blanked a 670 KB image on the server the first time somebody
renamed the season** — the push sends the whole row. So `fromRemote` distinguishes an absent
column (`undefined`, "not fetched") from a present-and-null one (`''`, "no image"), and `toRemote`
omits the column entirely for the first. Asserted directly (*never writes the column back as NULL
from a device that has not fetched it*). `SeasonManager` lost its `editFieldImageData` state in
the same change — a second copy of a value the store already held, which would have been read
before the image arrived and never updated when it did.

> **The B3 guard survives: an un-pushed local record is still preserved across a full pull.**

Met. The existing B3 tests are green untouched (`pull-preserves-pending.integration.test.ts`,
`server-pull.db.test.ts`'s *preserves a task created offline*), and a new case asserts it across a
**multi-page** pull specifically.

> **Red tests:** an integration test against the local stack seeding 1,001 rows (fails today with
> 1,000); a unit test that a delta cursor only advances after the *last* page.

Both exist and both were **watched red**:

- Reverting the pagination to stop after the first page (`if (batch.length < PULL_PAGE_SIZE)` →
  `if (true)`) → 3 failures: *brings back all 1,001 rows*, *walks three pages for 2,500 rows*,
  *leaves the cursor at the newest row of the LAST page*. Restored → 9 passed.
- Reverting the season filter (`seasonFilter = null`) → 3 db failures and 2 unit failures.
- Reverting `pullColumns`/`deferredFields` → 3 failures across the two files.

The cursor half has two forms, both green: the db test asserts the stored cursor equals the
newest `updated_at` in the whole 1,005-row set (not the first page's), and the unit test
*leaves the collection and the cursor alone when a later page errors* asserts that a full first
page followed by a failing second page leaves both the collection and the cursor exactly where
they were. Reverting the `continue` that abandons an incomplete table made that one red.

> **Trap:** raising `max_rows` alone moves the cliff and is not done. Ordering must be
> `updated_at, id` for stable pages. The delta cursor must not advance past rows in a page that
> errored.

`supabase/config.toml` is untouched — `git diff main --stat -- supabase/` is empty. Ordering is
`updated_at, id` on every request (visible in the network log above).

One deliberate departure from the trap's wording, and the reason: **paging is keyset, not
`.range()`.** `(updated_at, id)` ordering with an offset window is not stable while anybody is
writing — a row on page 1 that is updated mid-pagination sorts to the end, everything after it
shifts down one, and the row that slides across the page boundary is never returned. For a full
pull that means it is *deleted from the device*, which is SYNC-01 again in a narrower window.
Paging on `(updated_at, id) > (last seen)` cannot skip a row: a row that moves, moves to after the
cursor, so the worst case is seeing it twice and an upsert by id does not care. The filter was
checked against the real PostgREST before it was written into the code (it correctly skips the
boundary row and returns the next ids sharing the identical microsecond timestamp).

**Effort:** estimated M (1–2 days). Actual: the largest item of the sprint, and the two IDs really
are one change — the season scope is what makes the row cap survivable and the delta is what makes
the season scope pay.

### SYNC-02 — never replace a collection with an anon-key result (S · Gate)

> **With a stored-but-expired JWT and the auth refresh endpoint failing, a pull is skipped (or
> errors), and the local collections are untouched; the status indicator does not say "Synced".**

**Half met, and the half that is not is named.** The pull is skipped and the collections are
untouched — `pull-guards.test.ts` → *does not empty the collections when the token resolver has
nothing to give* asserts `setTasks` was never called and the store still holds the local row, and
*does not even reach the server* asserts `supabaseSync.from` was not called at all.

The indicator half is **not done**. It is SYNC-07's mechanism ("track last successful server
contact"), SYNC-07 is Package C, and building half of it here would be a second implementation of
sync status — the defect class this project has paid for eighteen times. What a skipped pull does
today is `console.warn` and return an empty `PullResult`; the honest note for whoever takes
SYNC-07 is that "the pull was skipped because we are not authenticated" must count as *not
contacted*, not as a quiet success.

> **`supabaseSync.accessToken()` never returns the anon key for a pull; `pullFromServer` refuses
> to call `updateLocalDatabase` unless the token's `role` claim is `authenticated`.**

Met in substance, differently in shape, and the difference is deliberate. One client serves both
the pull and the push, and the `accessToken` callback cannot tell which is asking. So the token
resolution moved into a named function — `resolveSyncAccessTokenAsync()`, which returns `null`
rather than the anon key when there is no usable user JWT and checks the `role` claim rather than
comparing against `supabaseAnonKey` (a different anon-ish token is refused too) — and:

- the pull calls it directly and returns before issuing a single request when it is `null`;
- the callback keeps `?? supabaseAnonKey`, which is the trap's instruction: a queued write sent
  with the anon key gets a 42501 the classifier understands and the queue retries. Breaking that
  would have changed the push's failure from a classified refusal into an exception, which is a
  B-test risk for no gain.

One resolver, two callers, one place that knows how the token is found.

> **Red test:** unit test in `server-pull` that stubs the token as the anon JWT and asserts
> `setTasks` is not called with `[]` (fails today).

Exists; **watched red**. Replacing the guard's condition with `if (false)` → *does not empty the
collections when the token resolver has nothing to give* and *does not even reach the server* both
fail; the control (*pulls normally once there is a user token again*) stays green, so the guard is
targeted rather than a blanket refusal.

**Effort:** estimated S. Actual S.

### SYNC-05 — sign-out confirms when work is unsynced (S · Gate)

> **Offline, create a task, click sign-out → a confirm names the count ("1 change hasn't reached
> the server"); Cancel keeps the queue; Confirm clears it. Online with a non-empty queue → offer
> "sync then sign out".**

Met, and verified in the built bundle at 375 px with the server unreachable. Screenshot-free
evidence, read out of the live DOM:

```
message: "1 change hasn't reached the server yet. Signing out deletes it from this device."
buttons: ["Stay signed in", "Sign out anyway", "Sync, then sign out"]
```

"Stay signed in" left the session intact, the board rendered, and the URL unchanged. At 375 px the
card is 343 px wide inside a 375 px viewport with `document.documentElement.scrollWidth === 375`
— no horizontal overflow — and the three buttons stack.

The decision lives in `performSignOut`, not at the call sites, so all three sign-out buttons in the
app obey it; what differs per call site is only how the question is asked (the shell shows the
dialog, `Onboarding` and `JoinTeam` get `window.confirm`, which cannot offer three options and
offers the two that matter).

> **With an empty queue and no dead letters, sign-out is unchanged (one click).**

Met, and asserted as a control in two places — *does not ask at all when there is nothing
unsynced* (integration) and *does not interrupt a sign-out with nothing queued* (component). A
warning that fires every time would be worse than none.

> **Red test:** component test: sign-out with `getPendingSyncCount() = 1` does not call
> `clearLocalDatabase` without confirmation.

Exists as `AppShell.signout.test.tsx`, and it asserts something stronger than the criterion asks:
it runs the real `sign-out` module against a real (fake-indexeddb) Dexie and checks the **queue is
still there**, not that a spy went uncalled. `sign-out.test.ts`'s own header says why that matters
— "that would still pass if `clearLocalDatabase()` stopped clearing the dead-letter store".

**Watched red:** replacing the ask loop's condition with `if (true) break` → 3 of 4 component
cases fail and 2 of the integration cases fail, with the control staying green in both files.

**Two defects found by running it, neither of which any test had asked about:**

1. **"Sync, then sign out" could not do what it said.** `drainSyncQueue` does not touch the
   dead-letter store, and a parked change is most of what is on a device after a bad afternoon.
   Pressing it ran, changed nothing, and re-displayed the identical dialog with the identical
   button — `docs/failure-modes.md` §8, an enabled control whose handler silently does nothing.
   It now calls `retrySyncFailures()` first; the second time the question is asked it says a send
   was tried and failed, and the button that failed is withdrawn. Both halves have tests, and the
   `retrySyncFailures` half was watched red.
2. **The copy read "1 change hasn't reached the server yet. Signing out deletes them from this
   device."** Singular subject, plural object, on the commonest case there is.

**Effort:** estimated S. Actual S for the mechanism, plus roughly the same again for the two
things the browser found.

### SYNC-15 — cross-team leakage of a pending record after a team switch

**No exit-criteria block exists for this ID — it is in the SYNC report only. The definition of
done below is mine, written for this sprint and stated as such:**

> A collection in the store contains rows of exactly one team: the one that is open. That holds on
> the delta path as well as the full one, and it holds for a record that is still in the sync
> queue. A row that does not say which team it belongs to is kept, because "does not say" is not
> "belongs to somebody else". A row of another SEASON of the same team is kept, because the pull
> did not ask about it. Dropping a row from a collection never drops the queued change behind it.

Met, five assertions, one per clause, in `pull-guards.test.ts`:

- *drops a pending record belonging to the team that is not open* — the report's exact scenario: a
  task queued on Team A, a switch to Team B, a pull for Team B. Team A's card is gone from the
  board **and** `db.syncQueue.count()` is still 1, which is the clause that matters most: the push
  reads the queue's own payload, not the store, so hiding the row must not destroy the work.
- *keeps a pending record of the team that IS open* — B3, unchanged.
- *evicts another team's rows on a DELTA pull too* — this is why it is here rather than in a
  cosmetics sprint. `fetchTeamData` is a delta pull now, so a team switch can arrive as a merge,
  and a merge that only ever adds would put two teams on one board. The tenant filter is what
  makes delta-on-open safe to do at all.
- *keeps a row that does not say which team it belongs to* — records persisted by an older build.
- *keeps another SEASON's rows, which is the opposite rule and deliberately so.*

The data half is `teamId` on the season-scoped local types, filled by `fromRemote`, which had been
dropping `team_id` since the registry was written. The round-trip samples carry it now, so the
suite asserts the new symmetry rather than tolerating it.

**Watched red:** making `withinPulledTeam` return `true` unconditionally → *drops a pending record
belonging to the team that is not open* and *evicts another team's rows on a DELTA pull too* fail;
the three "keeps" controls stay green.

**Effort:** estimated S. Actual S, and it paid for itself inside the sprint — without it,
delta-on-mount would have been unsafe and SYNC-03's main saving unavailable.

---

## 3. Decisions consumed

**None.** The package depends on none, and re-reading `decisions.md` confirmed it: D1 (pricing),
D2 (event data), D3 (trial), D4 (scouting customisation), D5 (training), D6 (beta cohort), D7
(hosting tier), D8 (content permissions) and D9 (admin nomination) are all still blank and none of
them gates a read-path change. Nothing in the work contradicted a recorded decision.

Two *locked* decisions in plan §3 were leaned on and both held: "seasons are fresh starts, prior
seasons read-only" is what makes season-scoping the pull correct rather than merely cheaper, and
"Supabase free → Pro is a billing toggle whose trigger is the first paying customer" is what makes
egress worth fixing in code now rather than paying for later.

---

## 4. Discovered → parking lot

Six entries added to `FALCONFORGE_V2_PLAN.md` §8, with numbers. In short:

1. **A dead letter records `"[object Object]"` as its `lastError`, for every server refusal.**
   `throw result.error` throws PostgREST's plain object; `moveToDeadLetter` stores
   `error instanceof Error ? error.message : String(error)`. Reproduced in the built bundle. It
   reaches no user today, but **SYNC-10's whole design is shipping that record to a server**.
   One line to fix.
2. **The SYNC report's SYNC-14 claim that `ParkedChangesDialog` "shows `lastError` when no reason"
   is not true of the code as it stands** — it shows `terminalReason` or a generic sentence
   (`ParkedChangesDialog.tsx:140-143`). Verified rather than widened, per guardrail 2.
3. **`sync.integration.test.ts`'s delta test never runs the delta path** — it seeds two
   `localStorage` keys nothing has read since B5, and the setup clears `db.appState` before each
   test, so there is never a cursor. It is named for the delta and passes either way. §2 class.
4. **The `team_members` `status='approved'` filter stays in the pull** (see §5).
5. **A team switch costs two season pulls**, because `fetchSeasonData` de-duplicates on
   `(team, season, mode)` and the two callers disagree about the mode. Harmless; listed so it is a
   decision rather than an accident.
6. **The sync loop only pulls when the queue is non-empty**, so a read-only device never reaches
   the periodic full reconciliation. True before this sprint; matters more now the mount pull is a
   delta.

---

## 5. What was **not** done, and why

- **SYNC-02's "the status indicator does not say Synced".** SYNC-07's mechanism, SYNC-07 is
  Package C. Building it here would be the second implementation of sync status. Flagged above
  with the note SYNC-07 needs.
- **The Sprint 10 parking-lot item this package was pointed at** — `server-pull.ts` filtering
  `team_members` to `status='approved'`, so a task assigned to a removed member renders
  "Unassigned" and saving it writes the assignment away. Read before the pull was changed, and
  **not fixed: it is not made trivial by the pull change.** The pull half is one line. The other
  half is not: twelve components reference `teamMembers`, nine receive the shell's already-filtered
  list through the outlet context, and three read the store directly — `AppShell.tsx:95` (which
  filters with `isActiveMember`), `GuardianView.tsx:32` and `PreMatchChecklist.tsx:32` (which do
  not). Dropping the filter alone changes nothing visible and quietly widens what those last two
  see. The fix is "carry `status='removed'` rows and filter in the pickers, keeping the name
  read-only", which is roster UI work. It stays in the parking lot, now with the numbers.
- **`supabase/config.toml`'s `max_rows`.** Not raised, per the trap. Nothing under `supabase/` was
  touched at all.
- **A Playwright spec for any of this.** The e2e pack rebuilds `dist/`, and SYNC-16 (the offline
  cold-boot spec) is Package G's. The browser work here was done against a real build served by
  `vite preview` and driven directly, which is the same evidence without disturbing that pack.

---

## 6. Verification notes — what would have made each check fail

Per `docs/failure-modes.md` §3's question, for the steps that are not tests:

- **The bundle really was the local one.** `grep` for `127.0.0.1:54321` in `dist/assets/*.js`
  found it and `grep` for `supabase.co` found nothing, before anything was measured
  (`docs/environment-divergences.md` §2).
- **The page really was serving the fresh bundle.** The service worker was unregistered, caches
  deleted, and `[...document.querySelectorAll('script[src]')]` compared against `dist/index.html`
  — `index-qrYvFxSj.js` on both sides (§4; a stale worker has served a pre-fix bundle here twice).
- **One check did fail, and was my own fault, which is the point of writing this down.** Clearing
  IndexedDB with `indexedDB.deleteDatabase` while the page held it open left Dexie throwing
  `DatabaseClosedError` from inside the pull's per-table `try`, so every table was skipped and the
  season picker was empty. For twenty minutes that looked exactly like the change having broken
  the season pull. A hard reload — not a hash navigation, which does not reload (§8's cousin,
  and the Sprint 8 capture bug) — showed the seasons arriving normally.
- **The measurement's `--seed` spreads `updated_at`**, and without that the warm-open number would
  have been a measurement of the seeding statement rather than of the delta.
- **The 375 px check measured geometry**, not classes: card width, viewport width, document
  scroll width and every button's rect, read from the live page (§5 — jsdom renders the broken
  and fixed versions identically).

---

## 7. The B-tests that changed, reported rather than edited

Principle 2 says a B-test that has to change is a finding. Three did. None of them lost an
assertion; each gained an input or a name:

1. **B5 (`sign-out-cleanup.integration.test.ts`).** Two cases now pass `performSignOut` a third
   argument answering `'sign-out'`. That is a new *input*, not a relaxed assertion — every
   teardown assertion in the file is untouched and still runs. Without it those cases would have
   been answered by a jsdom `window.confirm` returning `undefined`, which reads as "cancel", so
   they would have been asserting that a sign-out which never happened cleared nothing. Four new
   cases pin the other half (the count is named; cancelling leaves the queue, the dead letters,
   the session and the navigation alone; an empty queue is one click; parked changes are
   re-queued before a sync-first attempt).
2. **B4 (`server-pull.db.test.ts`, *advances the delta cursor to a server timestamp*).** The
   cursor key gained the season it describes, so the lookup changed from `${team}:tasks` to
   `${team}:tasks:season:${season}`. The assertion — that the cursor equals the server's
   `updated_at` and not the local clock — is unchanged. The key is spelled out rather than
   derived from the code under test, so changing the scheme has to be a deliberate edit to that
   line. **Why the key had to change:** the pull asks for one season at a time now, so a single
   per-table cursor would be a claim about rows it never requested — open the archived season next
   and its first pull would start from a timestamp none of its rows has, return nothing, and be
   indistinguishable from a season with nothing in it.
3. **The registry round-trip suite.** Six samples gained `teamId`. With the field absent the round
   trip would have compared a 13-key object to a 12-key one; adding it is what makes the suite
   assert the new symmetry rather than tolerate it.

Two test *harnesses* also had to be repaired, and both are the same class as the drift their own
files already document:

- `sync.integration.test.ts`'s hand-rolled query builder needed `.or()`, `.order()` and `.limit()`
  — the file's header already records `.gt()` vs `.gte()` as the previous instance.
- `SeasonManager.test.tsx` and `MatchPlanner.test.tsx` mocked the store as a bare `vi.fn()` with no
  `getState`, which threw *inside an async function* — an unhandled rejection, so the run fails
  while every test reports passing (`docs/failure-modes.md` §11). And `SeasonManager`'s *allows
  removing an image* was asserting a `useState` call rather than the season: it passed because the
  component kept its own copy of the image, and would have gone on passing if `updateSeason` had
  stopped being called. It now tells the mocked store what happened and asserts the panel follows
  it.

---

## 8. One line for the plan §8 Progress log

Added to `FALCONFORGE_V2_PLAN.md` §8 as the `2026-08-24` row for
`v2/sprint-11-read-path`. Repeated here so the two cannot drift:

> | 2026-08-24 | Sprint 11 — Package B "the read path" (SYNC-01+03, SYNC-02, SYNC-05, SYNC-15) | `v2/sprint-11-read-path` | **Complete, unmerged.** Gate green (lint / 695 unit +2 skips / 95 integration / build) and `test:db` 526/526; `supabase/` untouched, so no migration. **A pull could return less than the truth four different ways, and a full pull REPLACES the collection, so each one deleted rows from the device.** SYNC-01: PostgREST caps a response at 1,000 rows and says nothing — `error` null, array short — so rows 1,001+ were deleted and `newestUpdatedAt` then advanced the cursor past records that had never arrived. Now paged, keyset on `(updated_at, id)` rather than `.range()` (an offset window over a table somebody is writing to skips the row that slides across the boundary), applied to the store ONCE after the last page; a page that errors abandons the table with the store and the cursor untouched. Proved against a real PostgREST at 1,001 and 2,500 rows. **`max_rows` was not raised** — the trap says it moves the cliff, and it does. SYNC-03: **measured, not estimated** — a mid-season team with a prior season cost **863.8 KB per app open** (gzip 63.4), close to the assessment's 0.7 MB guess and *wrong*, because attendance truncated. Season-scoped pulls, `field_image_data` off the season select, delta-on-mount and delta page hooks bring a **warm open to 13.8 KB (gzip 3.0) — 98.4% off**; a cold first-ever open is 637.8 KB (−26.2%), and that is the honest shape of it: the criterion's ≥60% is met by the open that happens six times a day, not by the one that happens once per install. `meeting_attendance` has no `season_id` and reaches its season through `meetings!inner()` with an EMPTY embed spec, which filters without adding a byte. SYNC-02: the pull refuses to run at all without an `authenticated` token — the anon fallback answered `200 []` on every table, which this read path treats as "deleted elsewhere"; the PUSH keeps the fallback, because a 42501 the classifier understands is a request that fails loudly. SYNC-15: a collection only ever holds the pulled team's rows now, on the delta path too, which is what makes delta-on-open safe; another SEASON's rows are the opposite rule and are kept. SYNC-05: sign-out reads the queue and the dead letters and asks before destroying them, in `performSignOut` so all three sign-out buttons obey it. **Every red test was watched red with its fix reverted**, per ID, and two defects were found by running the built bundle at 375 px that no test had asked about: "Sync, then sign out" could not touch a parked change and re-asked the same question with the same button, and the copy said "1 change hasn't reached the server. Signing out deletes them". `as any` unchanged at 56; six parking-lot entries. |
