# FalconForge

A comprehensive management app for FIRST Tech Challenge (FTC) robotics teams. Features sprint planning, scouting reports, and match planning - all with offline-first support.

## Features

- **Sprint Planning / Kanban Board** - Agile-style task management with Board, List, and Calendar views
- **Pre-Match Checklist** - Customizable checklists for competition day, saveable as team templates
- **Scouting Reports** - Track opponent capabilities during competitions
- **Match Planner** - Draw autonomous paths and game strategies on the field
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

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`

## Running in Demo Mode

By default, the app runs in **Demo Mode** without any cloud services:
- All data is stored locally in your browser (localStorage + IndexedDB)
- No account required
- Works completely offline
- Perfect for trying out the app

## Enabling Cloud Features (Optional)

To enable cloud sync, authentication, and multi-device support:

### 1. Set up Supabase

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Project Settings > API
4. Copy your Project URL and anon/public key

### 2. Configure Environment

Create/edit `.env.local` in the project root:

```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### 3. Set up Database Schema

The schema lives in `supabase/migrations/` and is the source of truth — do not hand-write
SQL in the dashboard. Apply it with the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref> && supabase db push
```

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

### 4. Enable Auth Providers (Optional)

In Supabase Dashboard > Authentication > Providers:
- Enable Google OAuth
- Enable Microsoft OAuth (Azure)
- Configure redirect URLs

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
                    └── per-page refresh hooks (mode: 'full', one table)
                             │
                             ├─→ getPendingRecordIds()   ← the rule, applied once
                             ├─→ entity.fromRemote()
                             └─→ store setters
```

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
bracket, the token is missing — add it there rather than inline (there is exactly one
arbitrary value left in `src/`, and it carries a comment explaining why it earns its place).

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

## Testing

```bash
npm run lint             # tsc --noEmit
npm run test:run         # unit
npm run test:integration # real IndexedDB, real store, no network
npm run test:db          # real Postgres — needs `npm run db:start` (Docker)
npm run test:rls         # the tenant-isolation subset of test:db
npm run test:coverage    # all three suites, merged, with thresholds
```

`test:db` runs the data layer against a real local Supabase stack: the sync drain and pull
against real PostgREST, and a behavioural tenant-isolation suite that asserts, with real
JWTs for two teams and all four roles plus a guardian and an anonymous client, that nobody
can reach another team's rows. It also asserts what the capability model permits, that a
guardian reaches their child and nothing else, and that a team whose licence has lapsed can
read everything and write nothing. It fails loudly if the stack is not running rather than
skipping — a security suite that passes with no database is worse than none.

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
│   │   └── Sidebar.tsx        # ONE nav definition, rail at lg / drawer below
│   └── test/db/               # Local-Postgres test harness + fixtures
├── supabase/
│   ├── migrations/            # The schema. Source of truth.
│   └── tests/                 # schema_assertions.sql
└── public/                    # Static assets
```

## Roadmap

Tracked in [`FALCONFORGE_V2_PLAN.md`](FALCONFORGE_V2_PLAN.md) §6. The season lifecycle, the
new-season wizard, and the UI/density/routing pass have landed; next is the licensing and
admin console with the legal pages, then beta hardening for FTC kickoff. After beta: meetings
and attendance UI, guardian accounts, Stripe billing, and team data export — the schema for the
first three is already live.

## License

MIT
