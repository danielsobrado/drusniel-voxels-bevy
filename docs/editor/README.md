# Drusniel Voxels Editor Build Plan

Phased roadmap for the editor rebuild and integration workstream.

## Phases

- Phase 1 - Editor Shell MVP
  - [Sprint 0 - Project setup and repo strategy](./sprint-00-project-setup-and-repo-strategy.md)
  - [Sprint 1 - Design system and static editor shell](./sprint-01-design-system-and-static-editor-shell.md)
  - [Sprint 2 - Editor state, domain types, and mock data](./sprint-02-editor-state-domain-types-and-mock-data.md)
  - [Sprint 3 - Command registry and command palette](./sprint-03-command-registry-and-command-palette.md)
- Phase 2 - Core Editor Workflows
  - [Sprint 4 - World Outliner and selection system](./sprint-04-world-outliner-and-selection-system.md)
  - [Sprint 5 - Inspector system](./sprint-05-inspector-system.md)
  - [Sprint 6 - Viewport shell and overlays](./sprint-06-viewport-shell-and-overlays.md)
  - [Fast authoring viewport plan](./fast-authoring-viewport-plan.md)
  - [Sprint 7 - Area and unbreakable-zone workflow](./sprint-07-area-and-unbreakable-zone-workflow.md)
  - [Sprint 8 - Voxel paint and texture atlas workflow](./sprint-08-voxel-paint-and-texture-atlas-workflow.md)
- Phase 3 - Domain-specific systems
  - [Sprint 9 - Water body editor](./sprint-09-water-body-editor.md)
  - [Sprint 10 - Props, foliage, and placement tools](./sprint-10-props-foliage-and-placement-tools.md)
  - [Sprint 11 - Rendering, lighting, atmosphere, and diagnostics panels](./sprint-11-rendering-lighting-atmosphere-and-diagnostics-panels.md)
- Phase 4 - LLM-first editor
  - [Sprint 12 - Agent Workbench MVP](./sprint-12-agent-workbench-mvp.md)
  - [Sprint 13 - Automated tests and regression harness](./sprint-13-automated-tests-and-regression-harness.md)
- Phase 5 - Runtime integration
  - [Sprint 14 - Bevy editor bridge design](./sprint-14-bevy-editor-bridge-design.md)
  - [Sprint 15 - First real Bevy connection](./sprint-15-first-real-bevy-connection.md)
  - [Sprint 16 - Runtime write commands](./sprint-16-runtime-write-commands.md)
  - [Sprint 17 - Protected areas runtime implementation](./sprint-17-protected-areas-runtime-implementation.md)
- Phase 6 - Production hardening
  - [Sprint 18 - Save/load, snapshots, and undo/redo](./sprint-18-save-load-snapshots-and-undo-redo.md)
  - [Sprint 19 - Performance and large-world UX](./sprint-19-performance-and-large-world-ux.md)
  - [Sprint 20 - Polish, documentation, and Codex/agent workflow](./sprint-20-polish-documentation-and-llm-agent-workflow.md)

## Suggested MVP cut
- Sprint 0: React app setup
- Sprint 1: Docked editor shell
- Sprint 2: Zustand state + mock world
- Sprint 3: Command registry + command palette
- Sprint 4: Outliner
- Sprint 5: Inspector
- Sprint 6: Viewport shell
- Sprint 7: Protected/unbreakable area workflow
- Sprint 8: Texture atlas workflow
- Sprint 12: Agent Workbench
- Sprint 13: Playwright tests
