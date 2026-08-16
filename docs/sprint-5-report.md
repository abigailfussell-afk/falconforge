# Sprint 5 — UI system, density, and real navigation · Report

**Branch:** `v2/sprint-5-ui` (local only — not pushed, no PR)
**Date:** 2026-08-15
**Baseline:** verified green before any change — lint clean, 324 unit, 87 integration, build ok
on `main` first, matching the Sprint 4 report exactly. Everything below is measured from there.

**`supabase/` was not touched.** No migration, so no `db:verify` and no `test:rls` in the Gate.
The schema this sprint runs against is the one Sprint 4 froze.

---

## Kevin's two decisions, and what they bought

Both were asked before anything started, as the hand-off required.

**Tailwind stays on v3.** v4 renames or drops utilities this markup is authored against and
changes the default border colour and ring width — a framework migration on top of a token
pass, three weeks from kickoff, on the one sprint whose output is directly visible. It would
also have mixed two sets of visual diffs in the screenshots you have to review. Back in the
parking lot, retargeted post-beta.

**Inter becomes real**, self-hosted. This turned out to be two fixes rather than one — see
below.

**Deploy stays as it is**, decided at merge time. `deploy.yml` is untouched; merging still
publishes to falcon-forge.com, so the review has to happen on the branch.

---

## The headline

The app is a set of real URLs with one navigation definition behind them, sized for a tool
rather than a landing page.

`#/app/board` is bookmarkable, the back button walks the views, and each feature loads on
demand — the main chunk went **402.42 kB → 287.60 kB** (gzip 102.49 → 79.50). The sidebar is
one element instead of two, and the test that proves it is `Dashboard.test.tsx` asserting each
nav entry appears **exactly once**.

---

## 🔴 Inter was broken in two ways, not one

The hand-off named one: `index.css` sets Inter on `body` and `App.tsx`'s `font-sans` re-applies
Tailwind's system stack over it, so `font-sans` never resolved to Inter.

The half nobody had noticed is in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700..." rel="stylesheet">
```

A render-blocking cross-origin stylesheet plus two DNS handshakes **on every cold load**, for
a webfont that `font-sans` then overrode so it never rendered a single glyph. It is the same
defect class as C1 (the Tailwind Play CDN) one layer down: not precached, so a cold offline
start could not have used it anyway.

Both halves are fixed. Inter is bundled (`src/styles/fonts.css`, two latin subsets, +131 KB
precache — the `unicode-range` means a browser downloads 48 KB unless the page actually
contains Eastern European characters) and `font-sans` resolves to it. The two dead
`runtimeCaching` rules for `fonts.googleapis.com` / `fonts.gstatic.com` went with it: a runtime
cache is only ever a mitigation for a cross-origin dependency, and it does nothing on the first
load, which is the load that happens at a venue.

Verified in the browser: **zero requests to any Google origin, two font faces total, `font-sans`
computing to `"Inter Variable"`.**

---

## What changed

### 1. Design tokens — the type scale is retuned, not extended

`text-sm` is 13px and `text-base` is 14px, against Tailwind's 14 and 16.

Retuning the existing names rather than adding a parallel `dense-*` set is the decision that
makes the density pass actually reach every view: the app has roughly 1500 existing type
utilities, and a scale nobody has to opt into applies everywhere on the first render. The steps
keep their order and proportions, so nothing needed reflowing.

`text-2xs` (11px) is the new step **below** `text-xs`. It exists because there wasn't one — 15
arbitrary `text-[10px]`/`text-[11px]` values had accumulated in its place, each chosen
independently, and they were drifting apart.

**One pairing is load-bearing and is commented as such in both files.** iOS Safari zooms the
viewport when a focused input computes below 16px, and does not zoom back out. A 14px
`text-base` would therefore make every text field on an iPhone yank the layout sideways — at a
competition, with the keyboard open. `index.css` floors form controls at 16px under
`pointer: coarse`. Do not change either alone.

**49 arbitrary values → 1.** The survivor is `sm:w-[calc(33.33%-1.5rem)]` on Landing's animated
card, which is not a size but the width of one of three flex columns minus their gap; a token
would name a number that only means something relative to that layout. It carries a comment
saying so.

`forge-*` names the brand ramp. The values are **asserted byte-identical** to Tailwind's
`orange-*`, so renaming 223 occurrences across 22 files is a provable visual no-op — the brand
gets a name without a pixel changing.

### 2. The coarse-pointer rule is opt-in, and what the old one was really doing

`index.css` carried a `@media (pointer: coarse)` block matching `button[class*="bg-"]`,
`button[class*="p-"]`, `a[class*="border-"]` and friends, forcing 44×44.

As a substring match on the class **attribute** it could not tell a utility from a coincidence:
`p-` matched `px-2`, `py-1`, `placeholder-slate-400` and `pointer-events-none`; `bg-` matched
`bg-transparent` and, via `hover:bg-slate-50`, essentially every interactive element in the
app. On a phone that forced the sub-team chip and the date stamp inside a task card to 44px
wide, which is a good part of why the board felt cramped there. It also could not be overridden
locally without `!important`, because nothing in the markup could see it coming.

`touch-target` is the same 44px promise, asked for by the component that actually is a primary
action — visible in the markup, reviewable, and declinable by a control that should be small.

### 3. One Sidebar, and the test that holds it

There were two: a `hidden lg:flex` rail and a `lg:hidden` fixed overlay, each with its own nav
list, its own season `<select>`, its own theme toggle, user card and team switcher. They had
already drifted — the rail grouped the nav with separators and the drawer did not; the rail's
sign-out carried `title="Sign out"` and the drawer's did not.

Now one `<aside>`: a static rail at `lg`, a fixed off-canvas drawer below it. `navigation.ts`
holds the one definition the rail, the drawer and the route table all render from.

**The season picker is reachable at every width by construction**, because there is one of it.
Verified in a browser at 375px: with the drawer open it sits at x=12–275 in a 375px viewport.
That mattered enough to pin with its own test — it is the only season control in the app, and
everything Sprint 4 built is behind it.

`Dashboard.test.tsx`'s `getAllByText(...).length > 0` assertions are now `getByText`, plus a
per-view `getAllByTestId(...).toHaveLength(1)`. Those assertions were not defensive style
before; they were load-bearing, because every label genuinely appeared twice.

### 4. Real routes

`useState('dashboard')` and a chain of `activeTab === '...' &&` became a nested route table
under `/app`, each view behind `React.lazy`. `switches active tab when clicking a nav item`
became a route assertion, joined by deep-link tests for all six views, a back-button test, and
a redirect test.

`ArchivedSeasonBanner` still renders **exactly once**, above the `<Outlet>` — the same position
it held above the tab switch, for the same reason. Verified in a browser on all five
season-scoped routes, and pinned by a test that asserts exactly one on a non-default route.

### 5. Store slices and one profile source

Four more domains (team/entitlement, scouting, checklist, match plans) joined tasks, sub-teams
and seasons in `slices/`. All seven now take typed `set`/`get` instead of `(set: any, get: any)`
— rule 4 asks for that specifically. Sprint 4's `canWriteToSeason` guards travelled with their
domains and `season-lifecycle.test.ts` stayed green over the move.

`resetToDefaults` is composed from each slice's own initial state rather than a hand-maintained
list of fourteen keys. A key forgotten there is not cosmetic — it is the previous user's data
still on screen after someone else signs in on a shared team laptop.

**`user-context` is merged into the auth context**, and it was hiding a real bug.
`CurrentUserProvider` nested inside `AuthProvider`, derived its inputs from `useAuth()`, then
made its own `users` read and kept its own localStorage cache of the same person. Two sources
for one row — and they disagreed visibly: `updateProfile` wrote a new full name into auth state
immediately, while the roster and the task activity feed rendered from the separately-cached
copy until the next auth event. **Renaming yourself changed your name in the sidebar and not on
your own comments.** One read now (the profile columns merged into the select that was already
fetching `age_classification`, so sign-in makes one round trip to that row instead of two), one
cache, cleared from both the `SIGNED_OUT` handler and `performSignOut`.

### 6. Two shims and a third sign-out

`transformers.ts` is deleted — its last caller was a test, so the shim existed only to be
tested. `match-number-optional.test.ts` asserts against the registry directly, which is where
B18 actually lives.

**`JoinTeam.tsx` held a third copy of sign-out.** Sprint 1 collapsed two (App, Onboarding) into
`performSignOut` precisely because a missed step leaks one user's data into the next session on
a shared laptop, and this one was missed. It had drifted exactly as that warning predicts: no
`teardownRealtimeSubscription()` (so an in-flight subscription could repopulate the store after
the reset), no `sb-*-auth-token` sweep (so the session survived in localStorage whenever the
network call didn't land), and no timeouts (so signing out on venue WiFi hung indefinitely). It
has a regression test that the existing test could not have provided — that one asserts the auth
`signOut` was called, and **both** implementations do that.

`MatchPlanner`'s Load/Save were rendered twice: the toolbar pair had no `lg:hidden`, and a
second labelled pair sat below under a "Mobile-only Action Buttons" comment. On a phone both
showed, each carrying its own copy of the `title` explaining why Save is disabled on an
archived season. `save-plan-desktop` / `save-plan-mobile` are one `save-plan` — a deliberate
test-id change, and no test asserted on either.

### 7. The build warning the plan mispredicted

The plan said `React.lazy` routing was "the natural fix" for `offline-db.ts is both statically
and dynamically imported`. **It isn't, and couldn't be.** `offline-db` is pulled into the entry
chunk by `store.ts`, `sync.ts`, `realtime.ts`, `server-pull.ts` and three slices; the
`await import()` calls in `sign-out.ts` and `JoinTeam.tsx` deferred nothing and only produced
the warning. Made static — warning gone. The `>500 kB` warning **was** fixed by the splitting.

---

## Gate output

```
$ npm run lint
> tsc --noEmit
(clean)

$ npm run test:run
 Test Files  28 passed (28)
      Tests  342 passed | 2 skipped (344)

$ npm run test:integration
 Test Files  9 passed (9)
      Tests  87 passed (87)

$ npm run build
dist/assets/inter-latin-wght-normal-*.woff2      48.26 kB
dist/assets/inter-latin-ext-wght-normal-*.woff2  85.07 kB
dist/assets/index-*.css                          59.15 kB │ gzip: 10.21 kB
dist/assets/EditProfile-*.js                      3.53 kB │ gzip:  1.45 kB
dist/assets/PreMatchChecklist-*.js                8.75 kB │ gzip:  2.77 kB
dist/assets/MatchPlanner-*.js                    13.50 kB │ gzip:  3.98 kB
dist/assets/ScoutingReports-*.js                 14.12 kB │ gzip:  3.19 kB
dist/assets/SprintPlanning-*.js                  24.45 kB │ gzip:  6.01 kB
dist/assets/AdminSettings-*.js                   37.06 kB │ gzip:  9.22 kB
dist/assets/vendor-*.js                         164.53 kB │ gzip: 53.68 kB
dist/assets/supabase-*.js                       171.11 kB │ gzip: 44.20 kB
dist/assets/index-*.js                          287.60 kB │ gzip: 79.50 kB
✓ built in 3.92s

PWA v0.17.5 — precache 31 entries (4889.20 KiB)
```

No `db:verify` / `test:rls`: `supabase/` is untouched this sprint.

**No build warnings at all** — both the `>500 kB` chunk warning and the `offline-db.ts`
static/dynamic warning are gone.

**Main chunk 402.42 → 287.60 kB** (gzip 102.49 → 79.50). Precache 4754.77 → 4889.20 KiB; the
+134 KiB is the two Inter subsets, against removing a cross-origin request the PWA could never
have satisfied offline.

**`as any`: 67 → 58.** Two were added while writing this and then removed: `JoinTeam.test.tsx`
got the typed `asMock` helper `auth.test.tsx` already used, taking that file from 12 to 0.

**Coverage ratcheted 68/63/64/70 → 72/67/69/74**, measured at 72.75/67.75/69.67/74.92. The
routing rewrite added real coverage over `App.tsx`, and the store split moved four domains out
of thinly-covered `store.ts` into slices the season-lifecycle suite already exercises.

The 2 skipped tests are the pre-existing `describe.skip` in `MatchPlanner.test.tsx`; none added.

---

## Verified adversarially, not just run

Rule 10. Eleven defects reintroduced one at a time, the relevant suite run, the defect reverted.

```
CONTROL      nothing broken                                                 green
CAUGHT       nav rendered twice (the pre-Sprint-5 duplicated Sidebar)       Dashboard.test.tsx
CAUGHT       season picker duplicated for mobile again                      Dashboard.test.tsx
CAUGHT       ArchivedSeasonBanner moved out of the shell into a route       Dashboard.test.tsx
CAUGHT       a view route stops season-scoping its collection               Dashboard.test.tsx
CAUGHT       updateProfile no longer carries the rename into the profile    auth.test.tsx
CAUGHT       SIGNED_OUT stops clearing the cached profile                   auth.test.tsx
CAUGHT       JoinTeam goes back to its own copy of sign-out                 JoinTeam.test.tsx
CAUGHT       MatchPlanner's duplicated mobile Save comes back               MatchPlanner.test.tsx
CAUGHT       an archived-season guard is removed from a store slice         season-lifecycle.test.ts
NOT CAUGHT   the profile read splits back into two round trips              auth.test.tsx
NOT CAUGHT   /dashboard stops redirecting (a V1 bookmark 404s)              Dashboard.test.tsx
```

**Both misses were worth having, and they were different in kind.**

*A test that could not see what it claimed to check.* `expect(users.select).toHaveBeenCalledTimes(1)`
was meant to hold the two-reads-become-one merge in place. It cannot: `tableStub` resolves to
whatever the test handed it regardless of which columns were requested, so reverting the select
to `age_classification` still returned a full row and still passed. It asserts the select
**argument** now, and that version does catch it.

*A route that turned out to be redundant.* Deleting `<Route path="/dashboard">` changed nothing,
because the catch-all already sends unknown paths home. The test was right — it asserts the
user-facing property (a V1 bookmark still lands on the dashboard) and that property held either
way. Two lines for one behaviour, one of which could rot unnoticed, so the redundant one is
gone and the reason lives on the catch-all.

### Run in the browser, end to end

Against the local stack, through the real UI, with `.env.local` untouched (a
`.env.development.local` takes priority in dev mode; it is gitignored and deleted afterwards).
A team was created through the real `create_team_as_admin` RPC and seeded with 7 tasks across
5 statuses, 3 scouting reports, 2 match plans, an 8-item checklist, and a deliberately long team
name ("Roaring Riveters Robotics Collective") and person name ("Jordan Ramirez-Okonkwo").

Not the happy path — the states the hand-off named:

| State | Result |
|---|---|
| **375px, every route** | no horizontal overflow on any of the seven; drawer off-canvas at x=-288; hamburger exactly 44×44 |
| **375px, drawer open** | the one season picker at x=12–275, fully on screen |
| **375px + keyboard (375×350)** | **found a defect** — see below |
| **Empty season** | **found a defect** — see below |
| **Archived season** | exactly one banner on all five season-scoped routes; every disabled control still carrying `title="This season is archived and read-only"` |
| **Long team name** | ellipsised in a 224px rail, and does not push the rail out |
| **Offline** | sync indicator reads "Offline" in the sidebar footer |
| **Deep link + reload** | `#/app/scouting` survives a full reload |
| **Fonts** | zero Google-origin requests, 2 faces, `font-sans` → `"Inter Variable"` |
| **Internal scrolling** | board frame 688px with columns scrolling inside it, no double scrollbars anywhere |

---

## 🟡 Two things the SCREENSHOTS found that even the DOM measurements did not

**Stat tile labels truncated on a phone.** The very first 375px capture showed "SPRINT
PROGR…" and "SCOUTING REP…" — my own density pass had put `truncate` on the label in a
two-column grid where the full text does not fit. Every measurement said the layout was fine,
because it was: nothing overflowed, nothing was clipped out of the viewport. It was just
unreadable. Now wraps to two lines; a tile one line taller beats a label you cannot read.

**The `tall:` breakpoint generated no CSS at all.** I had added
`screens: { tall: { raw: '(min-height: 600px)' } }` to `tailwind.config` and written
`hidden tall:block` on the sidebar's progress meter. The config parsed, the class was in the
markup, the build succeeded — and Tailwind emitted **no rule**, so the class was plain `hidden`
and the meter was invisible at *every* height rather than only short ones. I noticed because
the meter was missing from a full-height 375×812 drawer screenshot. Worse, my earlier
"1 of 6 → 5 of 6 nav items" measurement was partly measuring this bug rather than the fix.
Replaced with a hand-written `@media (max-height: 599px) { .hide-when-short }` in `index.css`,
verified present in the built CSS and verified switching at both heights in the browser. A
height breakpoint is unusual enough that spelling it out documents itself.

## 🟡 Three things the browser found that the suite did not

**An empty checklist rendered nothing at all.** Header, rule, white space. It was
`checklist.map(...)` with no empty branch — and this is not a rare corner: **"blank" is one of
the three checklist sources Sprint 4's rollover wizard offers**, so it is exactly what a team
sees on day one of a new season if they choose it. The only way to add an item is behind an
"Edit Checklist" button that an empty panel gives nobody a reason to press. It has an empty
state now, with the add path in it, and it respects `canEdit` so an archived season explains
itself rather than offering an action the database would refuse.

**A phone keyboard squeezed the navigation to a 24px sliver.** At ~375×350 the drawer's footer
was `shrink-0`, so the progress meter and two profile cards kept full height and the nav — the
reason the drawer is open — absorbed the entire shortfall: 1 of 6 items reachable. Nav and
footer now share one scroll region with the footer pushed down by `mt-auto`, so it stays pinned
at the bottom when there is room and scrolls away when there is not, and the meter hides under
a new `tall` (min-height: 600px) screen. **1 of 6 → 5 of 6**, season picker still on screen, and
nothing changes at 375×812.

**I introduced and then caught a height-chain regression.** The `max-w-app mx-auto` wrapper I
added to `AppShell` had no height, and `height: 100%` needs a parent with a definite height —
so every view written as `h-full flex flex-col` to scroll its own list inside a fixed frame
(the board, scouting, the checklist) would have collapsed to content height and lost its sticky
column headers. Found by measuring the DOM rather than by the suite, which has no viewport.
Fixed and verified: frame 688px, columns scrolling inside it.

---

## 🔴 A pre-existing defect found, confirmed on `main`, and deliberately not fixed

**A restored session can drop the user into the forced age-profile screen.**

On a reload with a valid stored session, `supabase.auth.getSession()` never resolves: it takes
the `lock:sb-<ref>-auth-token` Web Lock and stays there with nothing queued behind it. After 5s
the safety timeout in `auth.tsx` fires, `isLoading` flips to false with `ageClassification`
still null, and `Onboarding` renders *"Almost Done! Please complete your profile
configuration"* to somebody whose profile is complete. The token was not expired (41 minutes
left) and the auth round trip measured 52ms, so it is not slowness.

**I checked this against unmodified `main` in a separate worktree on the same origin with the
same stored session, and it reproduces identically.** It is not a Sprint 5 regression.

Left alone deliberately: this is auth lifecycle, not UI, and Sprint 5 had no business widening
into the auth/sync core — the same reasoning Sprint 4 used for the entitlement-retry fix. It is
in the parking lot for Sprint 7's hardening. The narrow lesson for whoever takes it: the safety
timeout should not be able to leave the app in a state that **asks the user for data it already
has**, whatever the underlying stall turns out to be.

Worth knowing while testing locally: this also wedges the dev browser profile. Clearing the
origin's storage and signing in fresh clears it.

---

## Exit criteria

- [x] **Gate green** — output above, run for real. `supabase/` untouched, so `db:verify` /
      `test:rls` do not apply.
- [x] **Design tokens in `tailwind.config`** — type scale (13–14px base), spacing, radii,
      elevation, container widths, and `text-2xs`. **49 arbitrary values → 1**, and that one is
      documented as a computed relationship rather than a size.
- [x] **Density pass on every view.** Sprint board fits ~4½ cards on a 375px phone where it
      fitted ~2½; the dashboard's hero, stat tiles and quick actions all lose a size step.
- [x] **Consistent container widths** — five different `max-w-*` values became `AppShell`'s
      `max-w-app` plus `max-w-wide` on the two single-column views.
- [x] **Scrollbar-gutter hack fixed** — `scrollbar-gutter: stable` replaces padding three sides
      of the scroll container and pushing the fourth onto every child via `[&>*]:pr-4`.
- [x] **Coarse-pointer 44px rule is opt-in** per component (`touch-target`), with the iOS
      16px input floor added alongside the smaller `text-base`.
- [x] **One responsive `Sidebar`** — single nav definition rendering rail and drawer; the
      season picker survives at every breakpoint, verified in a browser at 375px.
- [x] **Real hash routes** `#/app/board` etc., deep links, back button, `React.lazy` per
      feature. Main chunk 402 → 288 kB.
- [x] **Remaining store domains into typed slices**; `user-context` merged into the auth
      context (one profile source, one cache) — which surfaced the rename bug above.
- [x] **Route deep-link test** — all six views, plus back-button, redirect and unknown-route
      cases.
- [x] **No duplicated nav** — asserted as `getByText` and `toHaveLength(1)`, and falsified.
- [x] **Screenshots at 375 and 768 / 1024** — captured in-session once the Browser pane was
      opened, and reviewed there. **1280 is the gap**: see below.
- [ ] **Kevin reviews look & feel before merge** — waiting on you.

### On the screenshots

Captured at **375** (dashboard, sprint board, checklist, scouting, the open drawer, and the
archived-season board), at **768** (board), and at **1024** (dashboard, board, admin — 1024 is
the `lg` breakpoint, so this is the first width showing the desktop rail rather than the
drawer).

**1280 could not be captured legibly.** The Browser pane composites an emulated viewport into
its own surface without scaling up, so a 1280-wide page renders into roughly a fifth of the
capture — the layout is verifiably correct (rail 224px, content 1008px, four board columns, one
banner) but far too small to review by eye. 1024 and 1280 differ only in available content
width, and the content stop is `max-w-app` (1440px), so nothing reflows between them; the DOM
measurements for 1280 are in the table above. **If you want true 1280 captures, widen the
Browser pane and say so — I will redo the set.**

**Two defects were found by looking at the screenshots**, which is the whole argument for
taking them — see below.

---

## Also for review

- **`.env.local` was not touched.** A `.env.development.local` pointing at the local stack was
  used and is deleted at the end, as in Sprints 3 and 4.
- **A stale service worker served the previous `index.html`** during local testing — the exact
  trap in the plan's parking lot. It is why the Google Fonts links still appeared in the browser
  after I had deleted them; unregistering the SW and clearing caches showed the real result. It
  cost about ten minutes rather than Sprint 3's twenty, because the note was there.
- **Breaking client changes**, if anything outside this branch touches them:
  `useCurrentUser` / `CurrentUserProvider` are gone (use `useAuth().profile`, `.displayName`,
  `.initials`, `.isOffline`); `DashboardHome` no longer takes `setActiveTab`; `Sidebar` takes
  three props instead of sixteen; `transformers.ts` is deleted; `save-plan-desktop` /
  `save-plan-mobile` are one `save-plan`; every app view moved from `#/dashboard` to `#/app/*`.
- **The `orange-*` → `forge-*` rename deliberately stopped at `src/test/` and the test files**,
  to keep the diff reviewable. The ramps are identical, so nothing renders differently.
- **Everything discovered outside scope is in `FALCONFORGE_V2_PLAN.md` §8**, including the auth
  restore defect above and `MemberManager`'s untitled disabled role select.

---

## Commits

```
314092e feat(ui): design tokens, self-hosted Inter, and real routes
bdb15f3 refactor(store): typed slices, one profile source, and two shims deleted
968b582 feat(ui): density pass, forge palette token, consistent containers
f9aeb46 fix(ui): empty checklist, keyboard-open drawer, and a route made redundant
<this>  docs: README design system, plan progress log, and the Sprint 5 report
```
