---
name: Playwright Report Analysis
description: Parse E2E test failures and produce structured analysis for fixing
---

# Playwright Report Analysis Skill

Read Playwright E2E test results and produce a structured failure analysis that agents can use to fix issues.

## When to Use

- After running `npm run test:e2e` and seeing failures
- When asked to analyze or fix E2E test failures
- When an agent needs to understand what's broken in the E2E test suite

## Prerequisites

The project uses dual reporters (HTML + JSON). After running E2E tests, a `playwright-report/results.json` file is generated alongside the HTML report.

## Step-by-Step Instructions

### Step 1: Generate the Analysis

// turbo
Run the parser script to produce the analysis file:

```powershell
node .agent/skills/playwright-report/scripts/parse-report.cjs
```

This creates `playwright-report/analysis.md` with structured failure information.

### Step 2: Read the Analysis

Read the generated analysis file:

```
playwright-report/analysis.md
```

The analysis contains:
- **Summary**: Total, passed, failed, skipped, flaky counts
- **Failure Categories**: Failures grouped by error pattern, each with:
  - Error pattern and likely cause
  - Table of affected test files, names, and line numbers
  - Full error details (expandable)
  - Commands to re-run just those tests

### Step 3: Fix Issues by Category

Work through each failure category from the analysis:

1. **Read the affected test file(s)** to understand what the test expects
2. **Read the cited source file(s)** that the test exercises
3. **Identify the root cause** using the error pattern and likely cause
4. **Apply the fix** to either the source code or the test
5. **Re-run just the affected tests** using the command from the analysis:
   ```powershell
   npx playwright test e2e/<specific-test>.spec.ts
   ```

### Step 4: Verify All Tests Pass

// turbo
After fixing all categories, run the full E2E suite:

```powershell
npm run test:e2e
```

### Step 5: Regenerate Analysis (Optional)

If tests still fail, regenerate the analysis:

// turbo
```powershell
node .agent/skills/playwright-report/scripts/parse-report.cjs
```

Then repeat from Step 2.

## Common Failure Patterns

| Pattern | Typical Fix |
|---------|-------------|
| Timeout on `page.fill` for login inputs | Tests expect login page but auth state redirects to dashboard. Fix: clear auth or check `auth.setup.ts` |
| URL assertion mismatch after sign-out | App redirect logic changed. Fix: update the redirect in the sign-out handler or update test expectations |
| `locator.click` timeout for mobile menu | DOM structure changed. Fix: update the selector in the test to match current markup |
| Element not visible | Component rendering changed. Fix: update test selectors/assertions or fix the component |

## JSON Output

For programmatic consumption, use the `--json` flag:

```powershell
node .agent/skills/playwright-report/scripts/parse-report.js --json
```

This produces `playwright-report/analysis.json` alongside the markdown.

## File Locations Reference

| File | Purpose |
|------|---------|
| `playwright.config.ts` | Playwright configuration (reporters, projects, timeouts) |
| `e2e/*.spec.ts` | E2E test files |
| `e2e/auth.setup.ts` | Shared authentication setup |
| `playwright/.auth/user.json` | Stored auth state |
| `playwright-report/results.json` | Raw JSON test results |
| `playwright-report/analysis.md` | Generated failure analysis |
