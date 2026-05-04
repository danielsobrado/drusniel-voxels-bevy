# Sprint 18 — Save/load, snapshots, and undo/redo

Phase: 6 — Production hardening

## Goal
Make editing safe.

## Subtasks
- Define editor snapshot format.
- Add world snapshot command.
- Add autosave metadata.
- Add undo stack:
  - command ID
  - previous state patch
  - next state patch
  - timestamp
  - actor: human/agent/runtime
- Add redo stack.
- Add dirty tracking:
  - world dirty
  - atlas dirty
  - protected areas dirty
  - props dirty
  - water dirty
  - layout dirty
- Add confirmation dialogs for destructive commands.
- Add snapshot browser.

## Acceptance criteria
- User can save snapshot.
- User can undo protected-area creation.
- User can redo.
- Destructive commands require confirmation.
- Agent actions are tracked as agent-authored.
