# Shared brief for FalconForge assessment agents

You are one of several agents producing a comprehensive assessment of FalconForge
(repo: `C:\Claude\falconforge`, an offline-first PWA for FTC robotics teams — "Hudl for FTC").
The final deliverable is a markdown assessment that later Opus-level agents will implement
from, so **evidence and precision matter more than volume**. The owner (Kevin, solo maintainer)
explicitly said: "I don't want you to just guess on stuff." Every claim needs evidence.

## Ground rules
- **Read-only on the repo.** Do not edit, create, or delete files under `C:\Claude\falconforge`
  (except nothing). Do not run `git` write commands. Do not run `supabase db reset`,
  `npm run db:verify`, or anything that wipes the local database. Never touch production
  (`falcon-forge.com`, `.env.local` keys). The local Supabase stack at `http://127.0.0.1:54321`
  is the only database you may use; creating/editing rows there is fine.
- Write ALL scratch files and your report under
  `C:\Users\kevin\AppData\Local\Temp\claude\C--Claude-falconforge\d0f5b405-4994-4875-8f3a-a4f7ba006809\scratchpad\`
  (call it `$S`). Your report goes to `$S\findings\<your-area>.md`. Screenshots to `$S\shots\<area>-<name>.png`.
- Before reporting an issue as new, grep `FALCONFORGE_V2_PLAN.md` (§8 "Discovered / parking lot")
  and `docs/failure-modes.md` — if it is already recorded, cite it as "KNOWN (plan §8: <quote
  5 words>)" and add only what's new (e.g. you reproduced it, it's worse than stated, it's fixed).
- Read `CLAUDE.md` first (short). The plan file `FALCONFORGE_V2_PLAN.md` is 1100 lines — read
  §1–§4 (lines 1–115) for context and grep the rest as needed.
- Context: FTC-first, FRC is "designed-for later" (recommend abstractions, don't build FRC).
  Beta target: FTC kickoff early Sept 2026 (today is 2026-08-22). A few beta teams on gifted
  licences; Stripe later. Hosting is gh-pages + Supabase free tier.

## Finding format (use exactly, one block per finding)
```
### <AREA>-<nn> — <short title>
- **Severity:** Blocker | High | Medium | Low   (Blocker = prevents a real team using it at a competition / at scale; High = will be hit by beta teams; Medium = will be hit eventually; Low = polish)
- **Type:** bug | unfinished | scale-blocker | security | ux | debt
- **Status vs plan:** NEW | KNOWN (where) | KNOWN-but-worse
- **Evidence:** file:line references, query output, screenshot path, console output — concrete.
- **Repro / how observed:** exact steps or commands.
- **Impact:** who hits it, when.
- **Fix direction:** 2–5 sentences a later implementing agent can start from (files to touch, approach). Not code.
- **Effort:** S (<½ day) | M (1–2 days) | L (sprint)
```
End the report with a "## Summary" section: 5–10 bullets of what matters most, and a
"## Confidence / not checked" section listing what you could not verify.

## Local stack facts
- Dev server (Vite, local Supabase): http://localhost:5189 (already running). No service worker
  in dev mode; the built app is what ships. Supabase Studio: http://127.0.0.1:54323, Inbucket
  (captures confirmation emails): http://127.0.0.1:54324. Postgres:
  `docker exec -i supabase_db_falconforge psql -U postgres -d postgres -Atc "<sql>"`.
- Seeded accounts (password `ForgeReview!2026-local` for all of these):
  - `reviewer@falconforge.test` — admin of "Iron Falcons" (ordinary licensed team, 15 seats),
    students `iron-student0..10@`, pending joiners `iron-hopeful0..1@`, `successor@` (nominated admin),
    `mentor@falconforge.test` (mentor role), `guardian@falconforge.test` (guardian with managed child).
  - `full@falconforge.test` — admin of "full-house" (every seat taken, pending requests that cannot be approved).
  - `lapsed@falconforge.test` — admin of a team whose licence expired yesterday (read-only).
  - `expiring@falconforge.test` — admin of a team whose licence ends in 9 days.
  - `stranded@falconforge.test` — a team whose admin row was deleted (operator rescue case).
  - Use `scripts/seed-review-states.mjs` / `scripts/seed-demo-team.mjs` as a reference for
    exact shapes; `demo@falconforge.test` / `ForgeDemo!2026-local` exists only if seed:demo was run.
- For browser automation use **Playwright from node scripts** (`@playwright/test` is installed;
  write `.mjs` scripts in `$S` and run with `node`), headless Chromium, against
  http://localhost:5189. The app uses HashRouter (`/#/...`). Use a 1280×800 context AND a
  375×812 mobile context for every screen you check. Save screenshots. Collect console errors
  and failed network requests (`page.on('console')`, `page.on('response')`) and report them.
  Do NOT use the in-app Browser pane MCP tools (another agent owns it).
- `e2e/helpers.ts` shows how the smoke pack logs in / registers; reuse its selectors/approach.
