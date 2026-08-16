# Sprint 7 — Beta hardening & launch

Branch `v2/sprint-7-hardening`, off the merged `main` (`cafc0d3`). Thirteen commits. **Not merged,
not pushed, not deployed.**

---

## 🔴 Read this first: a password is in the public git history

While pruning `.agent/` I found `jkfussell@gmail.com` and its **plaintext password** committed as
"test credentials" in three files: `.agent/rules/coding-rules.md`,
`.agent/skills/e2e-testing/SKILL.md` and `.agent/skills/verification/SKILL.md`.

Two things make it worth interrupting a sprint report for:

- **The repository is public.** `curl https://api.github.com/repos/abigailfussell-afk/falconforge`
  returns 200 unauthenticated.
- **That account holds the `platform_operators` row** — the identity `grant_team_license` and
  `operator_transfer_team_admin` check, and the one no API path can recreate.

I removed all three from the working tree. **That is not the fix.** The password is still in the
history (`5cdceac`, "Login workflow fixes part 1"), so it must be **rotated**. Rotating it is
sufficient; scrubbing the history is optional and your call. The seeded local accounts exist so
that no real credential ever needs to be written down again.

---

## The Gate — real output

Run on the final commit, local Supabase stack up.

| Step | Result |
|---|---|
| `npm run lint` | clean, no output |
| `npm run test:run` | **38 files, 503 passed, 2 skipped** (505) |
| `npm run test:integration` | **9 files, 91 passed** |
| `npm run build` | **✓ built in 4.02s**, no warnings; PWA precache 31 entries |
| `npm run db:verify` | **schema assertions passed** — 21 assertions (was 20) |
| `npm run test:rls` | **281 passed** (was 265) |
| `npm run test:db` | **9 files, 380 passed** (was 364) |
| `npm run test:e2e` | **10 passed** — new this sprint |

`as any` **55 → 55** (rule 7 satisfied). Arbitrary Tailwind values still **1** — the documented
`w-[calc(33.33%-1.5rem)]` computed column width in `Landing.tsx`. Coverage thresholds unchanged at
72/67/69/74.

Movement: unit **470 → 503**, integration **87 → 91**, db **364 → 380**, rls **265 → 281**.

---

## Phase 1 — Sprint 6 merged, and gated on `main`

`--no-ff` merge `cafc0d3`, message in `332f2bd`/`909a163`'s shape. Full Gate green on the merged
main **including `db:verify` and `test:rls`**, because unlike Sprints 5 and 5.5 this one touched
`supabase/`.

One thing I will not smooth over: the first (cold) `test:run` on the merged main **failed**, and
passed on a re-run. I did not re-run and move on — see below.

---

## Your four decisions, and what they changed

**1. Deploy: back to automatic.** `deploy.yml` regains its `push` trigger. The reasoning is now
written into the workflow rather than left in a report: the migration hazard Sprint 6 was
guarding against is not solved by a manual click, it is solved by applying migrations to the
hosted project *before* merging the branch that depends on them. Making every deploy manual to
guard the occasional schema change taxed the common case for the rare one. **The rule is now:
schema changes are ordered by hand, everything else ships on merge**, and the honest trigger for
returning to manual is beta onboarding.

**2. Production check: read-only.** Seven checks, every request a GET or a HEAD, nothing written
to the hosted database. Verified by running it against the live site — it passes and correctly
reports falcon-forge.com still serving the Sprint 5.5 bundle.

**3. Not the last sprint before beta.** This changed my posture more than anything else: I
executed Sprint 7's scope properly and **parked** Sprints 8–11 work rather than dragging it
forward. Seven new parking-lot items are recorded rather than opportunistically fixed.

**4. `anon` REVOKE: in scope.** Done, and it was more interesting than expected — see below.

---

## 🔴 CI had never run on a sprint branch

`ci.yml` triggered on `push: branches: [main, 'refactor/**']`. Six sprints have merged to `main`
on the strength of a locally-run Gate, and the first CI signal always arrived *after* the merge —
the one moment it is useless.

One line. It is the first commit of the sprint, and everything below now has somewhere to run
*before* a merge rather than after one.

---

## The tooling, and the five defects it found

Sprint 6 could not produce a screenshot at any width. `npm run capture` now produces 27 —
eight app views plus the landing page, at 375/768/1280 — headless, so the Browser pane's
display-state limitation stops applying, and with `fullPage`, so 1280 is readable.

The smoke pack is six flows (`e2e/`): register, invite/join/approve, create-a-task-offline→sync,
new season, scouting, checklist. **It runs against a production build served by `vite preview`,
not the dev server.** That is not fastidiousness: the dev server has no service worker, so an
offline navigation cannot fetch a `React.lazy` chunk and the app renders blank. Against the dev
server this pack would have been asserting things about the harness, in the one codebase where
offline behaviour *is* the product.

**Every defect below was found by building or running that tooling. None was found by the
476-test suite, which was green over all of them.**

**1. Upcoming Deadlines vanished when empty.** Found in the first 1280px capture. The panel was
behind `upcomingDeadlines.length > 0`, and its own comment says it exists because "the dashboard
used to end after Quick Actions — the lower two-thirds of a desktop screen was empty". That is
exactly the state it fell back into, for the teams that meet it first: a brand-new team has no
tasks by definition, so **every beta team's first impression was the version with the hole in
it**. Recent Activity, directly beside it, already had an empty state — the screen disagreed with
itself. The two ways of being empty now get different sentences, because pointing a team that
already has work at "plan your first sprint" would be wrong.

**2. Creating a team sent you to pick a team.** The wizard ends on "Go to Dashboard", which
navigates to `/`; the app found no current team and bounced the coach to the team picker to
select the team they had finished creating ten seconds earlier, from a list with one entry.
The non-obvious half: setting the current team id alone **moved** the problem rather than fixing
it, because `setTeams` has exactly one caller in the entire app (the picker's own loader) and
`teams` is not in the entity registry — so the app stayed put and the sidebar rendered "Select
Team" from inside that very team.

**3. The sign-up privacy acceptance was never recorded.** The smoke pack registered an account
and it was immediately told its legal documents were out of date — thirty seconds old.
`SIGNUP_REQUIRED_ATTESTATIONS` existed and had exactly one consumer, `ReAttestationPrompt`,
which **checks** it. Nothing anywhere **wrote** it: the acceptance arrived in `handleStep2Submit`
as a parameter named `_isPrivacyAccepted` and was dropped. So the prompt was not firing because
the record was old; it was firing because there had never been one. The quieter half is the more
serious: a product whose COPPA posture rests on attestation records was not recording the one
every user gives. This is Sprint 6's "gate with no door" shape, inverted.

**4. The sync indicator hid the pending count while offline.** Found by running the venue
simulation and looking at the sidebar. `getStatusText` returned a bare `'Offline'` and discarded
the count, so a team that had worked through an entire session at a competition saw exactly what
a team that had done nothing saw. The one number answering "is my afternoon actually saved?" went
quiet at the moment it was worth reading and returned only when the connection did. It now reads
`Offline · 4 queued`, and stays a plain `Offline` at zero so the count does not become noise.

**5. A test-isolation leak.** The signed-out redirect test does `mockReturnValue({ user: null })`,
and `vi.clearAllMocks()` clears recorded *calls*, not implementations — so it leaked a signed-out
user into every test declared after it. Invisible while it was last in the file. The Upcoming
Deadlines tests were written, failed, and turned out to be asserting against the landing page.

---

## The flake I did not re-run and forget

The cold `test:run` on the merged `main` failed one deep-link test and passed on re-run. The
temptation is obvious. What it actually was:

`src/test/setup.ts` configures `asyncUtilTimeout: 5000`, and `vitest.config.ts` never set
`testTimeout` — so it was Vitest's default, **also 5000**. A `waitFor` does not start when the
test starts; it starts after `render()`, so its window always extends past the test's own
deadline. **The ceiling always wins and the documented 5s of patience can never elapse.**

Measured with a probe component rather than reasoned about: settling at 4800ms passed, settling
at 5500ms failed at 5011ms with `Error: Test timed out in 5000ms.` and a code frame on the `it()`
line — byte-for-byte the shape of the Gate failure. Every deep-link target is behind
`React.lazy`, so render alone can eat most of the budget on a loaded machine.

The second cost was diagnosis: a test timeout names nothing, whereas the async util's own timeout
fails with the assertion and the DOM it could not find. Both values now live in
`src/test/timeouts.ts` with the measurements, because raising one in isolation is precisely what
made it unreachable — Sprint 2 raised the async budget 1s → 5s and hit a ceiling nobody had
looked at. It matters *now* because CI just started running on sprint branches, and a CI runner
is cold and contended every single time.

---

## The `anon` REVOKE, and the no-op that looked right

Nine directly-called admin RPCs lost EXECUTE for `anon`. Third forward migration on the frozen
schema; privileges only, no table, policy or function body touched.

The migration is honest that it fixes nothing currently broken — B25 is fixed at the root, so
these RPCs already refuse an anonymous caller. What it removes is the *second* thing that had to
be true for B25 to be reachable from the open internet.

**The first draft was a no-op and looked completely correct.** `REVOKE EXECUTE ... FROM anon`
removed anon's own ACL entry and changed nothing anon could call, because PostgreSQL grants
EXECUTE to PUBLIC by default and `anon` is a member of PUBLIC. The ACL read:

```
=X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

where the entry with the empty grantee **is** PUBLIC. Only the nine behavioural tests caught it —
an assertion over `pg_proc` ACLs would have passed. That is exactly why the parking-lot item
asked for a test per function, and it is the same lesson as schema assertion 20.

**What is deliberately not revoked, and is asserted as such:** the capability predicates
(`is_team_member`, `team_can_write`, `season_is_open`, `can_manage_*`). They are not an API
surface — they are called inside RLS policies, which evaluate as the calling role. Revoking them
would not harden anything; it would turn every anonymous SELECT into "permission denied for
function" instead of the empty set, breaking the `200 []` Sprint 3 verified and the signed-out
landing and join pages that depend on it. Seven tests pin that negative space.

---

## PWA: separating the two halves of `autoUpdate`

The plugin was on `registerType: 'autoUpdate'`, which sounds considerate and is not: it ships
`skipWaiting` **and** `clientsClaim`, so a newly deployed worker seizes an already-open page.
Chunk names change per build, so a tab open since before a deploy asks for a chunk the new
precache does not have — "Failed to fetch dynamically imported module", on the next nav click.

The halves are now separate: `skipWaiting: false` so a worker *replacing* one waits for the user,
`clientsClaim: true` so a worker with nothing to replace still protects the session it installed
in.

**That second half was not in the plan, and is the part worth carrying forward.** Dropping
autoUpdate for plain `prompt` silently left a coach's **first** visit entirely uncontrolled by
any service worker — precache built, nothing using it, offline navigation dead. The offline smoke
test went red immediately. A related ordering bug, same cause: registration was initially done
from the prompt component, which lives in the app shell, so nothing registered until the user had
signed in and picked a team, and the landing and login pages registered nothing at all.
`startServiceWorker()` now runs at boot in `main.tsx`.

---

## The rest of the sprint's scope

- **Per-route error boundaries.** There were **none anywhere in the app**, so React's default
  applied: an uncaught render error unmounts the whole tree and the user gets a blank page. The
  boundary sits *inside* the shell, so the sidebar and sync indicator keep working and the user
  can navigate away — which is also the reset, since `resetKey` is the pathname. The fallback
  says the thing a coach needs to know and that is actually true: the queue is in IndexedDB and a
  render crash does not touch it.
- **Dead-letter review.** B2 kept the work, B24 gave it a reason; neither let anybody *see* it.
  A number is not reviewable, and both available actions were wrong for the common case — a
  change belonging to an archived season re-parks on every bulk retry so the badge never clears,
  and the only escape was discarding everything. Now per-item, with B24's reason beside the
  change, and discarding names what is being thrown away.
- **Offline banner**, wording deliberately the opposite of the usual: offline is the designed
  case, so it reassures and offers no retry rather than warning.
- **Beta ops**: a feedback link on every screen (a `mailto:`, because a form would need an
  unauthenticated write endpoint on the database holding every team's data), `docs/beta-ops.md`
  with the backup one-liner and the two restore traps already in this project's history, and
  `npm run seed:demo` — one ordinary populated team, complementary to Sprint 6's awkward-states
  seeder.
- **`.agent/` pruned**, with `.agent/README.md` marking each document current, historical or
  aspirational. That is where the password turned up.

---

## The venue simulation

`npm run venue`, against a real build with a real service worker: register on a good connection,
cut the network, do a session's work (three tasks, a scouting report, three checklist items),
reload **while still offline**, reconnect on a throttled link, then sign in from a second browser
context to prove the work reached Postgres rather than the local store.

All six stages pass. Work survives the offline reload; the queue drains in under five seconds on
a 200kbps link; all three tasks and the scouting report are visible on the second device.

Two flaws in the simulation itself, fixed, because a simulation that quietly skips a step is
worse than one that omits it:

- The checklist stage located `input[type=checkbox]` and swallowed failures with
  `.catch(() => {})`. The toggle is a real `<button>`, so it matched nothing and reported success
  while doing nothing. **The screenshot is what gave it away** — eight untouched circles.
- The script registers accounts, and `npm run build` reads `.env.local`, which points at the
  **hosted** project. An ordinary build would have put test accounts and a "Venue Falcons" team
  into production. Caught before any harm; it now refuses at the network layer.

---

## Exit criteria, checked adversarially

| Criterion | Status |
|---|---|
| PWA: visible update prompt | **Met**, and it exposed the `clientsClaim` regression described above. |
| Offline banner wired to real connectivity state | **Met.** The state existed; the banner did not. |
| Venue simulation (DevTools offline + throttling) | **Met**, scripted and repeatable, all six stages pass. |
| Error boundaries per route | **Met.** There were none before. |
| Dead-letter UI reviewed (a coach can understand and retry) | **Met**, and extended: per-item discard, which is what makes the badge clearable. |
| Playwright smoke pack (5–8 flows) in CI against the local stack | **Met** — six flows, ten tests, wired into `ci.yml`. |
| Playwright owns screenshot capture | **Met** — 27 images at three widths, the criterion Sprints 5 and 6 both failed. |
| README rewritten to match reality; `.agent/` pruned | **Met.** |
| Seed script for a demo team | **Met** (`npm run seed:demo`). |
| Beta ops: feedback link, error logging story, backup documented | **Met** (`docs/beta-ops.md`, `src/lib/error-reporting.ts`, the sidebar link). |
| Full Gate + RLS + smoke pack green in CI | **Green locally, and this is the first sprint where CI *can* run on the branch — but it has not yet, because nothing is pushed.** Honest status: the claim is "green on my machine, and CI is now configured to prove it on push". |
| Kevin does the final walkthrough and tags `v2.0.0-beta` | **Not done, and correctly so** — you said this is not the last sprint before beta. Deferred rather than failed. |

Two further things I want to state plainly rather than let the table imply:

- **The `anon` REVOKE migration has not been applied to the hosted project.** Under the new
  deploy rule that is exactly right — schema changes are ordered by hand, before the merge — but
  it means merging this branch without applying it first would deploy a bundle against a database
  that does not match, which is Sprint 4's incident. The steps are in `docs/beta-ops.md`.
- **Safari is still untested.** Playwright's Chromium emulates iOS rather than being it. The 16px
  zoom floor is guarded by a source-level test and by computed styles, but genuine
  zoom-on-focus behaviour wants a real device before teams get the URL.

---

## Handing on

Seven new parking-lot items in §8, the first of which is the password. The most actionable of the
rest is the **406/409 pair logged during registration** — `ensureUserProfile` upserting into
`users` while the `handle_new_user` trigger inserts the same row. The flow succeeds either way,
which is why it has never surfaced, but it is noise on the one path every user takes exactly once.

Nothing is pushed. To ship this: apply the migration to the hosted project (after a dump), merge,
and `main` now deploys on its own — with the read-only production check running afterwards.
