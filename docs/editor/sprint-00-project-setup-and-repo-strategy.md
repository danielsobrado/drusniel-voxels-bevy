# Sprint 0 � Project setup and repo strategy

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 1 � Editor Shell MVP

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
  - `editor/frontend/src/app`
  - `editor/frontend/src/components/editor`
  - `editor/frontend/src/features/viewport`
  - `editor/frontend/src/features/outliner`
  - `editor/frontend/src/features/inspector`
  - `editor/frontend/src/features/assets`
  - `editor/frontend/src/features/agent`
  - `editor/frontend/src/features/profiler`
  - `editor/frontend/src/features/console`
  - `editor/frontend/src/state`
  - `editor/frontend/src/commands`
  - `editor/frontend/src/mocks`
  - `editor/frontend/src/types`
- Add strict TypeScript config.
- Add Playwright config.
- Add Storybook later, not in this sprint.

## Acceptance criteria
- `pnpm install`
- `pnpm dev`
- `pnpm typecheck`
- `pnpm test:e2e`

All should run, even if the app is only a blank editor shell.
