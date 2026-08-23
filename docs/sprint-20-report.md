# Sprint 20 — credentials and residue (SEC-17, SEC-13, WALK-A-12)

**Branch:** `v2/sprint-20-credentials-and-cleanup`
**Commits:** `cecc7fe..167982d` (three)
**Ratchets:** `as any` **56 → 55** (ceiling lowered), arbitrary Tailwind values 2 (unchanged), no
`describe.skip`, no assertion-free tests.

## Gate

Every stage run individually and green on the final state:

| Stage | Result |
|---|---|
| `lint` (`tsc --noEmit && eslint src`) | clean |
| unit | **1021 passed**, 2 skipped |
| integration | **95 passed** |
| build | ok |
| `db:assert` (schema assertions) | **passed** — and it caught a real mistake first, see SEC-17 |
| db | **632 passed**, exit 0 (was 626 — six new) |
| RLS | **418 passed**, exit 0 |
| e2e | **35/35** |

Chained `npm run gate:db` still aborts with exit 127 part-way through `test:db` on this machine.
That is the pre-existing issue recorded in the plan's §8 from Sprint 19 — **it reproduces on
`1610c0f`, before either sprint** — and it hit twice here, each time at a different suite and
never on a failing test. It also cost time in the way §8 predicted: an aborted run leaves fixture
teams at 30001+, and the next run then fails its first `createTeam` on `UNIQUE (program,
team_number)`. Both entries stand; nothing new learned about the cause.

## Scope, and why these three

D1, D5, D6 and D7 are still blank, which blocks pricing/Stripe, training content, the beta cohort
and the hosting decisions (OPS-07, OPS-09). These three are unblocked, small, and all touch what a
beta team's data is worth to somebody else.

**None of the three has an exit-criteria block** — I checked `docs/assessment-2026-08/
exit-criteria.md` rather than assuming, having got that wrong in Sprint 19's first draft. So the
definitions of done below are **mine**, stated before the evidence.

---

## SEC-17 — one invite-code generator, and it is a CSPRNG

**Definition of done (mine):** exactly one generator exists, it draws from the OS CSPRNG, both
creation paths produce codes indistinguishable from each other, and no client can choose or edit
a code — proved by issuing the write, not by reading a catalogue.

### The finding, restated with what actually mattered

Two generators for one concept:

| | Alphabet | Length | Source |
|---|---|---|---|
| `InviteManager.generateInviteCode()` | 32 symbols, no `I O 0 1` | 8 | `Math.random()` |
| `create_team_as_admin` | 16 hex | 8 | `md5(random())` |

~40 bits against ~32, and a support call about "the code doesn't work" could not be answered
without knowing which screen produced it. This is the same shape SEC-09 already found **in this
exact table** (`expires_at` written in two places), which is why the fix is a column DEFAULT
rather than a shared helper: a helper is still two call sites.

The length was never the real problem. An invite code is a **bearer credential** — it lands
whoever types it in a team's roster as `pending` — and neither RNG is cryptographic. V8's
`Math.random()` is xorshift128+, whose internal state is recoverable from a handful of outputs, so
a member generating a few codes for their own team could predict the codes another team generates
next. Postgres `random()` is a seeded PRNG with the same property, and `md5` of a predictable
input is a predictable digest.

### Verified

`src/test/db/invite-code-generation.db.test.ts`, 6 tests, against real Postgres:

| Criterion | Evidence |
|---|---|
| A code arrives without the client asking | Insert with no `code` at all succeeds; before this change that was a NOT NULL violation, which is *why* both call sites had to mint their own. |
| Both paths use the same generator | The registration path's code matches the panel path's on alphabet and length, and **is the row's code** (`RETURNING code INTO`) rather than a second value the RPC computed and happened to store. |
| No client can choose a code | An admin's insert with `code: 'ATTACKER'` is refused, `permission denied`. |
| No client can edit one | `update({ code: 'REWRITTN' })` refused — rotation is revoke-and-generate. |
| The narrowing was a narrowing | A roster manager can still change `max_uses`. |
| Uniform and unique | 500 codes: 500 distinct, all in the alphabet, all 32 symbols seen across 4000 draws. |

**Watched red, both directions.** Re-granting table-level INSERT: the two privilege tests fail
(2 failed / 4 passed). Dropping the column DEFAULT: the three generation tests fail (3 failed /
3 passed).

`& 31` rather than `% 32` for the symbol pick — identical here, since 32 is a power of two and the
byte is uniform. Written as a mask so the **assumption** is visible: a non-power-of-two alphabet
makes that line silently biased, and every code it produced would still look random.

### Two things the first draft got wrong

**1. `REVOKE INSERT (code)` was a no-op.** A column revoke cannot subtract from a table-level
grant. After it ran, `has_column_privilege('authenticated','invites','code','INSERT')` still
answered **true** — a control that reads as applied and does nothing. The table privilege has to
be revoked and re-granted per column, which is the mechanism Sprint 9 learned for
`managed_profiles.promotion_code`.

This is why the test issues the write as a real client. A catalogue assertion would have agreed
with the broken version — the same trap `docs/environment-divergences.md` §5 records, where a
`pg_proc` ACL assertion approved a REVOKE that did nothing.

**2. Revoking `anon`'s grants entirely was wrong, and `db:verify` said so.** It failed with
`Tables the API roles cannot use (missing GRANTs): invites (anon)`, and **the assertion was
right**. This repo has one boundary: CLAUDE.md principle 4 makes RLS the security boundary, and
grants answer only "can PostgREST use this table at all" — a question a rebuild once answered *no*
to for every table, which is why assertion 6 exists at all. `anon` is already refused here by
`can_manage_roster`; narrowing the grant on top is a second, weaker mechanism policing what RLS
already decides. Both API roles now get the same columns.

What is **not** bent to fit: `code` stays revoked from both. That is a different question — not
"may this role touch invites" but "may any client choose a credential" — and assertion 6 asks
`has_any_column_privilege` precisely so a deliberate column narrowing can coexist with it.

### The other two parts of SEC-17

**The orphaned preflight: deleted.** `supabase/tests/preflight_security_audit.sql` preflights
`20260317000000_database_security_audit.sql`, which lives in `_archive/pre-v2/` and is in no
environment's applied set — checked rather than assumed: the deployed commit `c1cec81` already
carries `20260816000000_v2_tables.sql` and the rest of the V2 set. Its checks are also now
structurally impossible (composite tenant FKs) or covered by 418 RLS tests and Sprint 19's CHECK
constraints.

**The assertion-23 rationale: already correct, no change.** SEC-17 says `team_seats_remaining` is
"allowlisted under a false rationale". It is not, any more —SEC-06's sprint fixed it. The comment
says both functions *left* the anon-executable set, neither name is in the allowlist array, and
`has_function_privilege('anon', 'team_seats_remaining', 'EXECUTE')` answers **false**. Verified,
not fixed.

**No new schema assertion for any of this**, deliberately. CI runs `test:db`, the behavioural test
is strictly stronger than a catalogue check, and shipping both would be two implementations of one
rule.

**`as any` 56 → 55.** `code` is optional in the regenerated types now, so the insert no longer
needs the cast. Ceiling lowered to match — the count only goes down.

---

## SEC-13 — the sign-up form says the same thing either way

**Definition of done (mine):** the message a person sees after submitting sign-up is identical
whether or not the address is already registered, it is true in both cases, and the identity is
enforced by construction rather than by two strings that happen to match.

**The leak was dormant, which is the interesting part.** "An account with this email already
exists" is a straight answer to *does this person have an account here?*, available to anyone with
the form and a list of addresses, on a product whose users are mostly minors. But with
`mailer_autoconfirm: false` — both environments,`docs/environment-divergences.md` §1 — GoTrue
returns an obfuscated fake user for an address it already knows, so that branch never fires. The
leak sat one dashboard toggle away, and SEC-14 is the finding about exactly that class of config.
Collapsing both branches into `SIGNUP_NEUTRAL_MESSAGE` makes the answer independent of the setting
rather than merely lucky.

The old success copy was three claims and all three were false for a returning user: no account
was created, no email is coming, nothing needs verifying. They wait, nothing arrives, and they
write to support — SEC-13's actual recorded cost.

**One constant, both branches.** Two strings that read alike are one edit from differing, and the
difference does not have to be large to be an oracle: a trailing full stop is enough to diff
across two submissions.

**The test changed, and what it used to assert *is* the finding.** It required the enumerating
string. It was correct about what the code did — and it was asserting a branch that cannot fire in
either environment, so it would have gone on passing whichever way the toggle went: green in the
safe configuration and green in the unsafe one. The replacement renders both paths and requires
the messages to be **character-identical** rather than both matching a pattern, since a pattern is
satisfied by two different strings. Watched red against the old message (1 failed / 10 passed).

---

## WALK-A-12 — sign-out really does empty the local database

**Definition of done (mine):** measure it, with a control that makes a passing result mean
something, and record the verdict either way.

**Verdict: not a defect.** `scripts/probe-signout-residue.mjs`, 6/6 on a real build:

```
while signed in : appState 2 rows (60 KB, roster with names and email addresses)
                  localStorage: ftc-current-user-cache, sb-127-auth-token
after sign-out  : appState 0, syncQueue 0, syncFailures 0
                  localStorage: (none)
                  FalconForgeDB still listed — Dexie keeping its schema, which is correct
```

The walkthrough's observation was accurate and its worry was not: the database name persisting is
Dexie keeping the schema. That is now **asserted**, so the next reader does not "fix" it.

Reading the code would not have settled this, and would have been misleading in both directions:
`clearAppState()` empties the store that holds team data, and directly beside it
`clearLocalDatabase()` clears only the sync queue and the dead-letter store.

**The control is the point.** Zero rows after sign-out proves nothing unless there were rows
before — a database that was never populated passes that check perfectly (`failure-modes` §7). So
the probe requires a non-zero count first and refuses to continue without one. It also searches
for a real teammate address rather than counting rows: `appState` is a single Zustand blob, so
"1 row" is its normal state whether it holds a whole team or an empty object, and a count cannot
tell those apart. **The first version of that content check was broken and reported a false FAIL
while signed in**; it was fixed only because the blob was dumped and the roster read out of it by
hand.

Object stores are enumerated from `objectStoreNames`, not listed in the probe, so a store added by
a future Dexie version cannot be invisible to it (`failure-modes` §12).

---

## Mistakes worth recording

- **`git checkout -- src/pages/Login.tsx` destroyed uncommitted work again**, mid-revert-pass, for
  the fourth time in this project's history. Recovered from the scratchpad scripts. Everything
  after that point was committed *before* the next revert pass, which is what the rule says.
- The residue probe's dump is a template literal, and a backtick inside a comment I added to it
  ended the string. One syntax error.
- `use_count: 0` was being sent by the invite panel while the column DEFAULT already said 0.
  Harmless until the grant narrowed, then a "permission denied" on a value the database was going
  to choose anyway. Same rule as `code` and `expires_at`: if the DEFAULT is the definition, the
  client does not restate it.

## Files

**New:** `supabase/migrations/20260828000000_sec_17_invite_codes.sql`,
`src/test/db/invite-code-generation.db.test.ts`, `scripts/probe-signout-residue.mjs`.

**Deleted:** `supabase/tests/preflight_security_audit.sql`.

**Changed:** `src/components/InviteManager.tsx`, `src/pages/Login.tsx`,
`src/pages/__tests__/Login.test.tsx`, `src/test/__tests__/harness-invariants.test.ts`,
`src/lib/database.types.ts`.
