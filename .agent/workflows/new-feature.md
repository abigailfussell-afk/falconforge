---
description: Step-by-step guide for adding a new feature to FalconForge
---

# New Feature Workflow

Follow these steps when adding a new feature or component to the app.

## 1. Read the Architecture Skill First
Read `.agent/skills/architecture/SKILL.md` to understand how data flows, especially:
- Store → Component data flow
- Sync queue pattern for persistent data
- Entity relationships

## 2. Define Types
If your feature introduces new data types:
- Add shared interfaces to `src/types.ts` (if used in multiple files)
- Or define them in `src/lib/store.ts` (if store-specific)

## 3. Add Store State + Actions
In `src/lib/store.ts`:
- Add state fields to the `AppState` interface
- Add action methods (e.g., `addEntity`, `updateEntity`, `deleteEntity`)
- Follow the existing pattern: update local state optimistically, then call `queueForSync()`
- Add the fields to `resetToDefaults()` to prevent stale state on sign-out

## 4. Add Sync Support (if data persists to Supabase)
In `src/lib/sync.ts`:
- Add transformation case in `transformToSupabaseSchema()`
- Add transformation case in `updateLocalDatabase()`
- Add entity pull in `pullChangesFromServer()`
- Read `.agent/skills/data-sync/SKILL.md` for details

## 5. Create the Component
In `src/components/YourComponent.tsx`:
- Follow the component structure pattern from `.agent/skills/code-conventions/SKILL.md`
- Use individual Zustand selectors (not destructuring)
- Add `data-testid` attributes to all interactive elements
- Make sure dark mode works (`dark:` variants)

## 6. Add Navigation
In `src/components/Sidebar.tsx`:
- Add a `<NavItem>` entry in both the desktop and mobile nav sections
- Choose an appropriate Lucide icon

In `src/App.tsx` (Dashboard function):
- Add a content panel: `{activeTab === 'yourId' && <YourComponent />}`

## 7. Write Tests
// turbo
Create `src/components/__tests__/YourComponent.test.tsx`:
```powershell
# Verify tests pass
npm run test:run
```

Follow patterns from `.agent/skills/testing-strategy/SKILL.md`:
- Mock the Zustand store
- Test rendering, user interactions, and conditional display
- If sync-enabled, also write integration tests and run:

// turbo
```powershell
npm run test:integration
```

## 8. Verify Everything
// turbo
```powershell
npm run test:all
```

Check that:
- [ ] All existing tests still pass  
- [ ] New component has tests
- [ ] Build succeeds (`npm run build`)
