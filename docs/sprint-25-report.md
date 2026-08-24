# Sprint 25 — the sync engine

**Branch:** `v2/sprint-25-sync-engine`
**Commits:** `279f5ac..9898f39` (four), off `main` at `8005e8d`
**Ratchets:** `as any` **55 → 54** (down one), arbitrary Tailwind values **2 → 2**,
`dark:text-slate-500` **0**, no `describe.skip`, no assertion-free tests. Coverage
**69.26 / 62.04 / 65.01 / 71.22** against floors 68 / 60 / 63 / 70 — up on all four again.

Four IDs in the order the handoff set, increasing blast radius: `SYNC-13`, `SYNC-09`,
`SYNC-04`, `SYNC-06`. No migration.

**Every B1–B26 regression test is green.** Two had to change and that is reported below rather
than buried, per CLAUDE.md principle 2.

---

## Gate

Stages run individually. `npx supabase db reset --local` before each database run.

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1101 passed**, 2 skipped (was 1091 — ten new) |
| integration | **99 passed** (was 95 — four new) |
| build | ok — precache 45 entries |
| `db:assert` | `schema assertions passed` |
| db | **661 passed** (was 650 — eleven new) |
| RLS | **418 passed** |
| e2e | **36/36**, chromium + mobile |
| coverage | **131 files, 1861 passed**, thresholds met |

---

## The two B-tests that changed, and why that is a finding

`DrainResult` gained a `stalled` field for SYNC-13. Two assertions in
`src/lib/__tests__/sync-drain.db.test.ts` compare the whole result object with `toEqual`, so both
noticed — which is exactly what a whole-object assertion is for.

**Both gained `stalled: false`. Neither was relaxed to `toMatchObject`.** That would have traded
a real property — no field of a drain result is ever unexpectedly non-zero — for never having to
touch the line again. The change is to an expectation's completeness, not to what it asserts, and
the file says so in a comment at the site.

Nothing else in the B1–B26 suite needed touching. In particular B3 and B8 — the pending-write
guards — are green **unmodified** after SYNC-06, which is the evidence for the principle-3
paragraph below rather than the claim of it.

---

## Exit criteria

None of the four IDs has an exit-criteria block. **The criteria below are mine.**

### SYNC-13 — a long drain that is working is not a failed one

> A queue larger than one timeout window drains to completion in one run as long as pushes keep
> landing. A run that stalls having pushed something is not reported as a failure. A run that
> stalls having pushed nothing still is.

The budget still says 30 s and now means "the longest we wait while NOTHING is succeeding". Only
a successful push resets it: five hundred items all being refused would otherwise extend it five
hundred times and hold the sync lock for an hour, since each item is bounded only by its own
10 s per-query timeout.

The drain is bounded by progress; the pull keeps its wall clock. They are different shapes of
work and the flat `withTimeout` around both treated them the same — a drain is N independent
round trips and a long one that keeps succeeding is a device catching up after a day offline,
which is what this app exists to survive; a pull is one operation that either answers or hangs.

### SYNC-09 — one drain at a time, across every tab

> Two tabs on one device do not drain the same queue together. A tab that finds the lock held
> declines rather than waits, and pays no retry for the attempt. Where the Web Locks API does not
> exist the drain still runs.

Verified in the browser: with another holder on `falconforge-sync`, an edit made through the task
modal stayed queued with **retryCount 0** — never attempted — and drained the moment the lock was
released, with zero failures. That number is the whole point: two tabs each incrementing the same
failing item's count is what parked a coach's change two failures earlier than the engine intends.

### SYNC-04 — a hidden tab gives up its socket

> A tab hidden for two minutes releases its realtime connection; an ordinary tab switch does not.
> Coming back reconnects and closes the gap the disconnection left.

The constraint is **connections**, not messages: the free tier allows 200 concurrent, a team
meeting is 8–15 devices, and 15–25 teams meeting on one evening saturates it. Resubscribe first,
then pull — a change landing between the pull and the subscribe would be in neither, and
subscribing first makes the overlap a duplicate instead of a hole.

### SYNC-06 — an update sends only the columns it changed

> An offline edit to one field does not revert a teammate's change to another. Several offline
> edits to one record collapse into a single push carrying everything they touched. A queue entry
> written by an older bundle still pushes.

Verified in the browser through the real UI, which is the link the db tests cannot reach — that
the slice call sites actually supply the pre-edit row:

1. Created "Conflict probe" on the board; it reached the server as `Backlog`.
2. Blocked `fetch` for `/rest/v1/tasks` and renamed it in the task modal. The queued entry
   carried `prevTitle: 'Conflict probe'`, `prevStatus: 'Backlog'`.
3. Device B set `status = 'Done'` directly on the server.
4. Back online: **`Conflict probe RENAMED | Done`**. Before this change the row would read
   `Conflict probe RENAMED | Backlog`.

---

## Red tests, each watched failing

| Test | Reverted | What it said |
|---|---|---|
| SYNC-13 drain (2) | the deadline check removed | `expected 3 to be 2`; `the drain kept going with nothing succeeding` |
| SYNC-13 drain (1) | the deadline reset on every item, not only on success | `expected 3 to be 2` |
| SYNC-13 status | the rule widened to `if (drain.stalled)` | `a partly-drained queue was reported as a failure: expected [ …(20) ] to deeply equal []` |
| SYNC-09 helper (3) | the lock removed entirely | `expected "vi.fn()" to be called with …` |
| SYNC-09 helper (2) | `ifAvailable` dropped | `expected {} to deeply equal { ifAvailable: true }` |
| SYNC-09 engine | the engine no longer calling the helper | `expected 0 to be 1` |
| SYNC-04 (2) | the delay removed | `a tab switched away for under two minutes lost its socket` |
| SYNC-04 (2) | the whole handler made a no-op | `expected "vi.fn()" to be called 1 times, but got 0 times` |
| SYNC-04 (1) | resume reconnecting without the pull | `came back to a stale board` |
| SYNC-06 (2) | the whole row sent again | **`A's stale row reverted B's status: expected 'To Do' to be 'Done'`** |
| SYNC-06 (1) | reference comparison instead of value | `expected [ 'title', 'checklist' ] to not include 'checklist'` |
| SYNC-06 (1) | coalescing keeping the newest pre-edit row | `expected 'First' to be 'Second'` |

Three of these exist because the fix has an obvious wrong version:

- **Reference comparison.** `checklist`, `timeline`, `tags` and a scouting report's `data` are
  objects. `!==` calls every one of them changed on every edit, the diff becomes the whole row,
  and SYNC-06's fix quietly does nothing — green tests, defect intact. This is the single most
  likely way to get this wrong and the assertion is written for it specifically.
- **Newest-vs-earliest base on coalesce.** Three offline edits collapse to one queue entry;
  taking the newest pre-edit row measures the diff from one edit ago and silently drops the first
  two. SYNC-06 one layer down.
- **The drain's deadline resetting on every item.** Then a queue of items that all fail keeps
  extending its own budget and the run never ends.

---

## What running the app found that the tests did not

### SYNC-13's first three test drafts were wrong in ways that looked like the fix failing

Worth recording because it is the same trap three times and none of it was visible from reading:

1. `progressDeadline` reads its clock **at construction**, so every scripted sequence was off by
   one and the drain pushed one item more than the script said.
2. A Dexie `deleting` hook advancing a fake clock is absorbed by the `progress()` call that
   follows it, so "time passed" never landed where the test needed it.
3. **A version that passed with the fix reverted.** Refusals of 11 seconds between successes
   never spent the 30-second budget, because each success reset it — so the drain never stalled
   and the assertion about what a stall reports was never exercised. Caught only by the revert
   pass, which is the one thing that catches this.

### The type-escape ratchet counts comments

Two `as any` in a comment *explaining* the ratchet pushed the count over its ceiling. The comment
now describes the cast rather than quoting it. Small, and the sort of thing that costs twenty
minutes when the number is what a check is written against.

### The browser probe ran into B2 working correctly, and it was not obvious

The first attempt at the SYNC-06 browser check left `fetch` blocked long enough for the queued
edit to spend five retries and park in the dead-letter store, so the row never changed and the
probe looked like a failure of the fix. It was B2 doing its job. Pressing the indicator's own
**"Retry it"** put the change back on the queue and it pushed correctly — which incidentally
exercised the dead-letter recovery path end to end, on real data, for free.

---

## What was decided rather than built

- **SYNC-04's table trim.** Measured at **12 tables × 3 events = 36 bindings** per tab, not the
  24 the assessment counted — Sprint 18 added four entities. Dropping `seasons` would undo B22
  (season deletions reaching other devices is exactly what that bug was, and `REPLICA IDENTITY
  FULL` was added for it), and per-route subscription costs a WebSocket handshake per navigation
  on the worst connection in the product. The message quota is not under pressure — the
  assessment's own estimate is 375 k against 2 M. Parked with the number.
- **SYNC-06's `updated_at` precondition.** The assessment's "better" option. It needs a conflict
  path, a re-pull, a re-apply and a decision about what the user is shown; until that exists a
  failed precondition sends the work round the retry ladder into the dead-letter store, turning a
  silent field revert into a loud failure a coach cannot act on. Two people editing the **same**
  field remains last-write-wins, and that is stated in the code, in the tests and here.
- **SYNC-09's per-tab timestamp allocator.** Two tabs writing in the same millisecond can still
  tie. Ties can only happen between *different* records, because `queueForSync` coalesces per
  `(table, recordId)` against the shared Dexie queue. Seeding the allocator from the queue's
  maximum would put an async read inside `queueForSync`, which is precisely how B1 was
  reintroduced the second time. Written into `sync-lock.ts` so nobody "fixes" it later.

---

## Principle 3, worked out

The handoff asked for this explicitly. A partial update changes what could be meant by "pending"
for a row: only some of its fields are un-synced, so a pull could in principle take the server's
version of every other field.

**It is deliberately left alone.** What `getPendingRecordIds()` protects is the window between an
edit and its push. In that window the local row is the user's work in progress; letting a pull
write half of it would put something on screen that is partly theirs and partly the server's,
changing under them while they type — for a benefit measured in the seconds before the queue
drains, since the moment the push lands the id leaves the pending set and the next pull merges
everything anyway. The stale-field window closes by itself.

So the invariant is unchanged and exactly as strict as before: an id with anything queued is
skipped by the merge, whole. **B3 and B8 are green unmodified**, which is the evidence.

---

## Files

New: `src/lib/sync-lock.ts`, `src/lib/__tests__/sync-lock.test.ts` (5),
`src/lib/__tests__/sync-partial-update.db.test.ts` (7).
Changed: `src/lib/sync.ts`, `src/lib/timeout.ts`, `src/lib/offline-db.ts`, `src/lib/realtime.ts`,
seven slices, and four test files.

One parking-lot entry.
