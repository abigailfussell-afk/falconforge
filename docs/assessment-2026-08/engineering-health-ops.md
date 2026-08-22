# OPS — Engineering health and operational readiness

Assessed 2026-08-22 against `main` @ `c1cec81` (clean). Evidence files under
`$S\ops\` (`coverage.log`, `outdated.txt`, `audit.txt`, `types.diff`, `database.types.local.ts`).
Everything below was measured, not inferred, unless marked in the final section.

---

## Findings

### OPS-01 — The coverage "ratchet" has been failing by ~10 points on every metric, and nothing runs it
- **Severity:** High
- **Type:** debt
- **Status vs plan:** KNOWN-but-worse (plan §8: "coverage thresholds are enforced by nothing")
- **Evidence:** `npm run test:coverage` (all three suites, 80 files, 1239 tests, exit code 1, 1m55s) — `$S\ops\coverage.log:1381-1384`:
  `lines 64.72% (threshold 74)`, `functions 59.13% (69)`, `statements 62.91% (72)`, `branches 56.39% (67)`.
  `vitest.config.coverage.ts:57-62` says "A ratchet, not an aspiration … Never lower them". Thresholds were last measured at Sprint 5 (72.72/67.69/69.67/74.92); Sprints 6–9 added ~2,800 lines of meetings, guardian, admin-transfer and reset-password UI with near-zero unit coverage (see Appendix A). Neither `ci.yml`, `deploy.yml`, nor `npm run gate` runs `test:coverage`; `.husky/pre-commit` runs only `vitest related`.
- **Repro / how observed:** `npm run test:coverage` with the local stack up. Exit 1.
- **Impact:** Kevin / the sprint agents. The plan's stated guardrail is red and has been for at least three sprints; any agent that believes the "ratchet" claim is working from a false premise. Also README says the thresholds exist "(not yet run by CI)" — true, but it reads as if they would pass.
- **Fix direction:** Either (a) add one `npm run test:coverage` step to `ci.yml`'s `schema` job (the stack is already up there) and **re-measure the thresholds honestly** at 62/56/59/64 with the Sprint-5 numbers recorded as the target, or (b) delete the thresholds and the "ratchet" comment. Do not leave a number that is neither enforced nor true. Separately, the 0%-covered user-facing modules in Appendix A are the weakest spots for Sprint-10 tests.
- **Effort:** S (wiring) / M (recovering the ~10 points)

### OPS-02 — Seven unit tests assert nothing, and ~25 more put their assertions behind an `if`
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** KNOWN class (failure-modes §2 "no assertion behind an `if`"), NEW instances
- **Evidence:** AST-free scan of every `it(`/`test(` body in `src/**/*.test.ts*` (948 parsed) for any `expect`/`toThrow`/`rejects`/helper-assert: 7 tests have none —
  `src/components/__tests__/SprintPlanning.test.tsx` ('opens task form when clicking add', 'opens task details when clicking a task', 'displays assignee information', 'can switch to archived view' — e.g. lines 259-273: `const archiveButton = screen.queryByText(/archive/i); if (archiveButton) { fireEvent.click(archiveButton); }`),
  `src/components/__tests__/ScoutingReports.test.tsx` ('opens form when clicking add button', 'calls deleteScoutingReport when deleting'),
  `src/components/__tests__/PreMatchChecklist.test.tsx:103-115` ('calls addChecklistItem when adding new item' — `if (addButton) { fireEvent.click(addButton) … }`).
  Plus 25 `if (<element>) {` guards across those three files and `MatchPlanner.test.tsx` (lines 122-252: `if (redBtn) fireEvent.click(redBtn)` etc.) — these tests pass whether or not the button exists. (The four `season-lifecycle.db.test.ts` hits are false positives: they assert via a `denied()` helper.)
- **Repro / how observed:** the scan script is reproducible from the report; or delete the "Add" button from `SprintPlanning.tsx` and watch 'opens task form when clicking add' stay green.
- **Impact:** These are the four oldest feature screens (board, scouting, checklist, planner) — the ones a team actually uses at a competition — and their component suites are the weakest truth in the repo. The unit count ("670 passed") overstates by at least 7.
- **Fix direction:** Delete or rewrite the seven; convert each `if (x) { … }` to `expect(x).toBeInTheDocument()` followed by the action. Add a `harness-invariants` ratchet: count of `it(`/`test(` bodies with no assertion = 0 (the scan is ~15 lines of Node and fits the existing file's style).
- **Effort:** S

### OPS-03 — Every deploy carries the same build id (`0.1.0`), so a feedback email identifies no build
- **Severity:** Medium
- **Type:** bug
- **Status vs plan:** NEW
- **Evidence:** `src/lib/feedback.ts:17-18`: `const VERSION = '0.1.0'; const BUILD_ID = \`${VERSION}${import.meta.env.PROD ? '' : '-dev'}\``. `package.json` has been `0.1.0` since 2026-01-02 (`git log -S`). 18 production deploys in the last 60 workflow runs, all labelled `0.1.0`. The file's own comment says the id exists "so a report is attached to a version rather than to 'last Tuesday'" — it is attached to nothing. There is also no version string anywhere else in the client (no `__BUILD_SHA__`, no `define` in `vite.config.ts`).
- **Repro / how observed:** open the sidebar feedback link on production; subject is `FalconForge beta feedback (0.1.0)`.
- **Impact:** Kevin, on the first "it's broken" email. Combined with OPS-05 it means a beta report carries: the user's prose, and nothing else.
- **Fix direction:** `define: { __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA?.slice(0,7) ?? 'local') }` in `vite.config.ts`, read it in `feedback.ts` and in `error-reporting.ts`'s structured line; have `check-production.mjs` assert the served `index.html` (or a `/version.txt` emitted by the build) matches `GITHUB_SHA`, which also closes the "is the live bundle the commit I merged" question the progress log keeps answering by hand.
- **Effort:** S

### OPS-04 — No schema/bundle handshake; a mismatched deploy dead-letters writes after ~9 minutes with a misleading reason
- **Severity:** High
- **Type:** scale-blocker
- **Status vs plan:** KNOWN ordering rule (`deploy.yml` header, `docs/beta-ops.md` "Deploys"); the **client-side behaviour** under a mismatch is NEW
- **Evidence:** `src/lib/sync-failure-classification.ts:141` — `if (code !== '42501') return RETRYABLE;`. A bundle ahead of the schema (PostgREST `PGRST204` unknown column) or behind it (`23502` new NOT NULL column) is therefore retried `MAX_SYNC_RETRIES` times with backoff and parked in the dead-letter store (`sync.ts:428-438`); `SyncStatusIndicator.tsx:144` offers an all-or-nothing "Retry them" that will fail identically. No client code reads a schema version, a migration marker, or the build id (grep `schema_version|SCHEMA_VERSION|schemaVersion|__BUILD` → only `feedback.ts`). The only mitigation is procedural: "apply the migration by hand first, then merge" (`deploy.yml:21-28`). Rollback is also procedural: `gh-pages` is `force_orphan: true` (single commit), `deploy.yml` has no ref input, and no migration has a down script, so a bad deploy is reverted by a new commit to `main` (≈2.2 min Deploy + 0.5 min Pages, measured) and a bad migration by hand from a dump.
- **Repro / how observed:** code reading; the Sprint 4 incident in the progress log is the historical repro.
- **Impact:** Every beta team, the day a migration is merged out of order or a user keeps a PWA open across a deploy (`registerType: 'prompt'` means a stale tab can run the OLD bundle against the NEW schema for as long as the user ignores the prompt). An offline coach whose queued writes then dead-letter sees "could not sync" with no actionable reason.
- **Fix direction:** (1) Add a `schema_version` row (or reuse `supabase_migrations.schema_migrations` via a tiny `SECURITY DEFINER` function returning the max version) and compile the expected version into the bundle; on pull, if server > client, show the existing `AppUpdatePrompt` as "update required"; if client > server, hold the queue (don't drain) with a banner — the queue already knows how to wait. (2) Classify `PGRST204`/`42703`/`23502` as "version mismatch — update the app or wait" rather than retrying into dead-letter. (3) Add a `workflow_dispatch` input `ref` to `deploy.yml` so rollback is a click, not a revert commit.
- **Effort:** M

### OPS-05 — A beta "it's broken" report reaches Kevin with no telemetry of any kind
- **Severity:** High
- **Type:** unfinished
- **Status vs plan:** KNOWN (beta-ops "Error review": "client errors are visible in a coach's console and nowhere else"; plan H1 Sentry deferred)
- **Evidence:** `src/lib/error-reporting.ts` writes one `console.error` line; nothing is sent anywhere. Supabase free tier log retention is **1 day** (pricing page, "Platform Security" table) so the weekly log skim in `docs/beta-ops.md` "Error review" can only ever see the last 24 hours — a Saturday-competition failure reported Monday has no server-side trace. No uptime monitor, no status page, no alerting on the Deploy workflow (GitHub emails the committer on failure by default, nothing else). Feedback is a `mailto:` with a constant subject (OPS-03); `support@` is forwarded by a single Edge Function (`supabase/functions/forward-support-email`) whose secrets/deploy are manual and whose health is not checked by `check-production.mjs`.
- **Repro / how observed:** read `docs/beta-ops.md` §"Error review", `error-reporting.ts`, `check-production.mjs`.
- **Impact:** What Kevin can actually see when a coach emails: the email text, and — if he asks for it — a console screenshot containing route + message + stack for the *last* error only. He cannot see: which build, which team, whether the device was offline, the dead-letter contents, or any Supabase log older than a day. For 3–5 teams this is survivable; for "many teams" it is the single biggest scale gap.
- **Fix direction:** Cheapest honest step, no new backend: the feedback `mailto:` body should auto-include build id, route, `navigator.onLine`, team id, pending-queue and dead-letter counts (all available client-side; none is PII beyond what the email already carries). Next: a `client_errors` table with INSERT-only RLS for **authenticated** users, rate-limited by a trigger — the beta-ops objection ("anyone may INSERT") applies to anon, not to signed-in members. Third: a free UptimeRobot/BetterStack HTTPS check on `falcon-forge.com` and on `${SUPABASE_URL}/auth/v1/settings` (both are GETs `check-production.mjs` already makes) — this also defeats the 7-day pause (OPS-09). Sentry free tier (5k events/mo) remains the right eventual answer; `vite.config.ts` already documents the `sourcemap: 'hidden'` + upload plan.
- **Effort:** S (mailto body + uptime check) / M (table)

### OPS-06 — Resend's 100/day ceiling: ~4 teams can onboard per day, and the failure is a raw GoTrue error string
- **Severity:** High
- **Type:** scale-blocker
- **Status vs plan:** KNOWN (beta-ops: "The ceiling that now binds is Resend's … Nothing warns")
- **Evidence:** Resend Free = 100 emails/day, 3,000/month (pricing page, fetched today). Supabase hourly limit raised to 100/h (beta-ops). Emails per account on day 1: 1 signup confirmation (`auth.tsx:472`, confirmations ON in production) + password resets (`auth.tsx:547`) — invites are codes/links, not email, so a 20-member team costs **20 confirmations + ~2–4 resets ≈ 23 emails**; guardians add 1 per guardian. Ceiling: **4 teams of 20 per calendar day (UTC), 3 if resets are heavier**; month ceiling ≈ 130 teams. When Resend refuses, GoTrue's `signUp` returns an error whose `message` is passed straight to the UI (`Login.tsx:64,89`): the user sees "Error sending confirmation email" (Resend cap) or "email rate limit exceeded" (Supabase cap) with no retry guidance, and Kevin has no signal at all — Resend's dashboard is the only place the bounce is visible.
- **Repro / how observed:** arithmetic from the fetched limits and the code paths above; not reproduced against Resend.
- **Impact:** The first multi-team onboarding evening (kickoff, early Sept) — exactly when several coaches will do it on the same night.
- **Fix direction:** Before kickoff: Resend Pro ($20/mo, 50k) is the cheapest fix and removes the ceiling entirely; or stagger onboarding by day. In code: map the two error strings in `Login.tsx` to a plain message ("We could not send your confirmation right now — try again in an hour, or ask your coach to contact support"); have `check-production.mjs` (or the uptime check in OPS-05) not depend on email. Document the 100/day number in `beta-ops.md` as a per-day *team* count, not an email count.
- **Effort:** S

### OPS-07 — GitHub Pages' terms exclude "commercial SaaS offerings"; the site hosts one
- **Severity:** Medium
- **Type:** scale-blocker
- **Status vs plan:** NEW (the Cloudflare plan lists headers/previews/private-repo as reasons; not this)
- **Evidence:** docs.github.com "GitHub Pages limits" (fetched today): Pages "is not intended for … commercial SaaS offerings" and should not "handle sensitive data like passwords". The product is per-user-per-team SaaS with Stripe planned (CLAUDE.md), and the login form posts passwords from a Pages-served page. Also: soft 100 GB/month bandwidth — at 5.1 MB precache per cold install (OPS-08) that is ~20,000 installs/month, not a real constraint; no response headers (already in the Cloudflare plan).
- **Repro / how observed:** documentation read.
- **Impact:** Policy risk rather than technical — GitHub rarely enforces, but the day Stripe goes live the hosting is against the ToS of the host. It is a stronger trigger for the Cloudflare move than any listed in `docs/cloudflare-migration-plan.md` §1.
- **Fix direction:** Add "first paid licence" as a hard trigger in the Cloudflare plan §1 alongside the existing headers/previews rationale; otherwise the plan's phasing (DNS first, hosting second, headers report-only first) is sound and its verification table passes the "what would make this fail" test. One gap in it: Phase 2 step 4's Realtime/CSP check has no automated form — extend `check-production.mjs` to open a websocket to `wss://…/realtime/v1` once headers are enforced.
- **Effort:** S (doc) — the move itself is the plan's "two sessions"

### OPS-08 — Precache is 5.13 MiB, 3.2 MB of which is one 1024×1024 PNG four times; manifest double-lists three assets
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** KNOWN (plan §8: "precache is 60% one image, copied four times")
- **Evidence (re-measured today):** `dist/` = 45 files, 5.2 MB; `logo.png`, `falcon_logo.png`, `icon-192.png`, `icon-512.png` all md5 `f74e417a…`, 802,825 B, 1024×1024; `hero_bg.png` 595 KB (640×640, used once on Landing); `DecodeField.png` 227 KB. JS+CSS+fonts total ≈ 1.26 MB. **New:** `dist/sw.js` precache manifest lists `DecodeField.png`, `icon-192.png`, `icon-512.png` **twice each** (once from `globPatterns`, once from `includeAssets`, `vite.config.ts:29,77`) — 45 entries for 42 unique URLs; Workbox dedupes at install so it is harmless, but it means the "45 entries" in the Gate log is not the file count. `icon-192.png` is declared `192x192` and is 1024px.
- **Repro / how observed:** `md5sum dist/*.png`; `grep -o 'url:"[^"]*"' dist/sw.js | sort | uniq -c`.
- **Impact:** Every cold install at a venue downloads 5.1 MB where 1.9 MB would do; on a 2 Mbps gym connection that is ~20 s vs ~8 s before the app is offline-capable.
- **Fix direction:** As the plan says — real image work: one 512 icon, one 192 icon, a ≤100 KB logo, WebP hero; delete `logo.png` (unreferenced in `src/`). Drop the three duplicates from `includeAssets` (the glob already covers them). Add a `harness-invariants` check that no two files in `public/` share an md5.
- **Effort:** S

### OPS-09 — Free-tier Supabase pauses after 7 idle days; nothing keeps it awake off-season or proves it is awake
- **Severity:** Medium
- **Type:** scale-blocker
- **Status vs plan:** NEW
- **Evidence:** Supabase pricing (fetched): "Free projects are paused after 1 week of inactivity"; Free has **no backups**, 500 MB DB, 5 GB egress, 50k MAU, 2 active projects. The only scheduled traffic is `check-production.mjs` on deploy (not on a timer). Backups: `backups/` holds three dumps, the newest 2026-08-17, all on one Windows laptop, taken by hand (`docs/beta-ops.md` says "weekly during the season" — there is no cron, no reminder, no off-machine copy).
- **Repro / how observed:** `ls backups/`; `gh run list` shows no scheduled workflow; `ci.yml`/`deploy.yml` have no `schedule:` trigger.
- **Impact:** Off-season (Apr–Aug) a paused project makes the first kickoff login fail with an opaque error until Kevin restores it from the dashboard. A laptop loss loses every backup.
- **Fix direction:** A `schedule:` job in a new `ops.yml` (weekly): `curl ${SUPABASE_URL}/auth/v1/settings` (keeps it active and doubles as uptime), `supabase db dump --linked` with `SUPABASE_ACCESS_TOKEN`/`DB_PASSWORD` secrets, uploaded as a **private** encrypted artifact (or to a private repo / S3) with 90-day retention. Record in `beta-ops.md` that Pro ($25/mo) removes the pause and adds 7-day PITR — the trigger should be "first real team data", not "first paying customer".
- **Effort:** S

### OPS-10 — `deploy.yml` re-implements the Gate and omits ESLint; pre-commit typechecks nothing
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** KNOWN-partly (plan §8 "Nothing typechecks at commit time"); the deploy/Gate drift is NEW and is the exact class `harness-invariants.test.ts:171-186` exists to prevent
- **Evidence:** `deploy.yml:62-63` runs `npx tsc --noEmit` (not `npm run lint`), so a commit that fails ESLint can deploy (`ci.yml` would be red in parallel, but Deploy does not wait for CI — both trigger on the same push; measured: CI 3.6 min, Deploy 2.5 min, so the bundle is live a minute before CI finishes). `deploy.yml` also skips the db/RLS job and the smoke pack entirely. `.husky/pre-commit` = `npx lint-staged` = `vitest related --run`.
- **Repro / how observed:** read the two workflows; `gh run list` timestamps.
- **Impact:** Kevin; a lint-failing or RLS-failing merge to `main` is live before CI says so.
- **Fix direction:** Make `deploy.yml` call `npm run gate` (one definition) and gate on CI with `workflow_run: [CI]` + `conclusion == success`, or fold deploy into `ci.yml` as a final job `needs: [verify, schema, smoke]` on `main` only. Extend the `keeps the Gate as one script` invariant to assert `deploy.yml` contains `npm run gate`.
- **Effort:** S

### OPS-11 — README makes six claims that are false today
- **Severity:** Medium
- **Type:** debt
- **Status vs plan:** KNOWN class (plan §8 "README is stale"), these instances NEW since the Sprint-7 rewrite
- **Evidence:**
  1. "Running in Demo Mode … no account required, works completely offline" — false: with no env the app renders "Supabase Not Configured" (`Login.tsx:173-180`); `Login.test.tsx` asserts that state.
  2. "Backend (optional)" / "Enable Google OAuth / Microsoft OAuth" — no UI calls `signInWithGoogle`/`signInWithMicrosoft` (only defined in `auth.tsx:501-530`, dead code).
  3. "Node.js v18 or higher" — vitest 4, jsdom 27 and `@vitejs/plugin-react` 5 require `^20.19 || ^22.12 || >=24`; CI uses 20, Kevin's machine 24.12. No `engines`, no `.nvmrc`.
  4. "`supabase link … && supabase db push`" — `docs/beta-ops.md` and the progress log both record that `db push` cannot apply this migration history.
  5. "exactly one arbitrary value left in `src/`" vs CLAUDE.md/`harness-invariants` ratchet at 2 (measured 2).
  6. "six flows … seven specs" — there are 5 spec files / 21 tests; `e2e/` tree says "seven specs".
  Also: `tsconfig.json` `include` lists `components` and `services` directories that do not exist; `LICENSE` file missing while README says MIT (for a SaaS, probably not intended); `.env.example` advertises `VITE_STRIPE_PUBLISHABLE_KEY`, unused.
- **Repro / how observed:** grep/ls as listed.
- **Impact:** A fresh-clone agent or contributor follows the README and hits a wall on items 1, 3 and 4 in the first ten minutes.
- **Fix direction:** Rewrite Quick Start around the real path: Node ≥20.19 (`engines` + `.nvmrc`), Docker, `npm run db:start`, create `.env.development.local` pointing at the local stack (this file is mentioned nowhere in README's setup), `npm run seed:review`, `npm run dev`. Delete Demo Mode and OAuth sections or the dead OAuth code. Decide the licence.
- **Effort:** S

### OPS-12 — Dependencies: 19 audit findings (2 critical, 8 high), all but 2 dev-only; three majors behind on core libs
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** KNOWN (Tailwind v4 deferred post-beta, plan §8); the rest NEW
- **Evidence:** `npm audit`: 19 (1 low, 8 moderate, 8 high, 2 critical). `--omit=dev`: **2** — `ws` 8.18.3 high (via `@supabase/realtime-js`, fixed in supabase-js ≥2.112) and `@remix-run/router` open-redirect moderate (react-router 6.30.3 → 6.30.6 fixes). Critical ones are `vitest` 4.0.x UI-server file read (dev only; `vitest --ui` is a script here) and `serialize-javascript` via `workbox-build` (build-time only). Full table in Appendix B. `@supabase/supabase-js` is 2.89 vs 2.112 (23 minors behind, includes the `ws` fix). React 18 / Vite 5 / Tailwind 3 / Dexie 3 / Zustand 4 are each one major behind; none is EOL, but Vite 5 and vite-plugin-pwa 0.17 are two majors behind and the PWA plugin is the riskiest to leave (Workbox 7.1 pinned underneath).
- **Repro / how observed:** `$S\ops\audit.txt`, `$S\ops\outdated.txt`.
- **Impact:** The two production ones are real but low-exposure (Realtime websocket DoS; a `//`-prefixed redirect — the app's `returnTo` logic should be checked against it).
- **Fix direction:** `npm update @supabase/supabase-js react-router-dom vitest @vitest/coverage-v8` (all within semver), re-run Gate + smoke. Schedule Vite 6/7 + vite-plugin-pwa 1.x together post-beta; Dexie 4 is a separate migration (IndexedDB schema unaffected, API mostly compatible). Add a monthly `npm audit --omit=dev` step to the ops workflow (OPS-09).
- **Effort:** S (patch-level) / M (Vite+PWA)

### OPS-13 — e2e pack has no coverage of the board, planner, password reset, guardian, licence-lapse, admin transfer, operator or update-prompt flows, and no mobile viewport
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW as an inventory
- **Evidence:** 21 tests in 5 specs: registration (5), invite/join (2), offline→sync (2), meetings/check-in/layout (9), team-lifecycle (3: scouting, checklist, new season). Only one `setViewportSize` in the pack and it is 1280×800 (`meetings.spec.ts:275`); `playwright.config.ts` has a single `Desktop Chrome` project. Unit coverage of the same unvisited screens is ≤31% (Appendix A).
- **Repro / how observed:** `grep -n "^\s*test(" e2e/*.spec.ts`.
- **Impact:** The sprint board (the daily-use screen), the match planner (d3 drag, SVG), and the password reset (dead in production until Sprint 9) have no browser-level check; "375px as every role" in CLAUDE.md is done by hand only.
- **Fix direction:** Add a `mobile` project (`devices['iPhone 13']`) to `playwright.config.ts` and run the existing layout tests under both; add one spec each for board CRUD + drag, planner draw/save/reload, reset-password round trip via Mailpit (helpers already exist in `registration.spec.ts`), and a licence-lapse read-only check using `seed:review`'s `lapsed@` account. Keep workers at 4/2 (env-divergences §9).
- **Effort:** M

### OPS-14 — `docs/beta-ops.md` runbooks: 3 of 6 requested scenarios are missing
- **Severity:** Medium
- **Type:** unfinished
- **Status vs plan:** NEW
- **Evidence:** Present and good: backups (one-liner + restore caveats), transactional email (complete, verified), support inbox forwarding, erasure (measured SQL), deploy ordering. Absent: **migration failure** (no "what if step 3 fails half-way" — no down scripts, no "restore from the dump you just took" walk-through, no note that `supabase migration repair` may be needed to resync `schema_migrations`); **stuck dead-letters** (user-side "Retry them" is documented in code only; nothing tells Kevin how to read a coach's dead-letter store or that the data lives in the coach's IndexedDB and nowhere else); **member deletion** is covered only as "the app never deletes a member" + the erasure SQL; **licence disputes / renewals** (no runbook for "extend a gift grant", "seat count dispute", "team says they are read-only" — the SQL for `grant_team_license` is in `v2-schema.md`, not here); **team admin leaving** is one sentence ("transfer in the operator console FIRST") with no steps. No status/uptime section at all.
- **Repro / how observed:** grep of `docs/beta-ops.md` for `stranded|dead-letter|licen|rollback|pause`.
- **Impact:** Kevin, during the first incident of each kind; each runbook that exists was written "so none of it has to be invented during an incident" — these three will be.
- **Fix direction:** Add five short sections: migration-failure rollback (dump → `psql -f` → `supabase migration repair --status reverted <version>` → re-insert operator row), dead-letter triage (ask coach for the SyncStatus screenshot; the payloads are only on their device; how to hand-apply one), licence operations (the three SQL/RPC calls with the operator console screens), admin-left (operator console steps + the erasure interaction), and "the project is paused / the site is down" (what to check in which order: Pages → Supabase status → auth settings URL).
- **Effort:** S

### OPS-15 — Fresh-clone / second-machine setup is undocumented and fragile in three specific ways
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** NEW
- **Evidence:** (1) `.env.development.local` (gitignored) is required for `npm run dev` to hit the local stack; absent it, `.env.local` (production keys, also gitignored, **not** in the clone) or nothing is used — README never mentions the file; only `playwright.config.ts`, `capture-screens.mjs` and `e2e/helpers.ts` pin local credentials explicitly. (2) Supabase CLI: devDependency `^2.114.0` (installed 2.114.0; 2.115 available, and `^` will float on a fresh `npm install` without a lockfile pin — `package-lock.json` pins it, so `npm ci` is safe, `npm install` is not) while CI pins `2.114.0` literally; `globalSetup.ts` prefers a PATH `supabase` over `npx`, so a second machine with a globally installed different CLI reads stack status with a different binary than created it (env-divergences §6 describes this exact defect). (3) No Node version pin (OPS-11). Docker Desktop is required for `test:db`, `test:coverage`, `db:verify`, the e2e pack and CI parity, and is stated only in `vitest.config.db.ts` comments and one README line.
- **Repro / how observed:** file reads; `npm ls supabase`.
- **Impact:** The "one Opus agent per sprint" model on a second machine or a cloud runner: first hour lost to environment.
- **Fix direction:** A `docs/setup.md` (or README Quick Start) with the real list; `engines` + `.nvmrc`; pin `supabase` exactly (`2.114.0`, no caret) and add a `harness-invariants` check that `ci.yml`'s two `version:` lines equal the devDependency; ship `.env.development.local.example` with the CLI demo anon key (it is public and identical on every local stack).
- **Effort:** S

### OPS-16 — Gate and CI timing, and the two CI failures in 60 runs — both in the smoke job
- **Severity:** Low
- **Type:** debt
- **Status vs plan:** KNOWN (env-divergences §9 worker cap; `ci.yml` comment on `setup-cli` rate limiting)
- **Evidence:** Local Gate ≈ 60 s (lint 16.3 s measured, unit 19.1 s, integration 5.4 s, tsc+build ≈ 15 s from `gate.log`). CI: 24 runs avg 4.2 min, max 13.9 min; Deploy avg 2.2 min. Failures: 2/24 CI, both the smoke job — run 31981020897 failed at `supabase/setup-cli@v1` (the GitHub-API rate-limit path the comment describes, pre-pin), run 31979126671 at "Smoke pack" (the 8-worker flake, pre-cap). Zero failures since both fixes (2026-08-17). Unit suite emits ~40 React Router future-flag warnings and 9 `act(...)` warnings per run (`gate.log:17-42, 229-372, 771-819`) — noise that will hide a real warning.
- **Repro / how observed:** `gh run list/view`; `$S\gate.log`.
- **Impact:** Acceptable for a solo maintainer; the warning noise is the only thing worth acting on.
- **Fix direction:** Set `future: { v7_startTransition: true, v7_relativeSplatPath: true }` on the router (one line, also de-risks the v7 upgrade); wrap the three `Onboarding`/`AppUpdatePrompt` state updates in `act`/`waitFor`.
- **Effort:** S

### OPS-17 — Generated DB types are fresh (no drift) — confirmed, not a finding
- **Severity:** Low — recorded so a later agent does not re-check
- **Evidence:** `npx supabase gen types typescript --local` → `$S\ops\database.types.local.ts`; `diff` against `src/lib/database.types.ts` after CRLF normalisation = **0 lines**. Local stack has all 17 migrations applied (`supabase_migrations.schema_migrations` count 17 = files on disk excluding `_archive`); newest `20260823000000_operator_console.sql` (dated tomorrow — harmless, but the timestamp is ahead of the clock).

---

## Appendix A — Coverage by area (all three suites, today)

| Area | Stmts | Branch | Funcs | Lines | Weakest user-facing files (lines %) |
|---|---|---|---|---|---|
| **All** | 62.91 | 56.39 | 59.13 | 64.72 | thresholds 72/67/69/74 — **all four red** |
| src/lib (sync engine etc.) | 87.59 | 85.10 | 89.83 | 90.71 | `store.ts` 56, `attestations.ts` 73, `supabase.ts` 79 |
| src/lib/slices | 89.03 | 78.22 | 93.10 | 91.06 | `guardianSlice` 54 |
| src/pages | 74.74 | 69.70 | 68.18 | 75.20 | `ResetPassword.tsx` **0**, `GettingStarted.tsx` **0** |
| src/components | 59.86 | 55.48 | 55.84 | 62.59 | `MemberManager` 26, `InviteManager` 32, `TaskDetail` 37, `SubTeamManager` 43, `SprintPlanning` 49, `SprintCalendar`/`SprintList` 14, `MatchPlanner` 59 |
| components/admin | 48.37 | 51.85 | 55.55 | 51.01 | `AdminNomination` 31, `TransferPanel` 41, `OperatorConsole` 60 |
| components/guardian | **7.29** | 2.12 | 1.92 | 8.47 | `GuardianView` **0**, `AddChildDialog` **0** |
| components/meetings | **21.76** | 17.97 | 18.98 | 21.51 | `AttendanceRoster`, `AttendanceSummary`, `CheckIn`, `EventDetail`, `MeetingsPage`, `QrCode`, `ScheduleCalendar`, `EventSchedule`, `CheckInPoster` all **0**; `EventManager` 6 |
| components/ui | 100 | 100 | 100 | 100 | — |

Test counts: unit **670 + 2 skipped** (54 files), integration **91** (9), db **478** (17; plan's last figure 459 db / 319 rls), total **1,239 + 2 skipped**. CLAUDE.md's "592-test suite" is two sprints stale. The 2 skips are the pre-rule `describe.skip('Drawing actions')` in `MatchPlanner.test.tsx:140`, ratcheted at 1 suite.

## Appendix B — Dependencies

| Package | Installed | Latest | Gap | Note |
|---|---|---|---|---|
| react / react-dom | 18.3.1 | 19.2.8 | 1 major | fine; React 18 still maintained |
| vite | 5.4.21 | 8.2.2 | **3 majors** | esbuild dev-server advisory (moderate, dev only) |
| vite-plugin-pwa | 0.17.5 | 1.3.0 | 2 majors | pulls workbox-build 7.1 → `serialize-javascript` high (build-time) |
| vitest / coverage-v8 | 4.0.17 | 4.1.11 | minor | **critical** advisory on 4.0.x UI server — dev only; `npm update` fixes |
| @supabase/supabase-js | 2.89.0 | 2.112.3 | 23 minors | carries `ws` **high** (prod) — update fixes |
| react-router-dom | 6.30.3 | 7.18.2 | 1 major | `@remix-run/router` open-redirect moderate (prod) — 6.30.6 fixes |
| tailwindcss | 3.4.19 | 4.3.3 | 1 major | deferred post-beta by decision |
| dexie / dexie-react-hooks | 3.2.7 / 1.1.7 | 4.4.5 / 4.4.0 | 1 major | no advisory; Dexie 3 unmaintained since 2024 |
| zustand | 4.5.7 | 5.0.15 | 1 major | — |
| d3 | 7.9.0 | 7.9.0 | current | only `select`/`drag` used in `MatchPlanner.tsx:100-113`; tree-shaken to the 41 kB `charts` chunk (14 kB gz), lazy-loaded but precached |
| lucide-react | 0.562 | 1.33 | 1 major | 59 files import it; icons are per-file chunks already |
| typescript | 5.8.3 | 7.0.2 | 2 majors | — |
| eslint | 9.39.5 | 10.9.0 | 1 major | — |
| supabase (CLI) | 2.114.0 | 2.115.0 | patch | must stay equal to `ci.yml` pins |

`npm audit`: 19 total (2 critical, 8 high, 8 moderate, 1 low); `--omit=dev`: **2** (ws high, @remix-run/router moderate). No installs were run.

## Appendix C — Hosting/limits (verified online today)

| Service | Limit | Relevance |
|---|---|---|
| GitHub Pages | 1 GB site, **100 GB/mo soft**, 10 builds/h (n/a with Actions); **not for commercial SaaS / passwords** | OPS-07; bandwidth ≈ 20k cold installs/mo at 5.1 MB |
| Supabase Free | 500 MB DB, 5 GB egress (+5 GB cached), 50k MAU, 1 GB storage, 500k edge invocations, **pause after 7 idle days**, **logs 1 day**, **no backups**, 2 projects | OPS-05, OPS-09; Pro $25/mo: no pause, 7-day PITR |
| Resend Free | **100/day**, 3,000/mo, 3 domains, inbound included | OPS-06; Pro $20/mo = 50k/mo |

## Appendix D — Ops gap list (ticket-ready)

1. Wire `test:coverage` into CI `schema` job; reset thresholds to measured 62/56/59/64 (OPS-01).
2. Delete/rewrite 7 assertion-free tests; add "no test without an assertion" ratchet (OPS-02).
3. Inject git SHA as build id; assert it in `check-production.mjs` (OPS-03).
4. Schema-version handshake + classify PGRST204/23502 as "update required"; `workflow_dispatch` ref for rollback (OPS-04).
5. Feedback `mailto:` body with build/route/online/queue counts; free uptime monitor on site + auth endpoint (OPS-05).
6. Resend Pro or staggered onboarding before kickoff; friendly copy for the two email-failure strings (OPS-06).
7. Add "first paid licence" and "GitHub ToS" as Cloudflare-move triggers; automated Realtime-through-CSP check (OPS-07).
8. Image work: one icon set, delete `logo.png`, WebP hero; remove duplicate `includeAssets`; md5-uniqueness invariant (OPS-08).
9. Weekly `ops.yml`: keep-alive GET, `db dump --linked` to private encrypted storage, `npm audit --omit=dev` (OPS-09, OPS-12).
10. `deploy.yml` → `npm run gate` and gate on CI success; invariant test covers it (OPS-10).
11. README truth pass + `engines`/`.nvmrc` + `LICENSE` decision + remove dead OAuth/Stripe env (OPS-11, OPS-15).
12. `npm update` supabase-js, react-router-dom, vitest; plan Vite 6/7 + PWA 1.x post-beta (OPS-12).
13. Mobile Playwright project + specs for board, planner, reset-password, licence-lapse (OPS-13).
14. Five new runbook sections in `beta-ops.md` (OPS-14).
15. Pin `supabase` exactly; invariant that CI pins equal the devDependency; `.env.development.local.example` (OPS-15).
16. Router future flags + `act` fixes to silence ~50 warnings per run (OPS-16).

---

## Summary

- The pipeline itself is healthy: 22/24 CI green, both failures pre-date fixes that addressed them, Gate ≈ 60 s locally / CI ≈ 4 min, generated types have zero drift, migrations on disk = migrations applied.
- The project's loudest guardrail is broken: coverage thresholds fail on all four metrics by ~10 points (64.7% lines vs 74) and nothing runs them. Sprints 6–9 shipped the meetings, guardian and admin UIs at 0–30% unit coverage.
- Seven unit tests assert nothing and ~25 guard their assertions with `if` — in the four oldest competition-day screens.
- Operationally, a beta bug report reaches Kevin as prose plus (maybe) a console screenshot labelled build `0.1.0` forever; Supabase logs last one day; there is no uptime check, no alert, no scheduled backup, and the last dump is five days old on one laptop.
- Scale ceilings for kickoff week: **~4 teams/day** on Resend Free (raw error string on failure), a 7-day pause on Supabase Free off-season, and GitHub Pages' ToS excluding commercial SaaS — the last is a better Cloudflare trigger than any the migration plan lists.
- No schema/bundle handshake: a mismatch retries into dead-letter with a wrong reason; rollback is a revert commit (~3 min) for the bundle and a hand restore for the schema.
- `deploy.yml` skips ESLint, RLS and the smoke pack and goes live a minute before CI finishes.
- README is wrong about demo mode, OAuth, Node version, `db push`, spec count and the arbitrary-value count; fresh-clone setup (`.env.development.local`, Docker, CLI pin, Node ≥20.19) is documented nowhere.
- Dependencies: only 2 production advisories, both fixed by in-range updates; Vite 5 / PWA plugin 0.17 are the ones to schedule.

## Confidence / not checked

- Did **not** touch production or the hosted Supabase project (no GETs to `falcon-forge.com` or the hosted API), so "pause status", actual Resend usage, Supabase auth rate-limit value and the `support@` forwarder's health are taken from the docs, not observed.
- The GoTrue behaviour when Resend rejects (whether the `auth.users` row is rolled back or left unconfirmed) was not reproduced; the user-facing strings are inferred from GoTrue's error messages, not captured.
- Coverage was measured once, with Docker up; numbers may move ±1 point between runs because db fixtures are live.
- The "assertion-free test" scan is a regex over test bodies; I hand-checked all 11 hits and excluded the 4 false positives, but a test asserting via an unusual helper name could have been missed (none found).
- `npm audit` advisory severities are npm's; exploitability in this app was reasoned, not tested.
- Did not run the e2e pack or `gate:db` (brief forbids `db:verify`); e2e inventory is from source.
- Did not verify Supabase Auth's current default per-hour email limit or the MAU definition beyond the pricing page.
