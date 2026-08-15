# Hand-off — Sprint 5: UI system, density, and real navigation

Open a fresh Opus 5 session in `C:\Claude\falconforge` and give it everything below.

---

Read FALCONFORGE_V2_PLAN.md §5 (engineering rules — binding) and §6 Sprint 5, then
execute Sprint 5 under those rules. Branch v2/sprint-5-ui off main.

Read first, in this order:
  - docs/sprint-4-report.md    — what just landed, and what it leaves in your way
  - docs/v2-schema.md          — you are not changing the schema, but read the season
                                 section: read-only prior seasons are a DATABASE rule and
                                 your disabled controls are the UX in front of it
  - FALCONFORGE_V2_PLAN.md §8 parking lot — six items name Sprint 5 by name

This is the first sprint since Sprint 3 whose exit criteria need KEVIN, not just a green
suite: screenshots at 375 / 768 / 1280 for every main view, and his look-and-feel review
before merge. Plan for that — do not merge on your own judgement of the design.

TWO DECISIONS ARE KEVIN'S, NOT YOURS. Ask before you start; do not infer.

  1. **Tailwind v3 -> v4.** The parking lot defers this to your sprint "where the design
     tokens are being reworked anyway and visual diffs are expected". v4 renames or drops
     utilities this markup uses (`shadow-sm`, `outline-none`, `bg-opacity-*`, `flex-shrink`)
     and changes the default border colour and ring width. It is the difference between a
     token pass and a token pass plus a framework migration, three weeks from kickoff.
  2. **Inter.** `index.css` sets Inter on `body`; `App.tsx` re-applies Tailwind's default
     system stack over it, so `font-sans` has never actually resolved to Inter. Either add
     it to `tailwind.config` or drop it. Both are defensible and both are a visible change.

ONE BULLET IN YOUR BRIEF IS ALREADY DONE. Sprint 5's plan says "checklist actions collapse
to one `updateChecklist(fn)` helper" — Sprint 3 did that; there is one helper in `store.ts`
and six thin callers. What is still outstanding in that bullet is the rest of it: split the
remaining store domains into typed slices, and merge `user-context` into the auth context.
`useCurrentUser` has four component consumers plus `member-utils.ts`, and four test files
mock it.

Sprint 4 context you cannot infer from the code alone:

  - **`Sidebar.tsx` duplicates more than the nav.** The nav list is rendered twice
    (desktop rail, mobile drawer) and so is the SEASON PICKER — `season-selector` and
    `mobile-season-selector`. That picker is the only season control in the entire app, and
    everything Sprint 4 built (rollover, archival, read-only browsing) is reachable only
    through it. A single responsive Sidebar must keep it reachable at every breakpoint;
    losing it on mobile makes last season unreachable at a competition, which is the exact
    venue this app is for.

  - **`Dashboard.test.tsx` is the only test that renders the real `App`,** and it asserts
    with `getAllByText(...).length > 0` precisely BECAUSE the nav is duplicated. When the
    single-nav rewrite lands, tighten those to `getByText` — that tightening is the test
    that proves the duplication is gone, and it is worth more than the rewrite itself.
    Its `switches active tab when clicking a nav item` case becomes a route assertion.

  - **`ArchivedSeasonBanner` renders ONCE, in the shell, above the tab switch in
    `App.tsx`.** It is there rather than in five feature components on purpose. Whatever
    replaces the tab switch must still render exactly one of it on every season-scoped
    route.

  - **Every view reads its season through `useSeasonScope()` / `useSeasonScoped()`**
    (`src/lib/season-scope.ts`). `React.lazy` per feature is fine; re-inlining
    `x.seasonId === currentSeasonId` into a component is not. Six copies of that filter
    were deleted in Sprint 4 and one of them turned out to be missing entirely, which is
    how a whole season of scouting reports had been leaking into the next season's list.

  - **The disabled controls carry `title="This season is archived and read-only"`.** That
    title is the only explanation the user gets for why a button does nothing. A density
    pass that strips titles turns a considered refusal back into a dead button.

  - **`transformers.ts` is now deletable.** The Sprint 2 note saying it has "two remaining
    callers' worth of value" is stale — it has exactly one caller left and it is a test
    (`match-number-optional.test.ts`). Re-point that test at the registry and delete the
    shim.

  - **Store slices carry Sprint 4's archived-season write guards.** `addTask`,
    `updateTask`, `deleteTask`, the scouting and match-plan actions, `updateChecklist` and
    the sub-team actions all call `canWriteToSeason` before touching state or the queue.
    If you extract more domains into slices, those guards travel with them. There are tests
    that fail if they do not (`src/lib/__tests__/season-lifecycle.test.ts`), which is the
    point.

Numbers you will want:

  - **49 arbitrary Tailwind values** in `src/**/*.tsx`. The biggest cluster is
    `text-[10px]` (11 uses) with `text-[11px]` (4) behind it — your type scale needs a step
    below `text-xs`, or those become inconsistent one at a time.
  - **`index.css` line ~101** holds the `@media (pointer: coarse)` block forcing
    `min-height/min-width: 44px`. The brief wants that opt-in per component instead of the
    broad attribute-substring selector it currently uses.
  - **Coverage thresholds are 68 / 63 / 64 / 70** (statements / branches / functions /
    lines) in `vitest.config.coverage.ts`. Ratchet, never lower — deleting a well-tested
    component and replacing it with an untested one shows up here and is meant to.
  - **`vite build` warns that `offline-db.ts` is both statically and dynamically imported,**
    defeating its own code-split. Your `React.lazy` routing work is the natural fix.

Sprint 4 added test ids the suite depends on: `archived-season-banner`, `start-new-season`,
`wizard-*`, `season-row-*`, `toggle-archive-*`, `save-checklist-template`, `scout-match`,
`add-sub-team`, and `save-plan-desktop` / `save-plan-mobile`. Keep them or change them
deliberately with the tests. Note that last pair: `MatchPlanner` has its own duplicated
desktop/mobile controls, which is the same defect as the Sidebar one level down, and is
fair game for your dedupe pass.

Three things outside your scope that may bite you:

  - **`.env.local` points at the HOSTED project. Do not overwrite it** (Sprint 2 did, and it
    was unrecoverable). For local work write `.env.development.local`, which takes priority
    in dev mode and is gitignored, and delete it when you are done. There is a `dev` config
    in `.claude/launch.json` on port 5188.
  - **Check whether `20260817000000_v2_season_lifecycle.sql` has reached production before
    you assume the hosted schema matches your local one.** If it has not, say so rather
    than pushing it — it is Kevin's call, and the ordering matters (migration first, then
    the bundle: the client writes `game_title` and `is_archived` on every season upsert).
  - **A stale dead-letter can survive a local database reset** in the dev browser profile.
    Sprint 4 hit one from Sprint 3's walkthrough. If the sync indicator offers "Retry it"
    before you have done anything, check IndexedDB before believing you broke something.

Rule 10 is the one that mattered most in Sprint 4, and it will matter differently for you.
Breaking each invariant on purpose found a test that passed for the wrong reason and a code
comment that claimed more than the code did — but the defect that mattered most was found
by RUNNING THE APP, not by the suite: a write the UI offered and the server refused, with
320 green database assertions over it. For a UI sprint the equivalent is not screenshots of
the happy path. It is the empty state, the long team name, the archived season, the
offline banner, the 375px viewport with the keyboard open. Go and look at those.
