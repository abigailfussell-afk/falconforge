# FalconForge Scaling & Security — Next Steps

This document captures the agreed-upon changes from the scalability analysis conversation (2026-03-08). Use this as a prompt for your next chat session.

## Context

- Full database backup completed: `backup-full-2026-03-08T22-03-03/`
- Scalability analysis: `.gemini/antigravity/brain/3e2882b2-7c3a-4616-81eb-9ec98e6a5f5a/scalability_analysis.md`
- Backup script for future use: `backup-full.mjs` (run with `$env:SUPABASE_DB_PASSWORD="<your-password>"; node backup-full.mjs`)
- Database region: **us-west-2** (pooler host: `aws-0-us-west-2.pooler.supabase.com`)

## Changes To Make (Priority Order)

### 1. Disable AI Features in UI (Keep Code)
- Add a feature flag constant (e.g., `AI_FEATURES_ENABLED = false`) 
- Gate the AI UI entry points (Portfolio Helper, Judging Prep) behind this flag
- Keep all AI code intact — just hide from users for now
- The Gemini API key storage in the Zustand store should also be hidden from settings

### 2. Fix Invite Code Security Hole
- The `invites_select_all` RLS policy currently returns `true` for ALL SELECT queries
- Any authenticated user can read any team's invite codes
- Change it to only allow: team members to see their team's invites, OR lookup by specific code
- Suggested fix: `USING (team_id IN (SELECT get_user_team_ids(auth.uid())))`
- Also add a separate policy or RPC function for invite code lookup during join flow

### 3. Incremental Delta Sync for `pullChangesFromServer()`
- **Keep the full fetch** in `fetchTeamData()` — this is the "fill the cache" moment for offline-first
- **Switch to delta sync** ONLY in `pullChangesFromServer()` in `sync.ts`
- Add `updated_at > lastSyncTimestamp` filtering for subsequent syncs
- Add `updated_at` columns to any tables that don't have them (seasons, sub_teams)
- Implement soft-delete (`deleted_at` column) to propagate cross-client deletions
- This is the **single biggest scalability bottleneck** 

### 4. Migrate Data Persistence from localStorage to IndexedDB
- Current: Zustand `persist` → localStorage (5MB hard limit)
- Target: Zustand `persist` → IndexedDB (via Dexie, already set up)
- Keep localStorage only for lightweight metadata (theme, current team ID, sync timestamps)
- This eliminates the storage ceiling and unblocks lazy loading
- Match plans with `drawingData` (SVG/JSON) are the biggest storage consumers

### 5. Supabase Realtime (Progressive Enhancement)
- Add Supabase Realtime subscriptions for the current team's tables
- Use as an **enhancement only** — if connection drops or hits limits, fall back to current polling + manual sync
- Replace the 5-second polling interval in `sync.ts` with Realtime push
- Graceful degradation: if Realtime subscription fails, silently revert to polling

### 6. Lazy Data Loading Per Page
- Current: `fetchTeamData()` loads ALL 7 entity types on every team switch
- Target: Load only what the current page needs
- Use React Query (`@tanstack/react-query` is already in package.json but unused)
- Add pagination for large result sets (tasks, scouting reports)

## NOT Changing (Design Decisions Kept)

- **Full-table fetch on initial load / team switch** — intentional for offline-first at competition venues with spotty WiFi
- **Supabase anon key in client** — this is by-design, RLS protects the data
- **Last-write-wins conflict resolution** — acceptable for current scale, add optimistic locking later if needed
- **No server-side API layer** — direct Supabase calls are fine; add Edge Functions only for AI features and specific business logic

## Database Changes Required

These changes will need Supabase schema modifications:
- Add `updated_at` column to `seasons` and `sub_teams` tables (for delta sync)
- Add `deleted_at` column to entity tables (for soft-delete propagation)
- Modify `invites_select_all` RLS policy (for security fix)
- Add `updated_at` trigger to `seasons` and `sub_teams`

> **Important**: Always run `backup-full.mjs` before making schema changes!

## Verification Plan

After each change:
1. Run `npm run test:run` — all unit/component tests must pass
2. Run `npm run test:integration` — sync/data transform tests must pass
3. Browser test: sign in, verify data loads, test sync, check the modified features
4. Run the backup script to capture the new schema state
