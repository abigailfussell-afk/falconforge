# Kickoff readiness review — 5 September 2026

**Against:** `main` @ `1b88b93` (2026-08-29), fully pushed, production check green, nightly backups
green every day through 2026-09-05. **Kickoff:** 12 September 2026 (BIOBUZZ). **Beta shape:** a few
teams on operator-gifted season licences, no Stripe.

**Method.** Read the plan (§1–§8 including the whole parking lot), the August assessment, the
decision record, the triage, `failure-modes.md`, `beta-ops.md`. Ran `lint`, unit (1213 passed,
2 skipped) and integration (99 passed) today. Did **not** run `test:db`/`test:rls`/the e2e pack
locally (they truncate the review database; CI ran all three green on 2026-08-29 and nothing has
changed since). Then walked a **production-mode build** (`npm run preview:local`) against the
local stack as: the seeded admin/operator, a brand-new coach through the real signup →
email-confirmation → create-team funnel, a student, a guardian, and a lapsed team; and a 375px pass
over the dashboard, board, scouting form and admin roster. Nothing was changed; nothing touched
production.

**Headline:** the app is in better shape than the parking lot makes it look — every flow a beta
team needs on day one works, on desktop and at 375px, and the ops side (backups, restore
rehearsal, email, uptime, operator console) is genuinely in place. Two things stand between
today and kickoff, and one of them is a new bug found today.

---

## 1. Bugs found in this review

| # | Sev | Finding | Where |
|---|---|---|---|
| R-01 | **High** | **Any tab hidden→visible transition unmounts the whole app behind the splash and destroys every open form.** `auth-js` re-emits `SIGNED_IN` on every `visibilitychange` (`_recoverAndRefresh` → `_notifyAllSubscribers('SIGNED_IN')`), `auth.tsx` treats every `SIGNED_IN` as "hold loading until the profile is fetched", and `App.tsx:204` renders `SplashScreen` instead of `<Routes>` while loading. Reproduced deterministically twice by dispatching `visibilitychange` on `window`: the create-team wizard on step 2 with a typed team name went back to step 1 empty (splash visible at 32 ms); a New Item modal with a typed title closed and the text was gone. **At a venue this is a half-filled scouting report lost when the scout switches to the camera, answers a text, or the phone locks.** Also an extra profile REST call and a splash flash on every refocus. Invisible to the suite: jsdom never fires `visibilitychange`, headless Playwright never hides a tab. | `src/lib/auth.tsx:238-246`, `src/App.tsx:204` |
| R-02 | **High (kickoff)** | **The BIOBUZZ game definition is a placeholder.** `field.image` is `DecodeField.png` — a 2026-27 season's Match Planner draws last year's field; the scouting form is Has Autonomous / Auto Score / TeleOp Score / End Game Score / Rating / Notes; partner capability "End game position" is a guess; `version: 0`. It cannot be finished before the reveal, and there is no way to update a definition without a release (phase M's global table was deferred), so a **release within days of kickoff** has to be planned, not improvised. | `src/games/ftc-2026-biobuzz.json` |
| R-03 | Medium | **Create-team attestation copy contradicts two locked decisions.** "You accept responsibility for obtaining parental consent for minors and **will act as the parent's agent for COPPA purposes**" — the shipped model is that the guardian consents directly and the admin only attests not to roster a child without the guardian (§3). "**You will be billed monthly based on approved team members** (free during beta)" — pricing is deferred (D1) and per-seat is the option the evidence argues against. This text is what `coach_terms@2.0` records, so changing it is a version bump with re-attestation consequences. | `src/pages/CreateTeam.tsx:384-400` |
| R-04 | Medium | Board at 1280px desktop: the fifth column (Done) is off-screen behind a horizontal scrollbar (WALK-A-05, unchanged). Stacks correctly at 375px. | `SprintBoard.tsx` |
| R-05 | Low | Scouting form shows the "Enter a team number" error in red on an untouched field the moment the modal opens. | `ScoutingReports.tsx` |
| R-06 | Low | The dashboard's empty-team banner is admin-shaped for every role: a student sees "Your team is set up and this is its hub… plan your first sprint below". | `DashboardHome.tsx:148` |
| R-07 | Low | The licence banner ("Your team's licence ends in 30 days… becomes read-only") is the first line of every screen from the minute a brand-new team exists, because the 30-day probation is the normal path (D3). A coach will read it as a warning. Copy or threshold call — see §4. | `LicenceBanner.tsx` |
| R-08 | Low | Landing page roles block: Student / Coach (badged "Team Admin") / Mentor — no Guardian, and no Admin as its own role (LAND-08 still open). Footer legal links are present (LAND-01 fixed). | `Landing.tsx:995-1035` |
| R-09 | Low | A user with exactly one team who signs in on a device holding another user's state lands on "Select a team to continue" with one team in it. Worth checking whether a single-team user ever needs that click. | `Onboarding.tsx` |
| R-10 | Note | The review seed labels the 2026-2027 season **DECODE**, so nothing in the seeded teams exercises BIOBUZZ; the new-coach funnel is the only way to see it. Seed has no tasks (known). Not a product bug; it shaped what this review could see. | `scripts/seed-review-states.mjs:191` |

**Verified working today (so they do not need re-checking):** signup → confirmation email
(Mailpit) → sign-in → create team (attestation, details, 7-day invite code) → dashboard with
season, five default sub-teams, BIOBUZZ form in Admin → Your scouting form, probation licence
"30 days, unlimited seats"; student read-only schedule + check-in; guardian lands on My children
with consents, upcoming meetings and attendance (WALK-B-01/02 fixed); lapsed team banner and
disabled New Item with the right reason; operator console new-teams list, directory, filters;
Getting started page; Edit Profile with email change; no horizontal overflow on any 375px route
checked; scouting modal Save button on-screen at 375×812; zero console errors on any route.

---

## 2. Known open items that matter in the next 60 days

From the plan's parking lot and the triage, filtered to what a beta team or Kevin will actually
meet. Everything else in the ~115 open entries can wait.

| Item | Why it bites now | Source |
|---|---|---|
| **Corporate/school mail link scanners spend the confirmation token before the coach clicks** ("link expired"). The `token_hash` round trip is unbuilt. | Beta coaches on district email are the likely cohort. First support ticket of the beta, on day one. | Plan §6 "UNSCHEDULED" |
| **`check-production.mjs` auth assertion goes red on gateway degradation while sign-in works** — twice on 08-29. | A deploy check people learn to ignore stops being a check; the BIOBUZZ release will need a trustworthy one. | §8 2026-08-29 |
| **`operator_grant_extra_team` has no button.** | The moment a coach runs two teams (common for a school with two FTC numbers) it becomes a support email + SQL. | §8 Sprint 17 |
| **Competitions schedule is an edit form with no read view** (12 matches ≈ 168 form controls at 375px). | The first league meet is the first time a coach looks at it between matches. | §8 Sprint 30 |
| **`AppShell` is `h-screen` + `overflow-hidden`** — parked by Kevin pending a real-phone check of the `dvh` modal fix. | Same phone, same URL bar, every route. | §8 Sprint 30 |
| **Nothing iOS has ever been verified on a real device** (7-day Safari eviction, zoom floor, standalone mode, safe-area). | Half of any team's phones. | `environment-divergences.md` §10 |
| **Onboarding email ceilings**: Resend 100/day (~4 teams/day at 20 members), Supabase 100/h. Failure is silent. | Several teams onboarding the same evening after kickoff. | `beta-ops.md`, OPS-06 |
| **Archived seasons created before `game_definition_id` ride on a title fallback.** Fine while DECODE ships; a one-off backfill is cheap insurance before DECODE is ever dropped. | Not urgent; note for the BIOBUZZ release. | §8 Sprint 18 |
| **Realtime: 36 bindings per tab, 200-connection free-tier cap** (~15–25 teams online at once). | Fine for a few teams; the number to watch alongside egress. | §8 Sprint 25 |
| **The exit-127 Gate death** did not reproduce in Sprint 36; lead discredited. | A Gate that dies at random before a kickoff release is indistinguishable from one that found something. Capture output if it recurs. | §8 Sprint 36 |
| **Legal pages carry "Draft — pending legal review"** on every page, as the plan intended. | A coach reading the Terms before accepting them sees it. Decision in §4. | `LegalPage.tsx:69` |

---

## 3. Feature gaps, by when a beta team will feel them

**Before / at kickoff (Sept 12–19)**
- **Real BIOBUZZ scouting form, metrics and field image** (R-02). Everything downstream of scouting
  — the summary table, CSV, match plans — is only as good as this file.
- **The refocus fix** (R-01) — not a feature, but it is the difference between scouting data that
  survives a phone and scouting data that does not.

**First month (league meets start)**
- **Competitions read-only schedule view**, and a "next match" surface on the dashboard/scouting
  screen. Import-by-paste exists; looking at it does not.
- **Reports tab filter/sort/search.** The summary table answers "how good is team X"; the reports
  list still cannot find team X's five reports at a 30-team event (Sprint 15 note).
- **Pit scouting.** `kind` was deliberately left out (Sprint 26). Every scouting lead will ask.
- **Pick list** (drag-ordered alliance-selection list from the summary). The one scouting feature
  with a deadline the team cannot move.
- **Notifications.** None exist: no email/push for "you were approved", "meeting tomorrow",
  "checklist reset". The approval case was made visible in-app (WALK-B-05), but nothing reaches a
  student who is not looking.

**During the season**
- **Planner that teaches agile** (P-03): sprint entity, goals, retro, points/burndown, DnD. Today
  it is a kanban with five columns; the landing page and the pillar copy promise more.
- **Portfolio / engineering-notebook bridge** (P-07): export tasks + timeline + meetings +
  attendance + outreach hours for a date range. Cheap, unique, uses held data, and judged awards
  are where FTC teams actually need help.
- **Team data export** (Sprint 11): the Privacy Policy promises "just ask"; today that is a manual
  dump by Kevin.
- **Parent visibility for 13–17s** (P-05), read-only, on the guardian model that already exists.
- **Training content** (P-06): the stub is good; the eight tracks are empty.
- **Game-definition hot update** (P-01 phase M): the operator fixes a rubric without a release.
  R-02 is the argument for it; the counter-argument is that a release is ~10 minutes and this
  season has one game.

**Not gaps — deliberately out of scope, and should stay so for beta:** Stripe, form builder,
FTC Events API, act-as-child mode, SDPC NDPA (all decided D1–D9).

---

## 4. Decisions for the review session

1. **Fix R-01 before kickoff?** Recommendation: **yes**, it is the single most likely way a beta
   team loses data at its first meet, the fix is contained (`auth.tsx`: hold loading only when
   there is no user yet or the user id changed; never unmount routes for a same-user
   re-emission), and it needs a named regression test plus a real-phone lock/unlock check.
2. **The BIOBUZZ release plan.** Who reads the game manual on Sept 12, what the form looks like
   (fields, counters, metrics), where the field image comes from and under what licence, and the
   release window. Suggest a dry run this week: edit the JSON, run the Gate (the harness validates
   it at build time), see it render in the new-coach funnel.
3. **R-03 attestation copy.** Rewrite to match §3 and D1 now (bumps `coach_terms` to 2.1 and
   re-asks existing admins — currently only Kevin's two teams in production), or ship as is and
   accept that beta coaches attest to a per-member billing model that may never exist.
4. **The probation banner (R-07).** Options: show it only at ≤14 days; or reword the probation
   case ("Beta probation — we extend this to the full season once we've checked your team
   number", which the admin page already says); or extend each beta team to the season during
   onboarding so the banner never appears (that is the D3 normal path anyway).
5. **"Draft — pending legal review" on the legal pages.** Keep it during beta (honest), or drop it
   once the review that cleared the COPPA design (2026-08-22) is judged to cover the documents.
6. **Link scanners.** Build the `token_hash` route now (~S), or write the support script ("ask the
   coach to request a new link and open it on their phone") and wait for the first report.
7. **Onboarding mechanics for the free passes.** Beta coaches register themselves (18+, their
   attestation) and Kevin extends in the operator console — or Kevin pre-registers nothing and the
   30-day probation carries them until he looks. Recommend: coach registers, Kevin extends the same
   day, and the invite one-pager says both.
8. **Multi-team coaches**: build the `operator_grant_extra_team` button, or accept the support
   email path for the beta.
9. **Landing page** roles block (R-08) and the still-open LAND-05/06/07/09 (real screenshots,
   trust strip, OG image, mobile length). Cheap, and the page is the invite.

---

## 5. Kevin's prework — the seven days

**Product**
- [ ] Decide §4 items 1–4; schedule the R-01 fix and the BIOBUZZ release.
- [ ] Draft the beta welcome one-pager: URL, "register the team yourself (18+)", invite code lasts 7
  days, install to home screen (iOS 7-day rule), under-13 guardian path, support address, what
  "free beta pass" means and until when (`current_season_end()` = 2027-04-30).
- [ ] Run `npm run seed:demo` locally and take screenshots of a populated team for the one-pager /
  landing page (LAND-05).

**Production dashboard checklist (SEC-14 — none of this is in the repo or checked by anything)**
- [ ] Auth → URL configuration: Site URL `https://falcon-forge.com`, redirect allow-list clean
  (the triage says it is stale; an unmatched `redirect_to` falls back silently).
- [ ] Auth → email confirmations ON (`mailer_autoconfirm = false`); custom SMTP = Resend; rate
  limit 100/h; the six templates still match `supabase/templates/`.
- [ ] Auth → password policy (min length; hosted value unknown).
- [ ] API → max rows 1000 (paging assumes it).
- [ ] `platform_operators` has Kevin's row; edge-function secrets set; `support@` forwarding proven
  with one real inbound message this week.
- [ ] Resend dashboard: daily usage and domain still verified.
- [ ] Project not paused (nightly backup connections keep it awake; verify once).

**Testing on real hardware (the suite cannot do any of this)**
- [ ] iPhone Safari: add to home screen, sign in, go airplane-mode, enter a scouting report and a
  task, lock the phone, unlock, reconnect — confirm nothing is lost (R-01) and the queue drains.
- [ ] Android Chrome: same run; also the task modal with the keyboard up (Sprint 31 fix unobserved).
- [ ] One coach-and-student rehearsal against **production**: register a throwaway team, invite,
  approve, meeting + QR check-in, then erase it with the operator tools (runbook exists).
- [ ] `npm run venue` (venue simulation) against the local stack once.

**Ops**
- [ ] Manual backup before onboarding day (`beta-ops.md` says before and after).
- [ ] `npm run gate:db` once on `main` before the BIOBUZZ release; if exit 127 recurs, keep the output.
- [ ] Decide what to do when the production check goes red on the auth assertion during the
  kickoff deploy (it did twice on 08-29): check sign-in in a browser, do not add a retry.
- [ ] Stagger team onboarding evenings against Resend's 100/day.
- [ ] Re-run the restore rehearsal after the first beta cohort lands (documented trigger).

---

## 6. What this review did not cover

Production data (the read-only production query was blocked in this session, so row counts and
licence states there are from the 08-29 record); the recurring-meeting and attendance-override
flows; admin transfer end to end; the "I've turned 18" path; offline queue/conflict scenarios in
the browser (covered by the e2e pack in CI); real iOS/Android devices; screenshots of some 375px
routes (the in-app browser pane triggers R-01 on every capture, which is how R-01 was found).
