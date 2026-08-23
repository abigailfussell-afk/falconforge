# Sprint 14 — Package G, "observability and ops"

**Package:** G — observability and ops (Phase 1), from `HANDOFF_ASSESSMENT.md` §"Sprint packages".
**IDs:** OPS-01, OPS-02, OPS-13, SYNC-08, SYNC-11, SYNC-16, and the first half of P-11 that
Sprint 13 did not take: OPS-04's classification half, OPS-05's uptime half, OPS-09 backups,
OPS-10 deploy gate.
**Branch:** `v2/sprint-14-observability`, off `main` at `388f653` (Sprint 13 merged first).
**Commit range:** `8c4ecd3..00af7f1` — seven commits; an eighth adds this report, the plan lines
and one stale-comment deletion.
**`supabase/` touched:** no. Nothing in this package needed a migration; the backup workflow
talks to the database over `SUPABASE_DB_URL` and never runs `--linked`.

---

## 1. Gate output

```
$ npm run gate

> falconforge@0.1.0 lint
> tsc --noEmit && eslint src

> falconforge@0.1.0 test:run
> vitest run
 Test Files  67 passed (67)
      Tests  806 passed | 2 skipped (808)

> falconforge@0.1.0 test:integration
> vitest run --config vitest.config.integration.ts
 Test Files  9 passed (9)
      Tests  95 passed (95)

> falconforge@0.1.0 build
✓ built in 4.82s

PWA v0.17.5
precache  45 entries (5151.38 KiB)
```

`GATE=0`. Unit 791 → 806 (+15; OPS-02 rewrote rather than added, so the growth is SYNC-08's
seven, OPS-04's three, and the four new ratchets). Integration unchanged at 95. `as any`
unchanged at **56**; arbitrary Tailwind values unchanged at **2**. The two skips are the
`MatchPlanner` drawing block, unchanged since Sprint 6 and now covered in a real browser instead
(see OPS-13 and the parking lot). The precache is still 5.0 MB, 3.06 MB of it one PNG four times
— SYNC-12, untouched and already in the plan's parking lot.

Not part of the Gate, run because this package touches both:

```
$ npm run test:db
 Test Files  23 passed (23)
      Tests  526 passed (526)

$ npx playwright test
  31 passed (59.7s)
```

Both were run after `supabase db reset && npm run seed:review`, so the local stack was clean
rather than the walkthrough's leftovers (guardrail 6).

**One failure, unexplained, reported rather than smoothed over.** In the *first* pack run after
that reset, `meetings.spec.ts:320` ("a code the server has not seen yet is not blamed on the
student") failed; the next run cleared `test-results/` before I read the error text, which is my
mistake and the reason there is no assertion quoted here. What was then measured: **5/5 green**
in isolation at 4 workers with `--repeat-each=5`, and **four consecutive green full-pack runs**,
one of them deliberately reproducing the same condition (`db reset` → `seed:review` →
immediately run the pack). So it is neither a contention signature nor tied to a cold database,
and it is not the toggle-knob defect fixed earlier in this sprint. It is one unreproduced failure
in a test that aborts a POST route and waits 30 s for a heading — parked with those exact numbers
rather than declared a flake, because "it passed the next four times" is how a real intermittent
defect gets ignored.

---

## 2. Per ID

### OPS-01 / OPS-02 — coverage truth and assertion-free tests

The exit criteria are one block for the two:

> `test:coverage` runs in CI (`schema` job) and passes at honestly re-measured thresholds (or the
> thresholds are deleted — state which); the seven assertion-free tests are rewritten or removed;
> the `if (button)` guards become `expect(button).toBeInTheDocument()`; a new ratchet counts test
> bodies without an assertion (= 0).

**"passes at honestly re-measured thresholds (or the thresholds are deleted — state which)"** —
**stated: kept and lowered, not deleted.** Measured `npm run test:coverage` on the branch:

| | Sprint 5 threshold | Measured | Set to |
|---|---|---|---|
| statements | 72 | **66.60** | 66 |
| branches | 67 | **60.41** | 60 |
| functions | 69 | **63.08** | 63 |
| lines | 74 | **68.34** | 68 |

The thresholds were written in Sprint 5 and enforced by nothing — `test:coverage` was in
`package.json` and in no workflow — so nine sprints of new files landed underneath them and the
number that was supposed to be a floor had become a wish. The choice the criterion asks to be
stated: a floor at today's measurement is a ratchet, the same shape as the `as any` count, and it
starts working on the next commit. A deleted floor is nothing, and re-earning six points is a
sprint's worth of tests nobody has scheduled. `vitest.config.coverage.ts` says so at the
thresholds, including "they may only go UP from here".

*How verified:* the numbers above are that command's own output on a clean checkout of the
branch; the run passes at the new values and fails at the old ones (which is how they were
measured — the first run was red on all four).

**"`test:coverage` runs in CI (`schema` job)"** — `.github/workflows/ci.yml:141`. The `schema`
job rather than `test`, because that is the only job that starts the Supabase stack, and the
coverage run includes the suites that need it.

*How verified:* `grep -n "test:coverage" .github/workflows/ci.yml` → one hit, inside `schema`.
Locally the same command with the same config is what produced the table.

**"the seven assertion-free tests are rewritten or removed"** — six rewritten, **one deleted**.
All seven were the same defect wearing different clothes: each searched for a control that does
not match what it looked for, then did all of its work inside the guard, so the body never ran
and the test passed anyway.

| Test | What it looked for | What is actually there |
|---|---|---|
| board: add a task | text `"add"` **or ANY `svg` child** | `data-testid="new-task-button"` |
| scouting: new report | same pattern | `data-testid="new-report"` |
| checklist: add item | same pattern | `data-testid="add-item"` |
| scouting: delete | `[class*="trash"]`, aria-label containing "delete" | label is `Delete report`, icon is an SVG child |
| checklist: reset | `[data-testid="reset"]` | the id is `reset-checklist` |
| board: archive | `queryByText(/archive/i)`, clicked, nothing asserted after | — |
| board: (one) | body was two comments | — |

They now click by test id and assert the state that follows. Two gained a control apiece,
because "a modal is open" and "the view switched" are both satisfiable by accident: the new-task
form is asserted to open **empty** rather than on an existing task, and the archived view is
asserted to **list an archived task**.

The deletion is `calls deleteScoutingReport when deleting`. Rewritten it would have been a fourth
copy of something `ScoutingReports.test.tsx` already tests properly three times, and principle 9
says the second copy is the defect. A dead test's replacement is not automatically worth having.

Two `expect(x).toBeDefined()` calls turned up in the same pass and are worth naming separately:
that matcher **passes for `null`** and is therefore not the null check both were being used as.
Both are `toBeTruthy` now.

**"the `if (button)` guards become `expect(button).toBeInTheDocument()`"** — done for every guard
outside the skipped suite; about a dozen across the four files.

**"a new ratchet counts test bodies without an assertion (= 0)"** — three ratchets, not one, in
`src/test/__tests__/harness-invariants.test.ts`:

- `has no test body without an assertion` — brace-matches `it(`/`test(` bodies and requires zero.
  It counts `expect`, `assert`, `.rejects`, `.resolves`, `toThrow` and this repo's two asserting
  helpers (`expectDenied`, `expectRefused`), which are why a naive `expect(` grep would have
  named a dozen innocent tests.
- `actually finds the tests it is checking` — asserts the extractor matches **more than 500**
  tests. This is the ratchet that keeps the first one honest: a scan that matches nothing reports
  perfect health, which is precisely the failure being fixed. Without it, a refactor of the regex
  would turn the check into a very confident `[]`.
- `does not put an action behind an `if (element)` guard` — ceiling **2**, both inside the repo's
  one skipped suite. Editing assertions inside a block nothing runs would be a change nobody
  could verify; un-skipping it is what takes this to zero, and that is in the parking lot.

*Red-test observation:* all three **seen red**. With the four test files reverted to their
committed state, `has no test body without an assertion` failed and named all seven by file and
title; with the ratchet's regex changed to match a token that appears nowhere, `actually finds
the tests it is checking` failed at `0 > 500`; with the guard ceiling set to 0 the third failed
naming the two skipped-suite hits. All three restored and green.

*Effort:* estimated S. Actual ~S+ — the rewrite was mechanical, but proving the extractor was
not lying about its own coverage was most of the time and is the part worth having.

---

### SYNC-08 — storage persistence

> `navigator.storage.persist()` called after sign-in; Getting Started documents "install to home
> screen" for iOS. Red test: unit test that the call happens on auth.

**"called after sign-in"** — `src/lib/storage-persistence.ts` (new), called from
`src/lib/auth.tsx:268` in the sign-in handler. Nothing in the repo had ever called it, so every
byte the app holds — the sync queue included — sat in best-effort storage that a browser may
evict under pressure without telling anyone. The symptom of that eviction is an **empty queue**,
which is indistinguishable from having synced: work simply gone, silently, which is the same
shape as B20.

Four decisions in the module worth naming, because each is a way the naive version would be
wrong:

- **After sign-in, not at boot.** It is a permission prompt in Firefox, and asking an anonymous
  visitor on the landing page is both premature and likely to be denied permanently.
- **`persisted()` checked first**, so a browser that has already granted it is never asked again.
- **`null`, not `false`, for "could not ask"** — a browser without the API has not refused. This
  is `docs/failure-modes.md` §4 (absence as a value) and the reason the return type is a
  three-state.
- **Never throws.** It is fire-and-forget (`void`) off the sign-in path; a rejected promise there
  would break a working sign-in over a storage hint.

**"Getting Started documents 'install to home screen' for iOS"** — `src/pages/GettingStarted.tsx`,
with the actual gesture (Share → Add to Home Screen) and the reason: Safari evicts a site's
storage after **seven days without a visit**, and `persist()` does not exist there to prevent it.
A home-screen install does. This is the half of SYNC-08 that no code can fix, so the person has
to be told — and told in the place they read before their first competition, not in a runbook.

*Red-test observation:* **seen red.** `src/lib/__tests__/storage-persistence.test.ts` — seven
tests. With the `void requestStoragePersistence()` line removed from `auth.tsx`, `is wired into
the sign-in handler` failed. With `persisted()`'s early return removed, `does not ask again when
it is already persistent` failed. With the three-state collapsed to a boolean, `reports null —
not false — where the API does not exist` failed. Restored; all seven green.

*Effort:* estimated S. Actual S.

---

### SYNC-11 / OPS-09 — scheduled, encrypted backups

No exit-criteria block of its own; it is inside P-11's:

> `.github/workflows/ops.yml` on a weekly schedule: keep-alive GET + `supabase db dump --linked`
> to an encrypted private artefact with retention; a restore has been rehearsed once against the
> local stack and the steps are in `beta-ops.md`.

**`.github/workflows/backup.yml`** (new), nightly at **07:10 UTC** — nightly rather than weekly,
because the criterion's own finding says the loss window is "up to a week of every team's work"
and a Sunday competition's scouting is the likeliest casualty. Named `backup.yml` rather than
`ops.yml` because it does one thing.

The finding it closes: `docs/beta-ops.md` has documented the dump one-liner since Sprint 7, and
`grep 'db dump' .github/workflows` found **only the document**. The habit was written down and
never automated, which is the same class as the coverage thresholds above.

What the workflow does, and the three places it deliberately **fails rather than continues**:

1. **Missing secret → error.** Checked before anything else, naming which one. A backup job that
   skips quietly when unconfigured is the exact failure it exists to remove.
2. **Dump under 50 KB → error.** That size is "connected, authenticated, read nothing" — a
   credential or permission problem that produces a *valid, tiny, useless* file. Without the
   check it would upload happily for a month and be discovered on the day it was needed.
3. Encryption happens **on the runner, before upload**: `gpg --symmetric --cipher-algo AES256`,
   then `shred -u` the plaintext. The dump contains every minor's name, which the finding
   correctly calls a privacy question the old doc acknowledged and did not solve. Artifact
   retention 30 days.

Secrets documented in `docs/beta-ops.md`: `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`.

**"a restore has been rehearsed once against the local stack"** — **met, and it is the most
valuable thing in this sprint.** The rehearsal found two defects that reading the workflow could
not, and the second one is the kind this project's `failure-modes.md` is made of.

**Defect 1: the backup contained no data.** `supabase db dump` with no flag is **schema only**.
Run against the local stack it produced a 137,067-byte file with **zero** data statements in it —
every table, policy and function, not one row. It also passed the 50 KB size gate, so the job
would have gone green nightly and the artifact would have restored an empty database. The doc's
hand-written one-liner, which this file has told Kevin to run **before every migration since
Sprint 7** — "the difference between a bad afternoon and a lost season" — had the same defect and
has never contained a single row of anyone's data.

Fixed: two dumps (schema, then `--data-only`) concatenated in restore order; the size gate moved
to the **data** half specifically, because 137 KB of `CREATE TABLE` hides the absence of every
row; plus a `grep -q 'CREATE TABLE'` on the schema half. Both corrected in `backup.yml` and in
`docs/beta-ops.md`, with the verification command (`grep -c '^INSERT INTO '` — the Supabase CLI
emits multi-row inserts, not `COPY`, so a check written for `COPY` cries wolf on a good backup).

**Defect 2: the restore reports success and loses five tables.** The data dump opens with
`SET session_replication_role = replica`, which is how `pg_dump` holds triggers and foreign keys
off while rows load. **The `postgres` role on Supabase is not a superuser** (`select usesuper
from pg_user where usename = 'postgres'` → `f`) and is not allowed to set it. psql prints one
`permission denied to set parameter` line in several hundred, runs the whole load with every
application trigger live, and **exits 0**.

Measured, restoring a real dump that way:

| | restored |
|---|---|
| `teams` | 32 |
| `seasons` | 32 |
| `team_members` | **0** |
| `tasks` | **0** |
| `meetings` | **0** |
| `meeting_attendance` | **0** |
| `scouting_reports` | **0** |

The first trigger to fire rejects a row ("The team admin must accept the terms of service…") and
every table with a foreign key to what it rejected fails behind it. The teams come back; their
people, work, meetings and scouting do not. This is exactly the failure a rehearsal exists to
find and reading cannot: the command succeeds.

Fixed in the runbook with the thing `postgres` *is* allowed to do — `ALTER TABLE … DISABLE
TRIGGER USER` over the public tables as their owner, bracketing the load, with the re-enable
block right beside it and a count-something-afterwards query. Rehearsed with that correction on a
freshly reset local stack: **32 teams, 64 members, 7 tasks, 20 meetings, 126 attendance rows, 4
match plans, 67 auth users, zero errors** — Iron Falcons back with its 18 members and 17 meetings.

A third finding fell out of writing it up: `beta-ops.md` had **two** "Restoring" sections, the
Sprint 7 one being a bare `psql -f` with none of this. Merged into one, per principle 9 — and
this is the seventh time in this project that a dedup pass has turned up a live defect rather
than tidiness.

**What is still not rehearsed,** and is a parking-lot entry rather than a claim: a *hosted*
artifact restored into a *new* Supabase project. The local stack supplies the `auth`,
`extensions` and `vault` schemas that Supabase manages on a hosted project — the same restore
into a bare Postgres database fails on all three — so the local rehearsal cannot speak for what a
fresh project provides. That needs a scratch project and one real nightly artifact, which needs
the secrets.

*Red-test observation:* n/a — a workflow file. Verified by executing every one of its `run:`
steps by hand against the local stack, which is what found both defects above. The size gate was
watched fail: pointed at the schema-only dump it passed (137 KB > 50 KB, the bug), and pointed at
an empty file it failed correctly.

*Effort:* estimated S (schedule) / M (rehearsed restore). Actual S + M — and the M was worth
several times its cost, since it turned a nightly job that would have produced thirty days of
empty backups into one that works.

---

### OPS-10 — the deploy runs the Gate

> `deploy.yml` runs `npm run gate` and waits for CI success; `harness-invariants` asserts
> `deploy.yml` contains `npm run gate`.

**"runs `npm run gate`"** — `.github/workflows/deploy.yml:72`. It previously spelled the Gate out
as four separate steps and called `tsc --noEmit` directly, which is the fourth copy of the Gate
in this repo's history and had already drifted: **Sprint 9 added ESLint to the `lint` script and
that change never reached the deploy**, so production shipped from a pipeline that had not run
the linter. CLAUDE.md's "the Gate is `npm run gate` and that is the only definition" now holds in
the one place it most needed to.

**"`harness-invariants` asserts `deploy.yml` contains `npm run gate`"** — a new ratchet,
`runs the Gate in the deploy, rather than restating it`. It asserts both halves: that the
workflow calls `npm run gate`, and that it does **not** call `tsc --noEmit` directly again.

Worth naming how it was written, because the first version was wrong in the way this sprint is
about: it read the raw file, and `deploy.yml`'s comments explain the old four-step form —
`tsc --noEmit` and all — and also say "npm run gate". So the check passed on the strength of the
documentation of the thing it was checking. It strips comment lines first now.

*Red-test observation:* **seen red, twice.** With `deploy.yml`'s step reverted to
`npx tsc --noEmit && npm run test:run`, the first version of the ratchet failed only its
tsc-clause (the `npm run gate` clause passed off a comment — which is how the flaw was found);
the corrected version fails at the first clause, naming the file. Restored from a copy, not with
`git checkout --`, and the step verified back in place.

*Effort:* estimated S. Actual S.

---

### OPS-04 — classification half only

> (2) Classify `PGRST204`/`42703`/`23502` as "version mismatch — update the app or wait" rather
> than retrying into dead-letter.

**Two of the three codes, deliberately.** `src/lib/sync-failure-classification.ts:172` now treats
`PGRST204` (PostgREST does not know a column the bundle sent) and `42703` (the same thing
reaching Postgres) as **terminal, with a reason the coach can act on**: reload the app. Before
this they were retried `MAX_SYNC_RETRIES` times over about nine minutes and then parked in the
dead-letter store with a raw PostgREST error, while the fix was one the person holding the phone
could perform immediately.

**`23502` is NOT included, and the finding asks for it.** Stating the disagreement rather than
quietly complying, per guardrail 10:

An unknown *column* can only be a version disagreement — there is no other way for a client to
send a column the server has never heard of. A missing *value* on a NOT NULL column is ambiguous:
it is equally a client bug, a partially-filled form, or a genuinely new required column. This
file's rule is data-preserving by design — anything ambiguous stays retryable so the work is not
thrown away — and B19's regression test leans on exactly that. Classifying `23502` as terminal
would discard a queued write the moment a validation bug produced a null, which is a worse
failure than a nine-minute retry.

If the schema-version handshake in the finding's part (1) lands, `23502` becomes decidable —
the client would *know* the server is ahead — and it can be reclassified then, with evidence
instead of a guess. That is in the parking lot.

Parts (1) — the schema-version handshake — and (3) — a `workflow_dispatch` `ref` input for
one-click rollback — are **not done**. The package brief says "OPS-04 classification half", so
the other two thirds are out of scope by the package definition, not by omission; both are in
the parking lot with the finding's own fix direction.

*Red-test observation:* **seen red.** `src/lib/__tests__/sync-failure-classification.test.ts` —
`an unknown column is a version mismatch, not something to retry` and `says the same for
Postgres' own undefined-column code` both failed with the two-code condition reverted (they got
`RETRYABLE`). The third, `a missing NOT NULL column stays retryable`, is the guard on the
decision above: it fails if a later change adds `23502`, so the reasoning is enforced and not
just written in a comment.

*Effort:* estimated M for all of OPS-04. Actual S for the classification third.

---

### OPS-05 — uptime half

> A free uptime monitor hits `falcon-forge.com` and `${SUPABASE_URL}/auth/v1/settings`
> (documented in `beta-ops.md`, with who gets the alert).

**Documented, not configured — it is an account signup and therefore Kevin's** (the package brief
says so for the workflow secrets, and the same applies here). `docs/beta-ops.md` gained an uptime
section naming both URLs, what each should return, either free provider that covers a 5-minute
interval on two monitors, and who the alert goes to.

Two reasons in the doc rather than a bare instruction, because a runbook line nobody sees the
point of does not get done:

1. It is the only thing that would report the site down **before a coach does** — every other
   review in that document is a cadence, meaning "after the fact by up to a week".
2. It **defeats the 7-day inactivity pause.** A Supabase free project with no requests for seven
   days is paused, and the first person to find out is whoever tries to sign in on the eighth
   day — most likely in the quiet weeks between competitions.

The feedback-body half of OPS-05 shipped in Sprint 13; this sprint documented what that body
carries so the person reading a beta report knows what they are looking at, and the privacy
assertion behind it: `src/lib/__tests__/feedback.test.ts` walks every line of the block and fails
on any key outside the fixed set, so member names and task content cannot drift into a support
inbox. `device online` and `server` are deliberately two lines — conflating them is the whole of
SYNC-07, and a captive portal is "online: yes, server: not reachable".

*Effort:* estimated S. Actual S (documentation only).

---

### OPS-13 — mobile project and the three missing specs

No exit-criteria block; the finding's fix direction is the closest thing:

> Add a `mobile` project (`devices['iPhone 13']`) to `playwright.config.ts` and run the existing
> layout tests under both; add one spec each for board CRUD + drag, planner draw/save/reload, and
> reset-password round trip via Mailpit […] Keep workers at 4/2 (env-divergences §9).

**My definition of done, since there is none to quote** (the same treatment SYNC-15 got in
Sprint 11): *the pack runs at a phone viewport as well as a desktop one; the board, the planner
and password reset each have at least one browser test that would fail if the feature broke; and
every new spec ends in a reload, because a card that only ever existed in Zustand survives
everything except that.*

- **`mobile` project** — added, `devices['iPhone 13']` metrics (390×844, touch, mobile UA),
  `grep: /@mobile/` so it runs the four tagged specs rather than the whole pack twice.
  **Pinned to Chromium**, explicitly: `devices['iPhone 13']` selects WebKit and CI installs
  chromium only, so an unqualified device descriptor would pass locally and fail in CI. This
  means `docs/environment-divergences.md` §10 — "Playwright's Chromium is not Safari" — is
  exactly as true as it was, and the config says so where somebody would otherwise assume
  otherwise. Parking lot.
- **`e2e/board.spec.ts`** (3 tests) — create → sync → **reload** → still there; open/edit/status
  → reload → edit kept; and FEAT-01's comment attribution, asserting the author is a person and
  that "Guest" appears zero times.
- **`e2e/planner.spec.ts`** (2 tests) — draw with pointer events, save against a match number,
  reload, load, save again, and assert the plan count is **1**. That count is FEAT-05's whole
  behaviour: Load → edit → Save used to produce a second plan, which is the drive team's normal
  act between matches. The second test is the control — "Save as copy" produces 2 — because a
  broken-in-the-other-direction Update (never creating anything) would also satisfy the first.
- **`e2e/password-reset.spec.ts`** (1 test) — request → read the link from Mailpit → set → sign
  out → **sign in with the new password**. The assertion is the last step, not the success
  message: a reset that reports success and changes nothing is the same silent failure in a new
  costume, and this flow was dead in production until Sprint 9 precisely because nothing
  exercised it.

Pack: 21 tests in 5 specs → **27 in 8**, 31 executions across the two projects.

**Workers stay at 4/2 — and the interesting part is why.** Adding the project surfaced a failure:
the toggle-knob geometry assertion in `meetings.spec.ts` failed in two of three full-pack runs.
The obvious reading was contention (§9's exact signature, on exactly the kind of test that
suffers), and the obvious fix was dropping to 3 workers. **The measurement said otherwise:** the
same test failed in *isolation* under `--repeat-each=4`, so contention was never the cause. It
was measuring the knob's "off" position before the CSS transition had settled — a real defect in
the test that a busier machine merely made likely instead of rare. Fixed with a `settled()` poll
before the first measurement, workers restored to 4/2, three consecutive full-pack runs green.
The abandoned "reduce to 3" comment was deleted from the config in this sprint's final commit;
leaving both explanations in place would have been principle 9 applied to prose.

*Red-test observation:* **seen red**, each against the defect it exists to catch rather than by
deleting a line. FEAT-05's guard reverted (`loadedPlanId` ignored on save) → the planner spec
failed at `toHaveCount(1)` with 2. FEAT-01's writer reverted to the profile id → the board spec
failed on "Guest". The password-reset spec was watched red in a more useful way: it *was* red
first, on a loose selector of my own (`.or(first password input)` and `/Update|Set|Save|Reset/i`)
which produced a plausible-looking "Invalid login credentials" and read as a product bug for
twenty minutes. The real ids (`#new-password`, `#confirm-password`, "Set new password") made it
pass. The reset flow was fine; my selector was `docs/failure-modes.md` §2 in miniature, written
by the person writing the ratchet against it in the same sprint.

*Effort:* estimated M. Actual M+, most of it in the flake diagnosis, which was worth it — the
cheap fix would have slowed the pack permanently and left the real defect in place.

---

### SYNC-16 — the cold boot proves the data came back

No exit-criteria block; the fix direction:

> Add a third spec: load online → `setOffline(true)` → `page.reload()` → assert nav + cached data
> + an honest status label.

**My definition of done:** *the assertion is the data, not the shell.* A cold boot that renders
`app-nav` and an empty board is a failure that looks like a success — the app booting offline is
worth nothing if the team's work is not in it.

`e2e/offline-sync.spec.ts`'s cold-boot test now creates a task, syncs, cuts the network, reloads,
and asserts the task is on the board — session restore, store hydration and the precached
`index.html` all in the one path that the pack previously never took. The existing tests go back
*online* before reloading (test 1) or navigate between hash routes without a reload (test 2),
neither of which exercises `index.html` or hydration with the network down.

*Red-test observation:* **seen red.** With the offline cutover moved to *after* the reload, the
test still passed on the shell assertion alone and failed only on the data one — which is the
demonstration that the data assertion is the load-bearing half. With `pullFromServer`'s cache
read stubbed to `[]`, it failed naming the missing task.

*Effort:* estimated S. Actual S.

---

## 3. Decisions consumed

**None.** No D-number in `docs/assessment-2026-08/decisions.md` is a precondition for anything in
Package G — checked before starting, because guardrail 3 says a package that depends on a blank
decision stops rather than infers. Nothing in the package contradicted a recorded decision.

One adjacent note: D8 ("keep as is" on the deploy model) is recorded, and OPS-10 stays inside it —
the Gate now runs in the deploy, but the deploy is still `main` → gh-pages with migrations applied
by hand first. Nothing here changes the ordering rule in `deploy.yml`'s header.

---

## 4. Discovered → parking lot

Five entries added to `FALCONFORGE_V2_PLAN.md` §8:

1. **The two backup secrets and an uptime signup** — both Kevin's, both blocking otherwise
   finished work. `backup.yml` fails red nightly until the secrets exist, by design.
2. **The last mile of the restore — a hosted artifact into a new Supabase project.** The local
   rehearsal happened and found the two defects above; what it cannot speak for is the schemas a
   fresh hosted project supplies. Blocked behind the same two secrets.
2b. **Every other runbook claim deserves the same treatment.** Two of the three things
   `beta-ops.md` said about backups were false, and both had been written down and never run.
   The deploy ordering, the erasure SQL and the support-email forwarding are the same shape:
   documented, unexecuted since the day they were written.
3. **The `mobile` e2e project is Chromium wearing an iPhone's metrics** — every iOS claim in the
   repo (16px zoom floor, safe-area insets, the 7-day storage rule) is still unverified on the
   real engine. Installing WebKit in CI closes `environment-divergences` §10.
4. **Two conditional actions remain**, both inside the one skipped suite; un-skipping or deleting
   that block takes the ratchet to zero.
5. **Coverage is a floor at 66/60/63/68, not a target** — the biggest gaps are whole files at 0%
   (`GettingStarted.tsx`, `ResetPassword.tsx`, the guardian and operator surfaces).

Plus, inside OPS-04's own entry: the schema-version handshake and the `workflow_dispatch` `ref`
input, which are the two thirds of that finding this package's brief excludes.

---

## 5. What was not done, and why

- **The hosted half of the restore rehearsal.** The local one is done (and is where both backup
  defects came from); restoring a real nightly artifact into a fresh Supabase project needs the
  secrets and a scratch project. Labelled unrehearsed in the runbook rather than claimed.
- **The uptime monitor itself (OPS-05).** An account signup; documented with both URLs, the
  expected responses and the reasoning.
- **OPS-04 parts (1) and (3)** — schema-version handshake, rollback `ref` input. Out of scope by
  the package definition ("OPS-04 classification half"); parked with the fix direction intact.
- **`23502` as terminal.** A deliberate, argued deviation from the finding — see OPS-04 above.
  A test now guards the decision so it cannot be reversed by accident.
- **`if (element)` guards inside `MatchPlanner.test.tsx`'s skipped suite.** Editing assertions in
  a block nothing runs is a change nobody can verify. Ratchet ceiling 2, parked.
- **Nothing in `supabase/`.** Not needed and not touched.

---

## 6. One line for the plan §8 Progress log

Added — the `2026-08-23 | Sprint 14 — Package G` row. It records the Gate, `test:db` and e2e
numbers, the per-ID outcomes, the two deliberate deviations (`23502` excluded; thresholds lowered
rather than deleted), the flake that was not contention, and the two outstanding items that are
Kevin's.
