# FEAT — Feature completeness and season/game coupling (static audit)

Scope: code-reading audit of the product features (planner, scouting, match planner, checklist,
seasons, meetings, dashboard, help) plus the game-coupling design question. Another agent owns
the live walkthrough; nothing here was observed in a browser. Unit test run: only
`harness-invariants.test.ts` (8/8 green) to read the ratchet numbers. All paths are under
`C:\Claude\falconforge\`.

---

## 1. Feature inventory

Route prefix is `#/app/` (`src/lib/navigation.ts:99-131`, route table `src/App.tsx:241-286`).
"Roles" = who the nav offers it to (`navViewsFor`, `navigation.ts:148-162`) — UX only; RLS is the
boundary. "Offline" = works from the Dexie-persisted store with `queueForSync` writes.
"Season" = filtered via `useSeasonScoped`/`selectChecklist`.

| Screen | Route | Roles | State | Offline | Season-scoped | Notable gaps (evidence) |
|---|---|---|---|---|---|---|
| Dashboard | `dashboard` | all team members | complete | yes | yes | Two different "progress" formulas vs sidebar (FEAT-09). `firstName` comes from `user.user_metadata` (`DashboardHome.tsx:37`), not `displayName` (second display-name path). Deadlines panel includes `Archived` tasks (`:72` filters only `!== 'Done'`). |
| Sprint Planning — Board | `board` | all | **partial** | yes | yes | No drag-and-drop: cards are `<button onClick={openTask}>` (`SprintBoard.tsx:359-362`); status changes only via the modal `<select>` (`SprintTaskDetail.tsx:103-112`). No sprint entity, no points, no WIP, no retro (section 4). |
| Sprint Planning — List | `board` (view toggle) | all | partial | yes | yes | No sort/filter; shows `Archived` rows mixed in (`SprintList.tsx:416` maps all tasks, no status filter), while the board hides them. |
| Sprint Planning — Calendar | `board` | all | **stub** | yes | yes | Not a calendar: a sorted list of tasks with due dates titled "Upcoming Deadlines" (`SprintCalendar.tsx:459-496`). Due date off-by-one is KNOWN (FEAT-12). |
| Sprint Planning — Archived | `board` | all | complete | yes | yes | Restore button enabled on archived seasons (FEAT-02). |
| Task modal | (modal) | all | partial | yes | yes | `tags` has no UI (dead field, `types.ts:144`, `SprintPlanning.tsx:83,121`); type is only Feature/Bug; Save/Delete/Archive never consult `canEdit` (FEAT-02); comments on a new task are dropped (FEAT-03); checklist edits mutate store objects (FEAT-04); other members' comments render as "Guest" (FEAT-01). |
| Pre-Match Checklist | `checklist` | all | complete | yes | yes (one row per season) | One shared, team-wide tick state per season, blob last-write-wins (`sync.ts:475-540`); no per-match history — "Reset before every match" destroys the record of who ticked what. Seeded items are hardware-generic (`v2_rpcs.sql:421-431`). |
| Scouting Reports | `scouting` | all | **partial** | yes | yes (fixed in Sprint 4) | Card list only: no per-team aggregation, no sort/filter/search, no event entity, no pit scouting, no alliance colour/station, no export (section 3). Form is DECODE-shaped (section 2). |
| Match Planner | `planner` | all | **partial** | yes (field image bundled or base64 in `seasons.field_image_data`) | yes | Load→Save duplicates (FEAT-05); `matchNumber` never settable; dead d3 "draggable robot" code (FEAT-06); no robot/game-piece tokens, no text labels, freehand only. |
| Meetings (schedule / manager) | `meetings` | all (manager view for admin/coach/mentor) | complete | yes | yes (`useSchedule.ts:47`) | Competition events are a meeting type (`types.ts:242-249`) with no link to scouting/plans. |
| Event detail / roster / poster / summary | `meetings/:id`, `/roster`, `/poster`, `meetings/summary` | roster & summary: admin/coach/mentor | complete | yes (check-in RPC is online; see `CheckIn.tsx`) | yes | Not audited deeper (Sprint 8 scope). |
| Check-in | `checkin/:code?` | all | complete | needs network (RPC judges window server-side) | via meeting | — |
| Admin Settings | `admin` | admin/coach | complete | mostly (approvals are online RPCs) | season for sub-teams | Sub-teams cannot be renamed (FEAT-14). Season delete not gated by `isReadOnlyTeam` (`SeasonManager.tsx:275-284`). |
| Season Manager | (inside `admin`) | admin/coach | complete | yes (rollover is client-side, `createSeasonSlice.ts:218-292`) | n/a | `gameTitle` is free text (`SeasonManager.tsx:317-328, 412-419`); delete confirm omits meetings (FEAT-10). |
| Edit Profile | `profile` | all | complete | partly | n/a | not audited |
| My children (guardian) | `guardian` | guardian accounts | complete | yes | n/a | not audited |
| Operator console | `operator` | platform operator | complete | no | n/a | not audited |
| Getting started | `help` | everyone incl. no-team | complete (static) | yes | n/a | Tells students to "Drag a card" — there is no drag (FEAT-07). |
| Landing | `/` | public | complete (static) | yes | n/a | Overclaims analytics (FEAT-08). |

**Dead / unused components:** none. Every file under `src/components/**` and `src/pages/*.tsx`
is imported by at least one non-test module (checked by grep over import statements).
**Unused store surface:** `updateMatchPlan` (`createMatchPlanSlice.ts:55-73`) has no caller
outside tests; `Task.tags` has no writer but `[]`.

**Handlers that silently do nothing (failure-mode class 8), all on an archived season:**
`SprintTaskDetail` Save/Delete/Archive (`:221-239`), `SprintTaskActivity` send/delete
(`:317, :343`), `SprintArchived` Restore (`:567-574`). The store refuses with a
`console.warn` (`season-rules.ts:42-53`) and the modal closes (`SprintPlanning.tsx:129`) as if
it had saved. See FEAT-02.

---

## 2. Game / season coupling — where DECODE (2025-26) is hard-coded

### 2a. Inventory of coupling points

| # | What | Where | Storage |
|---|---|---|---|
| G1 | Field image filename `DecodeField.png` | `src/constants.ts:33`; used as the default in `MatchPlanner.tsx:3, 45-49`; asset `public/DecodeField.png` (1024×1024, DECODE field render) | bundled asset; per-season override is base64 in `seasons.field_image_data` (`v2_tables.sql:~240`, `SeasonManager.tsx:104-144`) |
| G2 | Scouting report **fields** — `hasAutonomous`, `autoScore`, `intakeType: 'No Intake' \| 'Human Player' \| 'Automatic'`, `autoAim`, `farShooting`, `shotsTaken`, `shotsMissed`, `parking: 'No Park' \| 'Full Park' \| 'Partial Park'`, `rating`, `endGameNotes` | type `src/types.ts:153-172`; form `ScoutingReports.tsx:32-43, 114-128, 346-444`; card `:217-244`; mapping `entity-registry.ts:248-297` | **jsonb** `scouting_reports.data` (`v2_tables.sql:310-326`). Only `opponent_team_number`, `match_number`, `event_name`, `created_by` are columns. The jsonb keys are enumerated by hand in `toRemote`/`fromRemote` with per-key defaults. |
| G3 | Phase names "Autonomous" / "TeleOp" / "End Game" as form section headings | `ScoutingReports.tsx:348, 373, 407` | UI literals |
| G4 | Match-planner partner capabilities "Autonomous" and **"Lifted Park"** (not a DECODE term) | `MatchPlanner.tsx:346-349`; persisted as `partner_autonomous` / `partner_park` **columns** (`v2_tables.sql:340-341`, `entity-registry.ts:312-314`) | schema columns |
| G5 | Strategy placeholder "1. Autonomous path… 2. TeleOp focus…" | `MatchPlanner.tsx:339` | UI literal |
| G6 | Match planner geometry: fixed 600×600 viewBox, square field assumed; no zones/elements | `MatchPlanner.tsx:28-29, 283-284` | drawing stored as SVG paths in viewBox units (`drawing_data` jsonb) |
| G7 | Season upload hint "Recommended: 3:2 ratio", max 1200×800 — contradicts the square field/viewBox | `SeasonManager.tsx:115-127, 369` | — |
| G8 | `seasons.game_title` is free text with placeholder "e.g. DECODE"; nothing reads it except the season row label | `SeasonManager.tsx:326, 417`; `types.ts:206-214`; migration `20260817000000_v2_season_lifecycle.sql:43-55` | column |
| G9 | Pre-match checklist seed (Driver Hub, battery, servos) | `v2_rpcs.sql:421-431` | jsonb; hardware-generic, program-specific (FTC Driver Hub), not game-specific |
| G10 | Alliance model: one "Alliance Partner" text field (2v2 implied) | `MatchPlanner.tsx:324-331`; `match_plans.alliance_team text` | column |
| G11 | No point values, no scoring rubric, no derived metrics anywhere | grep for `pts` → only `ScoutingReports.tsx:221` renders `autoScore` | — |
| G12 | Sub-team seed `Programming, Build, Drive, Scouting, Outreach` | `v2_rpcs.sql:412-414` | program-generic |

What is already right: the scouting payload is jsonb (`data`), `game_title` exists on the
season, the field image is per-season overridable and stored for offline, and season-scoping is
uniform. The coupling is therefore almost entirely in **client code and type literals**, not in
the schema — which makes the migration path short.

What is wrong with the current DECODE form as a DECODE form (low confidence on rules detail —
I did not consult the game manual): it records shooting counts and a far-zone flag but no
artifact/pattern/classification scoring and no "leave" in auto; `rating` defaults differ
(`3` in the form, `0` in `fromRemote`, `entity-registry.ts:291`). Whatever the season's rubric
is, a team cannot change a single label or add a single field without a code release.

### 2b. Proposed game-agnostic model

**Concept: a `GameDefinition`** — a declarative, versioned document describing one program's
game for one season. Everything game-specific the UI renders comes from it; nothing
game-specific is a TypeScript literal.

```
GameDefinition {
  id, program: 'FTC' | 'FRC', seasonKey: '2025-26', title: 'DECODE', version: 3,
  match: { allianceSize: 2, phases: [{key:'auto', label:'Autonomous', seconds:30},
           {key:'teleop', label:'TeleOp', seconds:120}, {key:'endgame', label:'End Game', seconds:30}] },
  field:  { image: 'data:image/png;base64,…' | 'ftc-2025-decode-field.png',
            width: 1024, height: 1024, orientation: 'red-right',
            zones: [{id:'far-zone-red', label:'Far Zone', polygon:[[x,y],…]}] }   // optional
  scouting: { match: FormSchema, pit: FormSchema },
  scoring:  { metrics: [{key:'autoPts', label:'Auto points', expr:'autoScore'},
                        {key:'accuracy', label:'Shot accuracy', expr:'(shotsTaken-shotsMissed)/max(shotsTaken,1)'}] }
  planner:  { partnerCapabilities: [{key:'auto', label:'Autonomous'}, {key:'park', label:'Parks'}] }
}
FormSchema { sections: [{ key, label, phase?, fields: [
  { key, label, type: 'bool'|'int'|'counter'|'select'|'rating'|'text'|'textarea', options?, min?, max?, default? } ] }] }
```

`scouting_reports.data` stays a jsonb bag keyed by `field.key` — exactly the shape it has today
(`hasAutonomous`, `shotsTaken`, …), so **today's rows are already valid instances of a DECODE
FormSchema** and need no rewrite; only the `toRemote`/`fromRemote` enumeration becomes generic
(`data: r.data` both ways, validated against the schema at render time, unknown keys preserved).

**Where the definition lives (offline is the constraint):**

1. **Bundled JSON in the build** (`src/games/ftc-2025-decode.json`, `…/ftc-2026-<next>.json`).
   Available offline by construction, versioned with the app, zero schema change. This is the
   S-phase and is enough for beta: the operator ships the official template each September by
   releasing the app.
2. **DB table `game_definitions`** (global, operator-written, RLS: SELECT to `authenticated`,
   no client writes) pulled through the entity registry with `scope: 'global'` (the registry
   already supports non-team scopes since Sprint 9) and cached in Dexie like every other
   entity. This lets the operator fix a rubric mid-season without a release and lets FRC be
   added as data. Bundled JSON remains the fallback for a cold offline start.
3. **Per-team customisation**: `team_game_overrides (team_id, season_id, base_definition_id,
   base_version, patch jsonb)` where `patch` adds/hides fields and relabels. Rendered schema =
   base ⊕ patch. Teams never edit the base. Recommend **curated templates + light overrides**,
   not a full form builder, for beta: a builder is a sprint of UI and a new class of
   validation bugs, and the thing teams actually do to a template is add two fields and
   rename one.

**Binding to seasons and history:** `seasons.game_definition_id uuid NULL` +
`seasons.game_definition_version int` + **`seasons.game_snapshot jsonb`** — the resolved
definition (base ⊕ patch) frozen onto the season row at rollover (or at first customisation).
The renderer reads the snapshot, so an archived 2025-26 season keeps rendering DECODE's form
and field forever even after the bundled file is pruned or the global row is edited. This is
the same "snapshot on the row" idea as the checklist blob, and it is what makes offline and
read-only history trivially correct. `game_title` becomes a denormalised label of the snapshot
(keep the column; set it from the definition).

**Scouting rendering:** one `SchemaForm` component that renders a FormSchema into the existing
`.field` primitives (`counter` → the existing ± stepper, `rating` → the range input). Card and
detail views render from the same schema ("summary fields" flagged in the schema). A
`scoring.metrics` list gives derived per-report numbers; per-team aggregation (section 3)
computes mean/max over reports for each metric, again schema-driven.

**Match planner:** `field.image` and `field.width/height` replace `FIELD_IMAGE_URL` and the
600×600 assumption (viewBox = definition size; paths stay in viewBox units, so existing
drawings in a square viewBox remain valid for a square DECODE field). `planner.partnerCapabilities`
replaces the two hard-coded checkboxes; persist them as a `partner_capabilities jsonb` and
backfill from `partner_autonomous`/`partner_park`. `match.allianceSize - 1` partner fields.

**FRC without building it:** the model already expresses it — `program: 'FRC'`,
`allianceSize: 3`, a 3-phase structure with different seconds, a rectangular field
(`field.width ≠ height`), and a `scoring` block. Districts, TBA/Statbotics imports are
**event-layer** concerns (section 3's `competition_events`) not game-layer, and slot in as an
`eventsSource: 'ftc-events' | 'tba'` on the definition. Nothing FTC-specific should remain in
the scouting/planner components once they render from the definition; the Driver-Hub checklist
seed becomes a `program`-keyed seed list.

**Migration path from today (no data loss):**
- Keep `scouting_reports.data` as is. Add `scouting_reports.kind text NOT NULL DEFAULT 'match'
  CHECK (kind IN ('match','pit'))`, `alliance text`, `station smallint` (nullable).
- Keep `partner_autonomous`/`partner_park`; add `partner_capabilities jsonb` and write both
  during a transition, then drop the booleans after the freeze rules allow.
- Add the three `seasons` columns above; backfill every existing season's snapshot with the
  bundled DECODE definition (`game_title` is 'DECODE' or null for all seeded teams today).
- `FIELD_IMAGE_URL`, `ScoutingReport` field literals, `intakeType`/`parking` unions and the
  `renderStepper('shotsTaken'|'shotsMissed')` signature go away; the `ScoutingReport` type
  becomes `{ …columns, data: Record<string, unknown> }`.

**Phased plan:**
- **S (≤½ day each):** extract DECODE into `src/games/ftc-2025-decode.json`; `SchemaForm`
  renders the scouting modal and card from it; `MatchPlanner` reads image/size/capabilities
  from it; season "Game" field becomes a select over bundled definitions (free text kept as
  "Other"). No schema change. This alone removes G1–G7, G10.
- **M (1–2 days each):** `seasons.game_snapshot` + registry changes + rollover writes the
  snapshot; `game_definitions` table with `scope:'global'` pull; per-team overrides UI (add
  field / hide field / relabel); per-team aggregation table in Scouting; event entity.
- **L (sprint):** FTC Events import (Edge Function holding the API key, schedule + team list
  cached offline), pit scouting form, alliance-selection pick list, FRC definition file,
  engineering-notebook export (section 6).

---

## 3. Scouting & match planning depth vs what teams need

What a team does at a qualifier/league meet and whether the code supports it:

| Need | Today | Gap |
|---|---|---|
| Pit scouting (one sheet per team: drivetrain, mechanisms, auto routines, photo) | none — every report is a match report with a team # (`ScoutingReports.tsx:307-333`) | no `kind`, no photo, no per-team profile |
| Match scouting fast entry in the stands | modal form, steppers are 44px; team # is free text; match # optional | no schedule-driven entry (pick match → pre-filled six teams), no alliance colour |
| Per-team aggregation (avg auto, avg teleop, max, consistency, OPR-style) | none — cards only, one card per report, no grouping (`:184-268`) | this is the #1 reason to stay on a Google Sheet |
| Pick list / alliance selection | none; landing claims it (`Landing.tsx:601-609, 1021`) | no ranking, no "do not pick", no drag-ordered list |
| Event schedule / team list (FTC Events API, ftc-events.firstinspires.org, FTCScout) | none; `event_name` is free text; meetings have a `competition` type but no link | no `competition_events` entity, no import, no match list |
| Multi-scout concurrency | each report is its own row — safe | fine |
| Viewing a team's history across reports | none | needs grouping |
| Export / share (CSV, copy to drive team) | none (Sprint 11 "team data export" is post-beta) | — |
| Match planner tied to a real match (match # + partner from schedule) | `matchNumber` exists in type/column but has no input (`MatchPlanner.tsx:68-77`) | — |
| Field tokens (robots, game pieces, labelled start positions) | freehand pen only; the "draggable robot" code is dead (`:102-118`) | landing claims "tag key starting positions" (`Landing.tsx:461`) |

**Verdict:** a team can log observations offline, which a Sheet cannot do reliably at a venue,
but it cannot *answer a question* with them. Without grouping-by-team and a sortable table the
scouting lead will export nothing and keep the Sheet. The minimal competitive set for beta is:
(1) team summary table (schema-driven metrics, sortable), (2) team detail with all reports,
(3) match # + alliance colour on the form, (4) CSV export. Schedule import is the next step
and is online-only by nature (cache after fetch).

---

## 4. Does the agile planner "teach agile"?

No. It is a five-column kanban with a task modal. Specifically:

- **There is no sprint entity.** "Sprint" is a word in the nav (`navigation.ts:103`) and the
  dashboard ("open tasks for this sprint", `DashboardHome.tsx:84`); nothing has a start/end,
  a goal, or a capacity. `tasks` has no `sprint_id` (`v2_tables.sql:288-309`).
- No estimates/points, no velocity, no burndown, no WIP limits, no definition of done, no
  retrospective, no backlog grooming/ordering (columns are unordered arrays rendered in
  insertion order, `SprintBoard.tsx:335`), no drag-and-drop, no sub-team swimlanes (sub-team
  is a chip, `:372`), no priority.
- The "Calendar" view is a list (`SprintCalendar.tsx`).
- Task history is a per-task `timeline` jsonb of `moved to X` entries (`SprintPlanning.tsx:101-110`)
  — the raw material for a burndown exists but nothing reads it.

What would make it teach, in order of value/cost:
1. **Sprint entity** (`sprints`: season_id, name, goal, starts_at, ends_at, retro_notes) and
   `tasks.sprint_id` nullable; board filtered to the active sprint with a backlog drawer. (M)
2. **Guided first-sprint wizard** on an empty board: pick a 2-week window, write a goal, pull
   5–10 backlog items, assign owners — with one-paragraph explanations of *why* at each step.
   (M; mostly copy.)
3. **Sprint review/retro screen** at end date: what moved to Done, what slipped, three
   retro prompts saved to `retro_notes`; this doubles as engineering-notebook material. (S–M)
4. Points + **burndown** from the existing timeline events (`moved to Done` timestamps). (M)
5. **WIP limit** per column with a soft warning, and a **Definition of Done** checklist
   template auto-added to each task (the per-task `checklist` already exists). (S)
6. Drag-and-drop between columns (the help page already promises it, FEAT-07). (S–M)

---

## 5. Seasons

**Rollover** (`createSeasonSlice.ts:218-292`, wizard `SeasonManager.tsx:377-504`): creates the
season first (ordering is load-bearing for the queue), clones sub-team *names* with fresh ids
and empty `memberIds` (`:238-254`), builds the checklist from blank/previous/template with
fresh item ids and no `assignedTo` (`:303-329`), archives the outgoing season last, switches
`currentSeasonId`. Tasks, scouting, plans, meetings are not cloned. Client-side so it works
offline. This matches principle 5.

**Read-only archive:** `season_is_open()` gates every season-scoped table server-side
(`20260817000000_v2_season_lifecycle.sql:~102`); client guards via `canWriteToSeason` in every
slice and `canEdit` in most components. Archive is reversible (`setSeasonArchived`).

**Gaps vs principle 5:**
- The task modal, activity feed and Restore button do not honour `canEdit` (FEAT-02) — the
  only season-scoped writes that are still *offered* on an archived season.
- `deleteSeason` omits meetings/attendance from the local cascade and the confirm copy
  (FEAT-10).
- Game is not carried by the season in any structural way (`game_title` text, field image
  only) — section 2.
- Nothing records a season's *events* (competitions attended), so "history backward" has no
  competition dimension.
- `gameTitle` is not suggested on rollover (`openWizard` sets `''`, `SeasonManager.tsx:84-93`);
  with a definitions list it should default to the newest FTC definition.

---

## 6. Engineering notebook / judging / awards

Nothing exists. The AI Portfolio Helper and Judging Prep flashcards were removed
(`docs/ai-features-reference.md:10-39`); their state (`portfolioHistory`, `PortfolioEntry`,
`Flashcard`) is gone from `types.ts`. No notebook entity, no attachments/photos anywhere in
the schema, no awards tracking.

Hooks that exist and could feed a notebook without AI:
- `tasks.timeline` (comments + status history, per task, with author and timestamp) — a
  dated engineering log if exported per sub-team/week.
- `tasks.description` placeholder already says "paste meeting minutes" (`SprintTaskDetail.tsx:152`).
- `meetings` (dated sessions with attendance) — the "who was there" column of a notebook.
- `tasks.type` (Feature/Bug) and the per-task checklist — "problem / iteration / test".

What is missing to call anything a notebook: a dated entry entity with rich text + images
(needs Supabase Storage, which is a new backend surface and an offline-upload queue), a
judging-rubric checklist (Think/Connect/Innovate/Control award criteria as a checklist
template per season — cheap, and could ride on the `game_definitions` document), and an
export (Markdown/PDF) of tasks + timeline + meetings for a date range (fits Sprint 11's export).

---

## 7. Findings

### FEAT-01 — Task comments by anyone else render as "Guest"
- **Severity:** High
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** Writer stores the **auth user id**: `SprintPlanning.tsx:105` (`authorId: profile?.id || 'System'`) and `:137` (`profile?.id || 'guest'`); `profile.id` is `user.id` (`auth.tsx:408-409`). Reader resolves against **team member ids**: `SprintTaskActivity.tsx:49` (`teamMembers.find((m) => m.id === authorId)`), falling back to `Guest` (`:54`). `types.ts:131` documents `authorId` as "TeamMember ID". The test constructs events with `authorId: 'member-1'` (`SprintTaskActivity.test.tsx:39`) and so passes against the mismatch — failure-modes class 2.
- **Repro / how observed:** Code reading. To confirm: as student A add a comment; view the task as coach B → author shows "Guest"/"G". A sees their own name only because of the `profile.id` short-circuit at `:46`.
- **Impact:** Every team on day one; the activity feed is the only collaboration surface on the board.
- **Fix direction:** Write `currentMember.id` (AppShell already computes it, `AppShell.tsx:~118`) as `authorId`, and make the reader also match `m.userId === authorId` for rows written so far. Add a test whose fixture writes via `SprintPlanning` and reads via `SprintTaskActivity` with a *different* signed-in user.
- **Effort:** S

### FEAT-02 — Task modal, comments and Restore are offered on an archived season and silently do nothing
- **Severity:** Medium
- **Type:** ux (failure-modes class 8)
- **Status vs plan:** NEW
- **Evidence:** `SprintTaskDetail.tsx` and `SprintArchived.tsx` never import `useSeasonScope`/`canEdit` (grep: no matches). Save (`SprintTaskDetail.tsx:237`) is disabled only on empty title; Delete/Archive `:221-231`; comment send `SprintTaskActivity.tsx:317`, delete `:343`; Restore `SprintArchived.tsx:567`. The store refuses with `console.warn` (`season-rules.ts:48-51`, `createTaskSlice.ts:437, 457`) and `saveTask` closes the modal regardless (`SprintPlanning.tsx:129`).
- **Repro / how observed:** Switch the season picker to an archived season → open any card → edit → Save. Modal closes, nothing changes, no message.
- **Impact:** Anyone browsing last season — the exact "history backward" use case.
- **Fix direction:** Pass `canEdit` (or derive from `task.seasonId` via `isSeasonArchived`) into `SprintTaskDetail`/`SprintTaskActivity`/`SprintArchived`; disable with the same title text the other pages use ("This season is archived and read-only"); keep the modal openable read-only. Test: render with an archived season and assert the controls are disabled.
- **Effort:** S

### FEAT-03 — Comments typed on a not-yet-saved task are discarded on Save
- **Severity:** Low
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `addComment` for a new task only updates `activeTask` (`SprintPlanning.tsx:141-149`, guarded by `if (!isNewTask)`); `saveTask` passes no `timeline` to `storeAddTask` (`:114-124`), and `addTask` builds a fresh timeline with only "Task created" (`createTaskSlice.ts:412-418`).
- **Repro / how observed:** New Item → type a comment → Send (appears in feed) → Save Task → reopen: comment gone.
- **Impact:** Occasional; confusing rather than damaging.
- **Fix direction:** Either hide the comment box while `isNewTask` or pass `timeline` through `addTask` (prepend the system entry).
- **Effort:** S

### FEAT-04 — Task checklist edits mutate store objects in place (Cancel cannot revert)
- **Severity:** Low
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `SprintTaskDetail.tsx:165-167` and `:177-179` do `newChecklist[idx].completed = …` / `.text = …` on a shallow-copied array whose item objects are the store's (the route adapter copies the task and timeline but not `checklist`, `App.tsx:75-82`).
- **Repro / how observed:** Open a task, tick a checklist box, Cancel, reopen → still ticked locally; it is not queued for sync and reverts on the next pull/reload.
- **Impact:** Confusing desync between devices; also defeats the "nothing persists until Save" contract in the component's own docblock (`:31`).
- **Fix direction:** Replace the item immutably (`checklist.map((c, i) => i === idx ? {...c, completed} : c)`); add a test that Cancel leaves the store unchanged.
- **Effort:** S

### FEAT-05 — Match Planner cannot update a plan; Load → Save creates a duplicate; match number unsettable
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** `handleSave` always calls `addMatchPlan` (`MatchPlanner.tsx:68-77`); `handleLoad` keeps no loaded-plan id (`:87-94`); `updateMatchPlan` exists (`createMatchPlanSlice.ts:55-73`) with no caller outside tests. `MatchPlan.matchNumber` (`types.ts:196`, column `match_plans.match_number`, B10 comment) has no input anywhere in the component.
- **Repro / how observed:** Load "Match 3" → add a line → Save → Load list shows two "Match 3".
- **Impact:** Drive team editing plans between matches at a venue.
- **Fix direction:** Track `loadedPlanId`; Save updates when set (offer "Save as copy"); add a match # field to the save modal and a proper `title` default from it.
- **Effort:** S

### FEAT-06 — Dead "draggable robot" d3 code in Match Planner (3 of the remaining `as any`)
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** NEW
- **Evidence:** `MatchPlanner.tsx:96-118` builds a d3 drag behaviour and binds it to `.draggable-robot`; no element with that class is ever rendered (grep). `as any` at `:116, :144, :164`.
- **Repro / how observed:** Code reading.
- **Impact:** None to users; misleads maintainers and inflates the ratchet.
- **Fix direction:** Delete, or implement robot/game-piece tokens from the game definition (section 2) and bind to them.
- **Effort:** S

### FEAT-07 — Help page tells students to "Drag a card"; the board has no drag-and-drop
- **Severity:** Medium
- **Type:** ux
- **Status vs plan:** NEW
- **Evidence:** `src/pages/GettingStarted.tsx:150` ("Drag a card as the work moves."). Cards are `<button onClick={openTask}>` (`SprintBoard.tsx:359-362`); no DnD dependency in `package.json` (grep `dnd|drag` → none).
- **Repro / how observed:** Code reading.
- **Impact:** Every new student reads this on day one and then cannot do it.
- **Fix direction:** Either reword to "open a card and change its status" now (S) or add DnD (section 4 item 6). Add a source-level test like the "guidance describes the repo" ratchets in `harness-invariants.test.ts`.
- **Effort:** S (copy) / M (DnD)

### FEAT-08 — Landing page claims scouting analytics and planner features that do not exist
- **Severity:** Medium
- **Type:** ux
- **Status vs plan:** NEW (the beta-prep entry in plan §8 reviewed the landing page for Meetings, not for overclaim)
- **Evidence:** `src/pages/Landing.tsx:297` ("analyze scouting data"), `:340` ("Detailed match analysis"), `:601-609` ("Data-driven alliance selection", "uncover powerful metrics for your picklist", "Deep quantitative analysis", "Team progression charts"), `:1021` ("Analyze aggregate scouting data"), `:335` ("assign tasks to alliance partners"), `:461` ("tag key starting positions"). The app has no aggregation, charts, pick list, partner tasks or position tags (sections 1, 3).
- **Repro / how observed:** Code reading.
- **Impact:** Beta coaches arrive expecting a scouting analytics product and find a card list; this is the claim most likely to generate a "where is…" support email.
- **Fix direction:** Rewrite the three scouting bullets and the two planner phrases to what ships (offline entry, season-scoped history, shared plans), or build the summary table (section 3) before beta and keep the copy.
- **Effort:** S

### FEAT-09 — Two definitions of "progress" (sidebar vs dashboard)
- **Severity:** Low
- **Type:** debt (principle 9)
- **Status vs plan:** NEW
- **Evidence:** Sidebar: `done / tasks.length` including Backlog and Archived (`Sidebar.tsx:83-84`). Dashboard: `done / (ToDo+InProgress+Testing+Done)` (`DashboardHome.tsx:40-42`). Archiving a Done task *lowers* the sidebar figure and leaves the dashboard one unchanged.
- **Repro / how observed:** Code reading.
- **Impact:** Two numbers on the same screen disagree; cosmetic.
- **Fix direction:** One `sprintProgress(tasks)` selector in the task slice; both read it. Fold into the sprint-entity work (section 4).
- **Effort:** S

### FEAT-10 — `deleteSeason` local cascade omits meetings and attendance; confirm dialog does not mention them
- **Severity:** Low
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** Cascade list `createSeasonSlice.ts:128-135` covers tasks, sub_teams, scouting_reports, match_plans, checklists only, while the docblock (`:108-110`) says the server cascade also removes meetings. Confirm copy `SeasonManager.tsx:519-525` lists five things, not meetings/attendance. Server FK cascade is real (`v2_tables.sql` meetings section) so the data does go.
- **Repro / how observed:** Code reading. Expect: delete a season with meetings while offline → local `meetings` keep the dead `seasonId` until the next full pull; a season created offline and deleted before sync leaves its queued meetings pointing at a season the server never had (the exact case `:117-121` says the ordered cascade exists for).
- **Impact:** Rare (season delete is destructive and uncommon) but the dialog under-states what is destroyed.
- **Fix direction:** Add `meetings` (and `meeting_attendance` by meeting id) to the cascade array and local filter; add the two lines to the dialog; extend the existing deleteSeason test.
- **Effort:** S

### FEAT-11 — The current FTC game is hard-coded across scouting, planner and constants
- **Severity:** High (the beta's first rollover in Sept 2027 needs a code release to change the form; customising it for *this* season already does)
- **Type:** debt / unfinished
- **Status vs plan:** NEW (no parking-lot entry mentions game-agnostic, FRC, or form schema)
- **Evidence:** Section 2a table, G1–G11.
- **Repro / how observed:** Code reading.
- **Impact:** Every team, every September; any team wanting one extra field today.
- **Fix direction:** Section 2b; start with the S phase (bundled JSON + `SchemaForm`), which has no schema change and removes most of the coupling.
- **Effort:** S (phase 1) / M / L

### FEAT-12 — Due dates render one day early at negative UTC offsets
- **Severity:** Medium
- **Type:** bug
- **Status vs plan:** KNOWN (plan §8: "Due dates render one day early")
- **Evidence:** `SprintTaskDetail.tsx:139-140` (`toISOString().substr(0,10)` / `valueAsNumber` = UTC midnight); rendered with local `toLocaleDateString`/`getDate` in `SprintBoard.tsx:373`, `SprintList.tsx:436`, `SprintCalendar.tsx:482-483`, `DashboardHome.tsx:254-256`. Verified: `TZ=America/Chicago node -e` renders `2026-09-15T00:00Z` as `9/14/2026`. Also `overdue` (`DashboardHome.tsx:239`) compares UTC-midnight to local start-of-day — nothing new beyond the plan's entry.
- **Repro / how observed:** as above.
- **Impact:** Every US team.
- **Fix direction:** Per plan: date-only render helper or store `YYYY-MM-DD`.
- **Effort:** S

### FEAT-13 — `Task.tags` is a dead field; only two task types; no sprint entity
- **Severity:** Low
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** `tags` written as `[]` (`SprintPlanning.tsx:83`) and round-tripped (`:121`), no input anywhere; `TaskType` = Feature/Bug (`types.ts:13-16`); no `sprints` table (`v2_tables.sql`).
- **Fix direction:** Section 4.
- **Effort:** S (tags UI) / M (sprints)

### FEAT-14 — Sub-teams cannot be renamed
- **Severity:** Low
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** `createSubTeamSlice.ts:8-11` exposes add/remove/toggleMember only; `SubTeamManager.tsx` has no name input for an existing row (`:79` renders the name as text).
- **Impact:** A typo in "Programing" means delete (losing assignments) and re-add.
- **Fix direction:** `renameSubTeam` in the slice via `queueForSync('sub_teams', id, 'update', …)` + inline edit.
- **Effort:** S

### FEAT-15 — Scouting has no aggregation, grouping, event model, pit form or export
- **Severity:** High (will decide whether beta teams use it at their first meet)
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** Section 3 table; `ScoutingReports.tsx:184-268` is a flat card grid; `event_name` free text (`v2_tables.sql:318`).
- **Fix direction:** Section 3's minimal set, built on the schema-driven metrics from section 2.
- **Effort:** M (summary table + CSV) / L (events import, pit scouting, pick list)

---

## Ratchet numbers (from `harness-invariants.test.ts`, 8/8 green)

- `as any`: **56** (ceiling 56). Non-test sites: `SprintPlanning.tsx` 4, `entity-registry.ts` 4,
  `MatchPlanner.tsx` 3, `auth.tsx` 3, `realtime.ts` 3, `InviteManager.tsx` 2, `MemberManager.tsx` 1,
  `attestations.ts` 1, `createTaskSlice.ts` 1 (22 in product code, 34 in tests).
- Arbitrary Tailwind values: **2** (ceiling 2): `Sidebar.tsx` `transition-[width]`,
  `Landing.tsx` `w-[calc(33.33%-1.5rem)]`.

## Summary

1. The season model is sound and game-agnostic at the schema level (jsonb `data`, per-season
   field image, `game_title`); the coupling to DECODE is almost entirely in client literals
   (G1–G11), so phase 1 of a game-definition model is a no-migration refactor.
2. The scouting feature records but cannot summarise: no per-team table, no events, no pit
   form, no export. That, not offline, is what a scouting lead compares to a Sheet.
3. The planner is a kanban, not an agile teacher: no sprint entity, points, burndown, retro,
   WIP or DnD; the help page promises drag that does not exist.
4. One High bug found by reading: every comment by a teammate renders as "Guest" (user id
   written, member id read), and the unit test passes because its fixture uses member ids.
5. Archived seasons are read-only everywhere except the task modal, comments and Restore,
   which accept the tap, refuse in the store, and close as if saved.
6. Match Planner cannot update a plan (duplicates on Load→Save), has dead token-drag code,
   and a game-specific "Lifted Park" checkbox persisted as a schema column.
7. The landing page sells analytics, pick lists and progression charts that are not there.
8. No engineering notebook / judging surface exists; `tasks.timeline` + `meetings` are the
   raw material for a dated log export.
9. No dead components; two small principle-9 duplicates (progress formula, dashboard first-name).

## Confidence / not checked

- Nothing was run in a browser; all "silently does nothing" claims are from code paths, not
  observation (the live-walkthrough agent can confirm FEAT-01/02/05 in minutes).
- DECODE rule details (artifacts, patterns, leave) were not checked against the game manual;
  the claim is only that the form is a shooting-game form with no rubric, not which fields are
  missing.
- Meetings, guardian, operator and admin screens were inventoried, not audited.
- Checklist blob conflict behaviour between two devices was inferred from `sync.ts:475-540`
  and not exercised.
- Sizes/offline behaviour of base64 field images on a slow pull were not measured.
