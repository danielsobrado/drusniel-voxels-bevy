# Documentation index

Document status (2026-05-17): current index/reference.

## Lifecycle semantics

Every document in `docs/` declares a lifecycle status near the top. Treat `current index/reference` and `current technical note` docs as the best written orientation for their topic, but still verify code paths before editing. Treat `planning record`, `historical implementation/debug note`, and `historical release/reference record` docs as context: useful for rationale and lessons, not as direct execution instructions unless the plan is reconciled with the current code first.

## Current engine baseline

The current Rust runtime baseline is Bevy 0.18.1, as declared in `Cargo.toml` and `Cargo.lock`. Bevy 0.17 documents are historical references unless their status block explicitly says otherwise.

## Current CLOD docs

- [Bevy / clod-poc parity status](./plans/bevy-clod-poc-parity-status.md)
- [clod-poc tree parity status](./plans/clod-poc-trees-parity-status.md)
- [clod-poc GPU vegetation early rejection](./plans/clod-poc-gpu-vegetation-early-rejection.md)
- [clod-poc README](../tools/clod-poc/README.md)
- [clod-poc performance docs](../tools/clod-poc/docs/performance/)

## Drusniel Voxels editor roadmap

- [Editor build plan home](./editor/README.md)
- [Shader weather rendering](./rendering/weather.md)
- [NAADF implementation plan](./rendering/naadf-implementation-plan.md)
- [NAADF Jira breakdown](./rendering/naadf-jira-breakdown.md)
- [NAADF upstream parity](./rendering/naadf-upstream-parity.md)
- [Witchcraft water finish](./witchcraft-water-finish.md)
- [Rendering docs index](./rendering/README.md)
- [LOD docs index](./lod/README.md)
- [Physics docs index](./physics/README.md)

## Editor sprint plan files

- [Sprint 0 - Project setup and repo strategy](./editor/sprint-00-project-setup-and-repo-strategy.md)
- [Sprint 1 - Design system and static editor shell](./editor/sprint-01-design-system-and-static-editor-shell.md)
- [Sprint 2 - Editor state, domain types, and mock data](./editor/sprint-02-editor-state-domain-types-and-mock-data.md)
- [Sprint 3 - Command registry and command palette](./editor/sprint-03-command-registry-and-command-palette.md)
- [Sprint 4 - World Outliner and selection system](./editor/sprint-04-world-outliner-and-selection-system.md)
- [Sprint 5 - Inspector system](./editor/sprint-05-inspector-system.md)
- [Sprint 6 - Viewport shell and overlays](./editor/sprint-06-viewport-shell-and-overlays.md)
- [Sprint 7 - Area and unbreakable-zone workflow](./editor/sprint-07-area-and-unbreakable-zone-workflow.md)
- [Sprint 8 - Voxel paint and texture atlas workflow](./editor/sprint-08-voxel-paint-and-texture-atlas-workflow.md)
- [Sprint 9 - Water body editor](./editor/sprint-09-water-body-editor.md)
- [Sprint 10 - Props, foliage, and placement tools](./editor/sprint-10-props-foliage-and-placement-tools.md)
- [Sprint 11 - Rendering, lighting, atmosphere, and diagnostics panels](./editor/sprint-11-rendering-lighting-atmosphere-and-diagnostics-panels.md)
- [Sprint 12 - Agent Workbench MVP](./editor/sprint-12-agent-workbench-mvp.md)
- [Sprint 13 - Automated tests and regression harness](./editor/sprint-13-automated-tests-and-regression-harness.md)
- [Sprint 14 - Bevy editor bridge design](./editor/sprint-14-bevy-editor-bridge-design.md)
- [World persistence contract](./editor/world-persistence-contract.md)
- [Sprint 15 - First real Bevy connection](./editor/sprint-15-first-real-bevy-connection.md)
- [Sprint 16 - Runtime write commands](./editor/sprint-16-runtime-write-commands.md)
- [Sprint 17 - Protected areas runtime implementation](./editor/sprint-17-protected-areas-runtime-implementation.md)
- [Sprint 18 - Save/load, snapshots, and undo/redo](./editor/sprint-18-save-load-snapshots-and-undo-redo.md)
- [Sprint 19 - Performance and large-world UX](./editor/sprint-19-performance-and-large-world-ux.md)
- [Sprint 20 - Polish, documentation, and Codex/agent workflow](./editor/sprint-20-polish-documentation-and-llm-agent-workflow.md)
- [Sprints 18-20 completion handoff](./editor/sprints-18-20-completion-handoff.md)
