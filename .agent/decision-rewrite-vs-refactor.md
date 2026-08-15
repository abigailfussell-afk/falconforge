# Decision Record — Rewrite vs. Refactor In Place

> **Date:** 2026-08-09 · **Status:** recommendation, pending your call
> **Recommendation:** **Refactor in place.** Rewrite the data layer only, behind a stable interface, on a branch.

---

## The question

The app was built by a different AI agent, has accumulated bugs, and feels structurally messy. Is it better to rewrite it cleanly on a new branch, or refactor what's there?

## Recommendation: refactor in place

Six reasons, specific to this codebase.

### 1. The bugs are in 6% of the code

All 16 defects found sit in ~1,000 lines of data layer. `store.ts` (695 lines) is at 91.9% coverage and no bugs surfaced. The eight oversized UI components have **zero** known bugs — they're hard to read, not broken.

Rewriting 16,530 lines to fix 1,000 is a 16× overreach. The parts you'd spend the most time re-creating are the parts that work.

### 2. Your git log is a list of things a rewrite would re-encounter

```
Fixed login back button
Fixed some supabase vulnerabilities
FIxed logout bug.
Fixed season not syncing.
Fixed stale logout deployment bug.
Fixed login redirect to landing page
Fixed the animation
```

Each of those is a bug someone hit, diagnosed, and fixed. They're invisible in the code — they look like ordinary lines. A rewrite discards all of them and rediscovers them the same way: in production.

The clearest example is [supabase.ts:24-46](src/lib/supabase.ts:24). That comment documents a real `navigator.locks` deadlock where the auth mutex is held across a hanging token refresh and every subsequent query deadlocks. That is expensive, hard-won knowledge. A clean rewrite hits it again, on a Saturday, at a competition.

### 3. The architecture is already right

I said this in the first review and it still holds. React + TS + Vite + Zustand + Dexie + Supabase is a good fit. The data model is plain Postgres with sensible entities. Offline-first with a sync queue is the correct pattern for competition venues.

So what would a rewrite actually change? Same stack, same schema, same RLS, better internal structure. **That's a refactor.** The delta between "rewrite done right" and "Rounds B–D" is mostly the UI components — the part with no bugs.

### 4. There's institutional knowledge encoded outside the TypeScript

- **8+ migrations** of accumulated RLS fixes (`009`–`015` plus the security audit), including a patched invite-code hole in `014`. Those policies are security-critical and were tuned by hitting real problems.
- **COPPA / attestation flows** — `attestations.ts`, age classification, nine attestation types, three legal pages. Legally significant and tedious to re-derive correctly.
- **OAuth setup** for Google and Microsoft, with redirect URLs and provider config.

None of this is fun to rebuild, and all of it is easy to rebuild *slightly wrong*.

### 5. The rewrite would be built with the same broken feedback loop

This is the one I'd weight most heavily.

The previous agent didn't produce these bugs through bad architecture. It produced them because **nothing could tell it they existed.** The test suite mocks out every module that contains a bug. `sync.ts` sits at 10% coverage. `transformers.ts` shows 100% coverage with three bugs in it.

Rewrite under that same loop and you get a fresh 16,000 lines with a fresh crop of bugs at similar density — except now you've also thrown away the characterization tests and the working baseline you'd use to detect them.

**Round A is required for both paths.** And once Round A is done, the case for rewriting largely dissolves, because you can finally see what's broken and change it safely.

### 6. The app is live

`falcon-forge.com` is serving real users. A rewrite means weeks of divergence: either the live app freezes or you maintain two versions. FTC season timing makes that risk concrete in a way it wouldn't be for a pre-launch project.

---

## What I'd do instead — "rewrite the part that deserves it"

You want it done right. Fair. Here's the version of that which doesn't throw away working code:

**Rewrite the data layer properly, module by module, behind a stable interface — on a branch, with the old implementation still running until each piece is proven.**

That's Rounds B–D, and Round D in particular *is* the rewrite. The entity registry replaces four ad-hoc conversion sites with one definition per entity. `sync.ts` gets restructured around a corrected protocol rather than patched. The difference from a from-scratch rewrite is that everything outside those ~1,000 lines keeps working the whole time, and every step is verifiable against the existing behavior.

Concretely, on a branch:

1. **Round A** — feedback loop + local Supabase (required either way)
2. **Rounds B–C** — fix data-loss and protocol bugs, each with a test that failed first
3. **Round D** — replace the data layer with the registry design; delete the old paths once round-trip tests pass
4. **Round E** — decompose UI components, one per commit, optional

Branch the whole thing if you like — `refactor/data-layer` — and merge when the gauntlet is green. You get the "done right" outcome and a working app at every commit.

---

## What would change my recommendation

I'd argue for a rewrite if any of these were true. None are:

| Condition | Reality |
|---|---|
| The data model is wrong | Plain Postgres, sensible entities, works |
| The stack is wrong | React/TS/Vite/Zustand/Dexie/Supabase is a good fit |
| No users yet | Live on falcon-forge.com |
| Auth/legal layer is trivial to rebuild | 8+ RLS migrations, COPPA flows, 3 OAuth providers |
| Bugs are diffuse across the codebase | 15 of 16 are in four files |

If, during Round F's sweep, the untouched 94% turns out to be as defective as the data layer, revisit this. That's a decision Round A gives you the instruments to make — and today, without those instruments, it would be a guess.

---

## Honest caveat

I've read the data layer line by line — roughly 6% of the codebase. `store.ts`, `auth.tsx`, `Onboarding.tsx` (0% coverage, 436 lines), and the components have not had that treatment. I'm not claiming they're clean; I'm claiming no bugs surfaced in what I did read of them, and that `store.ts`'s 91.9% coverage is meaningful validation.

The honest position is that the *known* bug distribution strongly favors refactoring, and Round A + Round F are how you find out whether the unknown distribution agrees. Rewriting now would be acting on a guess about the other 94% — and paying for it up front.
