# Pre-V2 migrations (archived 2026-08-15, Sprint 3)

These are the migrations that built the schema up to and including the Sprint 2 fixes. They
were squashed into the V2 baseline (`20260816*`) and are kept only as a record of how the
schema got there and why particular decisions were made.

**Do not re-apply them.** The V2 baseline is not a diff on top of these — it replaces them,
and the CLI would run them in filename order alongside the baseline if they were moved back.

Read them for archaeology:

| File | What it recorded |
|---|---|
| `00000000000000_baseline.sql` | The 2026-03-08 production backup, squashed. Explains why migrations 001–008 never existed in this repo. |
| `014_fix_invites_rls.sql` | The real invite-code exposure hole (`invites_select_all USING (true)`) and its fix. |
| `015_delta_sync_columns.sql` | Which tables gained `updated_at`, and why delta sync needs it. |
| `20260317000000_database_security_audit.sql` | Empty-string CHECKs, composite tenant FKs, and B18 (`match_number` made nullable). |
| `20260814000000_replica_identity_full.sql` | B7 — why realtime DELETE events need `REPLICA IDENTITY FULL`. |
| `20260814010000_round_trip_columns.sql` | B9/B10/B17 — fields the UI set that had nowhere to live. |
| `20260815000000_api_role_grants.sql` | The missing API-role grants that made a from-scratch rebuild unusable. **Its contents live on in `20260816000500_v2_grants.sql`** — see the header there. |

Everything these files established is carried forward into the V2 baseline. The one that
matters most for anyone doing this again is the grants file: without it, rebuilding from
migrations produces a database PostgREST answers `permission denied` for on every request.
