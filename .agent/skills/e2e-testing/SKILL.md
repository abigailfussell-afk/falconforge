---
name: E2E Browser Testing
description: Run browser-based E2E test scenarios to discover edge cases and verify user workflows
---

# E2E Browser Testing Skill

This skill documents the browser-based end-to-end testing approach for FalconForge. These tests complement the Vitest unit/component/integration tests by exercising real user workflows against a running dev server.

## When to Use This Skill

- After implementing a new feature (as step after unit tests pass)
- After fixing a bug to verify the fix end-to-end
- Periodic regression sweeps when the user requests `/e2e-testing`
- When manually-reported bugs need reproduction and verification

## Prerequisites

1. Dev server running at `http://localhost:3000` (`npm run dev`)
2. Test credentials: use a seeded local account (`npm run seed:demo` prints one). NEVER put a real password in this repository -- it is public.
3. Browser subagent available (Antigravity browser tool)

## Test Scenarios Reference

The complete list of test scenarios lives in the artifact:
`<appDataDir>/brain/<conversation-id>/workflow_map.md`

The scenarios are organized into categories:

| Category | ID Prefix | Focus |
|----------|-----------|-------|
| Authentication | A1-A7 | Login, signup, sign-out, password reset |
| Team Management | B1-B4 | Switch team, join team, persistence |
| Sprint Planning | C1-C6 | CRUD tasks, views, error states |
| Pre-Match Checklist | D1-D4 | Toggle, add, reset, reorder |
| Scouting Reports | E1-E2 | Create, delete |
| Match Planner | F1-F2 | Create plan, drawing persistence |
| Admin Settings | G1-G5 | Coach-only access, invite, members, seasons |
| Cross-Cutting | H1-H5 | Theme, sync, persistence, mobile nav |

## How to Run Tests

### Running a Single Scenario

Use the browser subagent with a clear task description:

```
browser_subagent Task:
  1. Navigate to http://localhost:3000
  2. [Specific steps from test scenario]
  3. Verify: [Expected result]
  4. Return: PASS/FAIL with details
```

### Running a Category

Execute all scenarios in a category sequentially. Start with a login (A1) as a prerequisite for most categories.

### Running a Full Sweep

Execute categories in order: A → B → C → D → E → F → G → H. Document all PASS/FAIL results.

## Login Helper

Most test scenarios require authentication first. Use this login flow as a prerequisite:

1. Navigate to `http://localhost:3000`
2. If on login page: enter the seeded local account's email and password, click Sign In
3. If on onboarding page: Select first available team
4. Verify Dashboard is loaded (sidebar visible, team name shown)

## Recording Results

After running tests, create or update a results artifact documenting:
- Date and time of test run
- Scenarios tested (by ID)
- PASS/FAIL status for each
- For failures: screenshot, console errors, and reproduction notes
- New edge cases discovered

## Updating This Skill

> [!IMPORTANT]
> When a new feature is added or a bug is fixed that changes a workflow, the workflow map (`workflow_map.md`) and this skill's scenario list must both be updated. The `/new-feature` workflow should include updating E2E test scenarios as a final step.

### Adding New Scenarios

1. Identify the category (A-H) or create a new one
2. Assign the next available ID (e.g., A8 if A7 is the last in Auth)
3. Document: Steps, Expected Result
4. Add edge cases with `- [ ]` checkboxes

### Retiring Scenarios

If a feature is removed, mark the scenario as `[RETIRED]` rather than deleting it, to maintain ID stability.
