---
name: FalconForge Verification
description: Mandatory verification steps before completing any code change
---

# FalconForge Verification Skill

**ALWAYS follow this checklist before marking any change as complete.**

## Pre-Completion Checklist

Before calling a task "done", you MUST complete ALL of the following:

### 1. Unit & Component Test Check
```powershell
npm run test:run
```
- [ ] All unit/component tests pass
- [ ] If you modified tested components, update their tests
- [ ] If you added a new component, create a test file for it

### 2. Integration Test Check (for sync/data changes)
```powershell
npm run test:integration
```
- [ ] All integration tests pass
- [ ] If you modified store actions that sync, verify queue tests pass
- [ ] If you modified data transformations, verify transform tests pass

### 3. Build Check (for significant changes)
```powershell
npm run build
```
- [ ] Build completes without errors
- [ ] No TypeScript errors

### 4. Critical Flow Verification

For changes affecting these areas, perform browser verification:

| Change Area | Required Verification |
|-------------|----------------------|
| Auth (auth.tsx, Login.tsx) | Login flow works, sign out works |
| Store actions | Data persists, appears in UI |
| Sync (sync.ts, SyncStatusIndicator) | Sync button works, doesn't hang |
| Components | Component renders, interactions work |

### 5. Browser Verification Steps

Use the browser_subagent to verify when needed:

```
Login Verification:
1. Navigate to http://localhost:3000
2. Enter the seeded local account's email and password (`npm run seed:demo` prints them)
3. Click Sign In
4. Verify: Redirects to team picker or dashboard

Sync Verification:
1. After login, locate sync indicator in sidebar
2. Click sync button
3. Verify: Shows "Syncing..." then completes within 10 seconds

Sign Out Verification:
1. Click hamburger menu (mobile) or find Sign Out button
2. Click Sign Out
3. Verify: Redirected to login page
```

## Test File Conventions

| What to Test | Test Location | Pattern |
|--------------|---------------|---------|
| Store functions | `src/lib/__tests__/` | `*.test.ts` |
| Integration (sync/data) | `src/lib/__tests__/` | `*.integration.test.ts` |
| Components | `src/components/__tests__/` | `*.test.tsx` |
| Pages | `src/pages/__tests__/` | `*.test.tsx` |

## Test Commands

```powershell
# Run all unit + component tests
npm run test:run

# Run integration tests (sync/data transforms)
npm run test:integration

# Run ALL tests (unit + integration)
npm run test:all
```

## When Tests Fail

1. **Read the error message** - understand what's failing
2. **Check if test is outdated** - did component output change?
3. **Fix the test OR the code** - don't skip tests
4. **Run tests again** - verify fix works

## Quick Reference: Common Verification Scenarios

### Added a new component
- [ ] Component renders without errors
- [ ] Created test in `src/components/__tests__/ComponentName.test.tsx`
- [ ] Test covers main render and key interactions
- [ ] `npm run test:run` passes

### Modified store action
- [ ] Action works as expected
- [ ] Sync queue receives item (if applicable)
- [ ] Updated test in `src/lib/__tests__/store.test.ts`
- [ ] `npm run test:integration` passes (if sync-related)

### Fixed a bug
- [ ] Bug is actually fixed (browser verify)
- [ ] Added/updated test to prevent regression
- [ ] Didn't break other functionality

### Changed API/Supabase interaction
- [ ] Works with real Supabase (not just mocks)
- [ ] Error handling works for failures
- [ ] Offline behavior is acceptable
- [ ] `npm run test:integration` passes

## Recording Your Verification

After completing verification, summarize in your walkthrough:
- What tests were run and results
- What was browser-verified (if applicable)
- Any issues found and fixed
