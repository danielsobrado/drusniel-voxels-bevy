# Sprint 10 � Props, foliage, and placement tools

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 3 � Domain-specific systems

## Goal
Build prop browsing, prop selection, and placement/scatter controls.

## Subtasks
- Implement prop asset categories:
  - trees
  - rocks
  - bushes
  - flowers
  - buildings
- Implement `PropInspector`.
- Implement `PropBrushControls`:
  - density
  - spacing
  - slope limit
  - random rotation
  - scale jitter
  - terrain conform
  - align to normal
  - avoid protected areas
- Add prop bounds overlay.
- Add billboard/LOD fields:
  - billboard enabled
  - mode
  - switch distance
  - current LOD
  - visible instances
  - hidden instances
- Add commands:
  - scatter props on selection
  - clear props in selection
  - toggle prop bounds
  - rebuild prop chunk
  - focus selected prop
- Add mocked prop stats:
  - instance count
  - billboard count
  - LOD switches
  - missing meshes
  - bounds warnings

Runtime already has instanced prop grouping, LOD scaling from render quality, prop bounds debug settings, and billboard-oriented systems.

## Acceptance criteria
- User can select prop assets.
- User can edit prop placement settings.
- Prop bounds overlay toggles.
- Mock scatter command adds prop instances to state.
- Inspector shows prop LOD/bounds diagnostics.
