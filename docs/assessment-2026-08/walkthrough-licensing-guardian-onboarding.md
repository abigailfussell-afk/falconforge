# WALK-B — Hands-on walkthrough: first-run funnel, licensing states, guardian flow, auth edges

Tester: second hands-on agent. Method: Playwright (headless Chromium) node scripts in `$S\walkB\*.mjs`
against http://localhost:5189 (Vite dev, local Supabase), at 1280×800 (`-d.png`) and 375×812 (`-m.png`).
Screenshots: `$S\shots\walkB-*.png`. Raw logs: `$S\walkB\logs\*.log`. Confirmation e-mails read from
Mailpit (127.0.0.1:54324). The coordinator stopped the run before coverage items 5–8 and part of 4 were
reached — see "Not yet covered" at the end. Every claim below was observed unless marked otherwise.

**A note on the confirmation link locally.** `supabase/config.toml` `site_url` is `http://127.0.0.1:3000`,
nothing listens there, so GoTrue's 303 after `/auth/v1/verify` lands on a refused connection. I resolved the
303 myself and loaded `http://localhost:5189/#access_token=…` as a fresh document (`followVerifyLink` in
`lib.mjs`), which is what a click from a mail client produces in production. I could not see how
`e2e/registration.spec.ts`'s `page.goto(await confirmationLinkFor(email))` passes on this machine
(`curl -w %{redirect_url}` → `http://127.0.0.1:3000/#...`, connection refused); not investigated further.
**Important false alarm avoided:** my first attempt navigated from `/#/login` to `/#access_token=…` on the
same page — a fragment-only change, same document — and the token was discarded every time (HashRouter's
catch-all `Navigate` replaced the hash before supabase-js read it). With a real document load the token
is detected reliably (5/5, dev server and the built bundle on :5197). Worth knowing because it is exactly
what happens if a user pastes `…/#access_token=…` into the address bar of a tab already on the app — an
edge, not a beta blocker, and not filed as a finding.

---

## Findings (most severe first)

### WALK-B-01 — Guardian accounts cannot reach Edit Profile or Getting started: every `/app/*` route except `/app/guardian` bounces to the team picker
- **Severity:** High
- **Type:** bug
- **Status vs plan:** NEW (plan §8 records only the inert season picker and the re-attestation prompt for guardians)
- **Evidence:** `src/components/AppShell.tsx:184` — the no-team redirect is exempted only for
  `location.pathname.startsWith(`${APP_ROOT}/guardian`)`; 1 s later `navigate('/onboarding')`. Observed as
  `guardian@falconforge.test` and as the fresh guardian `parent-18ineg@`: `/app/profile` → `#/onboarding`,
  `/app/checkin` → `#/onboarding`, `/app/dashboard|board|admin|meetings|scouting` → `#/onboarding`.
  Screenshots `walkB-guardianS6-profile-d.png`, `walkB-guardianS5-checkin-d.png`, `walkB-guardian4-route-*-d.png`.
  The guardian's own sidebar renders an "Edit Profile" button and a "Getting started" nav item
  (`walkB-guardianS2-view-d.png`; nav list = `["nav-help"]`), both of which land on "Welcome! Let's get you
  set up."
- **Repro / how observed:** sign in as `guardian@falconforge.test` → click "I'm a parent or guardian" →
  click "Edit Profile" in the sidebar (or navigate to `#/app/profile`). You are on the onboarding picker
  one second later.
- **Impact:** Every guardian. They cannot rename themselves, cannot see the help page the rail offers them,
  and the "Switch team" button in their sidebar goes to the same Welcome screen. Also means the
  "I've turned 18" control is unreachable for a guardian (irrelevant for them, but the page is).
- **Fix direction:** In `AppShell.tsx` the redirect should be scoped to routes that need a team
  (board, checklist, scouting, planner, meetings, admin, dashboard, checkin) rather than "everything but
  guardian" — profile and help do not read team data. Alternatively the sidebar for a no-team account
  should not offer links that the shell will bounce. Add a test that renders AppShell with
  `currentTeamId = null` at `/app/profile` and asserts no navigation after 1 s.
- **Effort:** S

### WALK-B-02 — A guardian signs in to "Welcome! Let's get you set up." every time; the `GuardianOnly` routing the code comment promises does not exist
- **Severity:** Medium
- **Type:** ux / debt
- **Status vs plan:** NEW
- **Evidence:** `src/pages/Onboarding.tsx:85-86` says "A guardian's own view is `/app/guardian`, and
  `GuardianOnly` below routes them there." `grep -rn GuardianOnly src` finds only that comment. Observed:
  `guardian@` (two children on Iron Falcons, one approved with 3 attendance records) lands on
  `#/onboarding` showing "GET STARTED / Create a Team / Join with Invite Code / I'm a parent or guardian"
  at both widths — `walkB-guardianS1-landing-d.png`, `-m.png`. Same for the fresh guardian after promotion
  (`03b-claim.log`: "guardian lands: …/#/onboarding").
- **Repro / how observed:** sign in as `guardian@falconforge.test`.
- **Impact:** Every guardian, every sign-in: a parent with a rostered child is greeted as a brand-new user
  and has to know that "I'm a parent or guardian — Add a child who is too young for their own login" is
  the way to their child's attendance. The "Switch team" button in the guardian sidebar loops back here
  (`walkB-guardianS4-switch-team-d.png`).
- **Fix direction:** In `Onboarding.tsx`, when the membership query returns zero own memberships and the
  account holds ≥1 `managed_profiles` row, navigate to `/app/guardian` (or render the picker with the
  guardian entry first and relabelled "My children"). Delete or make true the `GuardianOnly` comment.
- **Effort:** S

### WALK-B-03 — After "Give them their own login" is claimed, the guardian's view shows the child as "Not on a team yet" and offers the hand-over again
- **Severity:** Medium
- **Type:** bug (ux)
- **Status vs plan:** NEW
- **Evidence:** `03b-claim.log`. The promotion worked server-side: `team_members` for the kid =
  `approved|student|seat_assigned=t|managed=f`; the guardian's own row is gone; the coach's roster shows
  "Zoë Kid / kid-5h48z0@…" (`walkB-guardian18-coach-after-promotion-d.png`). But
  `claim_managed_profile` (`supabase/migrations/20260822000200_guardian_access.sql:396-477`) only nulls
  `promotion_code`; `managed_profiles` has no "promoted" column (`\d managed_profiles`: id,
  guardian_user_id, full_name, notes, created_at, updated_at, promotion_code). The guardian view then
  renders the profile as "Not on a team yet — join with the code their coach gave you" with a fresh
  "Give them their own login" button (`walkB-guardian17-after-promotion-d.png`).
- **Repro / how observed:** guardian adds child → joins team → coach approves → guardian clicks "Give
  them their own login" → child signs up (13–17) and claims the code → guardian reloads `/app/guardian`.
- **Impact:** The parent who just handed the account over sees the child apparently dropped from the team,
  and can mint a second claim code for a profile that no longer holds a membership (a second account
  claiming it would get nothing — not tested). The "Nothing is lost" copy is contradicted by the screen.
- **Fix direction:** Record the promotion (`promoted_to_user_id` / `promoted_at` on `managed_profiles`,
  written inside `claim_managed_profile`), and have `GuardianView` render a promoted child as
  "Now has their own login (since …)" with no join/offer actions. Registry round-trip test for the new
  column; a guardian-view test that renders a promoted profile.
- **Effort:** M (migration on a frozen-ish schema + registry + view)

### WALK-B-04 — Invite deep link `/#/join/CODE` is lost across sign-up; the student must re-type the code
- **Severity:** Medium
- **Type:** ux (failure-modes §14, redirects that discard intent)
- **Status vs plan:** NEW (plan §8 records the "Unknown Team" pending bug as resolved; this is the step before it)
- **Evidence:** `02-student-join-mobile.log`: logged out, `/#/join/GYSQ6VQS` shows "Join a Team — You need
  to sign in or create an account to join a team. Sign In / Create Account"
  (`walkB-student0-join-link-logged-out-m.png`); after the sign-up + confirmation round trip the account
  lands on `#/onboarding` with no code remembered (`walkB-student1-after-confirm-m.png`), and the join
  form is empty. (Whether the plain *sign-in* path preserves the code was not reached — see "Not yet
  covered".)
- **Impact:** Every student who receives a link rather than a code. The code is in the URL they were sent,
  but on a phone the URL is gone once the mail app opens the confirmation link.
- **Fix direction:** Persist the invite code in `localStorage` (or signup metadata) when `/join/:code` is
  hit signed-out, and have `Onboarding` offer "Join Fresh Coach Falcons with code GYSQ6VQS" as the first
  action when one is stored; clear it on use. Same mechanism could carry a `returnTo` for other protected
  deep links.
- **Effort:** S

### WALK-B-05 — A pending student is never told they were approved; after approval the join page and `#/join/CODE` still show a blank form
- **Severity:** Medium
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `02-student-join-mobile.log`. After the coach approves, the student's open page (on
  `/#/join/GYSQ6VQS`, showing "You are already a member of this team") does not change; after reload it is
  an empty join form (`walkB-student12-after-approval-reload-m.png`); only navigating to any `/app/*` URL
  reveals "Select a team to continue" with the team now listed (`walkB-student14-student-admin-m.png`).
  The "Request Submitted! … View My Teams" screen (`walkB-student4-after-join-m.png`) likewise does not
  advance on its own.
- **Impact:** A student sits on "Pending Coach Approval" with no signal; the coach has to tell them "reload
  and pick the team". At a kickoff meeting with 12 students that is 12 verbal instructions.
- **Fix direction:** Poll (or Realtime-subscribe to) the user's own `team_members` row while the pending
  screen is shown and navigate to `/onboarding` → auto-enter the team when it flips to approved. Also: a
  signed-in member hitting `/join/CODE` for a team they are already approved on should be sent into the
  team, not shown the form.
- **Effort:** S–M

### WALK-B-06 — `Welcome back, Pat!` on the very first screen a brand-new coach ever sees
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `src/components/DashboardHome.tsx:82` unconditional "Welcome back"; `walkB-funnel10-first-app-screen-d.png`.
- **Fix direction:** Key on "team created < N minutes ago / zero tasks" → "Welcome, Pat! Here is how to start".
- **Effort:** S

### WALK-B-07 — Two team-number badges, two different truncations (`#99` vs `#911` for team 9911)
- **Severity:** Low
- **Type:** debt (principle 9)
- **Status vs plan:** NEW
- **Evidence:** `src/components/Sidebar.tsx:284` — `` `#${currentTeam.teamNumber.slice(0, 2)}` `` renders
  "#99"; the onboarding picker renders "#911" for the same team (`walkB-student14-student-admin-m.png`,
  `walkB-lic-full-landing-d.png` "#321" for 4321). Neither is the team number. FTC numbers are up to
  5 digits, so every badge is wrong.
- **Fix direction:** One `TeamBadge` component that shows the full number (or initials when none).
- **Effort:** S

### WALK-B-08 — Invite-code lifetimes disagree with the copy: the code minted at team creation lasts 24 h, "Generate Link" makes a 7-day one, the helper text says "Invite links last a week"
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `walkB-funnel12-invite-generated-m.png`: "F066BE26 — 23h 59m remaining" (from
  `create_team_as_admin`) next to "WU5FLRBF — 167h 59m remaining", under "Invite links last a week."
  The "Team Created Successfully!" screen hands the 24-hour code to the coach as "your team invite code".
- **Fix direction:** Give the creation-time invite the same TTL as `generate` (or say "valid for 24 hours"
  on the success screen).
- **Effort:** S

### WALK-B-09 — A brand-new self-serve team is labelled "Gifted licence"
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** KNOWN-adjacent (plan §8: "The trial licence in `create_team_as_admin` is temporary")
- **Evidence:** `walkB-funnel11-admin-m.png` "Licence & seats — Active — AVAILABLE Unlimited — COVER UNTIL
  11/20/2026 — Gifted licence". The coach gifted nothing and was told at step 1 "Billing: You will be
  billed monthly … (free during beta)".
- **Fix direction:** Label `source='gift'` grants created by the trial path as "Beta trial (90 days)";
  add `notes`/a source value that the label can key on.
- **Effort:** S

### WALK-B-10 — Child name has no length limit (142-character emoji name accepted, rendered in full everywhere)
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `03-guardian-desktop.log`: "DB managed_profiles: Zoë 🚀 Verylongchildname…|142";
  coach's pending list and roster, the join "Who is joining?" select and every guardian sentence repeat it
  (`walkB-guardian8-coach-pending-child-d.png`). Whitespace-only name is correctly refused (submit disabled).
- **Fix direction:** `maxLength` + trim on `AddChildDialog`, CHECK constraint or trigger on
  `managed_profiles.full_name`, and `truncate` classes on roster rows.
- **Effort:** S

### WALK-B-11 — A 13–17 member is offered in the "New team admin" nominate dropdown
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** KNOWN (plan §8: "`nominate_team_admin` refuses a `13_to_17` account outright") — adds that the dropdown still lists them
- **Evidence:** `walkB-student10-coach-approved-d.png`: "New team admin — Choose a member… — Sam Student —
  Nominate — They must be 18 or over…". Sam signed up as 13–17. Clicking Nominate was not tried (stopped).
- **Fix direction:** Filter the dropdown by `age_classification === '18_plus'` and say why when empty.
- **Effort:** S

### WALK-B-12 — The board still offers "New Item" to a lapsed (read-only) team; the outcome of the write was NOT verified here
- **Severity:** Medium (provisional)
- **Type:** ux
- **Status vs plan:** KNOWN (plan §8: "An unlicensed team's writes fail silently"; the client-side half — "stop offering writes" — is still open)
- **Evidence:** `src/lib/season-scope.ts` `canEdit: !!currentSeasonId && !isArchived` — entitlement is not
  an input; `04-licensing.log`: `[lapsed] New Item enabled=true title=New item` while the lapsed banner is
  on screen (`walkB-lic-lapsed-task-dialog-d.png`). The server side IS prepared: `sync-failure-classification.ts`
  classifies a `42501` with `entitlementStatus === 'read_only'` as terminal with a clear reason, and
  `SyncStatusIndicator` renders "N changes didn't save / Retry". **My probe did not actually submit a task**
  (the script clicked the wrong button — "Add Checklist Item" — and no 403 was recorded), so whether the
  user sees the terminal message is unverified. The lapsed banner itself is correct and prominent
  (`walkB-lic-lapsed-dashboard-d.png`, `-m.png`): "Your team's licence has lapsed — read only …".
- **Fix direction:** Fold `entitlement.status === 'read_only'` into `useSeasonScope().canEdit` with a
  title "Licence lapsed — read only"; then verify in the browser that a queued write hits the terminal
  path and the indicator says so.
- **Effort:** S

### WALK-B-13 — Stranded team (admin row deleted): the admin signs in to the blank Welcome screen with no mention of their team
- **Severity:** Low (operator case by design) — recorded for the operator-console reviewer
- **Type:** ux
- **Status vs plan:** KNOWN (seeded as "operator rescue case")
- **Evidence:** `walkB-lic-stranded-landing-d.png`: `stranded@` sees "Welcome! Let's get you set up. /
  Create a Team / Join with Invite Code / I'm a parent or guardian". Nothing says "Stranded Robotics exists
  and you used to run it; contact support".
- **Fix direction:** If `teams.owner_id = auth.uid()` for a team the user has no membership row on, show a
  "Your team Stranded Robotics needs an operator to restore your access — support@…" card on Onboarding.
  Needs a narrow `teams` SELECT for owners, or an RPC.
- **Effort:** S–M

---

## First-run funnel narrative (for the landing/marketing reviewer)

Timings are wall-clock from a headless Chromium on this machine, including my own waits (~0.8–3 s per
step), so treat them as "nothing is slow", not as user timings. Dev server, so no service worker.

### A. Brand-new coach (375×812 unless noted) — `01-coach-funnel-mobile.log`
| # | Step | Screenshot | t | Friction notes |
|---|------|-----------|---|----------------|
| 1 | Landing `/#/` | `walkB-funnel1-landing-m.png` | 2.4 s | Hero: "Don't just build your robot… FORGE IT". CTAs are **buttons, not links** (`Log In`, `Sign Up`, `Start Forging Now`, `Register a Team`) — fine for humans, no `href` for crawlers/middle-click. No mention of price, beta, or "free during beta" anywhere on the landing (billing is first mentioned inside the create-team agreement). |
| 2 | Login page | `walkB-funnel2-login-m.png` | 3.3 s | "Start Forging Now" goes to **Sign in**, not sign-up; the new coach must find "Don't have an account? Sign up". |
| 3 | Sign up step 1 | `walkB-funnel3-signup-step1-m.png` | — | Full Name / Email / Password / Continue. No password rules shown (server min is 6). |
| 4 | Sign up step 2 | `walkB-funnel4-signup-step2-m.png` | — | "How old are you? 18+/13–17/under 13" + one checkbox "I have read and agree to the Privacy Policy and Community Guidelines". The under-13 option is offered to someone creating their own login — what happens if chosen was not tested. |
| 5 | "Check your email" | `walkB-funnel5-check-email-m.png` | 6.0 s | Good: "Account created! Please check your email to verify your account, then sign in." It is a banner on the login form, so the coach can sign in right here afterwards. Console warning at this moment: `Could not record privacy_and_guidelines at sign-up: Not authenticated` (expected — no session until confirmation; the trigger records it). |
| 6 | Confirmation e-mail | — | <1 s | Subject "Confirm your email address", one link. Locally it redirects to `127.0.0.1:3000` (config), production to Site URL (plan §8 "signUpWithEmail passes no emailRedirectTo"). |
| 7 | After the link | `walkB-funnel6-after-confirm-m.png` | 9.1 s | Lands **signed in** on `#/onboarding`: "Welcome! Let's get you set up." with Create a Team (highlighted) / Join with Invite Code / I'm a parent or guardian / "Have a code from your parent or guardian?". Clear. |
| 8 | Create team, step 1 | `walkB-funnel7-create-team-step1-m.png` | 10.1 s | "Admin Agreement": Terms, **Billing: "You will be billed monthly based on approved team members (free during beta)"**, COPPA. Single checkbox "I am 18+ and I agree…". A 13–17 account can reach this screen (not tested what happens). |
| 9 | Create team, step 2 | `walkB-funnel7-create-team-step2-filled-m.png` | 11.5 s | Team Name (min 3), First Season (pre-filled "2026-2027 Season"), FTC Team Number (optional). Good. |
| 10 | Success | `walkB-funnel8-create-team-done-m.png` | 12.8 s | "Team Created Successfully! … Your team invite code: F066BE26 — Share this code". This code is the 24-hour one (WALK-B-08). |
| 11 | First app screen | `walkB-funnel10-first-app-screen-m.png` | 17.9 s | Dashboard: "Welcome back, Pat!" (WALK-B-06), four zero stat tiles, Quick Actions, "Plan your first sprint". The rail has "Getting started" last. Nothing points at Admin Settings → invite, which the Getting-started page says is step 3. |
| 12 | Admin Settings | `walkB-funnel11-admin-m.png` | 20.4 s | "Licence & seats: Active / Unlimited / Cover until 11/20/2026 / Gifted licence" (WALK-B-09). Invite Links, Roster, Sub-teams (5 defaults: Programming, Build, Drive, Scouting, Outreach), Season Manager. Dense but complete. |
| 13 | Generate Link | `walkB-funnel12-invite-generated-m.png` | 22.0 s | New code shown as a code, not a URL, with "Copy"? (not verified) — the help copy says "a code is not an email". |
| 14 | Getting started | `walkB-funnel13-help-m.png` | — | Reads well; step list matches the admin page (season, sub-teams, invite, approve, …). Not checked beyond step 4 (stopped). |

Sign-up to working team: **~18 s of machine time and four screens**; no dead ends observed. The points a
non-technical coach could stall on: (2) "Start Forging Now" landing on *sign in*; (5→7) the confirmation
link must be opened on a device where the app then loads — on a phone it will, in the browser, not the
installed PWA; (11) nothing on the first dashboard says "now invite people".

### B. Student joining with a code (375×812) — `02-student-join-mobile.log`
| # | Step | Screenshot | Notes |
|---|------|-----------|-------|
| 1 | `/#/join/CODE` signed out | `walkB-student0-join-link-logged-out-m.png` | "Join a Team — You need to sign in or create an account". Code not carried forward (WALK-B-04). |
| 2 | Sign up 13–17, confirm | `walkB-student1-after-confirm-m.png` | Onboarding shows Join / guardian options only (no Create a Team for a 13–17 — good). |
| 3 | Join form | `walkB-student2-join-form-m.png` | Input uppercases as you type; submit disabled under 6 chars and for whitespace. `' OR 1=1 --`, `ZZZZZZZZ`, six emoji → "Invalid or expired invite code". Lower-case valid code accepted (case-insensitive, good). |
| 4 | Pending | `walkB-student4-after-join-m.png` | "Request Submitted! Your request to join Fresh Coach Falcons-sacnel … Pending Coach Approval … View My Teams". Team is named (the "Unknown Team" fix holds). |
| 5 | Pending, elsewhere | `walkB-student7-pending-onboarding-m.png` | `/app/board` → onboarding "PENDING INVITATIONS — Fresh Coach Falcons-sacnel — Pending Coach Approval". Joining twice → "You are already a member of this team". |
| 6 | Coach approves | `walkB-student9-coach-sees-pending-d.png`, `walkB-student10-coach-approved-d.png` | "Pending Approvals (1) — Sam Student" → Approve → "Active Members (2)", "SEATS IN USE 2", invite shows "1 used". |
| 7 | Student after approval | `walkB-student11…`, `-12…`, `-14-student-admin-m.png` | No signal (WALK-B-05); after navigating, "Select a team to continue — #911 Fresh Coach Falcons-sacnel". Student app/profile screens were reached in the claim run (`walkB-guardian16-kid-in-app-d.png`, `walkB-guardian16b-kid-profile-d.png`): rail without Admin Settings; profile shows "Your account is recorded as 13–17 … I've turned 18". |

### C. Guardian (1280×800) — `03-guardian-desktop.log`, `03b-claim.log`
| # | Step | Screenshot | Notes |
|---|------|-----------|-------|
| 1 | Sign up 18+, confirm, "I'm a parent or guardian" | `walkB-guardian1-empty-d.png` | `/app/guardian`: "My children — You sign in; they take part. — Add a child". Sidebar shows "SEASON" with an empty picker, "Tasks Done 0/0", "T / Select Team", "Switch team" — team chrome with no team (plan §8 KNOWN for the picker; the rest is the same class). |
| 2 | Add a child | `walkB-guardian2-add-child-dialog-d.png` | Name, notes, consent checkbox with the full sentence and "Documents version 2.0". Whitespace name refused. |
| 3 | Child card | `walkB-guardian3-child-added-d.png` | "CONSENT YOU GAVE: Holding my child's information v1.0 · Terms v2.0 · Privacy Policy v2.0 · Community Guidelines v2.0" (versions match `attestation-versions.ts`: coppa 1.0, documents 2.0). |
| 4 | Join for the child | `walkB-guardian5-join-form-d.png` | Join form grows "Who is joining? Me / Zoë…" with "Your child does not need a login — you hold the account." Clear. |
| 5 | Pending | `walkB-guardian7-child-pending-d.png` | "Waiting for the team admin to approve Zoë… Nothing for you to do". |
| 6 | Coach side | `walkB-guardian8-coach-pending-child-d.png` | Pending row says "Guardian: parent-…@ — This member is a child joining through their parent or guardian. I confirm I will not add a child to this team without their guardian." Approve is disabled (title "Confirm the guardian statement first") until the checkbox is ticked. Good. DB: `approved|student|seat_assigned=t|managed=t`. |
| 7 | Approved | `walkB-guardian10-child-approved-d.png` | Child card now "Fresh Coach Falcons-sacnel", COMING UP "Nothing scheduled yet". Seeded `guardian@` shows real data: three upcoming events and "Attended 3 of 3 recorded so far. Most recent: Present." (`walkB-guardianS2-view-d.png`). |
| 8 | Give them their own login | `walkB-guardian11-promotion-offered-d.png` | "Give Zoë… this code. They sign up with their own email, then enter it. JVN6VNEF — Copy — Cancel this code". |
| 9 | Child claims | `walkB-guardian13-kid-claim-form-d.png` … `-16-kid-in-app-d.png` | Onboarding "Have a code from your parent or guardian?" → "Your code — Eight characters…". Wrong code / SQL-ish → "That code is not valid"; 7 chars → button disabled; lower-case accepted. After claim: team picker → full student app, attendance retained (DB row keeps id, `managed=f`). Reusing the code from a second fresh account → "That code is not valid" (single use — good). |
| 10 | Guardian afterwards | `walkB-guardian17-after-promotion-d.png` | WALK-B-03. Re-attestation prompt appeared for `guardian@` on the guardian view (`walkB-guardianS2b-reattest-d.png`) — plan §8 KNOWN, reproduced. |

---

## Licensing states (coverage item 2) — `04-licensing.log`, both widths

| Account | Lands | Banner | Admin "Licence & seats" | Generate Link | Approve | Board "New Item" |
|---|---|---|---|---|---|---|
| `full@` (3/3 seats, 4 pending) | team picker → dashboard | none | "Active — 3 of 3 — AVAILABLE 0 — Open-ended — Every seat is in use. Requests to join can still be received, but approving one needs a seat — remove a member or add seats first." Pending list headed "No seats left — 3 of 3 in use" | **disabled**, title "Every seat is in use — a new code could not be approved by anyone" | **disabled**, title "No licensed seats left — remove a member or add seats first" (`walkB-lic-full-admin-d.png`, `-m.png`) | enabled |
| `lapsed@` (expired yesterday) | team picker → dashboard | `licence-lapsed-banner`: "Your team's licence has lapsed — read only. Everything your team has made is still here and still readable. Nothing has been deleted. Cover ended 8/21/2026. See licence details." (also rendered as `role=alert`) | "Read only — 4 members — AVAILABLE No licence — COVER ENDED 8/21/2026" | disabled, but the title says "Every seat is in use…" — **wrong reason for a lapsed team** (minor copy bug; `walkB-lic-lapsed-admin-d.png`) | n/a | **enabled** (WALK-B-12) |
| `expiring@` (9 days) | team picker → dashboard | `licence-expiring-banner`: "Your team's licence ends in 9 days (8/31/2026). After that the team becomes read-only — nothing is deleted. See licence details." | "Active — 5 of 10 — COVER UNTIL 8/31/2026 — Cover ends in 9 days…"; invite copy adds "New links are capped at the 5 seats you have free" | enabled | n/a | enabled |
| `stranded@` | Welcome/onboarding, no team (WALK-B-13) | — | unreachable | — | — | — |

Observed: `full@` also shows an **"Operator"** rail item (I inserted `full@`'s user id into
`platform_operators` per the brief; row note "WALK-B review: local only") — console not walked (stopped).
The re-attestation prompt fired on first entry for full/lapsed/expiring (seeded accounts with 1.0 acceptances
— expected). No 4xx/5xx from any licensing screen.

**Queued-before-lapse probe (inconclusive, do not cite as a result):** as `expiring@`, offline, I opened
New Item and clicked a save button; reconnected after `update license_grants set valid_until = now() -
1 minute`. Result: sync "Live", `syncQueue 0`, `syncFailures 0`, no task on the server, no message. Because
the script matched "Add Checklist Item" rather than the task dialog's save, the most likely reading is
that nothing was queued; it is equally consistent with a silent drop. Needs a rerun with the right
selector. Grant restored to +9 days afterwards (`valid_until` now `2026-08-31 19:57 UTC`).

---

## Auth edges reached (coverage item 4, partial)
- **Password reset end to end:** "Forgot password?" → "Reset your password / Send Reset Link" →
  "Password reset email sent!" (`walkB-auth-forgot-sent-d.png`); mail "Reset your password"; link as a fresh
  document lands on `#/auth/reset-password` with a session (5/5 in `diag-race2.mjs`, dev and built bundle).
  The *form submission* on that page was not reached (my run had discarded the token — see the note at
  the top). `#/auth/reset-password` with no session: "This recovery link has expired — Recovery links
  can only be used once, and they time out. Request a new one…" (`walkB-auth-reset-no-session-d.png`). Good.
- **Reusing a verify link:** second use 303s to `#error=access_denied&error_code=otp_expired&
  error_description=Email+link+is+invalid+or+has+expired`; the app's catch-all sends that to the landing
  page with **no message** (`walkB-auth-recovery-link-reused-d.png` shows the plain landing). The same
  happens for an expired sign-up link. Low-severity UX: the fragment's `error_description` should be
  surfaced on the login page. (Not filed as a numbered finding because only observed via same-document
  navigation; needs a fresh-document confirmation.)
- **Enumeration:** not tested (stopped).
- Everything else in item 4 — wrong-password copy, session persistence, sign-out clearing IndexedDB,
  deep-link return after login, "I've turned 18" (screen seen: `walkB-guardian16b-kid-profile-d.png`,
  control not clicked) — **not reached**.

---

## Appendix A — Screens seen (all under `$S\shots\`, `-d` 1280×800, `-m` 375×812)
Landing; Login; Sign-up step 1/2; Check-your-email banner; Forgot-password form/sent; reset-password (no
session); Onboarding — new account / pending / picker / guardian entry / claim-code form; Create team step
1 (agreement) / step 2 / success; Dashboard (new team, full, lapsed, expiring); Admin Settings (new team
before/after Generate Link, full, lapsed, expiring, pending student, pending child, after approvals, after
promotion); Board New Item dialog (full, lapsed, expiring); Getting started (mobile); Join form (empty,
SQL/wrong/emoji errors, guardian "Who is joining?", already-a-member, after approval); Request Submitted;
Guardian view (empty, child added, pending, approved, promotion code shown, after promotion; seeded
`guardian@` with attendance; mobile drawer; re-attestation prompt); Student app dashboard + profile
("I've turned 18"); Claim-code wrong/claimed/reuse; Stranded onboarding. File list:
`ls $S\shots\walkB-*.png` (≈110 files).

## Appendix B — Console / network errors
Every page, every context (dev server):
- `[error] The script has an unsupported MIME type ('text/html')` + `[pageerror] SecurityError: Failed to
  register a ServiceWorker … /sw.js` — dev server has no SW; expected, not a finding.
- 2× React Router v7 future-flag warnings (`v7_startTransition`, `v7_relativeSplatPath`) on every load.
- `[warning] Could not record privacy_and_guidelines at sign-up: Not authenticated` at sign-up submit
  (expected with confirmations on; the trigger records it — and the fresh accounts were NOT shown the
  re-attestation prompt, so the server-side record works).
- **4xx/5xx: none** across all runs (`dumpCtx` on ~20 contexts). No `pageerror` other than the SW one.

## Not yet covered (stopped by coordinator)
- Item 4 remainder: wrong-password message, sign-up with an existing e-mail (enumeration), session
  persistence across reload, sign-out → IndexedDB/localStorage cleared, re-attestation accept path,
  "I've turned 18" click, protected deep link → login → return.
- Item 5 legal pages (`/#/legal/terms|privacy|community`), version text vs prompt, landing footer links.
- Item 6 GettingStarted accuracy beyond step 4.
- Item 7 operator console (`full@` is now in `platform_operators` and shows the "Operator" rail item;
  nothing walked; stranded rescue not attempted).
- Item 8 multi-team / team switcher. (Note: "Switch team" exists in the sidebar; for a guardian it goes to
  the Welcome screen.)
- Adversarial: duplicate team names, long/emoji team names, confirmation link clicked while signed in as
  someone else, a 13–17 or under-13 account attempting Create a Team, under-13 sign-up path.
- The licence-lapsed write outcome (WALK-B-12) and the queued-before-lapse scenario — rerun needed.
- All guardian/student screens at 375 px for the fresh-account flows (seeded `guardian@` was done at both
  widths; the fresh guardian and claim flows at desktop only; student flow at mobile only).

## Summary
- The self-serve coach funnel works end to end with email confirmation: ~4 screens, no dead ends, lands
  signed-in on onboarding. Copy gaps: "Start Forging Now" → sign-in, "Welcome back" on first screen,
  "Gifted licence" on a trial, 24 h vs 7-day invite codes.
- Guardians are the weakest account type in the shell: every `/app/*` route but `/app/guardian` bounces to
  the team picker (WALK-B-01, so Edit Profile and Getting started are unreachable), every sign-in lands on
  "Welcome! Let's get you set up" (WALK-B-02), and a completed hand-over shows the child as "Not on a team
  yet" with a second hand-over offered (WALK-B-03).
- Join/approve is correct but silent: the invite deep link is lost across sign-up (WALK-B-04) and approval
  never reaches the waiting student (WALK-B-05).
- Licensing states render exactly as designed: lapsed and expiring banners, seat-full refusals with
  honest tooltips, approve/generate disabled for the right reasons (one wrong tooltip on lapsed). The
  board still offers New Item to a lapsed team; what happens after is unverified (WALK-B-12).
- Promotion (claim code) is solid server-side: single-use, case-insensitive, membership id/seat/attendance
  preserved; refusal copy is good.
- Password recovery and sign-up confirmation tokens are detected reliably on a real document load (dev
  and built bundle); a fragment-only navigation on an already-open app page discards them, and an
  expired/reused link error is shown to nobody.
- Zero 4xx/5xx and zero runtime errors across ~20 browser contexts.

## Confidence / not checked
High confidence: WALK-B-01/02/03/04/05/07/08 (code + screenshots + DB). Medium: WALK-B-12 (UI half
observed; write outcome not). Low / inconclusive: queued-before-lapse probe. Not checked: everything under
"Not yet covered". The e2e `registration.spec.ts` passing locally could not be reconciled with the
`site_url` redirect to `127.0.0.1:3000` — not investigated.
