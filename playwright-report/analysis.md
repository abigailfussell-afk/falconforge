# E2E Test Failure Analysis

> Generated: 2026-03-01T18:32:31.474Z

## Summary

| Metric | Count |
|--------|-------|
| Total  | 35 |
| ✅ Passed | 7 |
| ❌ Failed | 28 |
| ⏭️ Skipped | 0 |
| 🔄 Flaky | 0 |

## Failure Categories

### 1. Timeout: page.fill (23 tests)

**Error Pattern**: `TimeoutError: page.fill: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('input[type="email"]')
`

**Likely Cause**: The target input element is not appearing on the page. Check if the app is redirecting away from the expected page (e.g., already logged in).

**Affected Tests**:

| File | Test Name | Line |
|------|-----------|------|
| admin-settings.spec.ts | admin-settings.spec.ts › should navigate to admin settings (coach only) | 24 |
| admin-settings.spec.ts | admin-settings.spec.ts › should display team roster section | 41 |
| admin-settings.spec.ts | admin-settings.spec.ts › should display sub-teams section | 58 |
| admin-settings.spec.ts | admin-settings.spec.ts › should display season manager section | 75 |
| admin-settings.spec.ts | admin-settings.spec.ts › should be able to add a sub-team | 92 |
| pre-match-checklist.spec.ts | pre-match-checklist.spec.ts › should navigate to pre-match checklist | 24 |
| pre-match-checklist.spec.ts | pre-match-checklist.spec.ts › should display checklist items | 39 |
| pre-match-checklist.spec.ts | pre-match-checklist.spec.ts › should toggle checklist item | 50 |
| pre-match-checklist.spec.ts | pre-match-checklist.spec.ts › should add new checklist item | 69 |
| pre-match-checklist.spec.ts | pre-match-checklist.spec.ts › should reset checklist | 88 |
| scouting-reports.spec.ts | scouting-reports.spec.ts › should navigate to scouting reports | 24 |
| scouting-reports.spec.ts | scouting-reports.spec.ts › should display scouting form when clicking Scout Match | 39 |
| scouting-reports.spec.ts | scouting-reports.spec.ts › should create a scouting report | 58 |
| sprint-planning.spec.ts | sprint-planning.spec.ts › should display Sprint Planning page | 33 |
| sprint-planning.spec.ts | sprint-planning.spec.ts › should show task columns | 42 |
| sprint-planning.spec.ts | sprint-planning.spec.ts › should be able to create a new task | 60 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should sign out successfully | 4 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should display team picker after login | 39 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should switch teams if multiple teams exist | 55 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should navigate to Dashboard | 91 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should navigate to Sprint Planning | 100 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should navigate to Match Planner | 112 |
| team-management.spec.ts | team-management.spec.ts › Team Management Flow › should navigate to Portfolio helper | 121 |

<details>
<summary>Error Details (click to expand)</summary>

```
TimeoutError: page.fill: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('input[type="email"]')

    at C:\Users\kevin\Downloads\falconforge\e2e\admin-settings.spec.ts:7:20
```
</details>

**Re-run these tests**:
```powershell
npx playwright test admin-settings.spec.ts
npx playwright test pre-match-checklist.spec.ts
npx playwright test scouting-reports.spec.ts
npx playwright test sprint-planning.spec.ts
npx playwright test team-management.spec.ts
```

---

### 2. Timeout: General (4 tests)

**Error Pattern**: `Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*login.*/
Received string:  "http://localhost:3000/"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    14 `

**Likely Cause**: An operation exceeded its timeout. Consider if the app is slow to load or if a prerequisite step failed silently.

**Affected Tests**:

| File | Test Name | Line |
|------|-----------|------|
| sign-out.spec.ts | sign-out.spec.ts › clicking sign out clears auth and redirects to login | 50 |
| sign-out.spec.ts | sign-out.spec.ts › after sign out, protected routes redirect to login | 75 |
| sign-out.spec.ts | sign-out.spec.ts › sign out clears local storage | 104 |
| sync.spec.ts | sync.spec.ts › sync button does not hang indefinitely | 22 |

<details>
<summary>Error Details (click to expand)</summary>

```
Error: expect(page).toHaveURL(expected) failed

Expected pattern: /.*login.*/
Received string:  "http://localhost:3000/"
Timeout: 10000ms

Call log:
  - Expect "toHaveURL" with timeout 10000ms
    14 × unexpected value "http://localhost:3000/"

    at C:\Users\kevin\Downloads\falconforge\e2e\sign-out.spec.ts:48:28
```
</details>

**Re-run these tests**:
```powershell
npx playwright test sign-out.spec.ts
npx playwright test sync.spec.ts
```

---

### 3. Timeout: locator.click (1 test)

**Error Pattern**: `TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('button').filter({ has: locator('svg') }).first()
    - locator resolved to <button class="w-full flex items-ce`

**Likely Cause**: The locator is not finding a matching element. Verify the selector matches the current DOM structure.

**Affected Tests**:

| File | Test Name | Line |
|------|-----------|------|
| sign-out.spec.ts | sign-out.spec.ts › sign out button works on mobile menu | 26 |

<details>
<summary>Error Details (click to expand)</summary>

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('button').filter({ has: locator('svg') }).first()
    - locator resolved to <button class="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 mb-1↵        bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 font-bold shadow-sm">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying click action
      - waiting 100ms
    29 × waiting for element to be visible, enabled and stable
       - element is not visible
     - retrying click action
       - waiting 500ms

    at C:\Users\kevin\Downloads\falconforge\e2e\sign-out.spec.ts:27:26
```
</details>

**Re-run these tests**:
```powershell
npx playwright test sign-out.spec.ts
```

---

## Fix Checklist

- [ ] Fix: Timeout: page.fill (23 tests)
- [ ] Fix: Timeout: General (4 tests)
- [ ] Fix: Timeout: locator.click (1 tests)
