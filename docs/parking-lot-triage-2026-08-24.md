# Parking-lot triage — 2026-08-24

A pass over all **161** top-level entries in `FALCONFORGE_V2_PLAN.md` §8, ahead of the September
beta. Nothing was fixed here except the one item that was blocking the Gate; this document is a
disposition, not a sprint.

**Method.** Every claim in section A was re-checked against the working tree — or against GitHub —
rather than taken from the entry. That mattered more than expected: **ten entries are already
fixed and still read as open, two of them marked 🔴.** A severity marker that is wrong in the safe
direction is still wrong; it is what makes the other ten 🔴s worth less than they should be.

The tenth is the one to read first, because it is the trap this pass nearly fell into. The entry
"the backup is still not running… unblocking it is a `git push` of `main`" is superseded by the
release row four hundred lines above it in the same document, and was never struck through. Taken
at face value it is the single most alarming item in the parking lot, and it would have been
ranked the #1 beta blocker here. `gh run list` settles it in one call: a **scheduled backup run
succeeded at 2026-08-24T08:02:30Z**. *The parking lot's biggest risk is no longer the defects in
it; it is that a reader cannot tell which entries are still true.*

| | Count |
|---|---|
| Top-level entries | 161 |
| Already marked ✅ / RESOLVED inline | 25 |
| **Verified fixed but still reading as open** | **10** |
| Duplicate entries describing one defect | 11 (→ 5 defects) |
| Genuinely open after this pass | **~115** |
| Of those, needing a decision from Kevin rather than an agent | 14 |

---

## A. Close these — verified fixed, entry is stale

Each was checked in the tree today. Two are marked 🔴, which is the finding worth reading first:
the parking lot's own severity markers have drifted.

| Entry (sprint) | Evidence it is fixed |
|---|---|
| **The backup "has never run once"** (S14) | `gh workflow list --all` returns "Nightly encrypted database backup" as active; `gh run list` shows a **scheduled run succeeding at 2026-08-24T08:02:30Z**. The 2026-08-23 production release pushed `main`, which is the one thing the entry said was missing. |
| 🔴 **A restored session drops the user into the age-profile screen** (S5) | The `setTimeout(0)` deferral the entry describes as "left uncommitted in the working tree for review" is committed — `src/lib/auth.tsx:251`, with the Web Lock reasoning in the comment. |
| 🔴 **Precache is 60% one image, copied four times** (auth templates) | The four PNGs are no longer byte-identical and no longer 784 KB: `falcon_logo` 10 KB, `icon-192` 7 KB, `icon-512` 23 KB, distinct md5s. `logo.png` is gone. Precache measured **1,582 KiB** on today's build, against the 5.01 MB the entry cites. |
| **`pg` is an unused devDependency** (S10) | `scripts/restore-rehearsal.mjs:50` imports it. The entry's own suggested remedy ("use it for raw SQL in the db suite") happened. |
| **`preflight_security_audit.sql` is orphaned** (retrospective) | The file no longer exists; `supabase/tests/` holds only `schema_assertions.sql`. |
| **No `404.html`, so every non-hash deep link 404s** (S9) | `public/404.html` exists. |
| **`transfer_team_admin` has no caller** (S3) | 30 references in `src/` outside tests. |
| **`tsconfig.json` includes `components` and `services`** (S1) | `include` is `["src", "*.ts", "*.tsx"]`. |
| **Unused CSS `.calendar-grid` / `.transition-smooth`** (S1) | Neither appears in `src/index.css`. |
| **`orange-*` is still `orange-` in tests** (S5) | No test file matches `orange-`. |

**Action:** mark these ✅ in §8 with today's date. Ten entries, no code. *(Done — §8 now carries
each of these with its evidence and the original text behind "Was:", the way every other closed
entry in that file does.)*

---

## B. Beta blockers — September 2026 is about a week away

Ordered by what would hurt most at a competition.

1. **The restore is rehearsed into a scratch database and never into a fresh hosted project — and
   as written it does not work.** Into a bare database: 29 errors. Two matter —
   `SET session_replication_role = replica` was **denied**, so the data half loaded with triggers
   live, and SEC-01's membership trigger then **rejected rows silently**, because the CLI does not
   stop on error. *A restore that drops the admin's `team_members` row while reporting success is a
   worse outcome than one that fails.* The local stack supplies the `auth`, `extensions` and
   `vault` schemas that Supabase manages on a hosted project, so a scratch-Postgres rehearsal
   cannot speak for a real recovery. **No longer blocked** — the artifact it was waiting for now
   exists. An hour with a throwaway project, and it should happen before the first competition
   rather than during one.

2. **`scouting_reports.event_name` is free text and the summary's filter groups on it exactly.**
   "League Meet 1" and "League meet 1" become two events and two separate summaries, and nothing
   tells anybody. Scouting is the feature teams will actually use at an event. `competition_events`
   already exists (S18) — the fix is a `season_event_id` FK plus a picker with free-text fallback.

3. **A team created seconds before going offline has no season, so the board is read-only.** The
   coach who registers in the car park and walks into a venue with no signal gets an app that
   cannot create anything, with a message that does not explain why. The fix has a precedent:
   seed the season from the create-team response, the way Sprint 7 seeded the store from the
   create-team write.

4. **Nobody can change their email address in-app.** `supabase.auth.updateUser` is called in
   exactly two places and neither touches `email`. For a managed child the guardian's address is
   *the only contactable address the team has*, and SEC-16 has just made the server side carry
   that change correctly onto every child's roster row — so this is a missing screen on top of a
   finished mechanism.

5. **`create_team_as_admin` has no trial limit.** One seeded account registered three teams in a
   row, each with its own unlimited-seat 90-day grant. That is the business model (§2), not a bug
   backlog item. Depends on D1/D3.

6. **The db suite poisons itself, and the Gate dies at random.** An interrupted `test:db` leaves
   fixture teams at 30001+, so the next run's first `createTeam` collides and takes **20 suites**
   down with an error about the fixture — and the collided run also dies before cleanup, so the
   state is self-sustaining. Separately, `gate:db` dies with **exit 127** part-way through, at a
   different suite each time, on `main` as well as on branches. *A Gate that dies at a random
   point is indistinguishable from a Gate that found something* — and CLAUDE.md makes a green
   Gate the precondition for done.

---

## C. Kevin's calls — 14 entries an agent cannot close

Blocked on a decision, not on work.

- **Licence.** README says no licence is granted and there is no `LICENSE` file. Should be decided
  *before* the repo is shown to a beta cohort. §2 says FalconForge is paid; MIT would let anyone
  run a competing instance.
- **D7 / hosting.** Gates two one-line edits in `beta-ops.md` — GitHub Pages' ToS excludes
  commercial SaaS, so "first paid licence" is a hard Cloudflare trigger.
- **Brand: white on `forge-600` fails AA at 3.55:1** on the primary button of *every* screen — the
  most-repeated contrast failure in the app by node count, hit by 7 of 9 Sprint 19 scans.
  `forge-700` measures 5.18:1 and is already the hover state. CLAUDE.md principle 8 makes the
  forge ramp Kevin's call, not an agent's.
- **D3's "routes to request to join"** was interpreted and Kevin should confirm the reading. The
  stronger version is one RPC and a rate limit — but it is a second join path (which D3 forbids)
  *and* a five-digit guessing oracle, which is B21's shape with a number in place of the uuid.
- **Softening the under-18 nomination gate**, and whether a guardian-only account should be asked
  to re-attest at all. The second needs the pending legal review, not a sprint.
- **The Supabase dashboard redirect allow-list** is stale and nothing visibly breaks — which is
  exactly the point: an unmatched `redirect_to` falls back to Site URL silently, so a wrong
  allow-list is indistinguishable from a right one until Site URL is also wrong.
- Plus: git-history scrubbing (the credential is already rotated, so this is optional), Tailwind v4
  (deferred post-beta), per-column `ON DELETE SET NULL` on five frozen constraints, and
  typecheck-at-commit (about 10s on every commit Kevin makes).

---

## D. Quick wins — one line each, disproportionate value

| Fix | Why it is worth doing now |
|---|---|
| `String((error as { message?: string })?.message ?? error)` at `offline-db.ts:403` | Closes **two** parking-lot entries at once. Today every dead-lettered change records `lastError: "[object Object]"` for every server refusal there is — verified still broken. SYNC-10's whole design is shipping that record to Kevin so he can see why a device is stuck; it would ship `"[object Object]"`. |
| `CheckIn.tsx:344-349` → `getMemberInitials` | The **ninth** display-initials implementation, and it disagrees with the canonical one: "Mary Jane Watson" is `MW` in `member-utils` and `MJ` here. The check-in avatar and the roster avatar are two screens a coach can have open at once. `member-utils` is already imported in that file, so the fix is smaller than the entry describing it. |
| `<Navigate to={loginWithReturnTo('/create-team')} replace />` in `App.tsx` | Fixes `registration.spec.ts`'s 1-in-24 flake, already diagnosed and measured (12/12 green on the control path). A redirect discarding intent on the one journey every team takes exactly once. |
| `emailRedirectTo` on `signUpWithEmail` | The one auth flow that ignores `authRedirectUrl()` — the helper written precisely so that no flow grows its own answer. Correct-by-accident today, because Site URL happens to be right. |
| Delete `MEMBER_REQUIRED_ATTESTATIONS` | Its own entry says "if a fourth sprint passes with it still empty, delete it." Twenty-two have. |

---

## E. Duplicates — 11 entries, 5 defects

Merge these; they inflate the count and split the evidence.

- **`lastError` is `"[object Object]"`** — S11 and S16 describe the same line from two angles.
- **The trial licence in `create_team_as_admin`** — S3 and S6, same block, same removal.
- **`teams` is not in the entity registry** — S7, S8 and S9. *All three are resolved* by the S9 ✅
  entry; the two older ones were never struck through.
- **Checklist templates have no management UI** — S4 and S5.
- **Coverage thresholds are enforced by nothing** — logged twice, the second marked "*(original
  entry follows)*", which is a merge that was started and never finished.

---

## F. Accepted — leave them, but say so

A sizeable tail is correctly parked and should be relabelled *accepted* rather than *open*, so
that the open count means something: the 36 realtime subscriptions per tab (measured against
quota, revisit with D7), `season_is_open` as an anon-callable oracle (one bit about no person,
deliberate), revocation needing a reload (the project's guardrail bar is "name the defect or leave
it out"), the coach-offline/student-online dead-letter, the event that cannot cross midnight, the
recurrence-rule edit, and the two unexplained one-off failures — the 409 and the
`meetings.spec.ts:320` timeout — which are correctly kept with their numbers rather than dismissed.

---

## Recommended Sprint 29

Everything in **D** (five one-liners, about an afternoon), plus **B6** (the fixture/Gate
reliability pair — a `globalSetup` sweeping the fixture team-number range closes both the collision
and the cascade in about ten lines), plus **A** as a documentation commit. That leaves the Gate
trustworthy and the open count honest before the beta sprints, which are **B2** (scouting event
identity) and **B4** (the email screen).

**B1 is not sprint work** — it is an hour with a throwaway Supabase project, and it is the one item
here whose cost is measured in what happens if it is never done.
