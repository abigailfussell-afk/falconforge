# FalconForge — Production Readiness Plan (GitHub Pages + Supabase Free Tier)

> **Prepared:** 2026-08-14 · **Revised** for the constraint: stay on GitHub Pages, stay on Supabase free tier.
> **Reviewed at commit:** `566bc1d` on `non-split-landing-page`
> **Status:** plan only — no code changed.

---

## Part 0 — Verified baseline

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean |
| `npm run test:run` | ⚠️ 222 passed, **1 failed**, 2 skipped (225 total) |
| Failing test | `src/components/__tests__/Dashboard.test.tsx:95` — `beforeEach` hook timeout at 10s |
| Source | 77 `.ts`/`.tsx`, ~16,530 LOC, 25 test files |
| CI | ❌ none (no `.github/`) |
| Bundle | `index` 878 KB · `supabase` 171 KB · `vendor` 163 KB · `charts` 41 KB |
| Built CSS | **2.6 KB** — proves ~zero Tailwind compiles at build time |
| `dist/` | 11 MB (3.4 MB is one sourcemap) |
| Live headers on falcon-forge.com | **no CSP, no HSTS, no X-Frame-Options**; GH Pages serves `Access-Control-Allow-Origin: *` |
| React Query lazy loading | ✅ already implemented and wired (`useTasksQuery`/`useScoutingQuery`/`useMatchPlansQuery`) |

**Corrected from the first draft:** I sized components by bytes, which Tailwind class strings inflate. Real counts: `Landing.tsx` **812**, `SprintPlanning` **558**, `PortfolioAI` 439, `Onboarding` 436, `MatchPlanner` 422, `ScoutingReports` 382, `Login` 350, `Sidebar` 315. Over your 300-line rule, but a smaller job than I first said.

---

## Part 1 — Findings (unchanged, severity-ranked)

### 🔴 CRITICAL

**C1. Live Supabase DB password in a tracked file on public GitHub.**
`.agent/scaling-next-steps.md:9` → `SUPABASE_DB_PASSWORD="k1uRA5kGvHria47A"`. Confirmed in `HEAD`. The earlier checklist marked this done but only fixed the *other* file. Bypasses every RLS policy. **On the free tier this is worse than it would be on Pro — there is no point-in-time recovery if someone drops your data.**

**C2. Tailwind loads from CDN at runtime.** `index.html:26`. Built CSS is 2.6 KB, so every style comes from `cdn.tailwindcss.com` on load. Offline at a venue = unstyled app, defeating the entire offline-first architecture. Plus ~300 KB blocking render and a third-party script with full DOM access.

**C3. 3.4 MB sourcemaps published.** `sourcemap: true` in `vite.config.ts`. Full readable source on your domain.

**C4. `gemini-proxy` has no authorization, no rate limit, wildcard CORS.** 117 lines, zero caller checks. The anon key gating it ships in your bundle by design. Anyone can burn your Gemini quota from any origin. `list_models` diagnostic is exposed.

### 🟠 HIGH

**H1.** No error boundary (white screen on any render error), no error reporting (zero production visibility).
**H2.** No CI — nothing runs on push or PR.
**H3.** The failing `Dashboard.test.tsx` hook must be fixed, not have its timeout raised, or CI is ignorable from day one.
**H4.** Assets: four **byte-identical 802 KB PNGs** (`falcon_logo`, `icon-192`, `icon-512`, `logo`), `hero_bg.png` 596 KB, `DecodeField.png` 227 KB. On the free tier this is now a **quota** problem, not just a perf one.
**H5.** 878 KB unsplit main chunk, no route-level code splitting.
**H6.** Eight components over the 300-line rule (counts above).
**H7.** The dual-client auth workaround in `supabase.ts` is load-bearing and fragile — it reconstructs the SDK's localStorage key by string-slicing the hostname and hand-decodes the JWT with `atob`. The reasoning is correct and well-documented; the dependency on undocumented SDK internals is not pinned or tested.

### 🟡 MEDIUM

**M1.** No schema-as-code. No `config.toml`, no CLI link, migrations start at `009` (001–008 exist only in the cloud), mixed naming. **You cannot rebuild your database from this repo.**
**M2.** 30 `as any`, clustered on `supabase.rpc()` and `from(tableName)` in `sync.ts` — exactly where schema drift should be caught.
**M3.** 76 `console.*` in production paths.
**M4.** Sync untested under design conditions: reconnect storm, clock skew on the `gte('updated_at', …)` delta boundary. `checklists` is excluded from delta sync (full blob every cycle).
**M5.** Minors' data. Scaffolding exists (`legal/` pages, `attestations.ts` with `coppa_responsibility`/`age_13_plus`, age-classification RPC) — more than most projects have. Needs verification that flows enforce it, plus a working deletion path.
**M6.** Repo root litter: `test-results.json` (305 KB), `test-results.log`, `vitest_output*.txt`, `auth_test_out.txt`, `supabase_schema.txt`, `reorder.cjs`, `updateLanding.{js,cjs}`, four `backup-full-*/` dirs, `coverage/`, `dev-dist/`.
**M7.** `supabase` CLI in `dependencies`; `@google/genai` ships despite AI being flagged off; duplicate `theme-color` meta (`index.html:7` and `:11`).

---

## Part 2 — Working within the constraints

Both constraints are workable. Here's what each actually costs and how to cover it.

### GitHub Pages — what you lose, and the honest mitigation

| Lost | Mitigation | Fully solved? |
|---|---|---|
| CSP response header | `<meta http-equiv="Content-Security-Policy">` | Mostly — see below |
| `X-Frame-Options` / CSP `frame-ancestors` | **Neither works.** JS frame-buster in `index.html` | ⚠️ Partial |
| HSTS | Enable **Settings → Pages → Enforce HTTPS** (verify with `curl -I`) | ⚠️ Verify |
| SPA fallback routing | Keep `HashRouter` | ✅ Accepted |
| Preview deploys per PR | Build artifact in CI + local `npm run preview` | ⚠️ Manual |
| Instant rollback | `gh-pages` branch has history — redeploy a prior commit | ✅ Good enough |

**CSP via meta tag — the gotchas that will bite you.** `frame-ancestors`, `report-uri`, and sandbox directives are *ignored* in meta tags; everything else works. The directive that silently breaks things is `connect-src` — **omit the `wss://` origin and Realtime dies with no visible error**. Your starting point:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: blob:;
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co;
worker-src 'self' blob:;
base-uri 'self';
form-action 'self';
object-src 'none';
```

`style-src 'unsafe-inline'` is unavoidable — React sets inline `style` attributes. `worker-src blob:` is needed for the service worker and `pdfjs-dist`. Note `font-src 'self'` assumes you take the next step:

**Self-host the Google Fonts.** This is a three-for-one win the constraints make especially worthwhile: it removes two external origins from CSP, it fixes the fact that fonts currently fail on a genuine cold offline load (workbox only `CacheFirst`s them *after* a successful online fetch), and it drops two `preconnect` round-trips. Do it in Round 1 alongside Tailwind.

**Clickjacking.** With neither `X-Frame-Options` nor `frame-ancestors` available, a small `if (self !== top) top.location = self.location` guard is the only lever. It's defeatable by a determined attacker but stops the casual case. Document it as an accepted residual risk — this is the one thing GitHub Pages genuinely can't do.

**HashRouter stays.** Checklist item #7 is now formally **won't-do**. GitHub Pages has no SPA fallback, and the `404.html` redirect trick trades one ugliness (a `#`) for a worse one (a real 404 status and a redirect flash). URLs with `#/dashboard` are cosmetic. Write the decision down so it doesn't get re-litigated.

**You still get CI.** This is the important part: GitHub Actions can run the full gauntlet on every PR and deploy to the `gh-pages` branch on merge. Staying on Pages costs you preview URLs and headers — it does **not** cost you CI/CD.

### Supabase free tier — the four things that actually matter

**1. The project pauses after ~7 days of inactivity.** This is the real risk: between competition seasons your app goes *down*, and users hit errors rather than a maintenance page. Mitigation is a weekly GitHub Actions cron issuing one cheap authenticated REST query. During the season, real traffic makes it moot. Verify the current pause window in your dashboard — Supabase changes these.

**2. No PITR and no managed backup retention.** This is the constraint with teeth, and it changes how you must handle migrations. You already have `backup-full.mjs`; it needs to become automatic:

- GitHub Actions cron (daily during season, weekly off-season)
- DB password from an Actions secret — **the rotated one from Round 0**
- **Encrypt the dump before it leaves the runner** (`gpg --symmetric` or `age`)
- Push to a **private** `falconforge-backups` repo. Not Actions artifacts — artifacts on a public repo are publicly downloadable.
- Prune to a sensible window (e.g. 30 dailies + 12 weeklies)

And the rule that makes it real: **a backup you have never restored is not a backup.** Round 2 includes a restore drill into the staging project, and it repeats quarterly.

**3. You get two free projects — so staging is free.** Use the second one. Staging will pause from disuse; unpausing takes about a minute and that's fine. With no PITR on prod, "test the migration on staging first" stops being best practice and becomes the only thing standing between you and an unrecoverable `ALTER TABLE`.

**4. Quotas — database size, egress, and MAU.** Confirm current numbers in your dashboard rather than trusting any figure written here. Two implications:

- **Egress is now a first-class reason to do Round 4.** Every PWA install pulls four 802 KB icons and a 596 KB hero. Fixing that is quota protection, not polish — which is why Round 4 sits before the refactoring rounds.
- Your architecture already helps: delta sync is live, and React Query per-page loading is done. The remaining offender is `fetchTeamData()`'s full pull on team switch, which is a deliberate offline-first choice and should stay.
- Add a monthly quota check to the operating rhythm. Free-tier limits fail *abruptly*.

### Cost

**$0/month.** The trade versus the ~$25 Pro tier is: you own backups, you own uptime-during-idle, and you have no PITR safety net. Rounds 0 and 2 are what make that trade survivable.

**Revisit Pro when** any of these happens: the app carries data a team would be upset to lose (arguably already true), you cross a free-tier quota mid-season, or a paused project causes a real outage. At that point $25/mo buys back PITR and no-pause, and Round 2's backup machinery becomes belt-and-braces rather than the only belt.

---

## Part 3 — The Gauntlet Loop

**Gauntlet** = a fixed battery every change must survive. **Loop** = fan out finders → dedupe → fix → run the gauntlet → *independently verify* → commit → repeat, until two consecutive rounds find nothing new.

### The Gate (after every round)

```
1. npx tsc --noEmit                          → exit 0
2. npm run test:run                          → 225/225, no failures, no new skips
3. npm run test:integration                  → pass
4. npm run build                             → succeed
5. Bundle budget: main ≤ 500 KB, no .map in dist/
6. gitleaks detect (full history)            → zero findings
7. npm run preview → smoke 6 flows:          login · sprint · checklist ·
                                               scouting · match planner ·
                                               offline→online sync
8. Lighthouse on preview: Perf ≥ 80, A11y ≥ 90, PWA passes
9. CSP smoke: zero CSP violations in console across all 6 flows,
   Realtime WebSocket connects            ← new; meta-CSP is all-or-nothing
```

Rounds 0–2 will fail gates 5, 8, and 9 by design. **From Round 3 on, all nine are hard blockers.**

---

### Round 0 — Stop the bleeding · **blocking, do today**
Fixes **C1**

1. Rotate the Supabase DB password. Rotate the Gemini API key.
2. Redact `.agent/scaling-next-steps.md:9`, gitignore it, `git rm --cached`.
3. `gitleaks detect` on the full history — find whatever else is in there.
4. History rewrite is optional. The repo is public and the credential is already exposed; **rotation is the fix**, not `git-filter-repo`.
5. Check the Supabase dashboard for unexpected connections during the exposure window.
6. Store the new password in GitHub Actions secrets now — Round 2 needs it.

**Gate:** old password rejected by Postgres · `gitleaks` clean on full history · app still runs.
**~1–2 hours.**

---

### Round 1 — Build correctly, on Pages
Fixes **C2, C3, M7** · checklist #2, #3, #16, #18 · closes #7 as won't-do

- Tailwind → build-time (`@tailwindcss/vite`); port `slate-750/850/950`; delete the CDN script and inline config.
- **Self-host Inter**; drop the two `preconnect`s and the stylesheet link.
- `sourcemap: 'hidden'` — keep maps for Sentry, stop serving them.
- Add the CSP meta tag (directives in Part 2). Add the frame-buster.
- Enable **Enforce HTTPS**; confirm with `curl -I`.
- `public/robots.txt`. Remove the duplicate `theme-color`. Move `supabase` CLI to devDependencies.
- Write the HashRouter won't-do decision into `.agent/`.

**Gate:** full gauntlet. Plus — **app is fully styled and correctly fonted with the network disabled** (the real test of C2). CSP present in page source, zero violations, Realtime still connects. No `.map` in `dist/`.
**~1–2 days.**

---

### Round 2 — Backend lockdown + free-tier survival kit
Fixes **C4, M1** · adds the backup/uptime machinery the free tier requires

- **`gemini-proxy`:** verify the caller is a real authenticated user *and* a member of the team they claim; scope CORS to `https://falcon-forge.com`; per-user rate limit; delete `list_models`.
- **Schema into git:** `supabase link` → `supabase db pull`. Reconcile missing migrations 001–008. Normalize naming. Verify a clean `supabase db reset` reproduces prod from `supabase/migrations/` alone.
- **Staging project** (free, your 2nd). This is now the *only* pre-flight for migrations, since prod has no PITR.
- **Automated encrypted backups** → private repo, per Part 2. Prune old ones.
- **Restore drill:** restore the newest backup into staging and confirm it's usable. Repeat quarterly.
- **Keep-alive cron:** weekly authenticated query to prevent idle pausing.
- **RLS re-audit** against the tenant-isolation model in `20260317000000_database_security_audit.sql` — especially invites, which has already had one hole (`014_fix_invites_rls.sql`).

**Gate:** full gauntlet. Plus — unauthenticated `curl` to `gemini-proxy` → 401; cross-origin request blocked; a database built only from `supabase/migrations/` matches prod; **a restore into staging succeeded**; an integration test proves a Team A account cannot read Team B rows (write it, don't eyeball it).
**~3–4 days** (up from the Pro-tier estimate — backups and the restore drill are the added work).

---

### Round 3 — Observability + CI/CD
Fixes **H1, H2, H3, M3**

- Error boundary around `<App />` with a real recovery path.
- Sentry free tier + `window.onerror` + `unhandledrejection`; upload hidden sourcemaps at deploy. **Add Sentry's ingest origin to `connect-src`** — easy to forget, and Round 1's CSP will silently swallow every report.
- `src/lib/logger.ts`; replace the 76 `console.*`; route to Sentry in prod, passthrough in dev.
- **Fix** the `Dashboard.test.tsx` hook timeout — find the slow async setup; don't raise the limit.
- **GitHub Actions:** on PR → gates 1–6 + upload the build artifact. On merge to `main` → build and deploy to `gh-pages`. This replaces the manual `npm run deploy`.

**Gate:** full gauntlet, now enforced by CI on a real PR. A deliberate error reaches Sentry with correct source lines. 225/225 green **three runs in a row**. A merge to main deploys automatically.
**~2–3 days.**

---

### Round 4 — Assets & bundle · *promoted: this is quota protection now*
Fixes **H4, H5** · checklist #6

- Real icons: 192×192 (~10 KB), 512×512 (~40 KB), 180×180 apple-touch. Compress `hero_bg.png` (596 KB → <100 KB, WebP with PNG fallback) and `DecodeField.png`.
- Route-level `React.lazy`: `Landing`, `PortfolioAI`, `MatchPlanner`, plus `pdfjs-dist` and `d3` on demand.
- Re-tune `manualChunks`. Record before/after with `npx vite-bundle-visualizer`.

**Gate:** full gauntlet with the bundle budget enforced. Lighthouse Perf ≥ 80 on throttled mobile. PWA installs and runs **fully offline, styled, correct icons**. `public/` under ~500 KB total.
**~1–2 days.**

---

### Round 5 — Decompose the monoliths
Fixes **H6** · checklist #8, #9, #10

**One component per iteration, full gauntlet between each. Do not batch.**

Order: `Landing.tsx` (812, lowest risk — mostly static) → `SprintPlanning.tsx` (558) → `PortfolioAI.tsx` (439) → `Onboarding.tsx` (436) → `MatchPlanner.tsx` (422) → `ScoutingReports.tsx` (382) → `Login.tsx` (350) → `Sidebar.tsx` (315).

Follow `.agent/skills/component-decomposition/SKILL.md`. **Add characterization tests before each split** so the tests prove behavior is unchanged.

**Gate:** full gauntlet per component. Nothing over ~300 lines. Test count goes **up**, never down.
**~3–4 days.**

---

### Round 6 — Types, sync correctness, the auth workaround
Fixes **H7, M2, M4** · checklist #11, #12

- `supabase gen types typescript` → replaces hand-maintained `database.types.ts`; add RPC signatures; eliminate all 30 `as any` (the `from(tableName)` cast wants a typed table map or discriminated union).
- **Pin `@supabase/supabase-js` to an exact version.** Add a test asserting the localStorage key `supabaseSync` computes matches what the SDK actually writes — so an SDK bump fails CI instead of failing users. Link the upstream issue in the comment.
- Debounce checklist sync (300–500 ms).
- Write the missing sync tests: reconnect storm (N clients flushing at once), clock skew across the `gte('updated_at', …)` boundary, offline edit vs. conflicting remote edit, and the `checklists` full-blob path.

**Gate:** full gauntlet. Zero `as any` outside `__tests__`. New sync tests pass. Two real browsers, one offline 5 minutes with edits, reconcile correctly on reconnect.
**~3–4 days.**

---

### Round 7 — Accessibility, compliance, cleanup
Fixes **M5, M6** · checklist #15, #17

- `aria-label` on every icon-only button; skip-nav link; labels on all inputs; keyboard-navigate every flow.
- Verify age-classification and attestation flows actually gate what they claim. Confirm an end-to-end account-and-data deletion path. Get a COPPA read from someone qualified — this is an FTC app, so most users are minors and some are under 13.
- Purge the repo root (M6); update `.gitignore`.

**Gate:** full gauntlet. Lighthouse A11y ≥ 90. Every main flow completable by keyboard alone. `git status` clean.
**~2–3 days.**

---

### Round 8+ — Loop until dry

Re-run the finder fan-out across every dimension (security, correctness, perf, a11y, types, sync, dependency CVEs). Anything new becomes Round N+1. **Stop after two consecutive rounds that surface nothing new.**

Two rules, the first because the last pass violated it:

- **A finding is not closed until an independent check confirms it.** Item #1 was marked ✅ while a live password sat in a tracked file.
- **Log what you deliberately skip.** A silently dropped item reads as "covered" six weeks later.

---

## Timeline

| Phase | Rounds | Effort |
|---|---|---|
| Emergency | 0 | 1–2 hours |
| Ship-blocking | 1–3 | ~1 week |
| Quota + hardening | 4–6 | ~1.5 weeks |
| Polish | 7–8 | ~1 week |
| **Total** | | **~3.5–4 weeks focused** |

Slightly longer than the Pro-tier version — Round 2 absorbs the backup automation and restore drill you'd otherwise buy.

**If you only do three:** Round 0 (rotate), Round 1 (Tailwind + CSP + sourcemaps), Round 2 (lock down the function, get backups running). That's "actively exposed" → "defensible."

---

## Ongoing operating rhythm (post-gauntlet)

Because free tier means you own the operations:

| Cadence | Task |
|---|---|
| Automated daily/weekly | Encrypted backup to the private repo |
| Automated weekly | Keep-alive query (prevents idle pause) |
| **Monthly** | Check free-tier quotas — DB size, egress, MAU. These fail abruptly. |
| **Monthly** | `npm audit`; review Sentry error trends |
| **Quarterly** | **Restore drill** into staging |
| Before every migration | Manual backup → apply to staging → verify → then prod |
| Before each season | Confirm the project isn't paused; smoke the offline PWA flow |

---

## Running this as an automated gauntlet

Each round is shaped for multi-agent execution: fan out finders in parallel per dimension → dedupe → fix → run all nine gates → have a *separate* agent try to **refute** each "fixed" claim → commit. The loop ends on two dry rounds, not a fixed count.

**Stays manual regardless** (only you can do these): credential rotation, Supabase dashboard changes, creating the staging project and private backup repo, GitHub Pages settings, and the COPPA review.

Say the word and I'll write the workflow script. It's opt-in — it spawns a lot of agents and costs real tokens.
