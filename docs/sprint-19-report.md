# Sprint 19 — accessibility (WALK-A-08, 09, 10, 11)

**Branch:** `v2/sprint-19-accessibility`
**Commits:** `c5d4d50..86cece7` (four)
**Gate:** `npm run gate:db` green on the branch at `86cece7` — one complete chained run: 1021
unit (+2 skipped), 95 integration, build, schema assertions, 626 db, 418 RLS. e2e 35/35.

**And a caveat that belongs in the headline rather than a footnote.** Later in the same session
`gate:db` began dying part-way through `test:db` with exit 127, at a different suite each time
and never on a failing test. **This is not a Sprint 19 regression — it reproduces on `1610c0f`,
the commit before the sprint**, in both Git Bash and PowerShell, with the containers healthy and
~4.5 GB of RAM free. The same command run directly as
`npx vitest run --config vitest.config.db.ts` completed 626 passed, exit 0. So the post-merge
verification of `main` is **stage by stage** rather than one chained run: lint + 1021 unit + 95
integration + build (repeatedly, green), `db:verify` schema assertions (green), 626 db (green,
exit 0), 418 RLS (green, exit 0). Both this and the fixture-leftover cascade it causes are in §8
with the numbers — a Gate that dies at a random point is indistinguishable from a Gate that found
something, and that is worth someone's time.
**Ratchets:** `as any` 56 (unchanged), arbitrary Tailwind values 2 (unchanged), no `describe.skip`,
no assertion-free tests. Two ratchets added, both at zero.

## Exit criteria

**Correcting this report's own first draft**, which said these four IDs have no exit-criteria
block. They do — `docs/assessment-2026-08/exit-criteria.md:158`, one bullet covering all four —
and it is the definition of done. Quoted in full, clause by clause, with how each was verified:

| Criterion (verbatim) | Verified |
|---|---|
| "axe (wcag2a/aa) on `/app/admin` and `/app/meetings` reports zero `select-name`/`button-name` violations" | **Met, and exceeded.** Zero on those two routes — and zero across **eight** routes plus the task modal, on `select-name`, `button-name` *and* `label`. Before: `select-name` ×14 on `/app/admin`, `button-name` ×1 on `/app/meetings`. `scripts/probe-accessibility.mjs`. |
| "the 2xs/xs slate-500-on-dark tokens pass 4.5:1" | **Met.** 3.07:1 → **5.70:1** (SEASON label), 2.52:1 → **8.08:1** (Tasks Done denominator), 4.03:1 → **6.97:1** (team badge), board card dates → **6.97:1**. Measured by axe on the built app in dark mode, not computed by hand. |
| "every interactive control on Admin/Meetings/Dashboard at 375 px is ≥ 32 px high" | **Met, and exceeded three ways.** Eight routes, not three; `min(width, height) ≥ 32` rather than height alone; and measured where `pointer: coarse` actually matches, which is the only place the number means anything (see below). **0 found.** |
| "`Modal` moves focus in, traps Tab, closes on Escape — one implementation used by every modal" | **Met.** One implementation in `src/components/ui/Modal.tsx`, fifteen call sites. 13 unit tests plus three real-browser checks. Two modals deliberately do not close on Escape, and the reason is in the criteria's own spirit rather than against it — see WALK-A-08 below. |

**What the criteria do not cover, where the definition of done is therefore mine:** the bullet's
heading names "wrapping" but the bullet itself does not, so **WALK-A-11 is measured against my own
definition** — an over-long title already stored renders wrapped and inside the 375px viewport,
new ones are capped at the input, the same cap exists in the database, and the two numbers cannot
drift apart silently. That definition is stated again in WALK-A-11's own section below, with the
evidence for each half.

---

## The thing worth reading first

**Sixty-four of WALK-A-10's 123 sub-32px controls were a measurement artefact, not a defect.**

`touch-target`, the app's 44px promise, is gated on `@media (pointer: coarse)`. A desktop
Chromium resized to 375px does **not** match that — it matches `fine`. The walkthrough measured
that way, and so did this sprint's probe on its first run. In a context where `pointer: coarse`
actually matches (`hasTouch: true, isMobile: true`), the same eight routes report 59, not 123.

The four sidebar controls WALK-A-10 names by number — sign-out 27×27, switch-team 27×27,
theme-toggle 31×31, feedback 31×31 — were already correct on a real phone the whole time. They
already carried `touch-target`; the media query was simply switched off in the harness that
measured them.

This is `docs/failure-modes.md` §11, a check bound to the wrong event, and it would have been
invisible in both directions: both runs produce a plausible-looking list of small boxes, and had
the fix been applied without noticing, the probe would have reported "no change" and the obvious
next move would have been an ungated rule that wrecks the desktop.

---

## WALK-A-08 — the modal keeps the promise its ARIA makes

**Criterion:** "`Modal` moves focus in, traps Tab, closes on Escape — one implementation used by
every modal." **Read strictly for this sprint as:** in a real browser, opening a modal puts focus inside it, Tab
cannot leave it, Escape closes the ones that should close and does not close the two that must
not, focus returns to whatever opened it, and all of that lives in one place for all fifteen
call sites.

| Criterion | How it was verified |
|---|---|
| Focus lands inside the dialog | `Modal.test.tsx` ×4, and `probe-accessibility.mjs` in Chromium: `focus is inside the dialog in a real browser, not on <body>` — PASS. The walkthrough measured `focusInDialog: false`. |
| It does **not** steal focus a modal already claimed | Test: `leaves focus alone when the modal has already claimed it`. `SprintTaskDetail` focuses the title input for a NEW task, which is why the walkthrough found the new-task path correct; an unconditional fix would have regressed the one path that worked. |
| Tab is trapped, both directions | Tests ×3, plus the real-browser `Tab keeps focus inside the dialog` — PASS. |
| Tab is **not** trapped mid-cycle | `does not interfere in the middle of the cycle`. A trap that fires on every Tab pins focus to one control, which is worse than no trap; that control test is what makes the two wrap tests mean something. |
| Escape closes | Test, plus real-browser `Escape closes the task modal` — PASS. |
| Escape does **not** close `ReAttestationPrompt` / `UnsyncedSignOutDialog` | `does nothing when the modal has no onClose`. `onClose` is optional and the default is not "close anyway"; making it required would have forced a no-op on those two, and a no-op named `onClose` reads as a bug. |
| Focus returns to the opener | `returns focus to whatever opened it`. |
| One implementation, fifteen call sites | `onClose` wired at 12 of 15; the other three are the two above plus `ConfirmDialog`'s own parent. |

**Watched red.** With the initial-focus effect disabled: **4 failed / 9 passed**. With the Tab
trap disabled: **3 failed / 10 passed**. Both restored from `git checkout HEAD --` after the
commit, never over uncommitted work.

**A real error the tests caught.** The first implementation used capture-phase +
`stopPropagation` to stop a stacked `ConfirmDialog` from also closing the modal underneath it.
That does not work: both handlers are on the **same node** (`document`), and `stopPropagation`
does not stop other listeners on the node it fires on. One Escape closed both — the user presses
a key once and loses two screens. The stacked-dialog test went red and a module-level
`modalStack` keyed on `useId` answers "am I the innermost?" explicitly instead.

**Deliberately not done.** No backdrop-click dismiss, which a first draft had. `jsx-a11y` refuses
a click handler on a non-interactive element and is right, but the deciding reason is that most
modals here are forms: a mis-click beside the scouting dialog would discard a report a scout just
typed at a venue, with no undo. Escape is the dismissal and every modal also has a visible Cancel.

**jsdom's limits, stated rather than papered over.** `offsetParent` is always null in jsdom, and
the focusable filter uses it, so the test file polyfills it — without which every test there
would pass for the wrong reason. That polyfill is a stand-in for a browser, which is exactly what
§2 warns about, so the three behaviours are *also* measured in Chromium by the probe.

---

## WALK-A-09 — controls with no name, and text nobody could read

**Criterion:** "axe (wcag2a/aa) on `/app/admin` and `/app/meetings` reports zero `select-name`/
`button-name` violations; the 2xs/xs slate-500-on-dark tokens pass 4.5:1." **Widened for this
sprint to:** axe-core (wcag2a + wcag2aa) reports zero `select-name`,
`button-name`, `label` and `color-contrast` violations across every app route **in dark mode**,
including the task modal open, which the walkthrough explicitly could not reach.

**Result: 24 contrast nodes and 15 nameless controls before, zero after, across nine scans.**
(Seven parked nodes excluded — see below.)

| Criterion | How it was verified |
|---|---|
| 14 × `select-name` on `/app/admin` | Gone. `aria-label={\`Role for ${getDisplayName(member)}\`}` — not a bare "Role", because fourteen identical names satisfy the rule and still leave a screen-reader user unable to tell which member they are demoting. |
| 1 × `button-name` on `/app/meetings` | Gone. `aria-labelledby` pointing at the visible label span. |
| 3.07:1 "SEASON" label | Now `text-slate-400` on `#1e293b` = **5.70:1**. |
| 2.52:1 "Tasks Done" denominator | Now `dark:text-slate-300` on `#2b374b` = **8.08:1**. |
| 4.03:1 initials badge | Now `dark:text-slate-300` on `#334155` = **6.97:1**. |
| Board card dates | Now `dark:text-slate-300` on `slate-700` = **6.97:1**. |
| The task modal's five unnamed selects | `htmlFor`/`id` pairs from a `useId` prefix (`useId`, not `task.id` — a new task has no id until saved). Verified by the first axe scan of that modal in this project's history: **0 owned violations**. |
| Dark mode is what was measured | The probe asserts `documentElement.classList.contains('dark')` before scanning. A persisted light-mode preference would have made every measurement pass for the wrong reason — slate-500 on white is fine. |

**The shape of the contrast bug.** All five sites were written `text-slate-400 dark:text-slate-500`
— dimmer text on a dimmer ground, which reads as the careful choice and inverts the requirement:
a dark ground needs *lighter* muted text. Same shape as the Toggle's
`aria-label={showLabel ? undefined : label}`: don't repeat a name the user can already see, except
the visible text was a sibling `<span>` and nothing associated the two, so the switch had **no
accessible name at all**.

**Ratchet added, at zero.** `dark:text-slate-500` measures 3.07:1 on slate-800, 2.52:1 on
slate-700/60 and 2.18:1 on slate-700 — it needs no knowledge of the ground to judge, because
there is no dark ground in this app on which it is legible. **Watched red**: reintroducing one of
the five sites fails `has no dark:text-slate-500...`, 1 failed / 22 passed.

**A defect the probe found that nothing else had.** The new-event date input added in Sprint 18
has no label, and a `type="date"` has no placeholder to fall back on. The Gate was green for it
twice. Fixed with `aria-label="Event date"`.

---

## WALK-A-10 — a 32px floor under every control, on touch devices only

**Criterion:** "every interactive control on Admin/Meetings/Dashboard at 375 px is ≥ 32 px high."
**Widened for this sprint to:** at 375px **with `pointer: coarse` matching**, no interactive
element renders below 32px on any app route, no horizontal overflow appears, and the desktop
keeps its compact controls.

**Result: 0 under 32px across eight routes; 0 horizontal overflow; 51 controls still compact on
the desktop.** 12/12 probe checks.

Measured progression: **123 → 59** (correcting the pointer emulation) **→ 15** (one CSS rule)
**→ 0** (the inline links `min-height` cannot reach).

**One rule, not twenty paddings.** `index.css` already carries a long note about the broad rule
that used to live there and had to go. Two things make this a different rule rather than the same
mistake at a smaller number:

- It selects **elements**, not class substrings. The old rule matched `button[class*="p-"]` and
  could not tell a utility from a coincidence — `p-` matched `placeholder-slate-400`, `bg-`
  matched `bg-transparent` — so it hit essentially everything.
- It sets **min-height only**. The old rule forced 44px of *width* too, which is what squashed the
  sprint board's row actions and produced the "blown up" density Sprint 5 was fixing.

**32, not 44,** because `touch-target` still means 44 and is still opt-in for primary actions;
`index.css` is explicit that a segmented control or a row's inline delete should stay small, and
44 everywhere would overrule that. A floor and a target say different things and both are wanted.

**Two defects introduced and caught, both by looking rather than by testing:**

1. The floor matched `[role="switch"]` and stretched the meetings toggle's **track** to 32px,
   leaving its 16px knob adrift — the knob is absolutely positioned from the content box, and the
   component's own comment says the 36/16/2 arithmetic only works if all three move together.
   Caught in a screenshot at 375px. Fixed by separating the boxes: the button is a transparent hit
   area free to grow, the track is an inner span pinned at 36×20. Now asserted: **hit 36×32, track
   36×20**.
2. Forcing checkboxes to 32×32 produced a white square dwarfing its 12px label. It was also
   answering a question nobody asked — **every checkbox in this app is wrapped in its label**, so
   the label is the control and the planner's rows were always ~40px tall. The 13×13 in the
   finding is a measurement of the wrong box (§9, record identity, with a bounding box for a
   record). Checkboxes are excluded from the rule and left at their natural size; the probe now
   measures a wrapped input's label.

**The half with no advocate.** "It is gated on `pointer: coarse`" is a claim about a media query,
and this repo has been wrong about one before — the `tall:` breakpoint in tailwind.config that
compiled to no rule at all. So the probe goes back to the `pointer: fine` context and **requires**
the small controls to still be small there. If that check ever passes with zero, the floor has
leaked and every row action in the app just grew, which would look like a successful accessibility
fix and be a density regression.

---

## WALK-A-11 — titles that wrap, and a limit that exists in both places

**No criterion covers this** — the exit-criteria bullet's heading says "wrapping" and its text does
not — so the definition of done here is **mine**: an over-long title already stored renders wrapped and inside the
375px viewport; new ones are capped at the input; the same cap exists in the database; and the two
numbers cannot drift apart silently.

**Result: 8/8 probe checks.**

| Criterion | How it was verified |
|---|---|
| The meeting detail header wraps | Probe, 109 unbroken characters at 375px: box 343 wide (was **1331**), right edge 355 of 375, 112px tall over four lines. |
| It **wrapped** rather than being clipped | Height > 1.5 × line-height. `overflow: hidden` would satisfy the first two checks while making the title unreadable — a different bug wearing the same green tick. |
| The scouting team number | Already closed by WALK-A-06 (`561ddf7`) — and measured rather than asserted: a 40-character number planted through the service key (the shape of a row stored before that cap, and the only shape the cap cannot reach) renders 226/226, right edge 251 of 375. |
| New titles are capped | `maxLength={TITLE_MAX_LENGTH}` on six title/name inputs. Probe types 400 characters into the meeting title: **120 got in**. |
| The database enforces it too | Migration `20260827000000`, CHECK on all eight `title`/`name` columns in the schema. |
| The two numbers agree | `src/test/__tests__/title-length-limits.test.ts`, 16 tests. |

**`break-words` alone did nothing, and the probe is the only reason that is known.** With the
class applied the `h1` still measured **1331px wide inside a 375px viewport**. A flex item
defaults to `min-width: auto` — "never shrink below your content" — so the box grew to fit the
unbroken word and `overflow-wrap` was never consulted: it breaks text that has run out of room,
and this text never did. Both the `h1` and the flex row above it need `min-w-0`. Had this shipped
on the strength of the class name, the finding would have been closed and unfixed.

**The constraint, verified against real Postgres rather than asserted:**

- 121 characters → refused (`check_violation`)
- 120 → accepted
- 120 + trailing spaces → accepted, because `btrim` runs first
- 120 emoji → accepted; `char_length` counts **code points** where JS counts 240 UTF-16 units, so
  the client is always the *stricter* of the two and the database never refuses what the client
  allowed. That direction is the safe one: the user is told at the keyboard, not by a failed sync.

**The migration's fail-loud guard, tested by making it fire.** A 132-character row was planted
with the constraint dropped; re-running the migration produced
`WALK-A-11: rows exceed the 120-character title limit and must be shortened by hand first:
sub_teams.name (1 rows, longest 132)` and altered nothing. `ADD CONSTRAINT`'s own error stops at
the first violating table, which is the least useful moment to learn production has more.

**The whole migration also replays from scratch:** `gate:db` reset the local database, and after
`supabase db reset` + `seed:review` all eight constraints are present — a stronger check than the
manual application.

**Watched red, twice.** `TITLE_MAX_LENGTH` set to 100: 1 failed / 15 passed. One `ALTER TABLE`
removed from the migration: 2 failed / 14 passed. The test reads the **CHECK expressions**, not
the digits anywhere in the file — the header comment says 120 too, and a check satisfied by its
own documentation is this repo's most-repeated test defect.

---

## Parked to §8, not fixed

**White on `forge-600` is 3.55:1** — a wcag2aa `color-contrast` failure on the **primary action
button of every screen**, and by node count the most repeated contrast failure in the app (7 of
the scans hit it). `forge-700` (`#c2410c`) would measure **5.18:1**.

Not fixed here for two reasons. It is not among the three ratios WALK-A-09's evidence names, so
it is a new discovery and belongs in §8 under the sprint rules. And it is the brand orange
(CLAUDE.md principle 8), which makes it a design decision rather than an accessibility chore.

The probe prints it every run, keyed on **the measured colour pair** rather than the rule id — so
parking the button cannot also park the secondary-text failures this sprint owns, which share the
rule id `color-contrast` and nothing else.

---

## What the harness caught in this sprint's own work

Worth recording, because the standing claim in CLAUDE.md is that the suite has never caught a
defect that reached a user — these did not reach a user, but they were real:

- The stacked-dialog test caught the `stopPropagation` error described under WALK-A-08.
- The `dark:text-slate-500` ratchet went red when a fix was reverted, as designed.
- The **swallowed-Playwright-action ratchet** refused `probe-long-titles.mjs`'s
  `.click()` with an empty catch, and was right: a swallowed click turns "the button moved" into
  "the input has no cap". It then matched the same pattern **inside the comment explaining the
  fix** — the repo's own most-repeated defect, a check reading its own prose. Both fixed.
- Two defects the harness could *not* catch — the stretched switch track and the 32px checkbox —
  were both found by opening a screenshot.

## Files

**New:** `scripts/probe-accessibility.mjs`, `scripts/probe-long-titles.mjs`,
`src/lib/text-limits.ts`, `src/components/__tests__/Modal.test.tsx`,
`src/test/__tests__/title-length-limits.test.ts`,
`supabase/migrations/20260827000000_title_length_limits.sql`.

**Changed:** `src/components/ui/Modal.tsx`, `src/index.css`,
`src/components/meetings/{Toggle,EventManager,EventDetail,EventFormModal}.tsx`,
`src/components/{MemberManager,Sidebar,SprintBoard,SprintTaskDetail,SubTeamManager,MatchPlanner,SeasonManager,InviteManager,PreMatchChecklist,ScoutingReports,ConfirmDialog,ParkedChangesDialog}.tsx`,
`src/components/events/{CompetitionEvents,SchedulePasteImport}.tsx`,
`src/components/guardian/AddChildDialog.tsx`,
`src/test/__tests__/harness-invariants.test.ts`.
