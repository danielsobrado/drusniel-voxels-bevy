# clod-poc TreeSystem SOLID Split

`tools/clod-poc/src/trees/tree_system.ts` is too large and currently mixes orchestration,
math, GPU policy, stats, mesh attribute writes, mesh bounds refresh, impostor state,
GPU-ring draw resources, lighting-proxy projection, and lifecycle cleanup. Split it in
small behavior-preserving steps only.

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

- `tree_system_gpu_ring_draw.ts`
  - GPU ring storage/indirect buffer creation
  - GPU ring instanced geometry creation
  - GPU ring mesh creation
  - indirect draw binding
  - GPU buffer lookup
  - ring visibility toggling

- `tree_system_instance_attributes.ts`
  - `writeTreeWorldXZIfChanged`
  - `writeTreeLodFadeIfChanged`
  - `writeTreeImpostorUvRectIfChanged`
  - `writeUvRectIfChanged`
  - instance attribute accessors

- `tree_system_mesh_bounds.ts`
  - `updateTreeMeshAfterLod`
  - `updateTreeMeshBounds`
  - `TreeMeshBoundsState`

- `tree_system_impostor_resources.ts`
  - `treeCanUseBakedImpostor`
  - `selectTreeSystemGeometry`
  - `selectTreeSystemMaterial`
  - `updateTreeSystemImpostorMaterial`
  - impostor geometry/material disposal helpers

- `tree_system_lifecycle.ts`
  - `removeTreePatchResources`
  - `disposeTreeMeshGrid`
  - `removeAndDisposeObjects`
  - `disposeTreeMaterialHandles`
  - `disposeMaterial`

- `tree_system_lighting_proxies.ts`
  - `buildTreeLightingProxy`
  - `buildVisibleTreeLightingProxies`

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

4. Replace mesh attribute private methods with `tree_system_instance_attributes.ts`.

5. Replace mesh post-LOD update/bounds private methods with `tree_system_mesh_bounds.ts`.

6. Replace impostor private methods with `tree_system_impostor_resources.ts`.

7. Replace patch cleanup and loose object disposal with `tree_system_lifecycle.ts`.

8. Replace CPU visible lighting-proxy generation with `tree_system_lighting_proxies.ts`.

9. Replace GPU-ring draw internals with `tree_system_gpu_ring_draw.ts`:
   - `createGpuRingDrawResources`
   - `createGpuRingTierDraw`
   - `createStorageInstancedAttribute`
   - `setRingDrawsVisible`
   - `setGpuRingIndirect`
   - `gpuBufferForAttribute`

10. Extract GPU-ring prepass twin creation into a final small helper, then wire TREE-4 geometry selection using `selectTreeGpuRingGeometry`.

## Rules

- Do not change behavior while moving code.
- Keep `TreeSystem` as the orchestration class.
- Prefer pure helpers with unit tests.
- Keep public exports stable until all imports are migrated.
- Do not mix the impostor feature changes with the SOLID split; do the integration only after the helper move is green.
