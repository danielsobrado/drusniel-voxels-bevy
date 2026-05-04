# Sprint 13 — Automated tests and regression harness

Phase: 4 — LLM-first editor

## Goal
Make the editor safe for LLM iteration.

## Subtasks
- Add Playwright tests:
  - load editor
  - open command palette
  - create unbreakable area
  - select water body
  - open water debug
  - edit atlas mapping
  - select prop
  - toggle chunk bounds
  - open Agent Workbench
  - verify observation JSON
- Add component tests with Vitest/Testing Library.
- Add Zustand store tests:
  - selection
  - command execution
  - dirty state
  - protected area creation
  - atlas mapping update
  - water debug mode update
- Add command registry tests:
  - all commands have IDs
  - no duplicate IDs
  - each menu item maps to valid command
  - each toolbar button maps to valid command
- Add design regression screenshots:
  - default layout
  - command palette
  - protected-area inspector
  - water inspector
  - atlas panel
  - agent workbench

## Acceptance criteria
- `pnpm test` passes.
- `pnpm test:e2e` passes.
- No duplicate command IDs.
- No missing data-testid for critical controls.
- Test names describe real editor workflows.
