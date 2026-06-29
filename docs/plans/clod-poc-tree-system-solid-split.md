# clod-poc TreeSystem SOLID Split

`tools/clod-poc/src/trees/tree_system.ts` is too large and currently mixes orchestration,
math, GPU policy, stats, mesh attribute writes, impostor state, GPU-ring draw resources,
and lifecycle cleanup. Split it in small behavior-preserving steps only.

## Current extracted modules

- `tree_system_math.ts`
  - `treeFootprintCenterX`
  - `treeFootprintCenterZ`
  - `treeFootprintRadius`
  - `treeDistance2d`
  - `visibleTreeLodCount`
  - `formatTreeLodCounts`

- `tree_system_stats.ts`
  - `TreeSystemStatsSnapshot`
  - `createEmptyTreeSystemStats`

- `tree_system_gpu_policy.ts`
  - `treeSystemUsesGpuRingDraw`
  - `packTreeSystemGpuFrustumPlanes`

- `tree_system_instance_attributes.ts`
  - `writeTreeWorldXZIfChanged`
  - `writeTreeLodFadeIfChanged`
  - `writeTreeImpostorUvRectIfChanged`
  - `writeUvRectIfChanged`
  - instance attribute accessors

- `tree_system_impostor_resources.ts`
  - `treeCanUseBakedImpostor`
  - `selectTreeSystemGeometry`
  - `selectTreeSystemMaterial`
  - `updateTreeSystemImpostorMaterial`
  - impostor geometry/material disposal helpers

- `tree_impostor_blend_geometry.ts`
  - `createTreeImpostorBlendGeometry`
  - `attachTreeImpostorBlendAttributes`

## Next safe edits inside `tree_system.ts`

Do these as separate commits, with tests after each commit.

1. Replace local helpers at the bottom:
   - `footprintCenterX` -> `treeFootprintCenterX`
   - `footprintCenterZ` -> `treeFootprintCenterZ`
   - `footprintRadius` -> `treeFootprintRadius`
   - `distance2d` -> `treeDistance2d`
   - `visibleTreeCount` -> `visibleTreeLodCount`
   - `formatLodCounts` -> `formatTreeLodCounts`

2. Replace public wrappers at the top:
   - `treeUsesGpuRingDraw` should delegate to `treeSystemUsesGpuRingDraw`.
   - `packTreeGpuFrustumPlanes` should delegate to `packTreeSystemGpuFrustumPlanes`.
   Keep the public names for backwards compatibility.

3. Replace `emptyTreeStats()` with `createEmptyTreeSystemStats()`.
   Keep the returned shape equal to `TreeStats`.

4. Replace mesh attribute private methods with `tree_system_instance_attributes.ts`:
   - `writeTreeWorldXZIfChanged`
   - `writeTreeLodFadeIfChanged`
   - `writeTreeImpostorUvRectIfChanged`
   - `writeUvRectIfChanged`
   - attribute accessors

5. Replace impostor private methods with `tree_system_impostor_resources.ts`:
   - `canUseBakedImpostor`
   - `geometryFor`
   - `materialFor`
   - `updateImpostorMaterials`
   - `disposeBakedImpostorGeometries`
   - `disposeImpostorMaterials`

6. Extract GPU-ring draw resource lifecycle into `tree_system_gpu_ring_draw.ts`:
   - ring mesh resource creation
   - ring prepass twins
   - clear/dispose lifecycle
   - TREE-4 geometry selection using `selectTreeGpuRingGeometry`

## Rules

- Do not change behavior while moving code.
- Keep `TreeSystem` as the orchestration class.
- Prefer pure helpers with unit tests.
- Keep public exports stable until all imports are migrated.
- Do not mix the impostor feature changes with the SOLID split; do the integration only after the helper move is green.
