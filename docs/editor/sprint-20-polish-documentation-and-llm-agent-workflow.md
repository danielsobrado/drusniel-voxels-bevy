# Sprint 20 — Polish, documentation, and Codex/agent workflow

Phase: 6 — Production hardening

## Goal
Prepare the editor for continuous LLM-assisted development.

## Subtasks
- Add internal documentation:
  - architecture
  - command system
  - state model
  - runtime bridge
  - testing
  - agent rules
- Add Codex instructions:
  - never create giant components
  - always use command registry
  - always add tests
  - always preserve data-testid
  - do not bypass runtime client
  - do not invent unsupported Bevy commands
- Add component stories or examples.
- Add keyboard shortcut reference.
- Add help/about panel.
- Add “LLM handoff” doc:
  - current sprint
  - known issues
  - next tasks
  - acceptance criteria
  - forbidden shortcuts

## Acceptance criteria
- New coding agent can understand the project.
- Every feature has command IDs.
- Every sprint has tests.
- UI is ready for iterative human + LLM development.
