# AI Features Reference (removed 2026-08)

This document records what the Gemini-powered AI features did before they were removed, so they
can be rebuilt later if the cost model justifies it. Removal rationale: each AI call is a per-use
cost (Gemini API) on top of fixed infrastructure, and none of the features are core to the beta.

All AI code was already gated off behind `AI_FEATURES_ENABLED = false` in `src/constants.ts` at
the time of removal, so users lost nothing visible.

## Feature 1 — Portfolio Summary Generation ("Portfolio Helper")

- **What it did:** From the sidebar ("Portfolio Helper") or a Dashboard quick-action tile, a user
  picked "Completed Only" or "All Tasks", clicked **Generate Summary**, and got a Markdown
  bulleted season-achievement summary written in a casual student voice ("we figured out…",
  "it was super cool when…"), suitable for pasting into an FTC engineering portfolio. Output was
  auto-saved to a season-scoped **History** list with per-entry delete. The button disabled itself
  when offline.
- **Input:** the team's task list, serialized as `- title (type): description. Tags: …`.
- **Prompt highlights:** FTC-robotics persona, high-school voice, Markdown bullets, and an
  explicit anti-hallucination clause ("Only use information that is explicitly provided… Do NOT
  make up, infer, or fabricate").
- **Model:** `gemini-1.5-flash` (client path) / `models/gemini-2.5-flash` (edge-function path).
- **Code (at removal):** `src/services/geminiService.ts` → `generatePortfolioSummary()`;
  UI in `src/components/PortfolioAI.tsx` (portfolio view); history persisted via
  `addPortfolioEntry`/`deletePortfolioEntry` in `src/lib/store.ts` (`portfolioHistory` state,
  `PortfolioEntry` type in `src/types.ts`).

## Feature 2 — Judge Interview Question Generation ("Judging Prep")

- **What it did:** From the sidebar ("Judging Prep"), a user typed free-form notes and/or uploaded
  PDF/TXT files (PDFs text-extracted client-side via `pdfjs-dist`), clicked **Generate
  Questions**, and got 5 flip-card flashcards: a likely FTC judge interview question on the front
  and a suggested answer on the back. If a generated portfolio summary existed, it was included
  as context.
- **Model:** same as Feature 1. Output requested as JSON (`{ questions: [{question, answer}] }`).
- **Known wart:** on empty/failed responses the UI silently substituted hard-coded demo
  flashcards — a real UX bug, don't reproduce it in any rebuild.
- **Code (at removal):** `geminiService.ts` → `generateInterviewQuestions()`; UI in
  `PortfolioAI.tsx` (judging view); `Flashcard` type in `src/types.ts`.

## Feature 3 — Meeting Notes Summarization (never shipped)

- **What it did:** nothing user-facing — dead scaffolding for a roadmap feature ("meeting minutes
  with AI transcription", per README). `summarizeMeeting(notes)` prompted: "Summarize these
  robotics team meeting notes into concise minutes with action items." No component ever called it.
- If meetings/attendance features return with AI assistance, this is the natural seed idea.

## Shared infrastructure (also removed)

- **Dual call path:** preferred path POSTed to a Supabase Edge Function
  (`supabase/functions/gemini-proxy/index.ts`, Deno) holding the `GEMINI_API_KEY` secret
  server-side, with actions `portfolio` / `questions` / `summarize` / `list_models`. Fallback path
  called Gemini directly from the browser with a user-supplied key (`geminiApiKey` in the zustand
  store — deliberately never persisted; the Admin Settings field to set it was never built).
- **Prompt-injection sanitizer:** `sanitizeForPrompt()` stripped "ignore previous instructions",
  `system:`, `[INST]`, `<<SYS>>`, `<|im_start|>`, converted code fences, and truncated input to
  10,000 chars. **Known hole:** it was applied only on the client path; the edge function
  interpolated payloads unsanitized. Any rebuild must sanitize server-side.
- **Known hole #2:** the edge function's `list_models` action was callable without auth.
- **Prompt drift:** the client and edge-function copies of each prompt had diverged (the proxy
  copy lost the anti-hallucination clause). Any rebuild should keep prompts in exactly one place.

## If/when these come back

1. Server-side only (Supabase Edge Function or equivalent) — no client keys, no client fallback.
2. Sanitize and auth-gate on the server; meter per-team usage so the cost can be priced into a
   license tier or add-on.
3. Single source of truth for prompts; keep the anti-hallucination clause.
4. Rebuild UI fresh — the old `PortfolioAI.tsx` predates the V2 design system and had the
   fake-flashcard fallback bug.

## What was deleted (for the removal commit)

- Files: `src/services/geminiService.ts` (+ test), `src/components/PortfolioAI.tsx` (+ test),
  `supabase/functions/gemini-proxy/` (also undeploy the function and delete the `GEMINI_API_KEY`
  secret in the Supabase dashboard).
- Entry points: routes/imports in `src/App.tsx`, nav items in `src/components/Sidebar.tsx`
  (desktop + mobile blocks), quick actions in `src/components/DashboardHome.tsx`,
  `AI_FEATURES_ENABLED` in `src/constants.ts`, marketing bullet in `src/pages/Landing.tsx`.
- State/types: `portfolioHistory`, `geminiApiKey`, `addPortfolioEntry`, `deletePortfolioEntry`,
  `setGeminiApiKey` in `src/lib/store.ts`; `PortfolioEntry`, `Flashcard` in `src/types.ts`;
  orphaned `portfolio_entries` mapping in `src/lib/sync.ts` (no such table ever existed).
- Config/docs: dead `define` block in `vite.config.ts` (`process.env.API_KEY` /
  `GEMINI_API_KEY`), `VITE_GEMINI_API_KEY` in `src/vite-env.d.ts` and README, AI mentions in
  README and `metadata.json` (including the vestigial `microphone` frame permission).
- Dependencies: `@google/genai`, `pdfjs-dist` (its only consumer was `PortfolioAI.tsx`; removing
  it also removes a third-party `unpkg.com` worker fetch).
