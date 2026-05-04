# Sprint 6 — Viewport shell and overlays

Phase: 2 — Core Editor Workflows

## Goal
Make the center viewport feel like a real editor while still using a placeholder Bevy host.

## Subtasks
- Implement `BevyCanvasHost`.
- Add placeholder viewport scene:
  - voxel island
  - water
  - chunks
  - props
  - protected area volume
  - selected object outline
- Add viewport overlays:
  - breadcrumbs
  - camera status
  - selected coordinate
  - active mode
  - brush preview
  - chunk bounds toggle
  - voxel grid toggle
  - protected-area overlay toggle
  - prop bounds toggle
  - water debug overlay
- Add viewport tool shelf:
  - select
  - sculpt
  - paint
  - area
  - props
  - water
  - measure
  - camera
- Add bottom contextual tool strip.
- Add minimap placeholder.
- Add LLM-visible viewport summary:
  - selected object
  - active mode
  - active tool
  - targeted voxel
  - visible overlays

## Acceptance criteria
- Viewport is not yet real Bevy, but it feels usable.
- Commands toggle overlays.
- Selecting from outliner updates viewport outline.
- Viewport exposes `data-testid="bevy-canvas-host"` for future runtime mounting.
