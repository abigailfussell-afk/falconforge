# `.agent/` — status of what is in here

Pruned in Sprint 7, as the plan's Sprint 7 entry asks ("`.agent/` folder pruned; aspirational
skill docs deleted or marked"). Nothing here is binding. **`CLAUDE.md` and
`FALCONFORGE_V2_PLAN.md` are the authorities**, and where anything below disagrees with them,
they win.

Marked rather than deleted, because most of it is an accurate record of how the codebase got
here and the plan's own convention is to keep history readable rather than tidy it away.

## Current

| File | Status |
|---|---|
| `rules/coding-rules.md` | **Current.** Rewritten in Sprint 7: it previously held a real account's plaintext password (see below). Defers to `CLAUDE.md` for the Gate. |

## Historical — describes work that has since been done differently

| File | Why it is historical |
|---|---|
| `decision-rewrite-vs-refactor.md` | The decision it records was superseded by the V2 plan, which chose a sprint-by-sprint rework of the existing codebase. |
| `refactor-bugfix-plan.md` | The pre-V2 bug list. Its contents were absorbed into the V2 plan's §4 current-state assessment; the B1–B25 numbering used today comes from the sprint reports, not from here. |
| `production-checklist.md`, `production-gauntlet-plan.md` | Pre-V2 launch checklists. Sprint 7 replaced the parts that were still live with `docs/beta-ops.md` (backups, error review, the deploy rule) and with the smoke pack and production check that now run in CI. |
| `scaling-next-steps.md`, `scaling-remaining-items.md` | Written against the V1 architecture, before the Sprint 3 schema and the Sprint 2 single read path. |
| `deploy-setup-runbook.md` | The one-off GitHub Pages and custom-domain setup. Done; kept because redoing it would need these steps again. |

## Aspirational — describes practices, not necessarily what exists

`skills/` holds seven `SKILL.md` files (architecture, code-conventions,
component-decomposition, data-sync, e2e-testing, error-handling, refactoring). They were written
as guidance for agents and predate most of the V2 work, so they describe intent rather than the
current codebase. Two concrete ways they are now out of date:

- `e2e-testing/SKILL.md` describes driving a dev server by hand. Sprint 7 built a real Playwright
  smoke pack (`e2e/`, `npm run test:e2e`) that runs against a production build in CI, plus
  `npm run capture` and `npm run venue`.
- `data-sync/SKILL.md` predates B19–B25 and the terminal-failure classification.

Read them for orientation; verify against the code before acting on them.

## A note on credentials

`rules/coding-rules.md` and two `skills/` files contained the plaintext password for a real
account — the one holding the `platform_operators` row — alongside its email address. **This
repository is public**, so that password was world-readable, and it is still in the git history
even though it has been removed from the working tree. It must be rotated. Recorded here because
a security decision that lives only in a commit message is one nobody finds later.
