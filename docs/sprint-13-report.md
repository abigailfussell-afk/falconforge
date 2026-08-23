# Sprint 13 — Package D, "beta logistics"

**Package:** D — beta logistics (Phase 0), from `HANDOFF_ASSESSMENT.md` §"Sprint packages".
**IDs:** OPS-06, LAND-01, LAND-02, LAND-03, OPS-11, OPS-03, the feedback-body half of OPS-05,
and the plan §9.2 corrections not already made by Package A.
**Branch:** `v2/sprint-13-beta-logistics`, off `main` at `5e924d2` (Sprint 12 merged first).
**Commit range:** `326e038..60375fd` (four commits; a fifth adds this report and the plan lines).
**`supabase/` touched:** no.

---

## 1. Gate output

```
$ npm run gate

> falconforge@0.1.0 lint
> tsc --noEmit && eslint src

> falconforge@0.1.0 test:run
> vitest run
 Test Files  65 passed (65)
      Tests  791 passed | 2 skipped (793)

> falconforge@0.1.0 test:integration
      Tests  95 passed (95)

> falconforge@0.1.0 build
✓ built in ~5s
```

Unit 772 → 791. `as any` unchanged at 56; arbitrary values unchanged at 2.

---

## 2. Per ID

### OPS-03 — every deploy carried the same build id

`BUILD_ID` was `'0.1.0'` plus a `-dev` suffix, from a `package.json` version unchanged since
2026-01-02 and carried identically by eighteen production deploys — under a comment saying the
id exists "so a report is attached to a version rather than to 'last Tuesday'".

`vite.config.ts` defines `__BUILD_ID__` from `GITHUB_SHA`; `src/lib/build-id.ts` reads it behind
a `typeof` guard so a consumer outside the Vite pipeline cannot throw while composing a mailto.

**A local build says `local`, deliberately.** The old comment's own defence of `0.1.0` was that a
coarse honest id beats a wrong-looking SHA; the lesson is the opposite of what it concluded — a
plausible-looking wrong answer is worse than an obviously partial one. If a beta report ever
says `local`, "somebody deployed by hand from a laptop" is a conclusion worth being able to draw.

**Verified end to end**, not assumed: `GITHUB_SHA=$(git rev-parse HEAD) npm run build`, then
grepped `dist/assets/index-*.js` for the short SHA — present, once.

`check-production.mjs` gained a check that the served bundle carries the expected SHA. That
retires the hand-run "normalise the chunk hashes and diff" comparison, which
`docs/environment-divergences.md` §8 records as failing for reasons unrelated to the deploy and
equally passing while hiding a real difference. With no `GITHUB_SHA` in the environment it
reports rather than fails, because "what is deployed right now?" is what somebody running it by
hand is asking.

### OPS-05 — the feedback-body half

> **Fix direction:** the feedback `mailto:` body should auto-include build id, route,
> `navigator.onLine`, team id, pending-queue and dead-letter counts.

All six, plus one the finding could not have asked for: **whether the server was actually
answering**, which is a different question from `navigator.onLine` and is the whole of SYNC-07.
An email that says only `online: yes` sends somebody looking at the wrong layer.

It is a hook (`useFeedbackLink`) rather than the module constant it replaces, because every one
of those is a fact about *now*, and an installed PWA is not reloaded on a schedule — a constant
computed at module load reports the state the app was in when it started, which could be days
ago. There are two feedback links (the sidebar and Getting started) and one hook, so they cannot
drift into carrying different information.

**What it must not carry is asserted, not just intended.** Nine tests, including one that walks
every line of the context block and fails on any key outside the fixed set, and one that
extracts every email address in the whole mailto and requires the only one to be the recipient.
A support inbox is not somewhere minors' data should arrive by accident. The body also tells the
reporter what it is attaching, because attaching diagnostics silently to somebody's email is not
on.

The rest of OPS-05 — the `client_errors` table and the uptime check — is Package G's.

### OPS-06 — onboarding email ceiling

> **`Login.tsx` maps "Error sending confirmation email" and "email rate limit exceeded" to a
> plain-language message with what to do; red test: Login test asserting the mapped copy.**

Met. Both, plus "Error sending recovery email" (the same ceiling reached through a password
reset). The copy says the failure is *our limit, not your details* — the raw string reads exactly
like a rejected email address, which is the wrong conclusion to hand a coach standing in front of
twenty students — and says when to come back.

Everything unrecognised passes through unchanged. That is deliberate: GoTrue gives these no error
code, so the match is on the message string and is fragile to an upstream rewording. Falling back
to the original means a rewording costs the user nothing they were not already getting, instead
of a friendly sentence about the wrong problem. **The control test asserts exactly that.**

**Watched red:** with the mapping bypassed, both cases fail and the control stays green.

> Either Resend Pro is active … or the beta onboarding schedule in `beta-ops.md` caps teams per
> day at the computed ceiling.

**Not done — this is an account change and it is Kevin's.** The arithmetic stands: 100 emails/day,
~23 per 20-member team, so four teams per calendar day. Nothing in this branch changes it.

### LAND-01 / LAND-02 / LAND-03 — landing page truth pass

> **Footer links to `/#/legal/terms`, `/#/legal/privacy`, `/#/legal/community`,
> `mailto:support@…`; "Not affiliated with FIRST" line; "FIRST® Tech Challenge" named in the
> hero.**

All met. Measured in the built bundle at 375 px:

```
6 anchors: #/login?mode=signup, #/login, #/legal/terms, #/legal/privacy,
           #/legal/community, mailto:support@falcon-forge.com
#/legal/terms     → "Terms and Conditions"
#/legal/privacy   → "Privacy Policy"
#/legal/community → "Acceptable Use"
"not affiliated with" present · "Tech Challenge" present
document.documentElement.scrollWidth === 375  (viewport 375) — no horizontal overflow
```

The two hero calls to action became anchors, which is what they always should have been: they
navigate to a route, so they should be middle-clickable, openable in a new tab and copyable into
the Discord thread this page will be posted to. A `<button onClick>` can do none of that — and it
is invisible to anything counting the page's links, which is how a marketing page reaches zero
`<a>` elements without anybody noticing.

**Worth recording:** the two existing "navigates to login" tests kept passing across that change,
because `getAllByText(/Log In/i)[0]` is the *header's* button. The hero CTAs had no coverage at
all. They do now.

> **Every feature claim on the page exists in the app: remove/rewrite the eight phrases listed in
> LAND-03.**

All eight gone, verified against the rendered page rather than the source. The replacement copy is
more differentiating than what it replaced: "works with no Wi-Fi at all, which is what a
competition venue actually gives you" is true, and "Data-driven alliance selection" was not.

> **Add a source-level test … that `Landing.tsx` does not contain the overclaim phrases.**

Done, in `harness-invariants.test.ts` alongside the existing "guidance describes the repo"
ratchets, plus three more: the legal links and the ≥5 anchor count, the program being named, and
the trademark disclaimer. The overclaim test's failure message says what to do when a phrase has
since been *built* — delete it from the list in the same commit — because the alternative is
somebody deleting the assertion to get green.

Pricing says only **"Free during the 2026–27 beta"**, per the handoff's instruction while **D1**
is undecided. Nothing else about price appears anywhere on the page.

### OPS-11 — README truth pass

All six false claims corrected:

| Claim | Reality |
|---|---|
| "Running in Demo Mode … no account required, works completely offline" | There is no demo mode. With no credentials the app renders "Supabase Not Configured" and stops — `Login.test.tsx` asserts it. Section deleted. |
| "Node.js v18 or higher" | vitest 4 / jsdom 27 / plugin-react 5 need ≥20.19; v18 fails at install. Now `engines` + `.nvmrc`, so it is enforced. |
| `supabase link … && supabase db push` | Has not worked on this migration history since the Sprint 2 squash. |
| "Enable Google OAuth / Microsoft OAuth" | Nothing calls either; dead code in `auth.tsx`. The section configured providers you could not reach. |
| "exactly one arbitrary value left in `src/`" | Two. The prose now points at the ratchet instead of restating a number. |
| "six flows … seven specs" | Five spec files, 21 tests. |

Quick Start rewritten around the local Docker stack, which is the route that actually works.
`.env.development.local` was mentioned nowhere in the setup despite being the file local work
needs, and the README pointed at `.env.local` — which is **production**. `.env.example` now
carries the local stack's own credentials, says which file to copy it to and why, and loses
`VITE_STRIPE_PUBLISHABLE_KEY`, which nothing reads. `tsconfig.json` stops including `components`
and `services`, directories that do not exist.

**README joins the ratchet** that every `npm run <script>` named in the agent-facing docs must
exist. It is the file a fresh clone follows first and the one that had drifted furthest.

> licence decided.

**Not decided — corrected instead, and escalated.** README has said "MIT" since the first commit
with no `LICENSE` file to match, so the claim was unenforceable in both directions. For a product
intended to be paid, MIT would let anyone run a competing instance; that is a decision, not a
default. The README now says no licence is granted and the code is source-available for review,
and it is in the parking lot as Kevin's. **This should be settled before the repo is shown to a
beta cohort.**

### Plan §9.2 corrections

| Line | Status |
|---|---|
| SEC-02 "✅ RESOLVED" | Already corrected by Package A. |
| "the app never deletes a member" | Already corrected by Package A (plan and `beta-ops.md`). |
| §3 "traffic will not come close to any limit" | **Corrected here**, with SYNC-03's measured numbers: 863.8 KB per app open, ~2.28 GB/month for one team, against a 5 GB allowance shared by all of them — about two teams. Sprint 11 moved the wall rather than removing it, and the line now says what to watch. |
| "coverage thresholds are enforced by nothing" | **Corrected here** — they are also now *failing* by ~10 points (OPS-01), so enabling enforcement is no longer a no-op commit. Package G owns it. |
| CLAUDE.md "592-test suite" | **Corrected here** — over 1,400 across the three suites, which changes the ratio not at all, and the sentence now says so. |
| `team_seats_remaining` allowlist rationale | Already corrected by Package A's SEC-06 work; the comment in `schema_assertions.sql` is accurate. |

---

## 3. Decisions consumed

- **D1 (pricing) — blank, and used per the handoff's instruction:** the landing page says "Free
  during the 2026–27 beta" and nothing else about price. Nothing in this branch presumes a model.
- **D7 (hosting and tier triggers) — blank, and it blocked one item.** The `docs/beta-ops.md`
  trigger text is untouched; the two edits waiting on it are in the parking lot with the exact
  wording the decisions file proposes.

D2–D6, D8 and D9 were not needed.

---

## 4. Discovered → parking lot

Four entries added to `FALCONFORGE_V2_PLAN.md` §8:

1. **The licence is undecided** and now says so. Kevin's, and it should be settled before the
   repo is shown to a beta cohort.
2. **`beta-ops.md`'s trigger text waits on D7** — both edits are one line each once the decision
   line is filled in.
3. **`Landing.tsx` is 1,050 lines**, the largest component in the repo, mostly animated CSS mock
   widgets. LAND-05/06/07/09 all touch it and whoever takes them should expect to split it first.
4. **The GoTrue error mapping is a substring match**, because GoTrue gives these no code. If
   Supabase ever exposes one, this should move to it.

---

## 5. What was **not** done, and why

- **Resend Pro, or a staggered onboarding schedule.** An account change and a scheduling
  decision — Kevin's. The arithmetic is unchanged: four teams of 20 per calendar day.
- **The `beta-ops.md` trigger text.** Blocked on D7.
- **The licence.** Blocked on Kevin; corrected to "undecided" rather than left claiming MIT.
- **The rest of OPS-05** — the `client_errors` table and the uptime check — is Package G's.
- **LAND-04 through LAND-09.** Not in Package D's ID list.
- **No browser pass beyond the landing page.** The other changes in this package are a mailto
  string, an error message and documentation; the landing page is the only visual surface, and it
  was measured at 375 px.
