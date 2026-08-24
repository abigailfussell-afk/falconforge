# Sprint 27 — consistency and dead code

**Branch:** `v2/sprint-27-consistency`
**Commits:** `738748e..` (two), off `main` at `de48182`
**Ratchets:** `as any` **54 → 51, and the ceiling lowered from 55 to 51** — three removed by
FEAT-06's deletion, and the gain locked in rather than left as headroom. Arbitrary Tailwind
values **2 → 2**, `dark:text-slate-500` **0**, no `describe.skip`, no assertion-free tests.
Coverage **69.56 / 62.14 / 65.43 / 71.38** against floors 68 / 60 / 63 / 70.

Four IDs: `FEAT-06`, `FEAT-07`, `FEAT-09`, `FEAT-13` (dead-field half only). One migration.

Each ID had a scoping trap where the assessment's fix direction points at deferred work. All four
are taken the way the handoff scoped them, and the report says so per ID.

---

## Gate

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1148 passed**, 2 skipped (was 1136 — twelve new) |
| integration | **99 passed** |
| build | ok — precache **46 entries, 1558.09 KiB** (was 1583.05; d3 is 25 KiB of it) |
| `db:assert` | `schema assertions passed` |
| db | **667 passed** |
| RLS | **418 passed** |
| e2e | **40/40** |
| coverage | **137 files, 1914 passed**, thresholds met |

No intermittents.

---

## Exit criteria

None of the four has an exit-criteria block. **The criteria below are mine**, and each names the
deferred work it does *not* do.

### FEAT-06 — the dead d3 drag behaviour

> No code remains that binds behaviour to an element the app never renders, and the Match Planner
> still draws.

**Deleted, not implemented.** The assessment offered "delete, or implement game-piece tokens from
the game definition"; the second is P-01 phase M and is not scheduled, and code kept against an
unscheduled feature is `docs/failure-modes.md` §7 pointing the other way — a door with no gate.

What went with it, none of which was obvious from the finding: **d3 itself**. The dead effect was
the only `import * as d3` in the codebase, so the dependency, `@types/d3`, and the `charts`
manualChunk `vite.config.ts` was carving out for it all went too. Precache **1583.05 → 1558.09
KiB**. And two more casts: `(svg as any).setPointerCapture` did not need one.

Verified in the browser: the planner renders and a synthetic pointer stroke produces three
`<path>` elements.

### FEAT-07 — the help page describes the board that exists

> The help page does not promise drag-and-drop, and a ratchet fails if it ever does again.

*"Drag a card as the work moves"* is now *"Open a card and change its status as the work moves."*
Verified in the browser: the sentence reads correctly and no occurrence of "drag" survives
anywhere on the page.

**Two ratchets, not one.** The second asserts that no DnD dependency exists — so that if somebody
adds drag-and-drop, the failure says *"this ratchet should go"* rather than sending the next
person to delete a word from a sentence that has become accurate. A ratchet that outlives its
reason is how a check quietly becomes an obstacle.

### FEAT-09 — one definition of progress

> The sidebar and the dashboard show the same number for the same question, and archiving a
> finished task does not make either of them go backwards.

**Done standalone**, as the handoff directs — the fix direction says "fold into the sprint-entity
work", which is P-03 and deferred.

The dashboard's definition won. "How much of this sprint is done" is a question about the work
*in* the sprint: Backlog is the pile the sprint is drawn from (counting it makes a team that
plans ahead look behind), and archived work is finished and filed (counting it makes tidying up
look like regress, which is the reported defect).

Verified in the browser against a real build — this is the measurement the whole ID is about:

| | sidebar | dashboard |
|---|---|---|
| three tasks: two Done, one To Do | **2/3** | **2 / 3** |
| after archiving one Done task | **1/2** | **1 / 2** |

Before this change the sidebar would have read 1/3 and the dashboard 1/2, on the same screen,
from the same click.

### FEAT-13 — the dead `tags` field

> `Task.tags` is gone from the type, the transform and the schema, and nothing anywhere writes or
> reads it.

**Only the dead-field half is in scope.** FEAT-13's fix direction is entirely "section 4", which
is P-03's sprint entity; that is not built and is not started.

`tags` was written as `[]` by the task modal, threaded through `addTask`, round-tripped by the
registry in both directions, and stored in a NOT NULL `text[]` with a `'{}'` default — with no
tag input, filter or display anywhere. Removed from `types.ts`, the registry, `SprintPlanning`,
**22 test fixtures across 18 files**, and the column dropped.

**Measured before dropping**, because "nothing has ever written it" is a claim about data and not
about code: production, read read-only, has 2 tasks and **0** with a non-empty `tags`.

The column is dropped rather than left. A nullable column costs nothing to keep, and that is
exactly the argument that leaves a schema full of things nobody can explain — the client stops
sending it in the same change, so keeping it would mean a NOT NULL column holding only its
default, for a feature nobody has asked for.

---

## Red tests, each watched failing

| Test | Reverted | What it said |
|---|---|---|
| progress agreement | the sidebar back on `done / tasks.length` | `the sidebar counts Backlog or Archived: expected '2/5' to be '2/3'` |
| sprint-progress (5) | Backlog and Archived added to the in-sprint list | 5 red |
| help-page ratchet | "Drag a card" restored | `expected [ 'Drag' ] to deeply equal []` |
| DnD-dependency ratchet | `@dnd-kit/core` added to package.json | `expected [ '@dnd-kit/core' ] to deeply equal []` |

The progress-agreement test renders the **whole app** and reads both numbers, rather than
asserting the selector twice. A shared selector that only one of the two call sites uses would
pass every assertion in `sprint-progress.test.ts` — and principle 9's own lesson is that the
divergence is only ever visible to somebody looking at two screens at once.

---

## The environment trap, met in practice

`git checkout package.json`, used to undo a deliberate test edit, **silently destroyed the d3
removal** — it restores from the *index*, not from HEAD, and `package.json` had not been staged.
`HANDOFF_BUILD.md` lists this exact trap with the note that it has destroyed uncommitted work
four times in this project. This is the fifth, and it cost about two minutes only because the
missing change was one grep away.

Worth recording because the warning did not prevent it: the trap is not "do not use `git
checkout`" but "`git checkout <file>` means something different from what it looks like". The
practical rule that would have worked is the one the handoff already gives — stage or copy first.

---

## Files

New: `src/lib/sprint-progress.ts`, `src/lib/__tests__/sprint-progress.test.ts` (5),
`src/components/__tests__/progress-agreement.test.tsx` (2),
`supabase/migrations/20260902000000_feat13_drop_task_tags.sql`.

Changed: `src/components/MatchPlanner.tsx`, `src/components/Sidebar.tsx`,
`src/components/DashboardHome.tsx`, `src/components/SprintPlanning.tsx`,
`src/pages/GettingStarted.tsx`, `src/types.ts`, `src/lib/entity-registry.ts`,
`src/test/__tests__/harness-invariants.test.ts`, `vite.config.ts`, `package.json`, and 18 test
files whose fixtures carried `tags`.

Removed: the `d3` and `@types/d3` dependencies.

No parking-lot entries: every discovery this sprint was inside its own IDs.
