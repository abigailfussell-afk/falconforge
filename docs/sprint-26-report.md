# Sprint 26 — scouting that answers questions

**Branch:** `v2/sprint-26-scouting`
**Commits:** `0d6e07d..774b3f3` (two), off `main` at `7f5c3f7`
**Ratchets:** `as any` **54 → 54**, arbitrary Tailwind values **2 → 2**, `dark:text-slate-500`
**0** (one was introduced and caught by the ratchet — see below), no `describe.skip`, no
assertion-free tests. Coverage **69.53 / 62.10 / 65.34 / 71.35** against floors 68 / 60 / 63 / 70.

One ID: `P-02` minimal set, which is also `FEAT-15` — the handoff is right that they are the same
work. One migration, two nullable columns, `db:types` regenerated.

---

## Gate

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1136 passed**, 2 skipped (was 1101 — 35 new) |
| integration | **99 passed** |
| build | ok |
| `db:assert` | `schema assertions passed` |
| db | **667 passed** (was 661 — six new) |
| RLS | **418 passed** |
| e2e | **40/40** on the second run; see the intermittent below |
| coverage | **135 files, 1905 passed**, thresholds met |

**One intermittent, recorded rather than re-run until quiet.** The first full e2e run failed
`meetings.spec.ts:333 — a code the server has not seen yet is not blamed on the student`. It
passed alone (9/9) and 40/40 on the next full run. That is Sprint 18's diagnosed route-guard
intermittent — a redirect that discards intent on the confirmation path, measured then at about
1 run in 24 — and the one-line fix is still in the parking lot.

---

## The finding that had nothing to do with scouting

**The unit and integration suites have been talking to the production database.**

Vite loads `.env.local` in every mode including `test`, and `.env.local` in this repo points at
the live project. So `src/lib/supabase.ts` built a real client against
`https://<prod>.supabase.co` in every unit and integration run, and the sync tests pushed queued
writes to it. `setup-integration.ts`'s own docblock states the opposite in so many words:

> Without a global mock, `@/lib/supabase` resolves for real and both clients are `null` (no
> VITE_ credentials in the test environment)

**Measured, not assumed: nothing landed.** Every write was refused by RLS, because the client
carries no session. Production, read read-only today: **0 scouting reports, 2 tasks**, none
matching any test fixture. A near miss — and the third time `docs/environment-divergences.md` §2
has recorded this exact class, the first time as the test suite rather than a script.

**How it surfaced is the part worth keeping.** This sprint adds two columns to
`scouting_reports`. A push that used to be refused by RLS (`42501`, retryable, item stays queued)
started being refused as `PGRST204 — Could not find the 'alliance' column of 'scouting_reports'
in the schema cache`, which the classifier correctly treats as terminal. A sign-out test that
expected a re-queued change found a parked one. The suite had noticed the schema of a database it
should never have been able to reach.

Both configs now empty `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` explicitly — which is the
rule §2 already states, applied to the two runners that had no such line. Emptied rather than
pointed at the local stack on purpose: a unit test that reaches a server is a db test in the
wrong file. `src/test/db/setup.ts` stubs the same two variables the other way, at the local
stack, deliberately and with a comment; the new invariant asserts both halves so the pair reads
as one decision.

---

## Exit criteria

P-02 **has** an exit-criteria block (`exit-criteria.md:110`), so these are quoted rather than
written by me.

> Scouting page has a team summary table (one row per team number, columns from
> `scoring.metrics`, sortable)

Verified in the browser: four reports entered through the real form produced three rows, ordered
**9, 8412, 30727** — numerically, so 9 comes before 8412. Columns are the four DECODE metrics.
First click on "Auto score" sorted **30727, 9, 8412** (30, 12, 5) and the second reversed it;
`aria-sort` read `descending` then `ascending`.

Team 30727's cell read **`30±10.0`** — the mean of a 40 and a 20 entered by hand, with the
population σ beside it. Nothing in the component knows what DECODE is.

> and a team detail listing that team's reports

Verified: clicking **#30727** opened "Team #30727 — 2 reports" listing `Match 2 · Blue 2 · League
Meet 1 · Auto score 20` and `Match 1 · Red 1 · League Meet 1 · Auto score 40`, newest first, each
a real button that reopens the report.

> the form has match #, alliance colour and station

Verified end to end. Match # already existed; alliance and station are new `select`s with a blank
first option, and the station list is `match.allianceSize` long so FRC's third needs no code.
Server-side afterwards: `30727|1|red|1`, `30727|2|blue|2`, `8412|1|blue|1`, `9|3|||` — the last
being the "not noted" case, which is the commonest and must never be refused.

> CSV export of the current event's reports downloads with one row per report

Verified by intercepting the download in the browser: a 16-column header, four rows, the correct
filename `scouting-all-events-2026-08-24.csv`. Held by an e2e spec that reads the downloaded
file's bytes rather than trusting the click.

> Works offline (table computed client-side from the store)

Verified with `fetch` rejecting everything and `navigator.onLine` false, after a route change:
the table still rendered all three rows and `30±10.0`, the detail still opened, and the export
still produced a five-line file. Both are pure client-side computations over the rehydrated
store, which is why.

> **Red tests:** metric aggregation unit tests (mean/max/σ) and a component test for sort.

Both, plus more: `scouting-metrics.test.ts` (17), `TeamSummaryTable.test.tsx` (8),
`scouting-csv.test.ts` (10), `scouting-position.db.test.ts` (6).

**The trap the criterion does not name**, and the one this ID could most easily have got wrong: a
migration for `kind` as well. `kind` is for pit scouting, which is not in the minimal set, so it
is not here.

---

## Red tests, each watched failing

| Test | Reverted | What it said |
|---|---|---|
| sort (3) | nulls sorted as zero (`(av ?? 0) - (bv ?? 0)`) | `expected [ '11', '10', '9' ] to deeply equal [ '10', '9', '11' ]` |
| metrics + sort (5) | `Number(raw) \|\| 0` instead of a null | `is NULL for anything that is not a number, never 0` |
| sort (3) | a metric column starting ascending | `expected [ '10', '9', '11' ] to deeply equal [ '9', '10', '11' ]` |
| db (2) | either CHECK constraint dropped | `23514` with the constraint named |
| harness (2) | the config value restored to `process.env.VITE_SUPABASE_URL` | `vitest.config.ts does not empty VITE_SUPABASE_URL, so the suite inherits .env.local` |

The three that exist because the fix has an obvious wrong version:

- **Nulls as zero.** The naive comparator. It puts a team nobody has scouted at the top of an
  ascending "best auto score" list — telling a lead that an unmeasured team is the worst at
  something, on the screen they pick alliance partners from. `docs/failure-modes.md` §4.
- **`Number(x) || 0`.** The idiom that produced B18's five fabricated zeroes in production
  scouting data. A mean with a phantom zero in it halves a team's rating because somebody left a
  box empty.
- **Ascending first.** Cosmetic-looking and not: making a lead click twice for "who scores most"
  is the small indignity that sends people back to the spreadsheet this feature exists to
  replace.

---

## What the tooling caught, and what it did not

**Caught by a ratchet:** the σ suffix was written `text-slate-400 dark:text-slate-500`, and the
`dark:text-slate-500` ratchet (added Sprint 19, ceiling 0) failed the build. That token measures
2.18–3.07:1 on this app's three dark grounds. It is the second time in two sprints a ratchet has
caught this sprint's own new code.

**Not caught by anything until it was measured:** the tap-target assertion in the new e2e spec.
It read 32 px in the browser pane and 30 px under Playwright's `chromium` project at the same
375 px width, because `touch-target`'s floor is gated on `@media (pointer: coarse)` and only the
`mobile` project emulates touch. That is WALK-A-10's own recorded artefact — 64 of its 123
"too small" controls were a fine-pointer browser resized to 375 px — met from the other
direction. The assertion now asks the page `matchMedia('(pointer: coarse)').matches` rather than
inferring a pointer from a width.

---

## The behaviour change, stated plainly

**The scouting page opens on the summary, not the cards.** "Who is good at what" is the question
somebody opening a scouting page has; forty cards do not answer it. The cards are one tap away
and every entry path is unchanged.

That means **12 existing unit tests and one e2e spec now switch to the cards view first**. Each
still asserts exactly what it asserted, on the same markup; the change is which view they open,
stated once in a `renderCards()` helper rather than spread through them. The card grid is a
conditional render rather than `display: none`, because a hidden grid keeps every card in the
accessibility tree — a screen reader would read the season twice, and every `getByText` in the
suite becomes ambiguous, which is how this was written first and what the failures said.

---

## Files

New: `src/lib/scouting-metrics.ts`, `src/lib/scouting-csv.ts`,
`src/components/scouting/TeamSummaryTable.tsx`,
`supabase/migrations/20260901000000_p02_alliance_and_station.sql`,
`e2e/scouting-summary.spec.ts`, and four test files.
Changed: `src/components/ScoutingReports.tsx`, `src/types.ts`, `src/lib/entity-registry.ts`,
`vitest.config.ts`, `vitest.config.integration.ts`, `src/lib/database.types.ts`.

Two parking-lot entries.
