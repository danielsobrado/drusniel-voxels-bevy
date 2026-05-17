# Sprint 16 � Runtime write commands

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 5 � Runtime integration

## Goal
Allow the editor to safely change Bevy runtime state.

## Subtasks
- Implement write commands:
  - set render quality
  - set water reflection debug mode
  - run water visual probe
  - rebuild selected chunk
  - rebuild dirty chunks
  - update atlas mapping
  - save atlas mapping
- Add command result handling:
  - success
  - failure
  - validation error
  - runtime unavailable
  - command not supported
- Add undo/redo placeholder.
- Add command audit log.
- Add dirty-state sync.
- Add runtime write tests if possible.

## Acceptance criteria
- UI command sends real request.
- Runtime response updates UI.
- Errors appear in console and toast.
- Agent timeline records every runtime command.
