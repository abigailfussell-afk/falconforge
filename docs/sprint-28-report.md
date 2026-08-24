# Sprint 28 — the Training UI stub (D5)

**Branch:** `v2/sprint-28-training-stub`, off `main` at `59507fe`
**Ratchets:** `as any` **51 → 51** (at its ceiling), arbitrary Tailwind values **2 → 2**,
`dark:text-slate-500` **0**, no `describe.skip`, no assertion-free tests. Coverage **69.89 /
62.47 / 65.97 / 71.69** against floors 68 / 60 / 63 / 70.

One decision, no IDs: D5, answered as a split on 2026-08-23 — *content deferred, presentation
not*. **No migration**, which is the decision's own boundary and the line this sprint was
scoped by.

---

## Gate

| Stage | Result |
|---|---|
| lint | clean |
| unit | **1182 passed**, 2 skipped (was 1148 — thirty-four new) |
| integration | **99 passed** |
| build | ok — precache **52 entries, 1581.79 KiB** (was 46 / 1558.09) |
| e2e | **40/40** |
| coverage | **1948 passed**, thresholds met |

`supabase/` untouched, so `gate` rather than `gate:db`. No intermittents.

The three Training chunks are **6.4 + 3.7 + 4.1 KB** raw, lazily loaded like every other route.
The outline itself is a few kilobytes of the shared bundle; the precache grew **23.70 KiB**,
which is what a stub with no media should cost.

---

## Exit criteria

**D5 has no exit-criteria block** — `docs/assessment-2026-08/exit-criteria.md` mentions neither
D5 nor P-06. **The five criteria below are mine**, written from the decision's own words before
any code, and each is quoted with how it was checked.

### 1. Reachable, by the person the feature exists for

> Training is one nav entry, visible to everybody on a team, and all three screens are real
> deep-linkable routes.

`APP_VIEWS` gains `training` with `inNav: true` and no capability gate, so the rail, the drawer
and the route table all get it from the one definition. Three routes: `/app/training`,
`/app/training/:trackId`, `/app/training/:trackId/:lessonId`.

Checked in the browser on a `--mode development` build (127.0.0.1:54321 in the bundle,
`supabase.co` absent), signed in against the seeded local team: the nav entry renders once, and
each of the three URLs loads directly from the address bar.

### 2. The structure is on screen, and complete enough to judge

> A person can see what a track is, what a lesson is, and everything a lesson carries —
> objective, hands-on task, what comes first, the checkpoint and who verifies it.

Eight tracks; a lesson carries `objective`, `handsOn`, `prereqIds`, `minutes`, a `checkpoint`
with one of five verifiers, whether the **team** writes it, whether it is rewritten every season,
and whether it **gates build work**. Prerequisites are chips that link, including across tracks.

The eleven outlined lessons are Tracks A and B transcribed from section 2.1 of
`training-onboarding-design.md` — chosen because between them they use **all five verifiers**, a
team-authored lesson (A2), a game-specific one (A4), a build gate (B1), a prerequisite chain
(A2 → A6 → A7), and two lessons with no hands-on task at all. Every shape the screens must
render has an instance.

### 3. Student and mentor, from the rule that already exists

> The two sides see the same outline and a different checkpoint, and the difference comes from
> the app's existing role rule rather than a second one invented here.

A student is asked to **ask for a sign-off**; a mentor or coach is offered **sign off**, plus a
"who has done this" panel on the lesson and a sign-off queue on the index. A quiz or an
automatic checkpoint reads identically to both, because it is the same event whoever is looking.

The predicate moved to `src/lib/roles.ts` and `AppShell`'s `canManageMeetings` now calls it, so
there is one spelling of "admin, coach or mentor" rather than two. The **names** stay separate:
they coincide today and are not the same question, and P-06's `can_sign_off` is where they part.

Measured in the browser both ways, by changing the role in the local database and reloading:

| | index | lesson B1 |
|---|---|---|
| `role = 'admin'` | sign-off queue present | **Sign off**, "Who has done this" |
| `role = 'student'` | no queue | **Ask for a sign-off**, no panel |

### 4. Empty states for what is actually true

> The screens are designed for the case that holds today — six of the eight tracks unwritten and
> no progress recorded anywhere — and no screen implies otherwise.

Every Training screen carries one banner: *"Training is a preview. The outline below is settled;
the lessons themselves are not written yet, and nothing on these pages records progress or
sign-offs."* It is on all three screens rather than only the index, because the lesson pages are
the ones a mentor sends as a link.

An un-outlined track says how many lessons it is waiting for — *"10 lessons are planned for
Mechanical"* — rather than "no lessons", because the second is a claim about the design and the
first is the truth. The index leads with **11 of 61 lessons outlined**. `trackSummary` returns
`minutes: null` rather than `0` for an un-outlined track for the same reason: "0 minutes of
training" is a statement about material that does not exist.

### 5. Nothing the decision put out of scope

> No migration, no authoring tools, no progress persistence, no content pipeline.

None of the four. `supabase/` is untouched; there is no editor anywhere; no store slice, no
persisted key, no queued write, no new entity; the outline is a TypeScript module, not a build
step over markdown.

**A local-only progress key was considered and rejected.** The store already persists to
IndexedDB, so "mark this lesson complete" would have cost about ten lines and made the stub feel
real. It is wrong twice: it is a second data path for something that must end up as a synced
entity (principle 3 — progress belongs in `member_progress`, which is a table, which is a
migration), and a tick a student can see that their mentor cannot is worse than no tick. The
checkpoint control is therefore rendered and **disabled**, with the reason under it, rather than
hidden — hiding it would answer D5's "how is progress recorded" with an absence.

---

## The defect found by running it

**The archived-season banner followed Training.** With the seeded season archived, the Training
page showed two amber banners stacked: the stub notice, and above it *"2026-2027 Season is
archived — read only"* — on the one view in the app that a season never touches. Training is
supposed to be open in the off-season; that is the whole reason it carries no season
precondition.

`ArchivedSeasonBanner`'s own docblock explains the cause: *"Every view is season-scoped, so
every view needs this state."* True when it was written. It stopped being true when `help`,
`profile` and the guardian view arrived, and Training made it visible.

Fixed on the view definition rather than in the banner: `AppView` gains `seasonFree`, the four
views that read no season carry it, and `pathShowsSeasonBanner()` asks the array — the same
construction as `pathNeedsTeam`, and for the same reason (`docs/failure-modes.md` section 12: a
hand-kept list that must track another list drifts). `help`, `profile` and `guardian` are
included because the rule is about whether a view reads a season, and a Training-only exception
would have been the second rule this repo keeps having to delete.

Verified in the browser with the season genuinely archived in Postgres:

| path | banner |
|---|---|
| `/app/training`, `/app/training/safety/B1` | **absent** |
| `/app/help`, `/app/profile` | **absent** |
| `/app/board`, `/app/dashboard`, `/app/scouting` | **present** |

**A second one, found by trying to seed a review team:** `scripts/seed-demo-team.mjs` still wrote
`tags: []`, so it died with *"Could not find the 'tags' column of 'tasks' in the schema cache"* —
Sprint 27 dropped the column from `src/` and `supabase/` and did not look in `scripts/`. One line
removed; the seeder runs. The wider question (nothing in this repo scans `scripts/` for schema
drift) is in the parking lot.

---

## Red tests, each watched failing

| # | Reverted | What it said |
|---|---|---|
| 1 | `A7`'s prereq changed to `A9` | `A7 needs A9, which is not in the outlined track A`, plus the cycle check and the resolver |
| 2 | Safety's `plannedLessons` set to 6; `B4` renamed `A8` | `Safety count vs lessons: expected 6 to be 4`; `A8 is not in track B`; totals `63` vs `61` |
| 3 | `trackSummary` minutes back to `0`; `findLesson` resolving across tracks; `formatLearnerTime` always printing minutes | `expected +0 to be null`; `expected { Object } to be undefined`; `expected '1 h 0 min' to be '1 h'` |
| 4 | coach sign-offs dropped from `mentorCheckpoints` | `"mentorCheckpoints": 4` → `2` |
| 5 | `isMentorOrAbove` loosened to `role !== 'student'` | `expected true to be false` — caught by the **no role at all** case, which is the guardian |
| 6 | Training's `inNav` set to false | `Unable to find [data-testid="nav-training"]` |
| 7 | the track and lesson routes removed from `App.tsx` | eight red at once — every screen assertion |
| 8 | sign-off queue shown to any member | `expected <section> to be null` |
| 9 | a season gate added to `TrainingHome` | `renders with no season at all` red |
| 10 | `StubNotice` and the no-progress note removed from the lesson page | `Unable to find [data-testid="training-stub-notice"]` |
| 11 | `<ArchivedSeasonBanner />` rendered unconditionally | `expected <div> to be null` |
| 12 | `pathShowsSeasonBanner` returning `true` always | `expected true to be false` |

**What would make the off-season test fail, asked properly.** Reverts 9 and 11 exist because
that assertion looked like decoration on first reading — nothing in the app gates a route on a
season, so "renders with no season" could have been true by construction. It is not: a season
gate in the component turns it red, and the banner half of the same claim was already false when
the sprint started. Both halves now have a revert behind them.

The component tests render the **whole app** rather than the three components. Two of D5's four
questions — is it reachable, does it survive the off-season — are properties of the shell and the
route table, and a test that mounted `<TrainingHome />` directly would have passed with the route
unwired and the nav entry missing.

---

## Files

New: `src/lib/training-curriculum.ts` (the outline), `src/lib/training.ts` (the selectors),
`src/lib/roles.ts`, `src/components/training/{TrainingHome,TrackDetail,LessonDetail,StubNotice}.tsx`,
`src/lib/__tests__/training.test.ts` (15), `src/lib/__tests__/roles.test.ts` (3),
`src/components/__tests__/training-stub.test.tsx` (13).

Changed: `src/App.tsx` (three routes), `src/lib/navigation.ts` (the view, `seasonFree`,
`pathShowsSeasonBanner`), `src/components/AppShell.tsx` (the shared predicate, the banner gate),
`src/lib/__tests__/navigation.test.ts` (3), `scripts/seed-demo-team.mjs`, `README.md`.

Two parking-lot entries.
