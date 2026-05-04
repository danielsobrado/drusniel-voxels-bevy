# Sprint 4 — World Outliner and selection system

Phase: 2 — Core Editor Workflows

## Goal
Build the left-side tree as the main way to navigate the world.

## Subtasks
- Implement `WorldOutlinerPanel`.
- Build tree sections:
  - `World`
  - `Terrain`
  - `Regions`
  - `Chunks`
  - `Dirty Chunks`
  - `Protected Areas`
  - `Water Bodies`
  - `Props`
  - `Lighting`
  - `Cameras`
  - `Debug Resources`
- Implement `OutlinerTreeItem`.
- Add per-item:
  - icon
  - label
  - visibility toggle
  - lock toggle
  - dirty badge
  - context menu
  - type badge
- Add search/filter:
  - chunks
  - dirty
  - area locked
  - water
  - props
  - warnings
- Add selection behavior.
- Add multi-select placeholder.
- Add virtualized list later if performance is needed.

## Acceptance criteria
- Clicking a chunk selects a chunk.
- Clicking a water body opens water inspector.
- Clicking a protected area opens protected-area inspector.
- Search filters work.
- Selection is reflected in viewport overlay summary and Agent Workbench.
