# Hand-off — sprints driven by the August 2026 assessment

Written 2026-08-22. This is the launch kit for every sprint that implements findings from
`docs/assessment-2026-08.md`. It carries only what is not written down elsewhere: the prompt to
paste, the sprint packages (which IDs travel together and why), and the guardrails that keep an
agent on the work it was given. Evidence, fix directions and exit criteria are pointers.

Three files do the steering:

| File | What it is | Who writes it |
|---|---|---|
| `docs/assessment-2026-08.md` + `docs/assessment-2026-08/*.md` | the findings (IDs, evidence, fix direction) | written; read-only for agents |
| `docs/assessment-2026-08/decisions.md` | D1–D9, the choices only Kevin can make | **Kevin fills in `Decision:` lines** |
| `docs/assessment-2026-08/exit-criteria.md` | per ID: what "done" means, the red test, the trap | written; agents quote it back in their report |

---

## The prompt (paste, replace the two placeholders)

> Read `CLAUDE.md`, then `FALCONFORGE_V2_PLAN.md` §3 and §5, then `docs/failure-modes.md` and
> `docs/environment-divergences.md`. Then read `HANDOFF_ASSESSMENT.md` in full.
>
> You are executing sprint **`<PACKAGE NAME>`** from HANDOFF_ASSESSMENT.md §"Sprint packages",
> on branch **`<v2/sprint-N-slug>`** off `main`. The sprint is exactly the IDs listed for that
> package — no more, no fewer. For each ID: read its block in the named report under
> `docs/assessment-2026-08/`, read its block in `docs/assessment-2026-08/exit-criteria.md`,
> and read `docs/assessment-2026-08/decisions.md` for any decision the package says it depends
> on. If a required decision line is blank, stop and tell me which one before building anything
> that depends on it; do the IDs that don't depend on it meanwhile.
>
> Plan → implement → Gate (or gate:db when `supabase/` is touched) → verify every exit criterion
> adversarially, including watching each red test go red with the fix reverted → commit → sprint
> report per §"Report format" below. Do not push, open PRs, or deploy.

---

## Sprint packages

Packages group IDs that touch the same files or the same tests, so one agent holds the context
and nothing is fixed twice. Order matters within Phase 0: the first two packages are the ones that
gate inviting more beta teams. Each package should fit one agent session; if it does not, split
at the marked `‖`.

### Package A — "tenant safety" (Phase 0; `supabase/` touched → gate:db)
**IDs:** SEC-01, SEC-02, SEC-05, SEC-09, SEC-10 ‖ SEC-03, SEC-06, SEC-08.
**Why together:** all are migrations on the frozen schema plus RLS/db tests; one migration file
per ID, one agent who has read the whole policy table (SEC Appendix A).
**Depends on decisions:** D3 only for the SEC-07 follow-on (not in this package); D8 is a
*read* — confirm it is recorded before touching `can_manage_content` at all (you should not).
**Also do:** correct the plan §8 lines for SEC-02 and SEC-03 (assessment §9.2) in the same commit
as each fix; apply the production migrations per `deploy.yml`'s order only when Kevin says so.

### Package B — "the read path" (Phase 0; `src/lib` only → Gate)
**IDs:** SYNC-01 + SYNC-03 (one change), SYNC-02, SYNC-05, SYNC-15.
**Why together:** all live in `server-pull.ts` / `supabase.ts` / `sign-out.ts` and share the B3
pending-id guard; the 2,500-row integration test written for SYNC-01 is the harness for the rest.
**Hard rule:** principle 2 — every B1–B26 regression test stays green; new behaviour gets a new
named test. Measure bytes-per-open before and after (SYNC report has the script) and put both
numbers in the report.

### Package C — "day-one UI bugs" (Phase 0; Gate)
**IDs:** FEAT-01, FEAT-02, FEAT-05, FEAT-12, WALK-A-07, WALK-B-01, WALK-B-02, SYNC-07.
**Why together:** small component fixes, each with a component test whose fixture must be able to
fail (OPS-02 is the cautionary tale — read it). Verify every one in the built bundle at 375 px.

### Package D — "beta logistics" (Phase 0; mostly docs/config + small code)
**IDs:** OPS-06, LAND-01/02/03, OPS-11, plan §9.2 corrections not already done by Package A,
OPS-03 (build id), the feedback-body half of OPS-05.
**Depends on decisions:** D1 for any pricing copy on the landing page — until decided, say
"free during the 2026–27 beta" and nothing else about price. D7 for the beta-ops trigger text.

### Package E — "BIOBUZZ readiness" (Phase 1; Gate; no migration in phase S)
**IDs:** P-01 phase S (FEAT-11), WALK-A-06, then P-02 minimal set if time allows (needs a small
migration: `scouting_reports.kind/alliance/station` → gate:db).
**Depends on decisions:** D4 (customisation depth — phase S assumes (a), curated templates).
D2 is *not* needed for this package; do not add any event-API code.
**Input:** the actual BIOBUZZ game manual (kickoff 12 Sept 2026) for the `ftc-2026-biobuzz.json`
fields — Kevin supplies it; until then ship the DECODE definition and a placeholder BIOBUZZ file
with generic phases so the select works.

### Package F — "licensing in season" (Phase 1; gate:db)
**IDs:** SEC-07, WALK-B-12, WALK-B-09, WALK-B-03, WALK-B-04, WALK-B-05, WALK-B-11.
**Depends on decisions:** D3 (trial), D9 (nomination gate).

### Package G — "observability and ops" (Phase 1; CI/workflows + small code)
**IDs:** P-11 first half (OPS-03 if not done, OPS-04 classification half, OPS-05 uptime, OPS-09
backups, OPS-10 deploy gate), OPS-01, OPS-02, OPS-13 (mobile Playwright project + the three
missing specs), SYNC-08, SYNC-11, SYNC-16.
**Note:** secrets for the ops workflow (DB URL, access token, encryption key) are Kevin's to add
in GitHub; the agent writes the workflow and documents the secret names in `beta-ops.md`.

### Later packages (Phase 2–3) — designed, not yet scheduled
- **"Agile that teaches"** P-03 (sprint entity, wizard, retro, burndown, DnD) — needs a design
  pass first (the FEAT report has the order of value; no schema sketch yet).
- **"Game definitions, phase M"** P-01 (snapshot column, global table, overrides) — D4.
- **"Scouting depth"** P-02 events entity, pit form, pick list, local scout-to-scout sharing — D2.
- **"Training, phase 1"** P-06 — D5; product model is implementable from TRAIN §2.2; content is not written.
- **"Parent view for all minors"** P-05 — after SEC-05.
- **"Erasure/export/delete tooling"** SEC-11 + Sprint 11.
- **Stripe** (Sprint 10) — D1 first.
- **Cloudflare move** — existing plan; D7.

---

## Guardrails — how an agent stays on course

1. **The package is the scope.** Anything discovered outside it goes into `FALCONFORGE_V2_PLAN.md`
   §8 "Discovered / parking lot" with the exact numbers, not into the diff. The memory of this
   project is explicit: Kevin accepts deferral and rejects silence.
2. **Do not re-audit.** The reports already contain the evidence; re-deriving it burns the
   session. If a report's claim looks wrong, *verify that one claim* (the repro is written down)
   and say so in the report — do not widen.
3. **Decisions are read, never inferred.** If `decisions.md` has a blank line the package
   depends on, stop on that ID and ask. Do not infer the decision from the schema, the landing
   page, or the plan's §2 — the assessment found the plan itself is stale in places.
4. **Exit criteria are the definition of done**, not the Gate. For every ID quote each criterion
   in the report with how it was verified; name the red test and state that it was seen red.
   A criterion with no way to fail is decoration (`docs/failure-modes.md` §0).
5. **Run the built bundle, not the dev server,** for anything visual or offline: `npm run
   preview` after `npm run build`; `npm run seed:review` first; both 1280×800 and 375×812. The
   dev server has no service worker and the walkthrough agents' screenshots were taken there —
   do not cite them as proof of the built app.
6. **Local DB state is disposable and currently dirty.** `supabase db reset` + `npm run
   seed:review` before measuring anything. The walkthrough rolled Iron Falcons to a
   "2027-2028 Season" and inserted `full@` into `platform_operators`.
7. **Never weaken the sync engine; never add `as any`; never add an arbitrary Tailwind value;
   never `describe.skip`.** The ratchets in `harness-invariants.test.ts` enforce the counts;
   the assessment found seven tests that cannot fail — do not add an eighth.
8. **Migrations are forward-only on the frozen schema**, one per ID, named
   `<timestamp>_<id-slug>.sql`, with `db:types` regenerated and `schema_assertions.sql`
   extended where a new policy or grant appears. Production is migrated by Kevin, by hand, before
   merge, per `deploy.yml`'s header — an agent never runs anything `--linked`.
9. **Three files are authoritative for "what is true about the repo" and may be stale:**
   README (OPS-11), plan §8 (assessment §9.2), `docs/beta-ops.md` (SEC-03). When the code and
   the prose disagree, the code is the fact and the prose is a finding to correct in the same
   commit.
10. **Report honestly.** If a criterion was not met, say which and why; scaling down is Kevin's
    call. Paste real Gate output. "Green" without output is not a claim.

---

## Report format (`docs/sprint-<n>-report.md`)

1. Package name, branch, commit range, Gate / gate:db output pasted.
2. Per ID: exit criteria quoted, each with *how verified* (command, screenshot path, test name)
   and the red-test observation; effort actual vs estimate.
3. Decisions consumed (D-numbers) and anything that contradicted them.
4. Discovered → parking lot entries added (IDs or a line each).
5. What was **not** done and why.
6. One line for the plan §8 Progress log, written for that table.

---

## For Kevin — what to do before launching the first package

1. Fill in `decisions.md` D3, D7, D8 (Package A/D read them; D8 only needs "keep as is" recorded).
   D1, D2, D4, D5, D6, D9 can wait for their packages.
2. `supabase db reset && npm run seed:review` on the local stack.
3. Launch Package A and Package B in **separate** sessions — they do not share files. Package C
   can run alongside. Package D waits for A (plan §8 corrections overlap).
4. Supply the BIOBUZZ game manual to Package E when it exists; until then E ships the placeholder.
5. Decide whether the assessment folder is committed as-is (recommended: one `docs:` commit,
   so the IDs are addressable from git history).
