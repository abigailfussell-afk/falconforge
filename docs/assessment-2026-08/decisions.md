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

**Decision:** **Deferred until the beta ends and Stripe goes in** (Kevin, 2026-08-23).

Not "undecided" — deliberately not yet decided, and the sequence is the reason. The beta is
free, so nothing in the product needs a price to work, and pricing set before a single team has
used the thing for a season is a guess dressed as a decision. It gets answered as part of the
Stripe work, alongside D7's hosting move, because those two share a trigger: the moment money
changes hands.

**Consequences, and they are live now.** Sprint 10 (Stripe) stays parked. `LAND-04` — the
landing page's roles block is styled as pricing tiers with no prices — is answered for the beta
by saying so: "Free during the 2026–27 beta" is a true and complete answer to the question a
coach is actually asking. Seat semantics in the licence code stay as they are; they already work
for gifted grants, which is every grant until Stripe exists.

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

**Decision:** **(b), and more than (b)** (Kevin, 2026-08-23) — paste/parse **plus** full manual
entry **plus** editing after the fact. FalconForge never calls the API; the coach copies the
schedule from the public event page and pastes it, with instructions and a preview to confirm
before anything is written.

**Consequences / scope this sets:**
- A `competition_events` entity with matches, decided **before** the September schema freeze.
- Import is a **shortcut, not the substrate**: every field the parser fills must be enterable and
  editable by hand. A coach with no published schedule yet — normal on the morning of an event —
  must be able to build the whole thing manually.
- Matches stay editable after import. Kevin's reason, which is the one that matters at a venue:
  **surrogates and mid-event schedule changes are routine**, so an imported schedule that cannot
  be corrected is wrong by lunchtime.
- The parser is heuristic (pasted text has no table structure, and team names contain digits), so
  the **preview-and-confirm step is load-bearing** and an import must never write silently.
- Verified 2026-08-23 rather than assumed: the schedule is a public page needing no API token —
  `ftc-events.firstinspires.org/<year>/<code>/qualifications`, two teams per alliance. Which is
  also why we do not fetch it ourselves: a paid product scraping FIRST data server-side carries
  the same commercial-use exposure as the API, arguably worse.

---

## D3 — Beta trial length and mechanism

**Depends on it:** SEC-07 implementation, WALK-B-09 label, operator expiry view.

**Options**
- (a) Keep the automatic 90-day trial in `create_team_as_admin` (expires ~5 Dec 2026 for kickoff registrations).
- (b) Lengthen the trial to cover the season (e.g. until 30 Apr 2027).
- (c) Remove the automatic trial; beta teams get an operator gift at onboarding (plan §2's original model).
- (d) **Chosen, and not on the original list:** a short automatic *probation* that the operator extends to season length. See the decision below.

**Evidence** ([SEC-07](auth-rls-licensing.md)): only an in-app banner warns; no operator expiry
list; content screens keep offering writes that dead-letter. [SEC-08](auth-rls-licensing.md):
trial chaining is unlimited.

**Recommendation:** (b) for the 2026–27 beta, plus the operator expiry view; (c) once Stripe exists.

**Decision:** **30-day probation, extended to season length by the operator** (Kevin,
2026-08-23; revised the same day from an initial (c)).

`create_team_as_admin` grants **30 days automatically**, so a coach registering at 8am on a
competition Saturday has a working app without waiting for Kevin. The operator console lists new
teams; one click extends to season length once the team number has been eyeballed. A fake team is
therefore worth 30 days of nothing, and a real team gets a season without a renewal treadmill.

**Why the licence is not the anti-abuse control.** Kevin's concern was fake teams and stolen team
numbers. Withholding the licence addresses neither — a squatter with a read-only team has still
taken the number, and the only people actually delayed are real coaches. The two threats get
their own controls, both agreed:

- **`UNIQUE (program, team_number)`**, and claiming a taken number routes to *request to join*
  rather than silently creating a duplicate. This is not primarily an anti-abuse feature: it
  fixes two coaches from the same team both registering, and typo'd numbers, which are certain.
  It **reuses the existing `pending` membership status and join RPC** — no second join path.
- **One auto-created team per account.** A second team needs an operator grant. Kills SEC-08's
  unlimited trial chaining outright and is invisible to a real coach, who has one team and whose
  students arrive by invite.

Deliberately **not** built, per the project's guardrail bar (name the defect or leave it out):
a team-number format check, and any automatic verification against FIRST's published team list.
The latter is the same commercial-use exposure D2 just avoided; a human check is one public URL
(`ftc-events.firstinspires.org/<year>/team/<number>`) and costs no code.

**`program`, because FRC is planned and the numbers overlap** (Kevin). Stored as a **column**
with `UNIQUE (program, team_number)`, not as a literal `"FTC-12345"` string: the prefix stays
data rather than a convention every query has to parse, and display renders "FTC 12345". Defaults
to `ftc`; **no FRC behaviour is built now** — the column is cheap insurance before the September
schema freeze, the features are not.

**Consequences:**
- **SEC-07 is now a prerequisite, not a companion.** Under a 30-day grant a lapse is routine
  rather than exceptional, and today a lapsed team is still offered writes that dead-letter.
- The operator console needs the new-team list and the one-click extend before any team onboards.
- 30 days is a *probation*, not a trial: the extension is the normal path, not an exception.
- Knock-on for D2: **FRC is 3v3 and FTC is 2v2**, so a match cannot be
  `red1/red2/blue1/blue2` columns. Participants are rows — which is also what makes surrogates
  and mid-event changes expressible, which D2 requires.

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

**Decision:** **(b) — curated templates plus light per-team overrides** (Kevin, 2026-08-23),
rather than the assessment's phased (a)-then-(b).

**Consequences:**
- `team_game_overrides.patch` ships with the templates: add a field, hide a field, relabel.
- The override patch is season-scoped and must survive a season roll the same way sub-team
  structure does — a team that customised its DECODE form does not want it silently carried into
  BIOBUZZ, nor silently lost.
- Not (c): no form builder. Field *types* stay ours.
- The validation surface widens — a per-team field needs the same treatment WALK-A-06 just gave
  the fixed ones, so the rules belong in `scouting-validation.ts` with the rest.

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

**Decision:** **Content deferred; the presentation is not** (Kevin, 2026-08-23).

Two halves, answered differently on purpose.

**Authoring is deferred.** The material will be AI-generated from FTC and REV Robotics
documentation, with Claude's help, rather than written from scratch — which changes the shape of
the work enough that scheduling it now would be scheduling the wrong thing. It is not this
season's sprint.

**The UI is in scope now, as a stub.** Kevin wants the shape of how training is presented
settled before there is anything to present: the navigation, the unit/lesson structure, what a
student sees versus a mentor, how progress is recorded. Deciding that against real content is
harder than deciding it against none, and a stub is cheap to move.

**What "stub" means here, so it is not read as "build P-06":** routes, layout and empty states
with a small amount of representative placeholder content, and no authoring tools, no progress
persistence beyond what the existing store already offers, and no content pipeline. If it needs
a migration, it is out of scope. `P-06` Phase 1 remains deferred.

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

**Decision:** **No SDPC National Data Privacy Agreement this season** (Kevin, 2026-08-23).

Overkill for the size of the beta. An NDPA is the instrument for selling into districts at
scale; the 2026–27 beta is a small number of known teams, and signing one would add weeks of
review to reach an agreement nobody is currently asking for.

**What this does NOT change, and the distinction matters.** The product's obligations to minors
are unchanged: COPPA still governs the under-13 model, the guardian-managed profile is still how
a child appears on a roster, the Privacy Policy still describes what is held and how to have it
erased, and `SEC-11`'s erasure tooling still exists to honour that. Not signing an NDPA is a
decision about a *contract with districts*, not about how the data is handled.

**When it comes back.** The moment a district — rather than a coach — is the party being sold
to. That is the same trigger as D1 and D7, and it should be revisited together with them rather
than separately.

---

## D7 — Hosting and tier triggers

**Depends on it:** OPS-07, OPS-09, the Cloudflare migration plan §1.

**Proposed changes to the existing triggers:** add "first paid licence" (GitHub Pages ToS
excludes commercial SaaS) as a hard Cloudflare trigger; move Supabase Pro's trigger from "first
paying customer" to "first real team data" (no backups, 7-day pause, 1-day logs on Free).

**Decision:** **Stay on GitHub Pages and Supabase free through the beta; move when Stripe
goes in** (Kevin, 2026-08-23).

One trigger, not a set of measured thresholds: **the transition off beta and onto Stripe.**

**`OPS-07` is the reason this is a decision and not a preference.** GitHub Pages' terms exclude
commercial SaaS offerings. A free beta is defensibly outside that; a paid product served from
Pages is not. So the hosting move and the first payment are the same event, and doing them in
either order alone is the mistake — shipping Stripe on Pages breaches the terms, and moving
hosting before there is revenue spends money and a weekend on nothing.

**`OPS-09` stays open and accepted for now.** Free-tier Supabase pauses after 7 idle days, which
is exactly what an off-season looks like. During the beta season that is unlikely to bite;
after it, it will. The nightly backup (working since 2026-08-23) is what makes accepting this
survivable — a paused project is recoverable, an unbacked-up one is not.

**Consequences.** The Cloudflare migration plan in §1 stays a plan. `docs/beta-ops.md`'s
"trigger text still waits on D7" parking-lot item is answered: the trigger is Stripe, and the
runbook should say so rather than describing thresholds nobody is measuring.

---

## D8 — Content permissions: may students edit any teammate's task / report / plan?

**Depends on it:** whether SEC's capability matrix row "students edit anyone's rows" is a bug or a feature; P-03 (sprint ownership).

**Today:** RLS (`can_manage_content` = any approved member) and UI agree: any student can edit or
delete any teammate's task, scouting report, match plan or checklist item.

**Options:** (a) keep as is (small teams, trust); (b) own-rows + coach/mentor override; (c) per-sub-team.

**Recommendation:** (a) for beta — record it as deliberate so it is not "fixed" by accident.

**Decision:** **(a) — keep as is** (Kevin, 2026-08-23). Any approved member, students included,
may edit or delete any teammate's task, scouting report, match plan, checklist item and
competition event. This is what `can_manage_content` has always meant and what the UI has always
allowed; what changes is that it is now a decision rather than an accident, so it is not "fixed"
by somebody who mistakes it for one.

**Consequences:**
- `can_manage_content` stays "any approved member", and the write policies on `tasks`,
  `scouting_reports`, `match_plans`, `checklists` and Sprint 18's `competition_events`,
  `event_matches` and `match_participants` are correct as they stand. No migration.
- The case this is *for* is the one at a venue: a student correcting a surrogate, or fixing a
  match number on a schedule that changed at lunchtime, while the coach is in the pit.
- **The form patch is deliberately NOT under this rule.** `team_game_overrides` is
  `can_manage_structure` (admin/coach), because a patch changes the form every scout on the team
  types into — content permissions would let one student hide a field mid-competition for
  everybody. That asymmetry is the reason this decision needed recording rather than assuming.
- Revisit if a beta team reports a deletion they did not expect. Moving to (b) later is a
  migration on live data, which is cheap now and is not cheap after September.

---

## D9 — Under-18 admin nomination gate (carried from plan §8)

`nominate_team_admin` refuses a `13_to_17` account outright, and the dropdown still lists them
(WALK-B-11). Options: keep the refusal and filter the dropdown; or soften to "must confirm 18+
on acceptance" (the plan §3 handshake). Not urgent.

**Decision:** **Keep the refusal; filter the dropdown** (Kevin, 2026-08-23).

**Consequences:** `nominate_team_admin` keeps refusing a `13_to_17` account, and the picker stops
listing accounts it will refuse (WALK-B-11) — an affordance that does nothing is
`docs/failure-modes.md` §8. No self-attested 18+ claim is introduced. The empty case needs words:
a team whose only other members are minors sees why, not an empty list.
