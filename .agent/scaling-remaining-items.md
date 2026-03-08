# FalconForge Scaling — Remaining Items (4, 5, 6)

This document captures the remaining scaling changes from the original analysis. Items 1–3 are complete (AI feature flags, invite security, delta sync). Use this as a prompt for a future chat session.

## Context

- Items 1–3 completed: 2026-03-08
- Delta sync is live: `pullChangesFromServer()` now does full pull every 5th cycle, delta pulls otherwise
- Migrations applied: `014_fix_invites_rls.sql`, `015_delta_sync_columns.sql`
- All tables now have `updated_at` columns with auto-update triggers
- Backup script: `backup-full.mjs` (run with `$env:SUPABASE_DB_PASSWORD="k1uRA5kGvHria47A"; node backup-full.mjs`)

## Changes To Make (Priority Order)

### 4. Migrate Data Persistence from localStorage to IndexedDB

**Why:** localStorage has a 5MB hard limit. Match plan SVG/JSON drawing data will eventually hit this ceiling. IndexedDB has essentially unlimited storage.

**Current state:**
- Zustand `persist` middleware → localStorage (`falconforge-storage` key)
- Only the sync queue uses IndexedDB (via Dexie, in `src/lib/offline-db.ts`)

**Plan:**
- Switch Zustand `persist` storage adapter from localStorage to IndexedDB
  - Dexie is already set up in `offline-db.ts` — add a new table for app state
  - Use Zustand's custom storage adapter: `createJSONStorage(() => indexedDBStorage)`
  - The custom adapter needs `getItem`, `setItem`, `removeItem` (all async-capable)
- Keep localStorage ONLY for lightweight metadata:
  - `falconforge-sync-timestamps` (sync timestamps)
  - `falconforge-sync-counter` (delta sync counter)
  - Theme preference
- Handle migration: on first load, check if `falconforge-storage` exists in localStorage; if so, migrate it to IndexedDB and remove the localStorage copy
- Update `signOut` flow in `App.tsx` and `JoinTeam.tsx` to clear the new IndexedDB state table

**Key files:**
- `src/lib/offline-db.ts` — Add new Dexie table + storage adapter
- `src/lib/store.ts` — Switch persist middleware config
- `src/App.tsx` — Update sign-out cleanup
- `src/pages/JoinTeam.tsx` — Update sign-out cleanup
- `src/lib/auth.tsx` — Check for any localStorage references

**Testing:**
- `npm run test:run` — all unit/component tests must pass
- `npm run test:integration` — sync/data transform tests must pass
- Browser test: sign in, verify data loads, refresh page (data should persist), sign out (data should clear)
- Test with large match plan drawings to verify no storage errors

---

### 5. Supabase Realtime (Progressive Enhancement)

**Why:** Currently syncs via polling every 5 seconds. Realtime push is instant and reduces unnecessary queries.

**Current state:**
- `src/lib/sync.ts` has a 5-second polling interval for pending changes count
- Auto-sync triggers when `pendingChanges > 0 && isOnline`
- `pullChangesFromServer()` runs after each push sync

**Plan:**
- Add Supabase Realtime subscriptions for the current team's tables:
  - `tasks`, `scouting_reports`, `match_plans`, `checklists`, `sub_teams`
- Use as **enhancement only** — if Realtime fails, fall back to current polling
- Create a new hook or extend `useSync` in `sync.ts`:
  - Subscribe to `postgres_changes` channel filtered by `team_id`
  - On `INSERT`/`UPDATE` events: merge the changed record into store (reuse `mergeIntoStore`)
  - On `DELETE` events: remove the record from store
  - On subscription error or disconnect: silently revert to polling
- Replace the 5-second polling interval with Realtime push
- Keep the manual sync button for fallback

**Key files:**
- `src/lib/sync.ts` — Add Realtime subscription logic
- `src/lib/supabase.ts` — May need to expose the Realtime client
- `src/lib/offline-db.ts` — No changes expected

**Testing:**
- `npm run test:run` — all tests pass
- Browser test with two clients: make a change on one, verify it appears on the other within seconds
- Test offline: disconnect network, verify app still works, reconnect, verify sync resumes
- Test Realtime failure: block the WebSocket, verify polling resumes

---

### 6. Lazy Data Loading Per Page

**Why:** `fetchTeamData()` loads ALL 7 entity types on every team switch. For teams with lots of data, this is slow and wastes bandwidth for pages the user may never visit.

**Current state:**
- `fetchTeamData()` in `store.ts` (line 215+) does sequential Supabase queries for all entity types
- React Query (`@tanstack/react-query`) is already in `package.json` but unused
- All data is loaded into the Zustand store on team switch

**Plan:**
- Keep `fetchTeamData()` for the initial offline cache fill (intentional for competition venues)
- Add React Query for per-page data fetching:
  - `useTasksQuery(teamId, seasonId)` — used by SprintPlanning
  - `useScoutingQuery(teamId, seasonId)` — used by ScoutingReports
  - `useMatchPlansQuery(teamId, seasonId)` — used by MatchPlanner
  - etc.
- Add pagination for large result sets (tasks, scouting reports)
- Stale-while-revalidate pattern: show cached data immediately, fetch fresh data in background
- This is the **lowest priority** because the offline-first cache fill already handles the main use case

**Key files:**
- `src/lib/store.ts` — May need to split `fetchTeamData` or add React Query integration
- `src/components/SprintPlanning.tsx` — Add query hook
- `src/components/ScoutingReports.tsx` — Add query hook
- `src/components/MatchPlanner.tsx` — Add query hook
- New file: `src/lib/queries.ts` — React Query hooks

**Testing:**
- `npm run test:run` — all tests pass
- Browser test: navigate between pages, verify data loads per-page
- Network tab: verify only relevant queries fire when switching pages

## NOT Changing (Design Decisions Kept)

- **Full-table fetch on initial load / team switch** — intentional for offline-first
- **Supabase anon key in client** — by-design, RLS protects the data
- **Last-write-wins conflict resolution** — acceptable for current scale
- **No server-side API layer** — direct Supabase calls are fine

## Verification After Each Change

1. Run `npm run test:run` — all unit/component tests must pass
2. Run `npm run test:integration` — sync/data transform tests must pass
3. Browser test: sign in, verify data loads, test sync, check the modified features
4. Run `backup-full.mjs` to capture the new schema state (if schema changed)
