# Wiring the repo to the live site — runbook

> **Date:** 2026-08-14
> **Why this exists:** `git push` is blocked for the agent by the Claude Code permission
> classifier, so these steps have to be run by you. Everything else is already committed.

## Where things stand

| | |
|---|---|
| Live site | `abigailfussell-afk/falconforge`, Pages serving **`main` at root** |
| That repo's history | 29 commits, all "Add files via upload" — **built output, no source** |
| Real source | this repo, branch `non-split-landing-page` (78 commits) |
| The refactor | `refactor/data-layer`, 13 commits on top of it |
| Shared history | **none** between the two repos |
| Backup | you have a zip of the current falconforge contents |

`origin` now points at `falconforge`. The old `ftc-team-manager` remote is kept as
`ftc-team-manager-old`; it has no `gh-pages` branch and was never serving anything.

Target layout — the one `"deploy": "gh-pages -d dist"` in package.json already assumes:

```
main       source code       -> PRs target this, CI gates it
gh-pages   built output      -> Pages serves this, Actions publishes it
```

## Ordering matters

`falconforge/main` **is** the website. Pushing source over it while Pages still serves
`main` takes the site down instantly, because `index.html` and `assets/` disappear.

So: move the site to `gh-pages` first, repoint Pages, confirm it still works, and only then
touch `main`. No downtime, and every step before 4 is reversible.

---

## Step 1 — copy the live site to `gh-pages`

Byte-identical to what is serving now. Purely additive; nothing changes yet.

```bash
git push origin refs/remotes/origin/main:refs/heads/gh-pages
```

## Step 2 — repoint Pages (GitHub UI)

`falconforge` → **Settings → Pages** → Source: **Deploy from a branch** → branch
**`gh-pages`**, folder **`/ (root)`**.

Then load <https://falcon-forge.com> and confirm it is unchanged. Give it a minute; Pages
is not instant.

**Do not continue unless the site looks right.** If it breaks, set Source back to `main` —
that branch is still untouched at this point.

## Step 3 — add the build secrets (GitHub UI)

`falconforge` → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | from your local `.env.local` |
| `VITE_SUPABASE_ANON_KEY` | from your local `.env.local` |

Without these, CI builds a demo-mode site with no backend. The anon key is designed to ship
in the client bundle, so putting it in Actions secrets is about keeping it out of the repo,
not about hiding it from users.

## Step 4 — put the source on `main`  ⚠️ rewrites history

This replaces the 29 upload commits. They are build output only — preserved on `gh-pages`
by step 1, and in your zip.

```bash
git push --force origin non-split-landing-page:main
```

The site keeps serving from `gh-pages` throughout, so nothing goes dark.

## Step 5 — push the refactor branch

```bash
git push -u origin refactor/data-layer
```

## Step 6 — open the PR (GitHub UI)

`refactor/data-layer` → `main`. Because step 4 made `main` the real source, the PR shows
**just the 13 refactor commits**, not 90.

CI (`.github/workflows/ci.yml`) runs here for the first time — typecheck, unit,
integration, build, plus the schema job. Expect to fix something; it has never executed.

---

## After the merge

`deploy.yml` takes over. Push to `main` → typecheck → tests → build → publish `dist/` to
`gh-pages`. No more manual uploads.

Two things that fix themselves at that point:

- **Stale bundles.** `assets/` currently serves at least five different `index-*.js` builds
  (`12eUUXdd`, `BENnFQ5t`, `BF_KC_VB`, `BJbGHcDn`, `BozL356-`) because uploading adds and
  never deletes. `force_orphan: true` replaces the branch each deploy.
- **Public sourcemaps.** Every one of those bundles has its `.map` next to it, so the full
  source is downloadable from the live site today. Still worth setting
  `sourcemap: 'hidden'` in `vite.config.ts` so maps stop being emitted at all — not done
  yet, it was not asked for.

## Rollback

- **Before step 4:** set Pages Source back to `main`.
- **After step 4:** `gh-pages` still holds the exact bytes that were live, and your zip is
  a second copy. Re-point Pages at `gh-pages` (or re-upload the zip) to restore.
