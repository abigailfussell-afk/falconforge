# Exit criteria per finding — Phases 0 and 1 of the roadmap

Each block is what "done" means for one ID. The **red test** line names the test that must fail
with the fix reverted (`docs/failure-modes.md` §2: comment the fix out, watch it go red, put it
back — say so in the sprint report). The **trap** line is the way this particular fix has gone
wrong before, or will if done naively. Evidence and fix direction live in the area report; this
file only says how to know it is finished. Effort: S < ½ day · M 1–2 days · L a sprint.

Conventions: "Gate" = `npm run gate`; "Gate:db" = `npm run gate:db` (required when `supabase/`
is touched). "Browser" = the built bundle (`npm run preview`, not the dev server) against the
local stack with `npm run seed:review` applied, at 1280×800 **and** 375×812.

---

## Phase 0 — before more beta teams are invited

### SEC-01 — coach cannot touch the admin row or assign `admin`  (M · Gate:db)
- As a coach (`successor@` on Iron Falcons) over PostgREST: `PATCH team_members?role=eq.admin {"role":"student"}` → `42501`; `PATCH` own row `{"role":"admin"}` → refused; `DELETE team_members?role=eq.admin` → refused; `PATCH` the admin row's `user_id`/`managed_profile_id`/`status` → refused.
- `nominate_team_admin` → `accept_admin_nomination`, `transfer_team_admin` and `operator_transfer_team_admin` still succeed end to end (the existing db tests stay green).
- Coach can still change another member student ↔ mentor ↔ coach and remove a non-admin.
- **Red tests:** four new cases in `src/test/db/tenant-isolation.rls.db.test.ts` (or a sibling), one per refusal above, asserting the error code — not just "no row changed".
- **Trap:** a trigger that also blocks the transfer RPCs. Use a transaction-local flag set inside the RPCs (`SET LOCAL`) and check it with `current_setting(..., true)`; the RLS suite must exercise the RPC path *after* the trigger exists. Do not solve it by making `can_manage_roster` admin-only — coaches must keep roster powers.
- Record the class in `docs/failure-modes.md` §6 (widest-brush default).

### SYNC-01 + SYNC-03 — paged, season-scoped pulls  (M · Gate)
- Seed 2,500 `tasks` for one team; after `fetchTeamData` the store holds 2,500; after a delta pull with 1,500 changed rows it holds all of them; no row is ever removed from the device by a *truncated* page.
- Season-scoped tables (`tasks`, `scouting_reports`, `match_plans`, `sub_teams`, `checklists`, `meetings`, and `meeting_attendance` via its meeting) are pulled for the **current** season on mount; an archived season's rows load when the season picker selects it, and are then cached offline like everything else.
- Measured with the SYNC agent's `pull-size.mjs` approach: bytes per app open for the seeded mid-season team drop by ≥ 60% versus the number recorded in [SYNC-03](sync-offline-scale.md) (~0.7 MB).
- `field_image_data` is no longer part of the `seasons` pull on every open (fetched once per season, or moved to Storage — either is acceptable for this criterion).
- The B3 guard survives: an un-pushed local record is still preserved across a full pull (existing regression tests green).
- **Red tests:** an integration test against the local stack seeding 1,001 rows (fails today with 1,000); a unit test that a delta cursor only advances after the *last* page.
- **Trap:** raising `max_rows` alone moves the cliff and is not done. Ordering must be `updated_at, id` for stable pages. The delta cursor must not advance past rows in a page that errored.

### SYNC-02 — never replace a collection with an anon-key result  (S · Gate)
- With a stored-but-expired JWT and the auth refresh endpoint failing, a pull is **skipped** (or errors), and the local collections are untouched; the status indicator does not say "Synced".
- `supabaseSync.accessToken()` never returns the anon key for a pull; `pullFromServer` refuses to call `updateLocalDatabase` unless the token's `role` claim is `authenticated`.
- **Red test:** unit test in `server-pull` that stubs the token as the anon JWT and asserts `setTasks` is not called with `[]` (fails today).
- **Trap:** the push path *may* legitimately send a queued write with the anon key and get 42501 → retry — keep that; only the pull's "empty means deleted" semantics change.

### SEC-02 — `age_classification` survives sign-in  (S · Gate:db)
- `update_user_age_classification('18_plus')` → password sign-in → `users.age_classification` is still `18_plus`; same after `PUT /auth/v1/user` (profile update) and after a password change.
- A brand-new signup still writes `age_classification` and `full_name` from metadata (registration smoke spec green).
- **Red test:** db test: set the column, `UPDATE auth.users SET last_sign_in_at = now()`, assert unchanged (fails today).
- **Trap:** the same COALESCE also rewrites `full_name` — fix both; and correct the "✅ RESOLVED" line in `FALCONFORGE_V2_PLAN.md` §8.

### SEC-03 — removing a member keeps history  (M · Gate:db)
- In the browser as admin: "Remove" a student who has an assigned task and attendance → succeeds; the row is `status='removed'`, `seat_assigned=false`; the task shows unassigned (or keeps the name read-only — state which); `meeting_attendance` rows for that member still exist.
- Rejecting a *pending* request still works (delete or mark removed — state which, and test it).
- A removed member re-joining with a code lands `pending` on the **same** `team_members.id`.
- `docs/beta-ops.md` and plan §8 no longer claim "the app never deletes a member".
- **Red test:** db/integration test that removal of a member with an assigned task succeeds (fails today with `23502`).
- **Trap:** do not fix this by widening the FK actions yet — that is a migration on the frozen schema (per-column `ON DELETE SET NULL (column)`) and is a separate, later item. The UI fix is enough for Phase 0.

### SEC-05 — teammates see only a child's name  (M · Gate:db)
- As `iron-student0@`: `GET managed_profiles?select=notes,promotion_code` → error or columns absent; `select=id,full_name` still works for rostered children.
- As the guardian: full row still readable and writable; `AddChildDialog` and `GuardianView` unchanged in the browser.
- The registry's `managed_profiles` pull still works for both roles (the `select('*')` trap in the fix direction).
- **Red test:** RLS test asserting a student cannot read `notes`/`promotion_code` (fails today).

### SYNC-05 — sign-out confirms when work is unsynced  (S · Gate)
- Offline, create a task, click sign-out → a confirm names the count ("1 change hasn't reached the server"); Cancel keeps the queue; Confirm clears it. Online with a non-empty queue → offer "sync then sign out".
- With an empty queue and no dead letters, sign-out is unchanged (one click).
- **Red test:** component test: sign-out with `getPendingSyncCount() = 1` does not call `clearLocalDatabase` without confirmation.

### SEC-09 — creation-time invite code lasts 7 days and says so  (S · Gate:db)
- `create_team_as_admin` inserts `expires_at = now() + 7 days`; CreateTeam's success screen shows the expiry; InviteManager shows one consistent lifetime for both codes (WALK-B-08 screenshot no longer reproducible).
- **Red test:** db test on the RPC's inserted `expires_at` (fails today at 24 h).

### FEAT-01 — comment authors render by name  (S · Gate)
- In the browser: student adds a comment; admin opens the task and sees the student's name and initials, not "Guest".
- Comments already stored with an auth user id still resolve (reader matches `userId` too).
- **Red test:** the fixture in `SprintTaskActivity.test.tsx` writes via the same path `SprintPlanning` uses, with a *different* signed-in user than the author (the current fixture cannot fail).

### WALK-B-01 + WALK-B-02 — guardians can use their own shell  (S · Gate)
- As `guardian@`: sign-in lands on `/app/guardian` (or a picker with "My children" first — state which); `/app/profile` and `/app/help` render and stay; "Switch team" does not loop to the Welcome screen.
- A no-team, no-children account still reaches onboarding.
- Delete or make true the `GuardianOnly` comment in `Onboarding.tsx`.
- **Red test:** AppShell test with `currentTeamId = null` at `/app/profile` asserting no navigation after 1.5 s (fails today).

### WALK-A-07 — re-attestation "Later" persists  (S · Gate)
- Click "Later" → reload ×3 → the prompt does not return within the snooze window; it never renders on `/app/checkin/*`.
- Accepting still records the attestation at the displayed version.
- **Red test:** component test: snoozed state → render → prompt absent.

### OPS-06 — onboarding email ceiling  (S · no code Gate needed for the account change)
- Either Resend Pro is active (documented in `docs/beta-ops.md` with the new daily number), or the beta onboarding schedule in `beta-ops.md` caps teams per day at the computed ceiling.
- `Login.tsx` maps "Error sending confirmation email" and "email rate limit exceeded" to a plain-language message with what to do; **red test:** Login test asserting the mapped copy.

### LAND-01 / LAND-02 / LAND-03 — landing page truth pass  (S · Gate)
- Footer links to `/#/legal/terms`, `/#/legal/privacy`, `/#/legal/community`, `mailto:support@…`; "Not affiliated with FIRST" line; "FIRST® Tech Challenge" named in the hero.
- Every feature claim on the page exists in the app: remove/rewrite the eight phrases listed in [LAND-03](../assessment-2026-08.md#7-landing-page-review).
- `landing-shots.mjs`-style check: `document.querySelectorAll('a').length ≥ 5`; no horizontal overflow at 375 px. Add a source-level test (like the "guidance describes the repo" ratchets in `harness-invariants.test.ts`) that `Landing.tsx` does not contain the overclaim phrases.

### Plan §8 corrections  (S)
- The six lines in [§9.2 of the assessment](../assessment-2026-08.md#92-plan-8-corrections-the-parking-lot-currently-says-things-that-are-false) are corrected in place, each with a pointer to the finding ID.

---

## Phase 1 — early season (Sept–Oct)

### P-01 phase S — bundled `GameDefinition` + `SchemaForm`  (M · Gate; no migration)
- `src/games/ftc-2025-decode.json` and `ftc-2026-biobuzz.json` exist and validate against a `GameDefinition` type; a source-level test asserts no game-specific literal remains in `ScoutingReports.tsx`, `MatchPlanner.tsx`, `constants.ts`, `types.ts` (`FIELD_IMAGE_URL`, `intakeType`, `Lifted Park`, `DecodeField` are gone).
- Scouting modal and card render from `scouting.match`; existing seeded DECODE rows render unchanged (same values, same labels) — screenshot before/after.
- Match Planner reads image, width/height and `partnerCapabilities` from the definition; existing drawings still load.
- Season form's "Game" is a select over bundled definitions plus "Other"; rollover defaults to the newest FTC definition.
- Archived 2025–26 season keeps rendering DECODE after the current season is BIOBUZZ (this is the snapshot criterion — in phase S it can be satisfied by storing the definition id + version on the season; the full `game_snapshot` column is phase M).
- **Red tests:** `SchemaForm` renders each field type; the source-level literal ratchet; entity-registry round-trip for `data` as an opaque bag (unknown keys preserved).
- **Trap:** the `rating` default mismatch (3 in the form, 0 in `fromRemote`) — pick one in the schema. Do not enumerate jsonb keys by hand anywhere.

### P-02 minimal set — scouting that answers questions  (M · Gate; migration for `kind`/`alliance`/`station` allowed)
- Scouting page has a team summary table (one row per team number, columns from `scoring.metrics`, sortable) and a team detail listing that team's reports; the form has match #, alliance colour and station; CSV export of the current event's reports downloads with one row per report.
- Works offline (table computed client-side from the store).
- **Red tests:** metric aggregation unit tests (mean/max/σ) and a component test for sort.

### SEC-07 — expiry is visible to the operator and writes are not offered to a lapsed team  (M · Gate:db)
- Operator console lists teams sorted by `valid_until` with an "expiring ≤ 30 days" filter.
- On a lapsed team every content "New/Edit/Save" control is disabled with the banner's reason (`useSeasonScope().canEdit` includes entitlement — this also closes WALK-B-12).
- A write queued *before* lapse and drained after lands in the terminal "renew and retry" state with the reason shown (rerun the WALK-B probe with the correct selector and screenshot it).
- **Red test:** `canEdit` false when `entitlement.status === 'read_only'`.

### SYNC-07 — honest sync status  (S · Gate)
- Built bundle, network cut, `navigator.onLine === true`: indicator shows "Can't reach server" (or "Synced · N min ago" with a stale marker), never plain "Synced"; `lastSyncTime` surfaced.
- **Red test:** add the offline-reload assertion to `e2e/offline-sync.spec.ts` (SYNC-16's third spec).

### SYNC-08 — storage persistence  (S · Gate)
- `navigator.storage.persist()` called after sign-in; Getting Started documents "install to home screen" for iOS. Red test: unit test that the call happens on auth.

### FEAT-02 / FEAT-05 — archived-season controls and planner update  (S each · Gate)
- Archived season: task modal Save/Delete/Archive, comment send/delete and Restore are disabled with the archived title text; modal opens read-only. Red test: render with an archived season, assert disabled.
- Planner: Load → edit → Save updates the same row (`match_plans` count unchanged); "Save as copy" available; match # editable. Red test: slice test that `handleSave` with a loaded id calls `updateMatchPlan`.

### WALK-B-03 / 04 / 05 — guardian promotion record, invite deep link, approval signal  (S–M · Gate:db for B-03)
- B-03: `managed_profiles.promoted_to_user_id`/`promoted_at` written by `claim_managed_profile`; guardian view shows "Now has their own login" with no join/offer actions; registry round-trip test.
- B-04: hit `/#/join/CODE` signed-out → sign up → confirm → onboarding offers "Join <team> with CODE" first; code cleared on use. Red test: Onboarding renders the stored-code action.
- B-05: pending screen advances to the team within 30 s of approval without a manual reload (poll or realtime); a signed-in approved member hitting `/join/CODE` is sent into the team.

### P-11 first half — observability  (S each · Gate)
- Build id = git SHA (`__BUILD_ID__` via `define`), shown in feedback subject and `error-reporting`; `check-production.mjs` asserts the served bundle's id equals `GITHUB_SHA`.
- Feedback `mailto:` body includes build id, route, `navigator.onLine`, team id, pending and dead-letter counts.
- A free uptime monitor hits `falcon-forge.com` and `${SUPABASE_URL}/auth/v1/settings` (documented in `beta-ops.md`, with who gets the alert).
- `.github/workflows/ops.yml` on a weekly schedule: keep-alive GET + `supabase db dump --linked` to an encrypted private artefact with retention; a restore has been rehearsed once against the local stack and the steps are in `beta-ops.md`.
- `deploy.yml` runs `npm run gate` and waits for CI success; `harness-invariants` asserts `deploy.yml` contains `npm run gate`.

### OPS-01 / OPS-02 — coverage truth and assertion-free tests  (S · Gate)
- `test:coverage` runs in CI (`schema` job) and passes at honestly re-measured thresholds (or the thresholds are deleted — state which); the seven assertion-free tests are rewritten or removed; the `if (button)` guards become `expect(button).toBeInTheDocument()`; a new ratchet counts test bodies without an assertion (= 0).

### OPS-11 — README truth pass  (S)
- The six false claims are gone; Quick Start lists Node ≥ 20.19 (`engines` + `.nvmrc`), Docker, `npm run db:start`, `.env.development.local` (with an `.example`), `npm run seed:review`, `npm run dev`; dead OAuth/Stripe env references removed or implemented; licence decided.

### SEC-06 / SEC-08 / SEC-10 — predicate exposure, bare `teams` insert, server-side under-13  (S each · Gate:db)
- SEC-06: `anon` `POST /rpc/get_user_team_ids` → no EXECUTE; `team_seats_remaining` removed from the allowlist or actually used; anonymous SELECTs still return `[]` not an error (test it before and after).
- SEC-08: `teams_insert_owner` policy dropped; `create_team_as_admin` still works (it runs as definer).
- SEC-10: signup with `age_classification='under_13'` in metadata is refused by `handle_new_user`; `update_user_age_classification('under_13')` refused. Red tests for both.

### WALK-A-06 — scouting input validation  (S, or folded into P-02)
- Team # 1–5 digits, match # ≥ 1, notes capped; long values wrap on the card. Red test: form rejects the three adversarial inputs from the walkthrough.

### WALK-A-08/09/10/11 — modal focus/Esc, a11y names and contrast, tap targets, wrapping  (S each · Gate)
- axe (wcag2a/aa) on `/app/admin` and `/app/meetings` reports zero `select-name`/`button-name` violations; the 2xs/xs slate-500-on-dark tokens pass 4.5:1; every interactive control on Admin/Meetings/Dashboard at 375 px is ≥ 32 px high; `Modal` moves focus in, traps Tab, closes on Escape — one implementation used by every modal.
