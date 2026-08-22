# Decision record — assessment of 2026-08-22

Fill in the **Decision** line under each item. Agents read this file before starting any sprint
that depends on the decision (the dependency is named per item). Until a line is filled in, an
agent must treat the item as undecided and **not** build on an assumption — it either does the
non-dependent work or stops and asks.

Format: options → evidence → recommendation → `Decision:` (Kevin, date) → consequences.

---

## D1 — Pricing model

**Depends on it:** Sprint 10 (Stripe), landing page pricing section (LAND-04), seat semantics in
`enforce_seat_capacity`, the "Gifted licence" label (WALK-B-09).

**Options**
- (a) Keep plan §2: per named user, per team, monthly.
- (b) Flat per team per season (~$99–149), free rookie tier, affiliate/PDP bulk rate.
- (c) Hybrid: flat team fee with a seat cap (e.g. 20), overage per seat.

**Evidence** ([MKT §4](market-and-competition.md#4-pricing)): every FTC tool is free; a $25
registration rise got its own thread; (a) × 13 users ≈ $470/yr, above Hudl's entry tier and ~10%
of a $4k regional budget; per-seat punishes guardians and drop-in mentors and breaks at FRC roster
sizes; serious tier spends $10–20k so $99–149 is <2%.

**Recommendation:** (c) — flat per team per season with a generous cap, because the entitlement
model already counts seats and a cap keeps the existing `license_grants.seat_count` meaningful.

**Decision:** _____________________________ (Kevin, ____-__-__)

**Consequences once decided:** Stripe product/price shape; whether `seat_count` stays; landing
copy; whether guardians/mentors consume seats.

---

## D2 — Official event data (FTC Events API)

**Depends on it:** P-02 events entity, any schedule/rankings import, Match Planner "match from schedule".

**Options**
- (a) Do not consume the FTC Events API at all; `event_name`/match # stay free text.
- (b) User-side import: the coach pastes/uploads a schedule fetched with *their* key (their use, not ours).
- (c) Ask FTCScout's maintainers for written permission to use their API (upstream is still FIRST data).
- (d) Make schedule/rankings a free, unlicensed feature served outside the paid product.

**Evidence** ([MKT §2](market-and-competition.md#competitor-matrix)): the API terms say data "may
not be used for commercial purposes. There can be no financial gain from acquiring an access
token." FTCScout publishes no terms. FRC's TBA is a free keyed API with no such clause.

**Recommendation:** (b) now (zero legal exposure, unblocks the events entity), pursue (c) in
parallel, get a lawyer's read before any server-side fetch.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D3 — Beta trial length and mechanism

**Depends on it:** SEC-07 implementation, WALK-B-09 label, operator expiry view.

**Options**
- (a) Keep the automatic 90-day trial in `create_team_as_admin` (expires ~5 Dec 2026 for kickoff registrations).
- (b) Lengthen the trial to cover the season (e.g. until 30 Apr 2027).
- (c) Remove the automatic trial; beta teams get an operator gift at onboarding (plan §2's original model).

**Evidence** ([SEC-07](auth-rls-licensing.md)): only an in-app banner warns; no operator expiry
list; content screens keep offering writes that dead-letter. [SEC-08](auth-rls-licensing.md):
trial chaining is unlimited.

**Recommendation:** (b) for the 2026–27 beta, plus the operator expiry view; (c) once Stripe exists.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D4 — Scouting form customisation depth

**Depends on it:** P-01 phase M (overrides UI), FEAT-11 phase scope.

**Options**
- (a) Curated per-season templates only (operator ships JSON each September; teams cannot change fields).
- (b) Templates + light per-team overrides (add a field, hide a field, relabel) — `team_game_overrides.patch`.
- (c) Full form builder.

**Evidence** ([FEAT §2b](features-and-game-coupling.md#2b-proposed-game-agnostic-model)): what
teams actually do to a template is add two fields and rename one; a builder is a sprint of UI
and a new validation bug class.

**Recommendation:** (a) for phase S (kickoff), (b) for phase M. Never (c) before beta retention is known.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D5 — Training section scope and authorship

**Depends on it:** P-06 Phase 1 sprint; whether content authoring is scheduled at all this season.

**Options**
- (a) Not this season; revisit after the April 2027 championship.
- (b) Phase 1 skeleton (schema + UI + link-out modules + checkpoints + skills matrix) during the season; content trickles.
- (c) Phase 1 + original lessons for Tracks D/E (another 200–300 h).

**Who authors:** Kevin / veteran students from beta teams / commissioned.

**Evidence** ([TRAIN §2.4–2.5](training-onboarding-design.md)): the sellable part is matrix +
sign-off + off-season mode, not lessons; Phase 1 ≈ one sprint + 110–150 h authoring; licences
allow copying only FTC Docs/SDK samples (BSD-3).

**Recommendation:** (b), app work in Phase 3 of the roadmap (post-season), authoring by veteran
students with Kevin reviewing, because that is how every team in the evidence already does it.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D6 — Beta cohort and school data-privacy agreements

**Depends on it:** who gets invited in September; whether an SDPC NDPA is signed this season.

**Options**
- (a) Community/parent-run teams only this season; no DPA work.
- (b) Also school teams; sign the SDPC NDPA v2.2 template once and publish a subprocessor list.

**Evidence** ([MKT §4](market-and-competition.md#school-procurement-constraints)): 75–80% of
regional-level teams are school-affiliated and need a DPA before rostering minors; districts
will ask about 1-day log retention, no PITR, and no security headers.

**Recommendation:** (a) now; (b) after Supabase Pro and the Cloudflare move.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D7 — Hosting and tier triggers

**Depends on it:** OPS-07, OPS-09, the Cloudflare migration plan §1.

**Proposed changes to the existing triggers:** add "first paid licence" (GitHub Pages ToS
excludes commercial SaaS) as a hard Cloudflare trigger; move Supabase Pro's trigger from "first
paying customer" to "first real team data" (no backups, 7-day pause, 1-day logs on Free).

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D8 — Content permissions: may students edit any teammate's task / report / plan?

**Depends on it:** whether SEC's capability matrix row "students edit anyone's rows" is a bug or a feature; P-03 (sprint ownership).

**Today:** RLS (`can_manage_content` = any approved member) and UI agree: any student can edit or
delete any teammate's task, scouting report, match plan or checklist item.

**Options:** (a) keep as is (small teams, trust); (b) own-rows + coach/mentor override; (c) per-sub-team.

**Recommendation:** (a) for beta — record it as deliberate so it is not "fixed" by accident.

**Decision:** _____________________________ (Kevin, ____-__-__)

---

## D9 — Under-18 admin nomination gate (carried from plan §8)

`nominate_team_admin` refuses a `13_to_17` account outright, and the dropdown still lists them
(WALK-B-11). Options: keep the refusal and filter the dropdown; or soften to "must confirm 18+
on acceptance" (the plan §3 handshake). Not urgent.

**Decision:** _____________________________ (Kevin, ____-__-__)
