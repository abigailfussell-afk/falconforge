---
description: Process for identifying and filling test coverage gaps
---

# Test Coverage Workflow

## When to Use
Use this workflow routinely to ensure critical logic and new files have sufficient tests, and specifically when instructed to improve coverage.

## Workflow

1. **Review Strategy**
   Consult `.agent/skills/testing-strategy/SKILL.md` for proper testing methodologies and mocking patterns.

2. **Generate Coverage Report**
   // turbo
   Run the test suite with coverage enabled:
   ```powershell
   npm run test:run -- --coverage
   ```
   *Note: If coverage scripts are not defined in `package.json`, use standard Vitest commands (e.g., `npx vitest run --coverage`).*

3. **Identify Gaps**
   Review the coverage output (in the terminal or by analyzing the generated report, usually in `coverage/`).
   Look for:
   - Files with 0% coverage (missing test files entirely).
   - Functions or components showing low branch/line coverage.
   - Focus on `src/lib/` (business logic/store) and core `src/components/`.

4. **Write Tests**
   - Create or update test files corresponding to the under-tested code (e.g., `src/components/__tests__/MissingComponent.test.tsx`).
   - Focus on:
     - Error state testing (what happens on failure?).
     - Empty state testing (what happens with no data?).
     - Both positive ("happy path") and negative paths.

5. **Verify Improvement**
   // turbo
   Re-run the coverage report to confirm the numbers have improved.
   ```powershell
   npm run test:run -- --coverage
   ```

6. **Integration Tests (If Applicable)**
   If the untested code interacted with the synchronization queue or data transformations, ensure integration tests are also written.
   // turbo
   ```powershell
   npm run test:integration
   ```
