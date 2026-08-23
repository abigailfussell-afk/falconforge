# Sprint 15 — WALK-A-06, the one unblocked ID in Package E

**Package:** E — "BIOBUZZ readiness", from `HANDOFF_ASSESSMENT.md` §"Sprint packages" — **one ID
of it**, not the package.
**ID:** WALK-A-06 (scouting input validation).
**Branch:** `v2/sprint-15-scouting-validation`, off `main` at `8449751` (Sprint 14 merged first).
**Commit range:** `561ddf7..` — one code commit; a second adds this report and the plan lines.
**`supabase/` touched:** no.

---

## 0. Why one ID and not the package

Package E's brief says it **depends on decision D4** (scouting customisation depth), and
`docs/assessment-2026-08/decisions.md` D4 is still a blank line. Guardrail 3 is explicit: *"If
`decisions.md` has a blank line the package depends on, stop on that ID and ask."* On that ID —
so P-01 phase S stops, and P-02 stops behind D2 as well.

WALK-A-06 depends on neither. Its exit-criteria block covers only the validation half (the block
itself says "S, or folded into P-02"), the game-schema and filter halves being P-02's. It has
written criteria, needs no migration, and is Gate-only. So it is the part of Package E that can
be done honestly today, and it is done; the rest of E waits for Kevin.

**Package F is untouched and blocked the same way** — D3 (trial length) and D9 (under-18
nomination gate) are both blank, and unlike D4 they gate every ID in that package.

---

## 1. Gate output

```
$ npm run gate

> falconforge@0.1.0 lint
> tsc --noEmit && eslint src

> falconforge@0.1.0 test:run
 Test Files  68 passed (68)
      Tests  831 passed | 2 skipped (833)

> falconforge@0.1.0 test:integration
 Test Files  9 passed (9)
      Tests  95 passed (95)

> falconforge@0.1.0 build
✓ built in 5.06s
```

`GATE=0`. Unit 806 → 831 (+25: 19 in the new validation module, 6 in the form's suite).
`as any` unchanged at **56**; arbitrary Tailwind values unchanged at **2**.

```
$ npx playwright test
  33 passed (59.9s)
```

31 → 33: the new geometry spec runs in both projects. `npm run test:db` not run — nothing in
`supabase/` changed and no policy or schema is involved.

---

## 2. The ID

### WALK-A-06 — scouting input validation

> Team # 1–5 digits, match # ≥ 1, notes capped; long values wrap on the card. Red test: form
> rejects the three adversarial inputs from the walkthrough.

**"Team # 1–5 digits"** — `checkTeamNumber` in `src/lib/scouting-validation.ts`: required, digits
only, at most five. The input carries `maxLength={5}` and `inputMode="numeric"`, and the rule is
enforced independently of both, because `maxLength` does not stop a paste on every browser and
does not stop a sign, a space or an emoji at any length.

**Kept as text, deliberately.** A leading zero is not a rounding error — `0123` and `123` are two
different teams on a pit board, and this app stores the number as text elsewhere. Parsing here
would merge them. There is a test for that specifically.

**"match # ≥ 1"** — `checkMatchNumber`: a whole number from 1, `undefined` when not recorded.

This is the half of the finding worth dwelling on. `-5` was not refused before; it was **accepted,
discarded, and rendered as "No match #"** — the same words that mean "the scout did not record
one". A scout at a venue types a number, sees the card say it is missing, and has no way to tell
whether the app refused it or they mistyped. That is `docs/failure-modes.md` §4 (absence used as
a value), and it is the same shape as the fabricated "Match 0" that B18 already guards on the way
out. The rule now is: say no out loud, or store what was typed — never both accept and drop.

Blank and `NaN` are deliberately *not* errors. A cleared `<input type="number">` produces `NaN`
on its way to empty, and "not recorded" is a legitimate answer; conflating either with `-5` would
break B18's behaviour to fix this one. `match-number-optional.test.ts` still passes untouched.

**"notes capped"** — 500 characters, `maxLength` on the textarea plus the rule, with a counter
that appears at three-quarters full. Not always: a counter on an empty box is a limit announced
to somebody who was not going to reach it.

**"long values wrap on the card"** — `min-w-0` on the card's left flex child and `shrink-0` on
the match badge, `break-words` on the team number, event name and notes. The cause was never the
string: a flex child defaults to `min-width: auto` and refuses to shrink below its content, so
the long value pushed the badge out past the card's own edge. Validation does not make this safe
— it protects reports written from now on, while the walkthrough's 21-character number is already
in databases and the event name has no length rule at all.

**Where the rules live.** In a module, not in the form's `onChange`. The form is not the only
writer: the sync engine replays queued reports, and a rule that exists only in a handler is a
rule the round trip does not have.

---

### Red-test observations

**`ScoutingReports.test.tsx` → `refuses the values the walkthrough got in` — seen red.** With
`canSave` reverted to `hasTeamNumber` in both the button and the save handler, all three failed:
the pasted team number, the `-5`, and the 5,000 characters. The two control tests in the same
block stayed green, which is the point of having them — three tests asserting "Save is disabled"
are all satisfied by a Save button disabled forever, and a scout unable to file any report is a
worse bug than the one being fixed.

**`scouting-validation.test.ts`** — 19 tests, the first three quoting the walkthrough's values
verbatim rather than invented edge cases.

**`team-lifecycle.spec.ts` → `a long value wraps inside the report card` — seen red, on the
second attempt, and the first attempt is the finding.**

The first version of this test used a 56-character event name and **passed with the layout fix
reverted**. It was decoration — `docs/failure-modes.md` §0 — and nothing but reverting the fix
would have shown that. The value was simply not long enough to overflow the card.

At 120 characters, with `min-w-0`, `shrink-0` and `break-words` removed:

```
Error: the match badge is outside its card
  Expected: <= 485      Received: 1103.8125    [chromium, 1280px]
  Expected: <= 371      Received:  863.8125    [mobile, 390px]
```

618px outside a 485px card, 492px outside on mobile. Restored, green in both projects. The
tolerance is one pixel for sub-pixel rounding and no more: the defect is measured in hundreds, so
a generous tolerance would pass on the broken version.

---

### What running the app found that the suite did not

Built against the local stack (`npx vite build --mode development`, verified: `127.0.0.1:54321`
present in the bundle, no `supabase.co` anywhere in `dist/assets`), service worker unregistered
and caches cleared, and the loaded script filename checked against `dist/index.html` before
measuring anything.

Typing the walkthrough's three values into the running app at 375 px:

| | value | result |
|---|---|---|
| Team # | `-12345678901234567890 🦅` | refused — "Digits only — no spaces, signs or symbols" |
| Match # | `-5` | refused — "Match numbers start at 1" |
| Notes | 5,000 chars | refused — "Notes are capped at 500 characters" |
| Save | | disabled, title carrying the field's own message |

Two things came out of it that the suite had not:

1. **The counter read `-4500 left`** after a paste that got past `maxLength`. A negative
   allowance is a number pretending to be a budget. It says `4500 over` now, and there is a test
   for the branch.
2. **No horizontal overflow at 375 px** — `document.documentElement.scrollWidth` 375 against a
   375 px viewport, with all three error messages inside the modal (right edges 176/335/335
   against the modal's 375).

---

*Effort:* estimated S. Actual S.

---

## 3. Decisions consumed

**None** — and that is the reason this sprint is one ID rather than a package. D4 is blank and
Package E's other IDs need it; D2 is blank and P-02 needs it; D3 and D9 are blank and Package F
needs both.

---

## 4. Discovered → parking lot

Two entries added to `FALCONFORGE_V2_PLAN.md` §8:

1. **The event name has no length rule** and is the remaining unbounded string on the card. The
   layout now survives it, which is why this is a parking-lot line and not a change: capping it
   is a product decision (event names are genuinely long) and belongs with P-02's form work.
2. **The reports page still has no filter, sort or search** — the other half of WALK-A-06's
   finding, explicitly P-02's and blocked on D2. At an event with 30+ teams × 5 matches there is
   no way to find a team's reports, which is the finding's actual impact line.

---

## 5. What was not done, and why

- **Package E's other IDs** — P-01 phase S needs D4; P-02 needs D2 and a migration. Both blank.
- **Package F, entirely** — D3 and D9 blank, and they gate every ID in it.
- **The DECODE-specific scouting fields**, the field-image coupling, and the filter/sort work —
  all P-02, all named in WALK-A-06's finding but outside its exit-criteria block, which covers
  the validation half only.
- **`npm run test:db`** — nothing in `supabase/` changed.

---

## 6. One line for the plan §8 Progress log

Added — the `2026-08-23 | Sprint 15 — WALK-A-06` row, recording the one-ID scope and why, the
`-5`-as-"No match #" defect, the geometry test that first passed with the fix reverted, and the
two things the built app found that the suite did not.
