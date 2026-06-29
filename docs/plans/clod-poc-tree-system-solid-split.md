# clod-poc TreeSystem SOLID Split

`tools/clod-poc/src/trees/tree_system.ts` is too large and currently mixes orchestration,
settings-update planning, GPU policy/status, stats, patch planning, patch removal, shadow policy,
material application, mesh attribute writes, mesh write-state bookkeeping, mesh bounds refresh,
impostor state, GPU-ring draw resources, GPU-ring prepass creation, lighting-proxy projection,
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
  - `buildTreeSystemStats`

- `tree_system_gpu_policy.ts`
  - `treeSystemUsesGpuRingDraw`
  - `packTreeSystemGpuFrustumPlanes`

- `tree_system_gpu_status.ts`
  - `treeCpuFallbackGpuStatus`
  - `treeGpuRuntimeStatus`
  - `treeReportsGpuRingStats`

- `tree_system_settings_plan.ts`
  - `planTreeSystemSettingsUpdate`

- `tree_system_patch_planner.ts`
  - `treePatchIsInRange`
  - `selectRetainedTreePatches`
  - `selectTreePatchCandidates`
  - `countTreePatchInstances`
  - `shouldDeferTreePatchRefresh`

- `tree_system_patch_removal.ts`
  - `treeInstanceToFallingInstance`
  - `collectFallingTreeInstances`
  - `planTreePatchRemoval`

- `tree_system_shadow_policy.ts`
  - `treeLodCastsShadow`

- `tree_system_material_application.ts`
  - `applyTreeSystemMaterials`
  - `replaceTreeSystemImpostorGeometries`
  - `replaceTreeSystemImpostorGeometry`
  - `createTreeSystemImpostorGeometryForCapacity`

- `tree_system_gpu_ring_draw.ts`
  - GPU ring storage/indirect buffer creation
  - GPU ring instanced geometry creation
  - GPU ring mesh creation
  - indirect draw binding
  - GPU buffer lookup
  - ring visibility toggling

- `tree_system_gpu_ring_prepass.ts`
  - `treeSystemUsesGpuRingPrepass`
  - `addTreeGpuRingPrepassTwin`

- `tree_system_instance_attributes.ts`
  - `writeTreeWorldXZIfChanged`
  - `writeTreeLodFadeIfChanged`
  - `writeTreeImpostorUvRectIfChanged`
  - `writeUvRectIfChanged`
  - instance attribute accessors

- `tree_system_write_state.ts`
  - `createTreeMeshWriteState`
  - `resetTreeMeshWriteState`
  - `resetTreeMeshWriteStateForGrid`
  - write count helpers
  - dirty-flag mark helpers

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

3. Replace `updateSettings()` decision logic with `planTreeSystemSettingsUpdate()`.

4. Replace `emptyTreeStats()` / `updateStats()` aggregation with `createEmptyTreeSystemStats()` and `buildTreeSystemStats()`.

5. Replace refresh patch planning with `tree_system_patch_planner.ts`.

6. Replace node removal / falling-tree conversion with `tree_system_patch_removal.ts`.

7. Replace material application and impostor-geometry replacement with `tree_system_material_application.ts`.

8. Replace GPU status helpers with `tree_system_gpu_status.ts`.

9. Replace mesh attribute private methods with `tree_system_instance_attributes.ts`.

10. Replace write-state private methods with `tree_system_write_state.ts`.

11. Replace mesh post-LOD update/bounds private methods with `tree_system_mesh_bounds.ts`.

12. Replace impostor private methods with `tree_system_impostor_resources.ts`.

13. Replace shadow policy with `tree_system_shadow_policy.ts`.

14. Replace patch cleanup and loose object disposal with `tree_system_lifecycle.ts`.

15. Replace CPU visible lighting-proxy generation with `tree_system_lighting_proxies.ts`.

16. Replace GPU-ring draw internals with `tree_system_gpu_ring_draw.ts`.

17. Replace GPU-ring prepass private methods with `tree_system_gpu_ring_prepass.ts`.

18. Wire TREE-4 geometry selection using `selectTreeGpuRingGeometry` after the helper replacements are green.

## Rules

- Do not change behavior while moving code.
- Keep `TreeSystem` as the orchestration class.
- Prefer pure helpers with unit tests.
- Keep public exports stable until all imports are migrated.
- Do not mix the impostor feature changes with the SOLID split; do the integration only after the helper move is green.
