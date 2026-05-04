# Sprint 0 — Project setup and repo strategy

Phase: 1 — Editor Shell MVP

## Goal
Create a clean frontend/editor workspace without touching game runtime behavior yet.

## Subtasks
- Decide location:
  - `tools/drusniel-editor/`
  - `editor/`
  - or separate repo if you prefer isolation.
- Create Vite React TypeScript app.
- Add core dependencies:
  - `react`
  - `vite`
  - `typescript`
  - `tailwindcss`
  - `shadcn/ui`
  - `dockview-react`
  - `zustand`
  - `immer`
  - `cmdk`
  - `lucide-react`
  - `@tanstack/react-query`
  - `@tanstack/react-table`
  - `@tanstack/react-virtual`
  - `react-hook-form`
  - `zod`
  - `sonner`
  - `@playwright/test`
- Add editor folders:
  - `src/app`
  - `src/components/editor`
  - `src/features/viewport`
  - `src/features/outliner`
  - `src/features/inspector`
  - `src/features/assets`
  - `src/features/agent`
  - `src/features/profiler`
  - `src/features/console`
  - `src/state`
  - `src/commands`
  - `src/mocks`
  - `src/types`
- Add strict TypeScript config.
- Add Playwright config.
- Add Storybook later, not in this sprint.

## Acceptance criteria
- `pnpm install`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm test:e2e`

All should run, even if the app is only a blank editor shell.
