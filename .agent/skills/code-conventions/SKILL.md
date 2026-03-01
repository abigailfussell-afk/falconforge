---
name: FalconForge Code Conventions
description: File structure, naming patterns, and coding standards for consistency across the codebase
---

# Code Conventions Skill

Follow these conventions to keep the codebase consistent and agent-friendly.

## File Structure

```
src/
├── App.tsx                      # Router + Dashboard layout
├── types.ts                     # Shared TypeScript interfaces (Team, TeamMember, etc.)
├── components/
│   ├── Sidebar.tsx              # Navigation sidebar (desktop + mobile)
│   ├── SyncStatusIndicator.tsx  # Sync status display
│   ├── SprintPlanning.tsx       # Sprint board component
│   ├── PreMatchChecklist.tsx    # Checklist component
│   ├── ScoutingReports.tsx      # Scouting reports component
│   ├── MatchPlanner.tsx         # Match strategy planner
│   ├── PortfolioAI.tsx          # Portfolio/judging helper
│   ├── AdminSettings.tsx        # Admin panel (coach-only)
│   ├── DashboardHome.tsx        # Dashboard overview widgets
│   ├── EditProfile.tsx          # User profile editor
│   └── __tests__/               # Component tests
├── pages/
│   ├── Login.tsx                # Login page
│   ├── Onboarding.tsx           # Team selection
│   ├── CreateTeam.tsx           # Team creation
│   ├── JoinTeam.tsx             # Team join flow
│   └── __tests__/               # Page tests
├── lib/
│   ├── store.ts                 # Zustand store (ALL app state + actions)
│   ├── auth.tsx                 # Auth context + Supabase auth
│   ├── sync.ts                  # Sync queue + online/offline
│   ├── offline-db.ts            # IndexedDB via Dexie
│   ├── supabase.ts              # Supabase client config
│   └── __tests__/               # Store/sync tests
└── test/
    └── setup.ts                 # Global test setup
```

## Component Patterns

### Standard Component Structure

```tsx
// 1. Imports (React, libraries, then local)
import { useState, useEffect } from 'react';
import { SomeIcon } from 'lucide-react';
import { useAppStore } from '../lib/store';

// 2. Props interface (if applicable)
interface MyComponentProps {
    title: string;
    onAction?: () => void;
}

// 3. Component function (default export)
export default function MyComponent({ title, onAction }: MyComponentProps) {
    // 4. Store selectors
    const tasks = useAppStore(s => s.tasks);
    const addTask = useAppStore(s => s.addTask);
    
    // 5. Local state
    const [isOpen, setIsOpen] = useState(false);
    
    // 6. Effects
    useEffect(() => { /* ... */ }, []);
    
    // 7. Handlers
    const handleSubmit = () => { /* ... */ };
    
    // 8. Render
    return (
        <div data-testid="my-component">
            {/* ... */}
        </div>
    );
}
```

### Store Access Pattern

The Zustand store uses individual selectors for performance:

```tsx
// ✅ CORRECT - individual selectors
const tasks = useAppStore(s => s.tasks);
const addTask = useAppStore(s => s.addTask);

// ❌ WRONG - destructuring causes unnecessary re-renders
const { tasks, addTask } = useAppStore();
```

**Exception:** In `App.tsx`/`Dashboard`, the store is destructured for convenience since it's the top-level component.

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Components | PascalCase | `SprintPlanning.tsx` |
| Hooks | camelCase, `use` prefix | `useSync`, `useAuth` |
| Store actions | camelCase, verb prefix | `addTask`, `updateTask`, `deleteScoutingReport` |
| Test files | `ComponentName.test.tsx` | `SprintPlanning.test.tsx` |
| Integration tests | `feature.integration.test.ts` | `store-sync.integration.test.ts` |
| `data-testid` | kebab-case | `data-testid="add-task-button"` |

## Type Definitions

- **Shared types** (used across multiple files): `src/types.ts`
  - `Team`, `TeamMember`, `SubTeam`, `ScoutingReport`, `MatchPlan`, `ChecklistItem`
- **Store types** (store-specific): `src/lib/store.ts`
  - `Task`, `Season`, `AppState` (the store state + actions interface)

## data-testid Convention

All interactive elements should have a `data-testid` for testing:

```tsx
// Navigation items use: nav-{tabId}
<button data-testid="nav-dashboard">Dashboard</button>
<button data-testid="nav-kanban">Sprint Planning</button>

// Action buttons use: {action}-{entity}-button
<button data-testid="add-task-button">Add Task</button>
<button data-testid="delete-report-button">Delete</button>

// Inputs use: {entity}-{field}-input
<input data-testid="task-title-input" />

// Landmark areas use: {area}-{type}
<aside data-testid="desktop-sidebar">
<nav data-testid="mobile-nav">
```

## Shared Utilities

1. **Extraction Rule**: If you write a helper function (e.g., `getMemberDisplayName`, `calculateDerivedMetrics`) that exists in another component or might be used generically, extract it to a shared utility file.
2. **Location**: `src/lib/` (e.g., `src/lib/member-utils.ts`, `src/lib/date-utils.ts`).
3. **Usage**: Import the utility from `src/lib/` into your components rather than defining it inline.
4. **Testing**: Write dedicated unit tests for these shared utilities in `src/lib/__tests__/`.

## Component Decomposition

1. **File Size Limit**: Try to keep components under 300 lines of code. If a component grows larger, extract sub-views, complex logic, or repeatable elements into separate files.
2. **Structure**: Place decomposed components in the same `src/components/` directory. If they are specific to a complex view and not reused, you can group them (e.g., `SprintBoard.tsx`, `SprintList.tsx`, `SprintCalendar.tsx` for `SprintPlanning.tsx`).
3. **Props**: Pass necessary state and handler functions down as props. Be careful not to prop-drill excessively; if multiple levels are needed, consider accessing the globally available Zustand `useAppStore` in the child component.

## Styling

- **Framework**: Vanilla CSS via Tailwind utility classes (already configured)
- **Dark mode**: Use `dark:` prefix variants
- **Colors**: Orange/amber for accents, slate for neutrals
- **Transitions**: `transition-all duration-200` for interactions
- **Responsive**: `lg:` breakpoint separates mobile from desktop

## State Management Rules

1. **All app state lives in the Zustand store** (`store.ts`)
2. **Component-local state** (modals, form inputs, etc.) uses `useState`
3. **Don't duplicate store state** — read directly from the store
4. **Store actions must call `queueForSync()`** for data that should sync to Supabase
5. **Use `resetToDefaults()` before sign-out** to prevent stale state
