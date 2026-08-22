# WALK-A — Hands-on walkthrough, core roles (Iron Falcons)

Method: headless Chromium via Playwright node scripts in `$S\walkA\` (`01-routes.mjs`, `02-flows.mjs`, `03-feat.mjs`, `04-comment.mjs`, `05-comment-nosave.mjs`, `06-admin.mjs`, `07-offline.mjs` — the last one was written but NOT run; the coordinator stopped the session). Every route was loaded at 1280×800 and 375×812 with a full reload on each, console/pageerror/4xx-5xx capture, `scrollWidth` overflow check, tap-target and label scan, and axe-core (wcag2a/aa) on desktop. Raw results: `$S\walkA\*.json`, logs `$S\walkA\*.log`. All DB checks ran with `docker exec … psql` against the local stack. Iron Falcons team id `3fbd82ac-…1445`, season `48d69f0e-…`.

Data the run left behind (local DB only): tasks "A very long task title…", "DoubleSubmit test"; match plans "Walk plan 1" + "Match Plan 8/22/2026, 2:47:17 PM"; checklist template "Walk template"; meetings "Walk one-off…" (code FF-9458); sub-teams "Pit Crew 🛠 ppp…" and "Drive Team"; a NEW season "2027-2028 Season" (game "NEXTGAME") with the 2026-2027 season now ARCHIVED. Other agents using Iron Falcons should know the current season changed.

---

### WALK-A-01 — Task comments from anyone but yourself render as "Guest" (FEAT-01 cross-check: CONFIRMED)
- **Severity:** High
- **Type:** bug
- **Status vs plan:** NEW (not in plan §8 / failure-modes; matches static audit FEAT-01)
- **Evidence:** `$S\shots\walkA-d-student-comment-own.png` (student sees own comment as "I0 Iron Student 0") vs `$S\shots\walkA-d-admin-sees-student-comment.png` (admin sees the same comment as "G Guest"). Dialog text captured in `04-comment.mjs`: student view `I0 | Iron Student 0 | 8/22/2026 | student0 says hi`; admin view `G | Guest | 8/22/2026 | student0 says hi`. DB: `tasks.timeline[0].authorId = 52bf902f-…` which is `auth.users.id` of iron-student0, while `team_members.id` for that user is `ee69b86c-…`. Writer: `src/components/SprintPlanning.tsx:137` (`authorId: profile?.id`); reader: `src/components/SprintTaskActivity.tsx:49` (`teamMembers.find(m => m.id === authorId)`).
- **Repro / how observed:** Sign in as iron-student0, open any task on the board, send a comment, Save. Sign in as reviewer, open the same task.
- **Impact:** Every team, every comment: a coach reading the activity feed cannot tell who wrote anything. Also the comment "Delete" control is rendered for every comment regardless of author (I deleted the student's comment as admin by accident in `04-comment.mjs` — it matched the first "Delete" button).
- **Fix direction:** Pick one identity for `TimelineEvent.authorId` (recommend the `users.id`, which is what is already stored) and resolve by `teamMembers.find(m => m.userId === authorId)` in `SprintTaskActivity.describeAuthor`; add a regression test with a comment authored by a *different* member than the viewer (the existing tests only cover self/System). Existing rows already store `users.id`, so no migration. Consider hiding the per-comment Delete for non-authors / non-managers.
- **Effort:** S

### WALK-A-02 — On an archived season the task modal accepts edits, comments and deletes, then silently drops them (FEAT-02 cross-check: CONFIRMED)
- **Severity:** High
- **Type:** bug
- **Status vs plan:** NEW (Sprint 4 plan says archived seasons are read-only; the board's New button honours it, the modal does not)
- **Evidence:** `03-feat.mjs` step "FEAT-02 task modal on archived season": `newDisabled:true`, but inside the modal `Save` enabled, `Delete` enabled, comment send enabled (`sendDisabled:false`). After editing the title and pressing Save: modal closed (`modalGone:true`), card title unchanged, DB unchanged, sync indicator "Live", and the ONLY feedback was two `console.warn` lines: `[store] updateTask ignored: season 48d69f0e-… is archived (read-only)`. Screenshots: `$S\shots\walkA-d-board-archived-season.png`, `walkA-d-board-archived-season-modal.png`, `walkA-d-board-archived-season-after-save.png`. (Note: the archive toggle's write itself took >1.75 s to reach Postgres — `db:"f"` immediately after click, `t` later.)
- **Repro / how observed:** Admin Settings → Archive the current season → Sprint Planning → click any card → change title / add comment → Save Task.
- **Impact:** A coach looking back at last season thinks they annotated a task; nothing is stored and nothing says so. Also affects the scouting Delete icon (disabled correctly) vs the scouting card click which still opens the editable modal (not verified to the end).
- **Fix direction:** `SprintTaskDetail` and `SprintTaskActivity` should take `canEdit` from `useSeasonScope()` and disable Save/Delete/Archive/send with the same `title` explanation used on the New button; better still, render the modal read-only. Replace the `console.warn` in `createTaskSlice.updateTask/deleteTask` with a user-visible toast so that a refused write is never silent (principle 2).
- **Effort:** S

### WALK-A-03 — Match Planner "Load" then "Save" creates a duplicate plan, and robots / name are not persisted (FEAT-05 cross-check: CONFIRMED)
- **Severity:** Medium
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `03-feat.mjs` "FEAT-05": `match_plans` count before=1, after=2; titles `Walk plan 1` and `Match Plan 8/22/2026, 2:47:17 PM`; the Save modal's name field was empty after loading a named plan (`prefilledName:""`). `src/components/MatchPlanner.tsx:69-84` only calls `addMatchPlan`; there is no `updateMatchPlan` path. The "draggable robots" d3 code at lines 96-113 binds to `.draggable-robot` but no such element is rendered (`robots:0` on the page), and `drawingData` stores only pen paths. Screenshots: `walkA-d-planner-drawn.png`, `walkA-d-planner-load-modal.png`, `walkA-d-planner-loaded.png`, `walkA-d-planner-save-modal.png`.
- **Repro / how observed:** Planner → draw → Save "Walk plan 1" → reload → Load → pick it → edit notes → Save → Save.
- **Impact:** Every edit of a plan during an event creates a new unnamed plan; the list fills with "Match Plan <timestamp>" rows. Drawing DOES persist and reload (paths 1 → 1 after load), so the core works.
- **Fix direction:** Track `loadedPlanId` in MatchPlanner; when set, pre-fill the title and call an `updateMatchPlan` store action (entity-registry already round-trips match_plans). Delete the dead d3 drag block or render the robot tokens it expects.
- **Effort:** S

### WALK-A-04 — Due dates show one day early (stored as UTC midnight, displayed in local time)
- **Severity:** Medium
- **Type:** bug
- **Status vs plan:** KNOWN (plan §8: "Due dates render one day early"; failure-modes.md:306). Reproduced; still present on main today.
- **Evidence:** Entered `2026-09-15` in the task modal; card shows `9/14/2026` (`$S\shots\walkA-d-board-after-create.png`); DB `tasks.due_date = 2026-09-15 00:00:00+00`. Modal re-opens showing 09/15/2026 because it formats via `toISOString().substr(0,10)` while `SprintBoard.tsx` uses `toLocaleDateString()` — two renderings disagree on the same value.
- **Repro / how observed:** Any machine west of UTC (this one). Set a due date, look at the card.
- **Impact:** Every US team; a deadline "Friday" reads "Thursday" on the board and in the calendar view.
- **Fix direction:** Treat `due_date` as a date-only value end to end: one formatter in `src/lib` that parses `YYYY-MM-DD` as local, used by board, list, calendar and modal; regression test run with `TZ=America/Chicago`.
- **Effort:** S

### WALK-A-05 — Sprint planner has no drag-and-drop, no sprints, no filters/search
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW as an observation (the plan calls it "agile sprint planning")
- **Evidence:** `02-flows.mjs`: cards have `draggable=null`; `card.dragTo(column)` left the card where it was. There is no sprint entity anywhere (`SprintPlanning.tsx` is a 5-column status board over `tasks`); "complete sprint" does not exist. `inputs:0` — no search/filter control on the board, list, or calendar. Status can only be changed inside the modal via the Status `<select>`. Screenshots: `walkA-d-board-view-List.png`, `walkA-d-board-view-Calendar.png`, `walkA-d-board-view-Archived.png`, `walkA-m-_app_board.png`.
- **Impact:** Workable but slow for a pit crew on a phone: three taps and a dropdown to move one card. At 1280 px the "Done" column is off-screen to the right of the board (`walkA-d-board-after-create.png` shows only 4 columns).
- **Fix direction:** Decide whether "sprint" is a real concept (then it needs a table, season-scoped) or rename the feature "Task board". Add a pointer-events-based move (or a quick "Move to →" menu on the card) before adding DnD library weight; add an assignee/sub-team filter bar. Make the board columns fit at 1280 (`md:w-64` × 5 + gaps > content width).
- **Effort:** M (filters/move) · L (real sprints)

### WALK-A-06 — Scouting form is hard-coded to the 2025-26 DECODE game; no event filter; no input validation
- **Severity:** High (for Sept 2026 kickoff)
- **Type:** unfinished
- **Status vs plan:** KNOWN-in-spirit (plan §8 line 464 mentions `DecodeField.png`); the field list itself is not recorded
- **Evidence:** Modal fields captured by `02-flows.mjs`: Team #, Match # (number), Event Name, Has Autonomous, Auto Score, Intake Type {No Intake, Human Player, Automatic}, Auto Aim, Far Shooting, Shots taken/missed, Parking {No Park, Partial, Full}, Driver rating 1-5, Notes (`ScoutingReports.tsx:376-417`). Match Planner background is `public/DecodeField.png` (`constants.ts:33`), partner capability "Lifted Park". No filter/sort/search on the reports page (`filterControls` counted only the dialog select). Team # accepted `-12345678901234567890 🦅` and pushed the "No match #" badge outside its card; Match # accepted `-5` and was saved as "No match #"; 5 000-char notes render unbounded (`$S\shots\walkA-d-scouting-after-create.png`). Season "Edit" does let an admin upload a custom field image, so the planner is partially season-aware; the scouting schema is not.
- **Impact:** Beta teams start scouting the 2026-27 game in September with last year's fields. At an event with 30+ teams × 5 matches there is no way to find a team's reports.
- **Fix direction:** Per the plan's "season carries the game" idea: a per-season scouting schema (JSON field definitions rendered generically) or at minimum a neutral generic form (auto points, teleop points, endgame level, rating, notes) plus team/event/match filters and sort. Validate team # (1-5 digits), match # ≥ 1, cap notes; `word-break` on the card header.
- **Effort:** M

### WALK-A-07 — "Later" on the re-attestation prompt does not survive a reload; it reappears on every page load
- **Severity:** Medium
- **Type:** ux
- **Status vs plan:** KNOWN-but-worse (plan §8 line 780 notes it can block a QR check-in; failure-modes.md:416 the "wrong cause" fix). Observed: the prompt came back on EVERY `page.goto`/reload for reviewer@ across all 8 scripts — 60+ times in this run.
- **Evidence:** `$S\shots\walkA-d-fail-board_new_task_open.png`, `walkA-d-fail-planner_draw_save_reload_load.png` — each is a fresh load with the modal back over the work. My harness had to add `dismissLater()` after every navigation.
- **Impact:** Anyone who picks "Later" on a phone will see the modal again on every cold start / PWA resume — exactly the moment a student scans a QR. Seed accounts (created at attestation 1.0) show this; real accounts created before Sprint 6 will too.
- **Fix direction:** Persist the "Later" choice (localStorage with the version it dismissed, or a `users.attestation_snoozed_until`) so the prompt returns on a schedule, not on every load; never render it on `/app/checkin/*`.
- **Effort:** S

### WALK-A-08 — Task modal: focus is not moved into the dialog and Escape does not close it
- **Severity:** Low
- **Type:** ux (accessibility)
- **Status vs plan:** NEW
- **Evidence:** `02-flows.mjs` "keyboard": `opened:true`, `focusInDialog:false`, `closedByEsc:false` on an EXISTING task (new-task path does focus the title input via `titleInputRef`). `Modal` renders `role=dialog aria-modal=true` (good) but no initial focus / Esc handler for existing tasks. Not measured: whether Tab cycles out of the dialog (script step failed on a selector).
- **Fix direction:** In `src/components/ui/Modal.tsx` focus the first focusable on mount, trap Tab, close on Escape; one implementation for every modal (principle 9).
- **Effort:** S

### WALK-A-09 — Accessibility: 14 unlabeled role `<select>`s on Admin Settings, unlabeled "show past" toggle, low-contrast secondary text everywhere
- **Severity:** Low
- **Type:** ux (accessibility)
- **Status vs plan:** NEW
- **Evidence:** axe-core on desktop (`$S\walkA\routes-admin.json`): `/app/admin` → `select-name` critical ×14 (`MemberManager.tsx:510` role selector has no label/aria-label); `/app/meetings` → `button-name` critical ×1 (`data-testid=show-past-toggle`, a `Toggle` with no accessible name); `color-contrast` serious on every page: 3.07:1 for the "SEASON" label `#64748b` on `#1e293b` (11 px), 2.52:1 for the sidebar "Tasks Done" denominator, 4.03:1 for initials badges; `/app/board` reports 21 nodes (card dates `text-slate-500` on `dark:bg-slate-700`). The task-modal labels (`SprintTaskDetail.tsx:88-145`) are `<label>`s without `htmlFor`, so the selects are announced without names (axe did not run with the modal open).
- **Fix direction:** `aria-label="Role for <name>"` on the role select; `aria-label` on Toggle when no visible label; bump the 2xs/xs slate-500-on-dark tokens one step (slate-400) in the Tailwind palette; `htmlFor`/`id` pairs in the task modal.
- **Effort:** S

### WALK-A-10 — Mobile tap targets under 32 px on several screens
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** 375×812 geometry scan (`routes-admin.json`, `vp:"m"`): Admin → `Approve` 40×28, `Reject` 40×28, `Generate Link` 133×30, COPPA attest checkbox 13×13; Meetings → 20 controls under 32 px high (List/Calendar 28 px, type filter pills 26 px); Planner → partner capability checkboxes 13×13; Dashboard → "Open the full check-in screen" 174×14, "View all project updates" 317×14; sidebar "Edit Profile" link 57×14 on every page. No horizontal overflow was found on any route at 375 px (all `scrollWidth == innerWidth`). Screens: `$S\shots\walkA-admin-m-*.png`.
- **Fix direction:** Apply the existing `touch-target` utility to pills/filter buttons and the dashboard text links; enlarge checkboxes via the `accent-*` inputs' wrapper label padding (already done for some).
- **Effort:** S

### WALK-A-11 — Very long titles: meeting title does not wrap; scouting team number does not wrap
- **Severity:** Low
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `$S\shots\walkA-d-meetings-after-create.png` — a 165-char unbroken title is clipped at the right edge of the detail header (no `break-words`); `walkA-d-scouting-after-create.png` — team number overflows the card. Task titles DO wrap correctly (`walkA-d-board-after-create.png`). No length limits on any title/name field (sub-team name accepted 125 chars + emoji, stored verbatim).
- **Fix direction:** `break-words`/`overflow-wrap:anywhere` on headings; `maxLength` on title inputs (80–120) with the same limit in a DB CHECK.
- **Effort:** S

### WALK-A-12 — Sign-out leaves `FalconForgeDB` (IndexedDB) in place
- **Severity:** Low (needs confirmation)
- **Type:** security/privacy
- **Status vs plan:** Possibly KNOWN (failure-modes.md:82 says `clearLocalDatabase()` is called on sign-out — so the DB name persisting may be an empty shell)
- **Evidence:** `06-admin.mjs` "sign out": after sign-out `localStorage` had no `sb-*-auth-token` (good) but `indexedDB.databases()` still listed `FalconForgeDB`. I did NOT inspect whether its stores were emptied.
- **Fix direction:** Verify with a Dexie count after sign-out; if tables are empty this is a non-issue (Dexie keeps the schema). If rows remain, a shared pit laptop keeps the roster readable by the next person.
- **Effort:** S (verify)

### WALK-A-13 — Observations that are design choices worth a second look (no bug)
- **Invite link generation is disabled when every seat is in use** (`title="Every seat is in use — a new code could not be approved by anyone"`). Reasonable, but an admin cannot even let a student *request* to join before a seat frees up. (`walkA-d-admin-top.png`)
- **Team name cannot be edited** anywhere in Admin Settings (no rename control; plan §8 line 527 hints at a governance reason).
- **There is no "Unsaved changes" guard**: editing a task then pressing Cancel / closing discards silently (by design, but comments sent with the paper-plane ARE saved immediately while field edits are not — mixed semantics in one modal; verified: comment sent then Cancel → persisted).
- **Recurring meeting creation** shows "Creates N events" — not completed in this run (script failed because creating an event navigates to its detail page; no defect).
- **Meeting past dates are accepted** (Save enabled with 2020-01-01) — probably fine for back-filling attendance.
- **Season rollover** worked: new season created, previous archived, sub-team *structure* cloned with `member_ids = {}` (verified in `sub_teams`: 2 rows per season, 0 members), checklist source offered "copy / empty / from template: Walk template". After rollover the season selector showed "2027-2028 Season". Switching back to the archived one via the selector timed out in my script (possible disabled state; not verified).

---

## Screens seen (route → screenshot, admin unless noted)

Desktop 1280×800 (`$S\shots\walkA-admin-d-<route>.png`) and mobile 375×812 (`walkA-admin-m-<route>.png`) for each of: `/app/dashboard`, `/app/board`, `/app/checklist`, `/app/scouting`, `/app/planner`, `/app/meetings`, `/app/meetings/summary`, `/app/checkin`, `/app/profile`, `/app/help`, `/app/admin`, `/app/operator`, `/app/guardian`, `/app/nonsense` (→ dashboard), `/app` (→ dashboard), `/dashboard` (→ dashboard), `/legal/terms`, `/legal/privacy`, `/legal/community`, `/join`, `/join/ABCDEF`. Every route survived a hard reload at the same URL; Back button walked board → dashboard correctly. Page load to interactive ~630–900 ms each; login ~1.0 s.

Flow screenshots (desktop): `walkA-d-board-newtask-modal`, `walkA-d-board-after-create`, `walkA-d-board-task-comment`, `walkA-d-board-view-{List,Calendar,Archived}`, `walkA-d-board-archived`, `walkA-d-board-archived-season{,-modal,-after-save}`, `walkA-d-scouting-modal`, `walkA-d-scouting-after-create`, `walkA-d-checklist-{initial,edited,template}`, `walkA-d-checklist-archived-season`, `walkA-d-planner-{drawn,load-modal,loaded,save-modal}`, `walkA-d-admin-season-archived`, `walkA-d-student-comment-own`, `walkA-d-admin-sees-student-comment`, `walkA-d-task-delete-confirm`, `walkA-d-meetings-{list,calendar,new-form,after-create}`, `walkA-d-meeting-{detail,poster,roster}`, `walkA-d-admin-{top,transfer,subteams}`, `walkA-d-season-{wizard,after-rollover}`, `walkA-d-profile`, plus `walkA-d-fail-*` captures.

Verified working (no defect found): task create/edit/archive/restore; double-click on New/Save created exactly one task and exactly one match plan; scouting create/edit/delete round-trip; checklist add item + save template + reset; planner drawing persists across reload and Load; meeting create → detail shows QR + `FF-9458` code that matches `meetings.public_code`; poster page renders; roster page renders with Present/Excused/Absent and "Mark rest absent"; licence panel shows 15/15 seats with the correct at-capacity notice; admin-transfer panel lists candidates; season wizard; sign-out clears the auth token and sign-in returns to the dashboard; no 4xx/5xx on any route.

## Console / network errors

Across all runs (admin, student, mentor contexts, both viewports) the only console output was:
- `SecurityError: Failed to register a ServiceWorker … /sw.js … unsupported MIME type ('text/html')` + `The script has an unsupported MIME type` — dev server only (no SW in dev), not a product defect.
- Two React Router v7 future-flag warnings (`v7_startTransition`, `v7_relativeSplatPath`).
- `[store] updateTask ignored: season … is archived (read-only)` ×2 — the WALK-A-02 symptom.
- No HTTP 4xx/5xx responses and no failed requests on any page.

## Not yet covered (stopped by coordinator)
- Offline scenarios (§10): `07-offline.mjs` is written but was not executed — no evidence on queue drain, conflict resolution, or reload mid-queue.
- Student and mentor role sweeps of every route (only the student comment flow and mentor login were exercised); role-difference notes.
- Roster: approve iron-hopeful0, change role, remove a member (script selector used the e-mail-derived name; the roster shows "Student 2…", "Ms Okonkwo", "Mr Adeyemi" — rerun with those names), invite copy/revoke (generation is disabled at 15/15 seats), sub-team member assignment.
- Meetings: recurring series creation, attendance override via roster (clicked but `meeting_attendance` stayed empty — unverified whether the click hit a filter pill), QR check-in as a student, attendance summary report.
- Switching back to the archived season via the selector and the read-only banner text; checklist season scoping after rollover.
- Edit Profile: rename (needs "Edit Name" click first), "I've turned 18" control (not shown for an 18+ account — expected; needs a 13-17 account), legal prompts acceptance path.
- Admin: nominate successor end-to-end and accept as successor@.
- Mobile flows (only route-level geometry done at 375 px; task/scouting/meeting modals were measured only at 1280×800, where each modal is 784–800 px tall i.e. fills the viewport).
- Brand-new team empty state via registration + Inbucket.
- Timing: nothing over 1 s was observed except the first sync of an archive toggle (>1.75 s to reach Postgres).

## Summary
- Two High bugs every beta team will hit on day one: comment authors render as "Guest" (WALK-A-01) and edits on an archived season are silently discarded by a fully enabled modal (WALK-A-02).
- Scouting/planner are DECODE-specific with no filtering or validation — a blocker-shaped gap for a September 2026 kickoff (WALK-A-06).
- Match-plan Load→Save duplicates rows; dead d3 "robot" code (WALK-A-03).
- Known due-date timezone bug reproduced on main today (WALK-A-04).
- Re-attestation "Later" returns on every load (WALK-A-07) — worse than the plan describes.
- Board has no DnD, no sprints, no filters; 5th column off-screen at 1280 px (WALK-A-05).
- Accessibility and 375 px tap targets are fixable in a day (WALK-A-08/09/10); no horizontal overflow anywhere, no network errors anywhere.
- Sync, routing, reload survival, double-submit protection and season rollover all behaved correctly in what was exercised.

## Confidence / not checked
High confidence on A-01..A-04, A-07, A-09, A-10 (each has a screenshot plus DB or axe output). A-05/A-06 are observations of what exists, not of failures. A-08 and A-12 need one more check each (Tab cycling; IndexedDB contents after sign-out). Everything under "Not yet covered" is unverified.
