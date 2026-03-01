---
name: UI/Design System
description: Enable consistent, production-quality UI without a designer
---

# UI & Design System Skill

This skill defines the visual language for FalconForge, ensuring consistency and a premium feel across all components.

## Foundation

*   **Framework**: Tailwind CSS (via utility classes).
*   **Icons**: Lucide React (`import { IconName } from 'lucide-react'`). Keep sizing consistent (usually `w-4 h-4` for inline text, `w-5 h-5` for standard icons, `w-6 h-6` for prominent buttons).

## Color Palette

Stick to this palette to avoid a scattered, inconsistent look. Do not introduce arbitrary generic colors like plain `red-500` or `blue-500` unless specified.

| Role | Tailwind Classes | Usage |
| :--- | :--- | :--- |
| **Primary Accent** | `bg-amber-500`, `text-amber-500`, `border-amber-500` | Primary buttons, active states, important links, brand accents. |
| **Accent Hover/Focus** | `hover:bg-amber-600`, `focus:ring-amber-500` | Interactive states of primary elements. |
| **Background (Light)** | `bg-slate-50`, `bg-white` | Main application background, card backgrounds in light mode. |
| **Background (Dark)** | `dark:bg-slate-900`, `dark:bg-slate-800` | Main application background, card backgrounds in dark mode. |
| **Text (Primary)** | `text-slate-900`, `dark:text-white` | Main headings, critical text. |
| **Text (Secondary)** | `text-slate-600`, `dark:text-slate-400` | Subtitles, helper text, less important information. |
| **Borders/Dividers** | `border-slate-200`, `dark:border-slate-700` | Card borders, list dividers. |
| **Destructive (Error)** | `text-red-600`, `bg-red-500`, `hover:bg-red-600` | Delete buttons, error messages. |
| **Success** | `text-emerald-600`, `bg-emerald-500` | Success indicators, completed statuses. |

## Typography

*   **Font**: Inter (default sans-serif stack provided by Tailwind).
*   **Scale**:
    *   `text-xs`: For badges, very small helper text.
    *   `text-sm`: The default size for most UI elements (buttons, inputs, lists).
    *   `text-base`: For longer reading paragraphs, standard body copy.
    *   `text-lg font-semibold`: For card titles.
    *   `text-xl font-bold` or `text-2xl font-bold`: For page headers.

## Layout & Spacing

*   **Containers**: Use `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` for standard page wrappers.
*   **Gaps**: Use standard Tailwind spacing (`gap-4`, `gap-6` for grids; `space-y-4` for vertical stacks).
*   **Padding**: Cards should consistently use `p-6` or `p-4` depending on available space.

## Interactive Elements

### Buttons

*   **Primary**: `bg-amber-500 text-white hover:bg-amber-600 px-4 py-2 rounded-md font-medium transition-colors focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900`
*   **Secondary/Outline**: `border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2 rounded-md font-medium transition-colors`
*   **Ghost**: `text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-md transition-colors`

### Inputs

*   **Standard**: `w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-amber-500 focus:border-amber-500 sm:text-sm text-slate-900 dark:text-white`

## Cards

Cards are the primary structural element for grouping content.

```tsx
<div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
    <div className="p-6">
        <h3 className="text-lg font-medium text-slate-900 dark:text-white">Card Title</h3>
        {/* Content */}
    </div>
</div>
```

## Dark Mode Checklist

1.  **Always test both modes**.
2.  Use the `dark:` prefix for every color-related class (`bg-`, `text-`, `border-`, `ring-`).
3.  Ensure contrast remains accessible in dark mode (e.g., don't put dark gray text on a dark slate background).
4.  Rely on `bg-slate-800` for elevated surfaces (cards, modals) on top of the `bg-slate-900` background.

## Animations

Keep interfaces feeling responsive but not overly busy.
*   Use `transition-colors duration-200` on hovers (buttons, links).
*   Use `transition-all` when transforming scales or opacities.
