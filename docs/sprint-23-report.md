# Sprint 23 — edits that are silently lost

**Branch:** `v2/sprint-23-lost-edits`
**Commits:** `d6d7080..172c568` (two), off `main` at `56d8800`
**Ratchets:** `as any` **55 → 55**, arbitrary Tailwind values **2 → 2**, `dark:text-slate-500`
**0**, no `describe.skip`, no assertion-free tests. Coverage **68.81 / 61.53 / 64.62 / 70.71**
against floors 68 / 60 / 63 / 70 (up on all four from Sprint 22's 68.64 / 61.41 / 64.25 / 70.51).

Three IDs: `FEAT-03`, `FEAT-04`, `FEAT-10`. No migration — every one of them is a client defect
sitting beside a server that was already correct.

---

## Gate

Stages run individually, per `HANDOFF_BUILD.md`. `npx supabase db reset --local` before each
database run.

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1086 passed**, 2 skipped (was 1074 — twelve new) |
| integration | **95 passed** |
| build | ok — precache 45 entries (1583.51 KiB) |
| `db:assert` | `schema assertions passed` |
| db | **645 passed** |
| RLS | **418 passed** |
| e2e | **36/36**, chromium + mobile |
| coverage | **128 files, 1826 passed**, thresholds met |

One failure during the sprint, caught by `tsc` rather than by a person: the new season-lifecycle
fixture used `eventType: 'meeting'` and `method: 'manual'`, neither of which is in the union
(`'team_meeting'` and `'coach'`), and omitted three required `Meeting` fields. Worth naming
because a fixture that does not typecheck is a fixture that does not represent the row — the same
shape as the mock-drift class, caught here only because these types are unions rather than
`string`.

---

## Exit criteria

**None of the three IDs has an exit-criteria block** — checked
`docs/assessment-2026-08/exit-criteria.md` by ID and by subject (`checklist`, `comment`,
`cascade`, `timeline`). **The criteria below are mine.**

### FEAT-03

> A comment typed into a not-yet-saved task is still there when the task is reopened, and it is
> ordered correctly against the "Task created" entry. A comment on a task that already exists
> still persists immediately. Nothing is written to the store for a task that does not exist yet.

Verified in the browser against a real build: typed a comment into a new task, saved, reopened
from the board — the comment is there and sits **above** "Task created" in the newest-first feed.
On the server: `jsonb_array_length(timeline)` = 2, newest `It has been slipping since Saturday.`,
oldest `Task created`.

### FEAT-04

> Ticking a checklist box and pressing Cancel leaves the store exactly as it was; pressing Save
> stores the tick. Editing an item's text behaves the same way.

Verified in the browser: ticked in the draft (`checked === true`), **unticked after Cancel and
reopen**, ticked after Save and reopen, and on the server
`checklist → [{"text": "Wiring checked", "completed": true}]`.

### FEAT-10

> Deleting a season removes its meetings and their attendance from local state as well as from
> the server, queues the child deletes before the parent's, and the confirm dialog names both.

Verified in the browser: deleted the seeded 2026-2027 season (17 meetings, 122 attendance rows)
and read the persisted store straight out of IndexedDB — **meetings 0, attendance 0, orphan
meetings 0**, one season left. Sync queue **0**, failures **0**, indicator "Live": the ordered
cascade drained end to end with no dead letters. The dialog's list reads exactly the seven lines.

---

## Red tests, each watched failing

| Test | Reverted | What it said |
|---|---|---|
| "does not tick the store's item … cancelled" | the `[...arr]; arr[i].completed =` mutation | `Cancel left the store ticked: expected true to be false` |
| "does not rewrite the store's item text … cancelled" | the same mutation for text | `expected 'Wiring checked TWICE' to be 'Wiring checked'` |
| "passes the comment to addTask" + "keeps more than one comment" | the `timeline` argument removed from `saveTask` | `addTask was given no timeline at all: expected undefined to be defined` |
| "keeps a timeline it was given, with 'Task created' LAST" | `addTask` ignoring `taskData.timeline` | `expected [ 'Task created' ] to deeply equal [ 'newer', 'older', 'Task created' ]` |
| …the same test | "Task created" placed **first** | `expected [ 'Task created', 'newer', 'older' ]` |
| "removes every record the server's ON DELETE CASCADE would" | meetings/attendance out of the cascade | `expected [ 'm1', 'm2' ] to deeply equal [ 'm2' ]` |
| "queues the attendance delete BEFORE its meeting's" | the same | `the attendance delete was never queued: expected -1 to be >= 0` |
| …the same test | the two cascade entries **swapped** | `expected 7 to be less than 6` |
| "names meetings and attendance among what will be destroyed" | the two `<li>`s removed | `expected [ 'All tasks', …(4) ] to deeply equal [ 'All tasks', …(6) ]` |

Three of these exist specifically so the fix cannot be half-done:

- **The swapped-order revert.** Adding both tables to the cascade in the wrong order still
  deletes everything locally and still passes the "removes every record" assertion. It fails only
  against the ordering test, and the ordering is what stops the drain erroring on a foreign key.
- **The "Task created" first/last revert.** Threading the timeline and putting the system entry at
  the front passes every assertion about the comment surviving.
- **"still saves the edit when Save is pressed"** and **"still persists a comment immediately on a
  task that already exists"**. A fix that made Cancel work by making Save stop working would pass
  every other assertion in the file.

---

## The fidelity that makes the FEAT-04 test mean anything

`App.tsx`'s route adapter hands `SprintPlanning`
`{...task, timeline: task.timeline.map(e => ({...e}))}` — a shallow copy of the task with a new
timeline array and **the store's own checklist array and item objects**. That sharing *is* the
defect: without it, mutating `newChecklist[idx]` would have touched nothing anybody could see.

So the test builds its prop the same way, deliberately, with a comment saying why. A fixture that
deep-cloned the task would pass against the mutating version, which is `docs/failure-modes.md` §2
in its usual form — a test satisfied by the state the defect also produces. This was the one
decision in the sprint worth thinking about; everything else followed from it.

The same applies in reverse to the FEAT-10 fixture, which carries a meeting **and** an attendance
row in the surviving season as well as the doomed one. A cascade that deleted everything would
pass an assertion that only checked the doomed rows were gone.

---

## What running the app added

Nothing was found by the browser this sprint that the tests had not already pinned — which is
worth stating plainly rather than leaving as an absence, because it is unusual here and it is not
evidence that the browser pass was unnecessary. Two of the three criteria are only *observable*
in a browser (a comment surviving a reopen; a tick surviving Cancel), and the FEAT-10 check read
the persisted IndexedDB blob rather than the store's in-memory copy, which is the thing that
actually outlives a reload and the thing the defect was about.

The one number that could not have come from a unit test: the real cascade queued and drained
**17 meetings and 122 attendance rows plus the season** with a queue depth of 0 and zero
failures afterwards. The fixture proves the order; only the app proves the drain survives it.

---

## Files

Changed: `src/components/SprintTaskDetail.tsx`, `src/components/SprintPlanning.tsx`,
`src/lib/slices/createTaskSlice.ts`, `src/lib/slices/createSeasonSlice.ts`,
`src/components/SeasonManager.tsx`.
Tests: `src/components/__tests__/task-draft-edits.test.tsx` (new, 8),
`src/lib/__tests__/store.test.ts` (+2), `src/lib/__tests__/season-lifecycle.test.ts` (+1 and a
widened fixture), `src/components/__tests__/SeasonManager.test.tsx` (+1).

9 files changed, 512 insertions, 22 deletions.

Nothing parked: every discovery this sprint was inside its own IDs.
