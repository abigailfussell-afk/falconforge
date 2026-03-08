---
description: Run browser-based E2E tests against the running dev server to discover edge cases
---

# E2E Browser Testing Workflow

Run this workflow to execute browser-based end-to-end tests. Read `.agent/skills/e2e-testing/SKILL.md` first for full context.

## 1. Read the E2E Testing Skill
Read `.agent/skills/e2e-testing/SKILL.md` to understand the test structure, categories, and conventions.

## 2. Verify Dev Server is Running
// turbo
```powershell
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```
If the server is not running, start it:
```powershell
npm run dev
```

## 3. Choose Test Scope
Ask the user which scope to test:
- **Single scenario**: Run one specific test (e.g., "A5")
- **Category**: Run all tests in a category (e.g., "Category A: Authentication")
- **Full sweep**: Run all categories A through H
- **Regression**: Re-run only previously-failed scenarios

## 4. Execute Tests via Browser Subagent
For each test scenario:
1. Use the `browser_subagent` tool with detailed steps from the workflow map
2. Include the login helper steps if the scenario requires authentication
3. Observe the result and check against expected outcome
4. Capture screenshots for any failures
5. Check browser console for errors

## 5. Record Results
Create or update a test results artifact with:
- Date/time
- Scope tested
- PASS/FAIL per scenario
- Failure details (screenshot path, console errors, repro steps)
- Any newly-discovered edge cases

## 6. Update Workflow Map
If new edge cases were discovered during testing:
1. Add them to the appropriate section in `workflow_map.md`
2. Assign new scenario IDs if they warrant their own test case
3. Update the E2E skill if the category list changed

## 7. Report to User
Summarize results using `notify_user`:
- Total PASS vs FAIL count
- Critical failures that need immediate attention
- New edge cases discovered
- Recommendations for which bugs to fix first
