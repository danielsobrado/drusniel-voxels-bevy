# Sprint 2 — Editor state, domain types, and mock data

Phase: 1 — Editor Shell MVP

## Goal
Create the real data model before implementing workflows.

## Subtasks
- Create `types/editor.ts`:
  - `EditorMode`
  - `EditorTool`
  - `Selection`
  - `ViewportOverlayState`
  - `BrushSettings`
  - `EditorCommandId`
- Create `types/world.ts`:
  - `VoxelBlock`
  - `ChunkSummary`
  - `ProtectedArea`
  - `WaterBody`
  - `PropInstance`
  - `MaterialAsset`
  - `AtlasMapping`
  - `WorldSnapshot`
- Mirror repo-specific concepts:
  - `RenderQualityPreset = "Low" | "Medium" | "High" | "Performance100"`
  - `WaterBodyKind = "Ocean" | "Lake" | "River" | "Pond" | "Unknown"`
  - `WaterReflectionDebugViewMode = "Off" | "Mask" | "ReflectionOnly" | "BlendFactor"`
  - `BlockType = "grass" | "dirt" | "rock" | "sand"`
  - `MaterialKind = "blocky" | "triplanar" | "building" | "props" | "water"`
- Render quality values should match Bevy enum:
  - `Low`, `Medium`, `High`, `Performance100`.
- Atlas editor should start with real grass, dirt, rock, sand mappings
  each with top/side/bottom tile IDs.
- Create Zustand store:
  - `activeMode`
  - `activeTool`
  - `selection`
  - `brush`
  - `viewportOverlays`
  - `chunks`
  - `protectedAreas`
  - `waterBodies`
  - `props`
  - `materials`
  - `atlasMapping`
  - `runtimeMetrics`
  - `agentState`
  - `dirtyState`
- Create mock data:
  - 8–12 chunks
  - 3 protected areas
  - 4 water bodies
  - 20 props
  - block materials
  - atlas mapping
  - render metrics
  - agent timeline events
- Add selectors:
  - `getSelectedObject`
  - `getDirtyChunks`
  - `getVisibleOutlinerNodes`
  - `getAgentObservation`
  - `getCurrentInspectorKind`

## Acceptance criteria
- Selecting mock objects updates the store.
- Inspector can switch based on selection kind.
- No real Bevy connection required yet.
- State is serializable to JSON.
