# FalconForge

A comprehensive management app for FIRST Tech Challenge (FTC) robotics teams. Features sprint planning, scouting reports, and match planning - all with offline-first support.

## Features

- **Sprint Planning / Kanban Board** - Agile-style task management with Board, List, and Calendar views
- **Pre-Match Checklist** - Customizable checklists for competition day, saveable as team templates
- **Scouting Reports** - Track opponent capabilities during competitions. The form comes from
  the season's game rather than from the code: FTC replaces the game every September, so each
  one is a JSON definition in `src/games/`, and a team can hide fields it does not use, rename
  them, and add a few of its own without anybody editing a type. Nothing a team adds can clash
  with next year's official fields, and hiding a field never deletes what was already recorded
- **Competitions** - The event schedule, either pasted from your event's public FIRST page
  (with a preview showing exactly what was read, because pasted text has no table structure and
  team names contain digits) or built entirely by hand, which is the normal case on the morning
  of an event. Everything stays editable afterwards: surrogates and mid-event schedule changes
  are routine, so an imported schedule that cannot be corrected is wrong by lunchtime.
  FalconForge never fetches that page itself
- **Match Planner** - Draw autonomous paths and game strategies on the field
- **Meetings & Attendance** - Schedule practices, build sessions, competitions, outreach and
  deadlines, one-off or recurring. Every occurrence gets its own four-digit code and QR poster,
  so students check themselves in by scanning with their phone's own camera — and a code
  photographed at last week's session will not work at this one. Coaches, mentors and admins
  take the roster (table, or a rapid-tap grid for walking the room) and read a per-member
  season summary; students get a read-only schedule as a list or a calendar
- **Guardian accounts** - Under-13s cannot hold an account under COPPA, so a parent signs up
  and adds a *managed profile* for their child, giving consent in the same sitting. They join
  the team with the coach's ordinary invite code, and the admin approves them exactly as for
  any other member — with one checkbox confirming they will not roster a child without their
  guardian. The guardian manages from their own view (children, consents given, upcoming
  meetings, attendance) and **never renders the team as the child**: there is no act-as mode.
  When the child is old enough, the guardian issues a claim code, the child signs up in their
  own name and redeems it — and **keeps their place on the team and their whole attendance
  history**, because the roster row is repointed rather than replaced. The app never stores a
  date of birth, so this is triggered by a person and never by a date
- **Getting started** - An in-app help page (`#/app/help`) covering the admin's first five
  steps, what a student needs, how offline actually behaves and the guardian path for under-13s.
  It is the one view that does not require a team, because a coach who has not created one yet
  and a guardian who never will are the two people most likely to need it
- **Seasons** - Each year starts fresh: a new-season wizard clones your sub-team structure
  (never its member assignments), empties the board, scouting log and match plans, and makes
  the previous season read-only while keeping every row of it browsable

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite, routed with `HashRouter` (`#/app/board`, …)
- **Styling**: Tailwind CSS v3, configured from design tokens in `tailwind.config.js`, with
  Inter self-hosted and bundled (no font CDN — the PWA must render styled offline)
- **State Management**: Zustand, persisted to IndexedDB, split into typed slices
- **Offline Storage**: IndexedDB via Dexie.js
- **Backend** (optional): Supabase (PostgreSQL + Auth)
- **PWA**: Installable on desktop, tablet, and mobile

## Quick Start

There is no offline demo mode. The app needs a Supabase backend to do anything at all — with
no credentials it renders "Supabase Not Configured" and stops, which `Login.test.tsx` asserts.
So the fastest route from a fresh clone to a working app is the **local stack**, in Docker, and
it is the one every contributor and every agent should use.

### Prerequisites

- **Node.js ≥ 20.19** (`.nvmrc` pins the version; `engines` in `package.json` enforces it).
  Vitest 4, jsdom 27 and `@vitejs/plugin-react` 5 all require it — v18 fails at install.
- **Docker Desktop**, running. The local Supabase stack is containers.
- The [Supabase CLI](https://supabase.com/docs/guides/cli), which ships as a devDependency
  (pinned to CI's version — see `docs/environment-divergences.md` §6 for why the pin matters).

### From a fresh clone to a running app

```bash
npm install

# Postgres, PostgREST, Auth, Realtime and Mailpit in Docker, every migration applied.
# First run pulls images and takes a few minutes.
npm run db:start

# Point the app at that stack. See .env.example for the file this copies.
cp .env.example .env.development.local

# Seed the review data: five teams, 36 accounts, one password, every legal document accepted.
npm run seed:review

npm run dev
```

The app is then at `http://localhost:3000`, and the seed prints the accounts and the shared
password on the way out. `reviewer@falconforge.test` is an admin on a fully populated team and
also a platform operator.

> **`.env.local` points at PRODUCTION.** That is the file the deploy uses, and anything
> inheriting ambient environment writes to the real database — which has been caught before
> harm three separate times. Local work belongs in `.env.development.local`, and every
> write-capable script passes its environment explicitly. See
> [`docs/environment-divergences.md`](docs/environment-divergences.md) §2.

## Pointing at a hosted Supabase project

Only needed for a deploy, or to reproduce something that only happens against the hosted
project.

1. Create a project at [supabase.com](https://supabase.com).
2. Project Settings → API: copy the Project URL and the anon/public key.
3. Put them in `.env.local`:

```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Set up Database Schema

The schema lives in `supabase/migrations/` and is the source of truth — do not hand-write
SQL in the dashboard. Apply it with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
# ...then apply the migrations BY HAND, in order, from the SQL editor.
```

> **`supabase db push` does not work on this project's migration history** and has not since
> the Sprint 2 squash. `docs/beta-ops.md` and the plan's progress log both record it; the
> deploy runbook in `.github/workflows/deploy.yml`'s header is the procedure to follow.

For local development, `npm run db:start` brings up the whole stack (Postgres, PostgREST,
Auth, Realtime) in Docker with every migration applied. `npm run db:verify` rebuilds it
from scratch and asserts the schema invariants in `supabase/tests/schema_assertions.sql`.

**[`docs/v2-schema.md`](docs/v2-schema.md) is the schema reference** — the entity diagram,
what each table is for, the capability model behind the RLS policies, and where each
invariant is enforced. The schema froze at the end of Sprint 3; everything after it is a
forward migration.

To gift a team access, or to make yourself the platform operator in the first place, see the
licensing section of that document.

> An earlier version of this section listed `CREATE TABLE` statements for a `users` and
> `organizations` schema. There is no `organizations` table; the tenant table is `teams`.
> Following those instructions would have produced a database the app cannot talk to.

### 4. Auth providers

Email and password only. `signInWithGoogle` and `signInWithMicrosoft` exist in `auth.tsx` and
**nothing calls them** — there is no button anywhere in the app. They are dead code kept
deliberately (removing them is a decision about whether OAuth is ever coming), and this section
used to tell you to configure providers that could not be reached.

What DOES need configuring on a hosted project is transactional email: see
[`docs/beta-ops.md`](docs/beta-ops.md) and [`docs/auth-email-templates.md`](docs/auth-email-templates.md).

## Building for Production

```bash
# Build the app
npm run build

# Preview the build
npm run preview
```

The built files will be in the `dist/` directory.

## PWA Installation

The app can be installed as a standalone app:

1. **Desktop (Chrome/Edge)**: Click the install icon in the address bar
2. **iOS Safari**: Tap Share > Add to Home Screen
3. **Android Chrome**: Tap the menu > Add to Home Screen

## How data flows

FalconForge is offline-first: venue WiFi is unreliable, so the local device is always the
thing the UI reads from, and the network is something that happens later. Three rules keep
that from becoming three different implementations.

### One write path

A user action mutates the Zustand store and queues a change. Nothing writes to Supabase
directly.

```
component → store action ──┬─→ Zustand store (IndexedDB-persisted) → UI re-renders now
                           └─→ queueForSync() → Dexie syncQueue
```

`queueForSync` coalesces redundant entries, so twenty edits to one task are one upsert.
Queue order is by the timestamp the user acted, never by primary key.

When online and authenticated, `useSync` drains the queue in that order:

```
drainSyncQueue() → processSyncItem() → entity.toRemote() → supabase upsert/update/delete
```

A push that fails is retried. After five attempts the change is **parked in a dead-letter
store, never discarded** — the user can see it and retry it. Losing a scouting report
entered at a competition because five pushes happened to fail is not an acceptable outcome.

### One read path

Everything that reads from the server calls `pullFromServer` in `src/lib/server-pull.ts`.
There is exactly one, and this is the rule it exists to enforce:

> **A record with an unpushed local change keeps its LOCAL version.** It is newer by
> definition — it has not been sent yet.

```
                    ┌── background sync loop  (mode: 'auto' — delta, cursor-driven)
pullFromServer() ←──┼── team switch / mount   (mode: 'full')
                    ├── per-page refresh hooks (mode: 'full', one table)
                    └── guardian view          (mode: 'full', guardian-scoped)
                             │
                             ├─→ getPendingRecordIds()   ← the rule, applied once
                             ├─→ entity.fromRemote()
                             └─→ store setters
```

Every entity declares what SCOPES it. Almost everything is `scope: 'team'` and filters on
`team_id`; `managed_profiles` and `guardian_consents` are `scope: 'guardian'` and filter on
`guardian_user_id`, because a child's profile belongs to their guardian rather than to whichever
team they are on this season — and a guardian usually holds no team membership at all. The field
is required rather than defaulted: a guardian table pulled with a `team_id` filter returns zero
rows and a warning nobody reads, which looks exactly like a guardian who has not added a child.

Delta pulls filter on a cursor taken from the server's own `updated_at`, never from the
local clock. Every fifth pull is a full reconciliation, which is how deletions made on
another device propagate.

Historically there were three read paths and two of them clobbered offline work; the
regression test named `preserves a task created offline (C3/B3)` is what stops that
coming back.

### Everything is scoped to a season

Every season-scoped table carries `season_id NOT NULL`, referenced compositely as
`(season_id, team_id)`. On the client, `useSeasonScope()` and `useSeasonScoped()` in
`src/lib/season-scope.ts` are the one definition of "belongs to the season on screen" —
that filter used to be copy-pasted per component, and the one component that forgot it
silently mixed last season's scouting reports into this season's list.

**A prior season is read-only, and that is a database rule.** `season_is_open()` gates the
INSERT, UPDATE and DELETE policy of every season-scoped table; SELECT is untouched, so the
history stays fully browsable. The client's disabled controls and archived-season banner
exist so the app does not QUEUE a write the server is going to refuse — not as the
enforcement itself. The client that matters is the one that was offline when the season
rolled over and still thinks last season is current.

A rollover is composed from the ordinary write path rather than an RPC, because it has to
work with no network: the season is queued first (its children reference it), then the
cloned sub-teams, then the checklist, then the archive of the outgoing season. One drain
satisfies the foreign keys because the queue drains in the order the user acted.

### Realtime is an enhancement, never a source of truth

Postgres change events merge into the store through the same `mergeIntoStore` /
`updateLocalDatabase` functions the pull uses, with the same pending-record protection.
If the WebSocket drops, polling covers it and nothing is lost — realtime only makes
updates arrive sooner.

### One definition per entity

`src/lib/entity-registry.ts` holds each entity's field mapping in both directions, and a
property test asserts `fromRemote(toRemote(x))` deep-equals `x`. Three separate production
bugs were the same defect — a field carried one way and not the other — so new entities go
here, not into an ad-hoc transform.

## The design system

Everything visual comes from `tailwind.config.js`. If you find yourself typing a square
bracket, the token is missing — add it there rather than inline. Two arbitrary values are
left in `src/`, each with a comment earning its place, and `harness-invariants.test.ts` holds
that count on a ratchet that may only go down — so this sentence cannot drift from the number
again without a test going red.

**The component kit** (`src/components/ui/`, Sprint 5.5) is the layer between the tokens and
the views: `Button` (primary/secondary/danger, `busy` ties the spinner to the disable),
`IconButton`, `Modal` (owns the overlay, `shadow-overlay`, the named widths and the dialog
ARIA; `stacked` puts a confirm above another modal), `EmptyState`, `SectionHeader`, and the
`.field` class in `index.css` for every input/select/textarea. Hand-rolling one of these in a
view is how the app accumulated eight primary-button recipes — reach for the kit, and extend
it if it can't express what you need.

**Type.** The named scale is *retuned*, not extended: `text-sm` is 13px and `text-base` is
14px, against Tailwind's 14/16. Retuning the names is what makes a density pass reach every
view at once instead of waiting for each one to opt in. `text-2xs` (11px) is the step below
`text-xs`; it exists because fifteen independently-chosen `text-[10px]`/`text-[11px]` values
had grown into the gap where it should have been.

> **Do not raise `text-base` back to 16px without also removing the coarse-pointer floor in
> `index.css`, and do not remove that floor while `text-base` is 14px.** iOS Safari zooms the
> viewport when a focused input computes below 16px and does not zoom back out — at a venue,
> with the keyboard open. The two changes are one change.

**Colour.** `forge-*` is the brand ramp (identical values to Tailwind's `orange-*`, which it
replaced everywhere in `src/`). Keep the orange identity; the plan is explicit that the
problem was never the brand.

**Space, elevation, radii.** `shadow-card` / `shadow-raised` / `shadow-overlay` are the three
elevation steps, tuned to read on both the light and dark grounds. Container widths are named
for what they hold — `max-w-prose`, `panel`, `dialog`, `wide`, `app` — and `AppShell` owns the
outermost stop, so a view only sets its own width if it genuinely wants to be narrower.

**Touch targets are opt-in**, via `touch-target` on the control that is actually a primary
action. This replaced a blanket `@media (pointer: coarse)` block matching `button[class*="p-"]`
and friends, which — being a substring match on the class attribute — also matched `px-2`,
`placeholder-slate-400` and `pointer-events-none`, and so forced nearly every control on a
phone to 44px wide.

**`tall:`** is a height breakpoint (`min-height: 600px`), not a width one. It exists for the
phone-keyboard case: when the viewport is short, ornament yields to navigation.

## Navigation

`src/lib/navigation.ts` defines the app's views once. The sidebar rail, the mobile drawer and
the route table are three renderings of that one array — add a view there and it appears in
all three or in none. Every view is a real route (`#/app/board`), deep-linkable and behind
`React.lazy`.

`Dashboard.test.tsx` asserts each nav entry appears **exactly once** in the DOM. That is not
defensive style: the sidebar used to be two components with two copies of everything, and
those assertions are what stop it becoming two again.

Some views are one nav entry with two experiences rather than a gate: **Meetings** is visible
to everybody, because the schedule is the whole of a student's use of the feature, and the page
renders the event manager or the read-only schedule depending on `can_manage_meetings`.

Views can be gated on a capability — `requiresManage` (admin or coach) and `requiresOperator`
(the platform operator). Both are UX only: the routes render their own refusal for anyone who
follows a deep link, and the database refuses the writes regardless. `navViewsFor` defaults
`isOperator` to false so adding a gated view cannot leak into an existing caller's nav.

## Attendance, and the one thing that is not offline-first

Everything in FalconForge is a queued write that works with no signal — including **the coach's
attendance roster**, which is the path that matters at a venue with dead WiFi.

**Student self check-in is the exception, deliberately.** A check-in is a claim about the
present moment, and an offline client has no credible account of what the present moment is.
Queue it and the check-in window, the dead code from last week, and "a student cannot check in
for a meeting they did not attend" all become requests the client is trusted to honour.
`check_in_with_code` is therefore an RPC that judges the window against the server's `now()`,
and the check-in screen says plainly what to do when there is no signal: ask a coach, whose
roster works offline. Same shape as seat capacity — put enforcement on an action that is
inherently online, so the offline write path never consults a rule it cannot evaluate.

Two more properties worth knowing:

- **Nobody is ever auto-marked absent.** A member with no record renders "—" and stays that way
  until a coach saves the roster, because an unsaved roster is a fact about the coach rather
  than about the student. "Mark rest absent" exists, and it is a coach saying so on purpose.
- **An excused absence leaves the denominator** of an attendance rate rather than counting as a
  miss, and a member with no records at all gets "—" rather than 0%.

## Licensing, seats, and who may do what

A team needs a current **licence** to write. Reads are never gated: an expired licence puts the
team in read-only mode and deletes nothing, which is a locked product decision and the reason
`team_can_write()` appears in every write policy and in none of the read ones.

**Seats are purchased team capacity, and the gate is join approval.** One seat per approved
member, the admin included. The whole model is three checks that all live in the database:

| Question | Enforced by | Where |
|---|---|---|
| Is this person on the team? | `is_team_member()` → `status = 'approved'` | RLS, every table |
| May the team write at all? | `team_can_write()` → an in-force grant | RLS, every table |
| May the admin approve one more? | `enforce_seat_capacity()` | BEFORE trigger |

**No policy consults `seat_assigned`, deliberately** — schema assertion 19 fails if one starts
to. Per-member licence checks in the write path would put licensing on the critical path of a
student's offline write at a competition, and lock out whoever's device could not ask. Putting
the gate at approval instead means the enforcement point is an action that is inherently online
and rare, and the offline path never consults licensing at all.

Approving a member sets `status` and `seat_assigned` in one statement, so the trigger refuses
the whole approval atomically when the team is full. Invite codes are capped at the seats
actually free, so twenty people cannot sign up for ten places. Reducing a seat count below the
current headcount is allowed — a customer must always be able to lower their bill — and nobody
loses access; the team simply cannot approve anyone new until it is back under.

Everything client-side **fails open**: `entitlement` is read over the network, and "we could not
ask" is never treated as "no". Predicates are written against a positive `'read_only'`, never
`!== 'active'`, because the two differ exactly on the device that has never managed to read.

### Handing a team over

Exactly one admin per team, enforced by a partial unique index — so moving the role is a
transfer, not an edit. It is a **two-party handshake**: the admin nominates, and the successor
accepts after reading the terms. That is not ceremony. `enforce_member_role_eligibility` refuses
the admin role to anyone who has not accepted the terms themselves, and you cannot validly attest
on somebody else's behalf.

If an admin leaves **without** handing over, the team is stranded: every warm path runs through
`can_manage_billing`, which only they satisfied, and the unique index blocks promoting anyone
while their row still holds the role. `operator_transfer_team_admin` is the only way out, gated
on `is_platform_operator()` and recorded in `operator_actions` — a table with a SELECT policy and
no INSERT/UPDATE/DELETE policy at all, because a trail the caller can append to is not evidence.

### Legal documents and attestations

`ATTESTATION_VERSIONS` in `lib/attestations.ts` is the **only** place a document version is
written; the pages read it, so a page cannot claim 2.0 while the app accepts 1.0. Raising a
version makes `ReAttestationPrompt` ask again on next sign-in.

The split is deliberate: the **database** asks only whether somebody has accepted a document at
all (consent identity), because the current version number is a client artefact and duplicating
it in a trigger would create two sources of truth. Whether an acceptance is **current** is the
client's question (consent freshness). `user_attestations`' unique key includes `version`, so
accepting a new version keeps the record of the old one.

## Testing

```bash
npm run gate             # the Gate: lint -> unit -> integration -> build
npm run gate:db          # the Gate plus db:verify, test:db and test:rls (Docker)

npm run lint             # tsc --noEmit && eslint src
npm run test:run         # unit
npm run test:integration # real IndexedDB, real store, no network
npm run test:db          # real Postgres — needs `npm run db:start` (Docker)
npm run test:rls         # the tenant-isolation subset of test:db
npm run test:coverage    # all three suites, merged, with thresholds (not yet run by CI)
npm run test:e2e         # Playwright smoke pack — a real browser, a real build
```

`npm run gate` is the single definition of "done" — it used to be spelled out in three places
that had drifted apart. ESLint is deliberately small: six rules, each one naming a defect this
project actually shipped. `docs/failure-modes.md` records those, and the fact that of 34 fix
commits, 13 were found by running the app and roughly none by the suite.

`test:db` runs the data layer against a real local Supabase stack: the sync drain and pull
against real PostgREST, and a behavioural tenant-isolation suite that asserts, with real
JWTs for two teams and all four roles plus a guardian and an anonymous client, that nobody
can reach another team's rows. It also asserts what the capability model permits, that a
guardian reaches their child and nothing else, and that a team whose licence has lapsed can
read everything and write nothing. It fails loudly if the stack is not running rather than
skipping — a security suite that passes with no database is worse than none.

### The smoke pack, and looking at the app

```bash
npm run test:e2e   # the smoke pack in a real browser against a real build:
                   # 5 spec files, 21 tests — registration through the emailed link,
                   # invite/join/approve, offline→sync, an offline cold boot,
                   # meetings and check-in, new season, scouting, checklist
npm run capture    # screenshots of every view at 375 / 768 / 1280
npm run venue      # the competition simulation: offline for a session, then reconnect
npm run seed:review  # the awkward licensing states (at capacity, lapsed, stranded)
npm run seed:demo    # one ordinary populated team, for demos and screenshots
```

The smoke pack runs against a **production build served by `vite preview`**, not the dev server.
That is deliberate rather than fussy: the dev server has no service worker, so an offline
navigation cannot fetch a `React.lazy` chunk and the app renders blank — testing offline
behaviour against it would measure the harness rather than the product, in the one codebase
where offline behaviour *is* the product.

None of these replace opening the app and looking at it. Every UI defect found in Sprints 5, 6
and 7 came from poking around, not from an assertion; a script only checks what somebody already
thought to check.

All of these scripts **refuse at the network layer** if the app under test is talking to the
hosted project, because `.env.local` points at production and `.env.development.local` is
gitignored — one deleted file and localhost is talking to the real database.

## Project Structure

```
falconforge/
├── src/
│   ├── lib/
│   │   ├── auth.tsx           # Authentication context
│   │   ├── supabase.ts        # Supabase clients (app + sync)
│   │   ├── store.ts           # Store composition, persist config, reset
│   │   ├── slices/            # One file per data domain, typed set/get
│   │   ├── navigation.ts      # The app's views, defined ONCE (nav + routes)
│   │   ├── season-scope.ts    # "which season, and may I edit it" — one answer
│   │   ├── meetings.ts        # Event palette, check-in window, codes, recurrence
│   │   ├── offline-db.ts      # Dexie: sync queue, dead letters, sync metadata
│   │   ├── sync.ts            # The write path: queue drain, retry, dead-letter
│   │   ├── server-pull.ts     # The read path: every server read, one rule
│   │   ├── entity-registry.ts # One field mapping per entity, both directions
│   │   ├── realtime.ts        # Postgres change events (enhancement only)
│   │   ├── queries.ts         # Per-page background refresh hooks
│   │   └── __mocks__/         # Manual mocks, opted into per test file
│   ├── pages/                 # Login, Onboarding, CreateTeam, JoinTeam, legal
│   ├── styles/fonts.css       # Self-hosted Inter @font-face
│   ├── components/            # Feature UI
│   │   ├── AppShell.tsx       # Sidebar + banner + <Outlet>, the app frame
│   │   ├── Sidebar.tsx        # ONE nav definition, rail at lg / drawer below
│   │   └── meetings/          # Schedule, roster, QR, poster, check-in
│   │       ├── useSchedule.ts # "this season's events, split at now" — one answer
│   │       └── format.ts      # Dates and times, local, in one place
│   └── test/db/               # Local-Postgres test harness + fixtures
├── e2e/                       # Playwright smoke pack (helpers + 5 specs, 21 tests)
├── scripts/
│   ├── seed-review-states.mjs # awkward licensing states, localhost only
│   ├── seed-demo-team.mjs     # one ordinary populated team, localhost only
│   ├── capture-screens.mjs    # screenshots at 375 / 768 / 1280
│   ├── venue-simulation.mjs   # offline for a session, then reconnect
│   └── check-production.mjs   # READ-ONLY post-deploy check of the live site
├── supabase/
│   ├── migrations/            # The schema. Source of truth.
│   └── tests/                 # schema_assertions.sql
└── public/                    # Static assets
```

## Roadmap

Tracked in [`FALCONFORGE_V2_PLAN.md`](FALCONFORGE_V2_PLAN.md) §6. The season lifecycle, the
UI/density/routing pass, the licensing and admin console with the legal pages, and the beta
hardening sprint have all landed, and so have the meetings and attendance UI and guardian
accounts. Next: Stripe billing and team data export — the schema for the first is already live.

Running the beta is documented separately in [`docs/beta-ops.md`](docs/beta-ops.md): backups and
when to take them, the error-review cadence, and the rule that governs deploys — **schema changes
are ordered by hand, everything else ships on merge**.

## License

**Undecided, and deliberately not stated as MIT.** This file has said "MIT" since the first
commit and there has never been a `LICENSE` file to match — so the claim was unenforceable in
both directions.

It needs a decision rather than a default: FalconForge is intended to be a paid product
(plan §2), and MIT would let anyone run a competing instance of it. Until that decision is
made, no licence is granted; the code is source-available for review, not for reuse.

Tracked in `FALCONFORGE_V2_PLAN.md` §8 as a decision for Kevin.
