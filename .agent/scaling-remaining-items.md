# FalconForge Scaling — Remaining Items (5, 6)

This document captures the remaining scaling changes from the original analysis. Items 1–4 are complete. Use this as a prompt for a future chat session.

## Context

- Items 1–3 completed: 2026-03-08 (AI feature flags, invite security, delta sync)
- Item 4 completed: 2026-03-08 (Zustand persistence migrated from localStorage → IndexedDB)
- Delta sync is live: `pullChangesFromServer()` does full pull every 5th cycle, delta pulls otherwise
- Migrations applied: `014_fix_invites_rls.sql`, `015_delta_sync_columns.sql`
- All tables have `updated_at` columns with auto-update triggers
- Zustand state persists to IndexedDB via `appState` table (Dexie v3)
- `indexedDBStorage` adapter in `offline-db.ts`, used by `store.ts` via `createJSONStorage`
- Sign-out cleanup: `clearLocalDatabase()` + `clearAppState()` (both IndexedDB)
- Backup script: `backup-full.mjs` (run with `$env:SUPABASE_DB_PASSWORD="k1uRA5kGvHria47A"; node backup-full.mjs`)

---

## Changes To Make (Priority Order)

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

---

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
