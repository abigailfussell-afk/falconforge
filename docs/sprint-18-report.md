# Sprint 18 — "the game and the events" (Package E: P-01 phase S, D4(b), D2)

**Branch:** `v2/sprint-18-game-and-events` · **Commits:** `b747a94..db9dfb2` (3) · off `main` at `ba8e8cb`
**Decisions consumed:** D4(b) (curated templates + light overrides), D2 (paste/parse + manual +
editing, never a server-side fetch), and D3's knock-on (FRC is 3v3, so participants are rows).
**`supabase/` touched** → `npm run gate:db`, one forward migration, `db:types` regenerated.

---

## 1. The Gate

```
$ npm run gate:db
 Test Files  82 passed (82)
      Tests  991 passed | 2 skipped (993)      ← unit
 Test Files  9 passed (9)
      Tests  95 passed (95)                    ← integration
✓ built in 5.23s
 schema assertions passed
 Test Files  26 passed (26)
      Tests  626 passed (626)                  ← db
 Test Files  6 passed (6)
      Tests  418 passed (418)                  ← rls
EXIT=0
```

Unit 904 → **991** (+87), db 551 → **626** (+75, all of them the new tables' isolation
assertions), rls 343 → **418**.

```
$ npm run test:e2e
  35 passed (1.1m)
```

Ratchets unchanged: `as any` 56, arbitrary Tailwind 2, `describe.skip` 2, assertion-free 0. The
Tailwind ratchet **fired during the sprint** on two `grid-cols-[…]` classes I had written; both
became flexbox with tokens. It works.

---

## 2. P-01 phase S — the game becomes data

### "`src/games/ftc-2025-decode.json` and `ftc-2026-biobuzz.json` exist and validate against a `GameDefinition` type"

**Met.** Both load through `games.ts`, which **throws at module load** on a malformed file —
`import x from './x.json'` is typed by its literal contents and never checked against the
interface, so a typo'd key would otherwise compile, ship, and fail at render time on the
scouting screen, which is used at a venue. `harness-invariants` imports the module, so that is
a Gate failure instead.

BIOBUZZ is the placeholder the package description asks for: generic phases, a counter per
phase, the DECODE field image. Kickoff is 12 September 2026 and the manual does not exist.

### "a source-level test asserts no game-specific literal remains in `ScoutingReports.tsx`, `MatchPlanner.tsx`, `constants.ts`, `types.ts`"

**Met**, as a ratchet over fifteen literals in the four named files, plus a fifth check on the
entity registry.

*Comments are stripped before matching, and that is not a loophole.* Every one of those files
now explains what used to be there — `constants.ts` carries a paragraph about the
`FIELD_IMAGE_URL` it replaced — and a ratchet that failed on the explanation would force the
explanation out. What matters is that no *code* branches on a game.

*Watched red:* re-adding `export const FIELD_IMAGE_URL = "DecodeField.png"` to `constants.ts`
→ `src/constants.ts still names FIELD_IMAGE_URL, DecodeField in code`.

### "Scouting modal and card render from `scouting.match`; existing seeded DECODE rows render unchanged"

**Met.** `scouting_reports.data` has always been a jsonb bag keyed by field name, so **no row
was migrated** — the DECODE definition was written to match the old form field for field,
deliberately without improving anything in passing, precisely so this is checkable. There is a
test on its exact key set: adding a field to DECODE fails it and makes somebody think about the
rows already stored.

Verified in the built app at 375 px (`scripts/probe-events-and-form.mjs`): the untouched fields
still read "Has Autonomous" and "Intake Type".

### "Match Planner reads image, width/height and `partnerCapabilities` from the definition"

**Met** for the image and the labels. **Partially met for the capabilities, and the gap is
deliberate:** the planner's two checkboxes are database *columns* (`partner_autonomous`,
`partner_park`), not schema fields, so the definition supplies their **labels** and cannot
add or remove them. Making them schema-driven is a change to `match_plans`, which is phase M.
"Lifted Park" — the literal the criterion names — is gone.

### "Season form's 'Game' is a select over bundled definitions plus 'Other'"

**Met.** It was free text, which is *why* `game_title` could never be an identity: "Decode" and
"DECODE" were two games. The select records the definition id; "Other" records a title and no
id, which is exactly the state every season created before this column was in.

### "rollover defaults to the newest FTC definition"

**Met** — `CURRENT_GAME` is `BUNDLED_GAMES[0]`, newest first, so in September the right answer
is the one nobody has to choose.

### "Archived 2025–26 season keeps rendering DECODE after the current season is BIOBUZZ"

**Met for seasons created from now on, and NOT met for seasons that already exist.** This is the
one criterion with a real gap and it is worth stating precisely.

`gameForSeason` prefers the season's recorded `game_definition_id`; failing that it matches
`game_title`; failing that it takes the newest bundle. A season created today records its id and
renders correctly for ever. A season created **before** this migration has no id — every season
in production — and falls back to its title, which works while we still ship DECODE and
**stops working the year we prune it**. At that point an archived season renders with the
newest game's fields over the old game's data.

That is what `game_snapshot` in phase M fixes, and the exit criterion anticipates it: *"in
phase S it can be satisfied by storing the definition id + version on the season."* Recorded in
`games.ts`'s own comment and in the plan's §8 rather than left to be discovered.

### Red tests

- `SchemaForm.test.tsx` (14) — every field type renders; watched red by removing a `case`.
- The literal ratchet, above.
- `game-definition.test.ts` → **"preserves a key it has never heard of"**, the round-trip the
  criteria name. Before this the registry enumerated ten DECODE keys, so an unknown key was
  **dropped**: a report carrying a field a team added, or one written by a newer build, lost
  that field on the next round trip through an older client — silently, and the row still saved.

*P-01's named trap, closed:* the `rating` default was 3 in the form and 0 in `fromRemote`, so a
report saved without touching the slider read back as a different number. One default now, in
the schema, with a test.

---

## 3. D4(b) — curated templates plus light overrides

No exit-criteria block; the decision text is the specification.

### "`team_game_overrides.patch` ships with the templates: add a field, hide a field, relabel"

**Met**, with a table, RLS, a registry entity, a resolver, validation, and a screen. The screen
matters more than it looks: without it the patch would be a **gate with no door** —
`docs/failure-modes.md` §7 is four sprints of exactly that, and the table, the policy, the
registry entry and the resolver would all have been correct with no team able to produce a patch.

*Verified end to end in the built app*: hide `farShooting`, rename `shotsTaken` to "Attempts",
add "Climbed", save, then open the scouting modal and read it back. That last step is the join
nothing else covers.

```
patch as stored: {"add":[{"field":{"key":"team.climbed-2ih6","type":"bool","label":"Climbed"},
                 "section":"endgame"}],"hide":["farShooting"],"relabel":{"shotsTaken":"Attempts"}}
```

### "Not (c): no form builder. Field types stay ours."

**Held.** Three operations and no more. Deliberately absent: reorder, retype, and editing a
field's options — each defensible, none with a reported need, and every one widening what a
patch can do to a form a scout is typing into at a venue.

**The namespace is the safety property**, and it has its own test. A team's key is prefixed
`team.` because a uniqueness *check* compares against the template as it is **today**, and the
template is replaced every September: without the prefix a team's `climb` and next year's
official `climb` become one key in one jsonb bag, and last season's hand-typed value silently
becomes this season's official field.

### "The override patch is season-scoped and must survive a season roll the same way sub-team structure does — not silently carried into BIOBUZZ, nor silently lost."

**Met, and the two halves point opposite ways**, so the condition is the **game** rather than
the wizard's checkbox alone: same game, the patch travels; different game, it stays on the
season it belongs to. "Not silently lost" does not mean "applied somewhere it makes no sense" —
`hide: ['shotsMissed']` against a form with no such field is a no-op wearing a customisation.

*Red tests:* `game-override-rollover.test.ts` (6), including that the new season is queued
**before** the patch that references it (B1's shape).

### "A per-team field needs the same validation treatment WALK-A-06 gave the fixed ones — the rules belong in `scouting-validation.ts`"

**Met.** `fieldError`, `gameDataErrors` and `patchIssues` are in that file with WALK-A-06's
three rules, and `SchemaForm` renders each field's own message beside the field. The reasoning
WALK-A-06 gave for a module rather than an `onChange` handler gets *stronger* when the fields
become data: a team can now add a field, and the only place its rule can live is there.

One decision inside this worth naming: **an unknown `select` option is not an error**. A report
saved under last September's template can hold an option this September's does not list, and
refusing it would make an archived season's data un-openable — the opposite of what "prior
seasons are read-only but readable" promises.

---

## 4. D2 — competition events

### "A `competition_events` entity with matches, decided before the September schema freeze"

**Met.** Three tables, one migration, in before the freeze.

### "Participants are ROWS, not `red1/red2/blue1/blue2` columns"

**Met**, and both of D2/D3's reasons are load-bearing rather than one being decorative:

1. **FRC is 3v3 and FTC is 2v2.** Four columns encode FTC's alliance size into the schema, when
   `teams.program` exists precisely so that assumption stops being made. The parser takes the
   alliance size from the game definition, and there is a test that reads three per alliance.
2. **A surrogate is a property of a participation.** A column layout has nowhere to put it, and
   D2 says surrogates and mid-event changes are routine — so a schedule that cannot express one
   is "wrong by lunchtime".

### "Paste/parse import from the public FIRST schedule page … with instructions, and a preview-and-confirm that is load-bearing"

**Met.** The parser's header states that it is heuristic and why. The dangerous ambiguities are
real and each has a test:

- **The trailing scores.** The verified row ends `… 25756 Nano Ninjas 108 11`, and 108 and 11
  are *scores* that are also valid FTC team numbers. Reading them as teams puts six robots in a
  2v2 match. Resolved by position, not cleverness, and the preview *names them*:
  `Ignored 2 number(s) after the teams (108, 11) — usually the scores.`
- **The time column** contains 2, 21, 11 and 42 — three of them valid team numbers. Stripped
  before the numbers are read, which makes correctness independent of which teams attend.
- **Team names contain digits.** "Team 5 Robotics" cannot be split correctly, because team 5
  exists. There is a test asserting the **wrong** answer deliberately, with a comment saying
  that a later change making it right *should* fail that test and should make somebody re-read
  D2 first.

**The first test in that file found a real bug on its first run:** the last team's name ran to
end-of-line and came out as `"Nano Ninjas 108 11"` — the scores appended to a team's name, which
is then what the preview shows and what the coach confirms. That is the argument for asserting
the whole participant list rather than only the numbers.

The preview shows **our own matches marked**, warnings per match in words, and skipped lines
**with their text** — a line the parser could not use is the one most likely to matter, and a
count hides which match will be missing at the venue.

### "Manual entry and post-hoc editing are the substrate, not the fallback"

**Met.** The events screen is a complete manual editor with an import button, not an import
screen with an escape hatch: create an event, add a match, type the team numbers and names, tick
a surrogate, change a phase or a number — every field the parser fills. Verified in the built
app: an event created entirely by hand reached the database.

### "Never fetch that page server-side"

**Held, and there is nothing to check because there is nothing to disable:** no code in this
sprint issues a request to any FIRST host. The paste box is the only input.

### One thing measured because §10 demanded it

`competition_events.starts_on` is a `date` column and a `YYYY-MM-DD` **string** on the client,
passed through untouched. A competition date is a date; round-tripped through epoch millis it
renders one day early at negative UTC offsets, which this project has shipped twice and which
for "which day is the competition" is the whole value of the field. Measured on this machine
(US Central — the failing case): typed `2027-02-21`, stored `2027-02-21`.

---

## 5. Isolation, per principle 4

`events-and-overrides.rls.db.test.ts` — **75 assertions** over the four new tables, four roles,
four verbs, plus:

- the control block (a student on team A *can* read and write their own team's events, and
  *cannot* rewrite the form patch, which is `can_manage_structure`);
- **the shape B21 actually used** — naming your **own** team id on somebody else's row. A match
  on team A pointing at team B's event is refused structurally by the composite FK, not merely
  by policy;
- the **season gate through a join**, which is a policy shape nothing else in this schema has:
  archiving the season must stop a match being added to an event in it, without any property of
  the match changing.

*Watched red:* widening `competition_events_select` to `USING (true)` → 5 failures.

---

## 6. What went wrong, and what caught it

**1. `registration.spec.ts` failed for the third time in two sprints, and it is a product
defect rather than a flake.** Sprint 17 parked it unexplained. This time I captured it before
re-running, as `failure-modes` instructs, and narrowed it:

- It happens **only** on the email-confirmation path. A control probe that signs in normally
  and issues the same immediate `goto('/#/create-team')` reached the wizard **12 times out of
  12**.
- It reproduces at roughly **1 run in 24** with `--repeat-each=8`, and hit a *different* test in
  the same file this time — so it is the shared `createTeam` helper, not one spec.
- The screenshot is always the onboarding picker. `App.tsx` guards the route as
  `user ? <CreateTeam/> : <Navigate to="/" replace/>`; a momentarily falsy `user` sends the
  coach to `/`, which bounces a signed-in user to `/app`, which for a user with no team is the
  picker. **That is a redirect discarding the user's intent on the one journey every team takes
  exactly once** (`failure-modes` §14).

The one-line fix — carry the destination with `loginWithReturnTo`, the helper this repo already
built for this — is **outside this sprint's IDs**, so it is in the plan's §8 with these numbers.
The e2e helper now retries and **throws with the real reason** if the retry fails, so the defect
can never again be reported as "waiting for a button".

**2. Two arbitrary Tailwind values, caught by the ratchet**, both `grid-cols-[…]`. Replaced with
flexbox and tokens.

**3. My own probe's wait condition was already true before the thing it waited for happened.**
It counted every participant the *team* had, so a leftover row from an earlier run satisfied it
instantly and it then reported the new rows missing — `failure-modes` §2's third variant, and it
cost two wrong diagnoses before I read it properly.

**4. One 409 I cannot explain, recorded rather than dismissed.** During the debugging above, one
run produced
`409 competition_events?on_conflict=id :: {"code":"23505", … "competition_events_id_team_id_key"}`.
It has not recurred in six subsequent runs, including three deliberate attempts with leftover
rows present. Written down with the exact body because this repo's rule about its other
intermittent failure is that "it passed the next four times" is how a defect gets ignored for a
season. → §8.

---

## 7. Not done, and why

- **P-02 (the scouting summary table, pick list, CSV export)** — Package E lists it as "if time
  allows", and it did not. `scoring.metrics` exists in the definitions ready for it.
- **`game_snapshot`** — phase M, per the exit criterion. §2 states the consequence precisely.
- **The planner's partner capabilities are labels only** — §2. Making them schema-driven is a
  `match_plans` change.
- **`match_participants` and `event_matches` are not season-filtered on pull**, because they
  have no `season_id` — they hang off the event. A team's whole match history downloads on team
  load. Fine at beta scale (~60 matches × 4 per event) and worth watching, since it is SYNC-03's
  shape. → §8.

---

## 8. Parking lot entries added

Five, in `FALCONFORGE_V2_PLAN.md` §8.

---

## 9. One line for the plan's §8 Progress log

> **2026-08-23 · Sprint 18 — Package E: P-01 phase S, D4(b), D2, `v2/sprint-18-game-and-events`.**
> Complete except P-02, merged to `main`. `gate:db` green (lint / 991 unit +2 skipped / 95
> integration / build / schema assertions / 626 db / 418 rls), e2e 35/35, and a 19-check browser
> probe at 375 px on a `--mode development` build. One forward migration, `db:types`
> regenerated. **The game stopped being TypeScript**: `intakeType`'s union, `FIELD_IMAGE_URL`,
> "Lifted Park" and ten enumerated keys in the entity registry are all data now, and a ratchet
> over four files keeps them out. No row was migrated — `scouting_reports.data` was always keyed
> this way — and the registry's stopping enumerating fixed something enumeration made invisible:
> an unknown key was **dropped**, silently, while the row still saved. **D4(b)**: curated
> templates plus add/hide/relabel, keys namespaced `team.` so a team's `climb` can never become
> next September's official one, season-scoped, and carried over a roll **only when the game is
> the same** — which is both halves of D4's sentence. **D2**: `competition_events` with matches
> and participants as **rows**, because FRC is 3v3 and because a surrogate is a property of a
> participation; paste/parse with a preview that names what it ignored (`Ignored 2 number(s)
> after the teams (108, 11) — usually the scores`), and manual entry as the substrate. 75
> cross-tenant assertions on the four new tables, including B21's own shape and the season gate
> checked through a join. **`registration.spec.ts`'s intermittent failure is now diagnosed**: a
> route-guard redirect that discards intent on the confirmation path, 1 run in 24, ruled out as
> contention by a 12/12 control — the one-line fix is outside this sprint's IDs and is in §8.
