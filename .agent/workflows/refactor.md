---
description: Step-by-step procedure for safely refactoring large files
---

# Refactor Workflow

## When to Use
Use this workflow when addressing files that violate size limits (e.g., components > 300 lines, store > 400 lines) or merging duplicated functionality.

## Workflow

1. **Review Guidelines**
   Use `view_file` to read `.agent/skills/refactoring/SKILL.md` and `.agent/skills/component-decomposition/SKILL.md`.

2. **Establish Baseline**
   // turbo
   Run tests to ensure you aren't starting with a broken baseline:
   ```powershell
   npm run test:run
   ```

3. **Identify Boundaries**
   Carefully examine the large file to determine logical seams (e.g., separate views, independent forms, duplicated helper functions).

4. **Extract**
   - Create new files (e.g., `src/components/SubView.tsx`, `src/lib/utils.ts`).
   - Move the targeted code into the new files.
   - Define minimal, strict props/interfaces for the new components or functions.

5. **Update Imports & Types**
   - Update the original file to import your new component/utility.
   - Clean up any unused imports or types in the original file resulting from the extraction.

6. **Verify Extraction**
   // turbo
   Run tests immediately to ensure the extraction didn't break the original component's behavior:
   ```powershell
   npm run test:run
   ```

7. **Add New Tests**
   Write dedicated unit/component tests for the newly created files, ensuring they operate correctly in isolation.

8. **Final Build Check**
   // turbo
   ```powershell
   npm run build
   ```
   Ensure no TypeScript compilation errors were introduced.
