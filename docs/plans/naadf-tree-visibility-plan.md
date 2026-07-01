# NAADF Tree Visibility Plan

Status: implementation plan with Jira-style tickets  
Last updated: 2026-07-01  
Scope: `tools/clod-poc` first, Rust/Bevy parity after CLOD proves value

## Goal

Use NAADF-style terrain visibility to reduce tree rendering cost without changing the visible forest result.

The goal is **not** to ray trace trees. The goal is to use terrain acceleration data to avoid generating, drawing, and shadowing tree clusters that are fully hidden behind hills, cliffs, ridges, or far terrain.

Target runtime flow:

```text
camera
  -> frustum culling
  -> terrain/NAADF visibility
  -> conservative tree candidate or cluster rejection
  -> GPU instance generation
  -> indirect draw
  -> shadow draw
  -> stats/debug validation
```

The first implementation target is CLOD PoC because it already has a GPU tree-ring path and NAADF/far-summary validation scenes. Rust/Bevy should only receive the idea after CLOD proves the counts, visuals, and stability.

## Why This Matters

Frustum culling answers only whether a tree is inside the camera cone. It does not answer whether the tree is behind terrain.

Large forest scenes currently waste work when trees are inside the frustum but hidden behind terrain. That cost can appear in several places:

- tree candidate generation;
- accepted tree instance count;
- visible indirect draw count;
- shadow caster count;
- overdraw and vertex work;
- future far forest/vegetation streaming.

NAADF is valuable here because it can become a **shared conservative terrain visibility accelerator**. For vegetation, we only need safe visibility decisions at candidate, cluster, or page level. We do not need exact branch/leaf visibility.

## Non-Goals

Do not use this work for:

- per-leaf ray tracing;
- per-branch visibility;
- per-tree collision;
- replacing the current tree LOD system;
- replacing impostors;
- replacing GPU frustum culling;
- CPU readback-driven visibility;
- exact software occlusion of every tree mesh.

Conservative rule:

```text
unknown / uncertain / missing data => keep visible
clearly terrain-hidden => reject
```

A false negative is acceptable because it only draws a hidden tree. A false positive is not acceptable because it hides a visible tree.

## Current Code References

### CLOD tree rendering path

| Area | File | Important symbols |
| --- | --- | --- |
| Runtime startup | `tools/clod-poc/src/runtime/vegetation/tree_startup.ts` | `runTreeStartup(...)` |
| Controller wrapper | `tools/clod-poc/src/runtime/vegetation/tree_controller.ts` | `createTreeController(...)`, `makeSettings()`, `TreeControllerDeps` |
| Main tree system | `tools/clod-poc/src/trees/tree_system.ts` | `TreeSystem` |
| CPU patch runtime | `tools/clod-poc/src/trees/tree_system_cpu_runtime.ts` | `refreshTreePatchesForCenter(...)`, `updateTreePatchLods(...)`, `createTreePatch(...)` |
| GPU ring runtime | `tools/clod-poc/src/trees/tree_system_gpu_ring_runtime.ts` | GPU tree ring update path |
| GPU compute wrapper | `tools/clod-poc/src/gpu/tree_ring_compute.ts` | tree ring dispatch, uniforms, counts/readback path |
| GPU tree shader | `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl` | `process_tree_slot(...)`, `terrain_ridge_filter(...)`, `append_lod_if_active(...)`, `append_shadow_lod_if_active(...)` |
| Shader composition | `tools/clod-poc/src/gpu/wgsl_modules.ts` | `composeTreeRingShader(...)`, `withTreeFinalPlacementHeight(...)`, `withTreeShadowLodGate(...)`, `withTreePcgHash(...)` |
| Shader tests | `tools/clod-poc/src/gpu/wgsl_modules.test.ts` | `composes tree ring helpers with final terrain placement height` |
| Tree stats | `tools/clod-poc/src/trees/tree_system_stats.ts` | `TreeSystemStatsSnapshot`, `buildTreeSystemStats(...)`, `createEmptyTreeSystemStats()` |
| Tree info display | `tools/clod-poc/src/trees/tree_info.ts` | `formatTreeInfoLine(...)`, `formatTreeGpuStats(...)` |
| Local patch script | `tools/clod-poc/scripts/apply-tree-terrain-cull.mjs` | applies blocked GPU shader/test patch |

### CLOD NAADF path

| Area | File | Important symbols |
| --- | --- | --- |
| NAADF integration | `tools/clod-poc/src/naadf/integration.ts` | `initNaadfIntegration(...)`, `NaadfIntegration`, `queryHeight(...)`, `traceSun(...)`, `getHeightProvider()` |
| NAADF query | `tools/clod-poc/src/naadf/query.ts` | `queryTerrainHeight(...)`, `traceSunVisibility(...)`, `tracePrimaryDebugRay(...)` |
| NAADF world state | `tools/clod-poc/src/naadf/summaryStreamer.ts` | `NaadfWorldState`, `createNaadfWorldState(...)`, `updateSummaryStreaming(...)` |
| Far clipmap | `tools/clod-poc/src/naadf/farClipmap.ts` | `sampleFarSummary(...)` |
| NAADF config | `tools/clod-poc/config/naadf_poc.yaml` | `far_shell`, `traversal`, `query`, acceptance thresholds |
| CLOD bootstrap | `tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts` | `naadfIntegration`, `useNaadfFarSummary`, `onFarSummaryUpdate` |
| NAADF docs | `tools/clod-poc/docs/naadf-poc.md` | browser validation status |

### New support already committed

| File | Purpose |
| --- | --- |
| `tools/clod-poc/src/trees/tree_terrain_occlusion.ts` | conservative CPU-side terrain-hidden helper for future CPU patch/cluster path |
| `tools/clod-poc/src/trees/tree_system_stats.ts` | added `terrainOccludedPatches` stat field |
| `tools/clod-poc/src/trees/tree_info.ts` | can display `terrainHidden=<count>` when populated |
| `tools/clod-poc/scripts/apply-tree-terrain-cull.mjs` | deterministic local patch for blocked direct shader edit |

## Architecture Target

### CLOD short-term

```text
GPU tree ring candidate
  -> placement/ecology/hydrology filters
  -> species selection
  -> distance/LOD selection
  -> terrain ridge visibility filter
  -> visible list append
  -> shadow list append
  -> indirect args
```

This does not require full NAADF yet. It uses the existing terrain height function inside the GPU tree shader. It is the lowest-risk first step.

### CLOD medium-term

```text
GPU tree ring / vegetation page
  -> NAADF or far-summary visibility provider
  -> conservative candidate/cluster visibility
  -> unknown/missing data keeps visible
  -> stats/debug counters
```

### Rust/Bevy long-term

```text
VoxelWorld / CLOD page
  -> Rust NAADF derived cache
  -> vegetation cluster bounds
  -> conservative terrain visibility query
  -> GPU compacted indirect draw
  -> benchmark + visual guard
```

Rust/Bevy must use the shipped Rust NAADF cache, not the browser heightfield approximation.

## Implementation Roadmap

### TVIS-001 — Activate existing GPU tree ridge cull

**Goal:** Turn on the existing `terrain_ridge_filter(...)` in the GPU tree-ring path.

**Files:**

- `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`
- `tools/clod-poc/src/gpu/wgsl_modules.test.ts`
- `tools/clod-poc/scripts/apply-tree-terrain-cull.mjs`

**Exact code location:**

In `tree_ring.compute.wgsl`, inside `process_tree_slot(...)`, after:

```wgsl
let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
```

insert:

```wgsl
if (terrain_ridge_filter(wpos, height, dist)) { return; }
```

This must happen before:

```wgsl
append_shadow_lod_if_active(...);
```

so rejected terrain-hidden trees do not enter either visible draw lists or shadow caster lists.

**Existing helper:**

```wgsl
fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool
```

**Current local command:**

```bash
cd tools/clod-poc
node scripts/apply-tree-terrain-cull.mjs
npm test
```

**Acceptance:**

- `npm test` passes.
- `composeTreeRingShader()` output contains `terrain_ridge_filter(wpos, height, dist)`.
- Mountain/valley tree visible count decreases.
- Flat terrain tree visible count is nearly unchanged.
- No near tree disappears.
- Shadow caster count decreases in terrain-occluded views.

**Notes:**

This is a ridge/heightfield cull, not full NAADF. It is still valuable because it proves the visual and performance direction with minimal new code.

---

### TVIS-002 — Add explicit feature flag for tree terrain visibility

**Goal:** Make the terrain visibility filter configurable and default-safe.

**Files:**

- `tools/clod-poc/config/trees.yaml`
- `tools/clod-poc/src/trees/tree_config.ts`
- `tools/clod-poc/src/app/clod_app_state.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_controller.ts`
- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`

**Suggested config shape:**

```yaml
gpu:
  terrain_visibility:
    enabled: true
    min_distance_m: 96
    sample_count: 6
    height_margin_m: 1.75
    crown_height_m: 5.5
    cull_shadows: true
    cull_visible: true
```

**Suggested TypeScript types:**

```ts
export interface TreeTerrainVisibilitySettings {
  enabled: boolean;
  minDistanceM: number;
  sampleCount: number;
  heightMarginM: number;
  crownHeightM: number;
  cullShadows: boolean;
  cullVisible: boolean;
}
```

Add it under `TreeGpuSettings` in `tree_config.ts`.

**Uniform packing:**

Use an existing spare vector if safe, or add a new packed vector to `TreeRingParams`.

Recommended new WGSL field:

```wgsl
terrain_visibility: vec4<f32>,
```

Suggested packing:

```text
x = enabled ? 1.0 : 0.0
y = min_distance_m
z = height_margin_m
w = crown_height_m
```

If adding a struct field changes uniform layout, update:

- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/gpu/tree_ring_species_layout.ts`
- `tools/clod-poc/src/gpu/tree_ring_wgsl_layout.ts`
- related layout tests.

**Acceptance:**

- `treeTerrainVisibility` can be enabled/disabled from config.
- Disabled mode produces identical visible/shadow counts to baseline.
- Enabled mode matches TVIS-001 behavior.
- Tests cover config parse fallback/defaults.

---

### TVIS-003 — Add GPU counters for terrain-hidden tree candidates

**Goal:** Measure what the filter is doing without CPU readback in normal gameplay.

**Files:**

- `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`
- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/trees/tree_system_stats.ts`
- `tools/clod-poc/src/trees/tree_info.ts`
- `tools/clod-poc/src/runtime/vegetation/vegetation_stats_presenter.ts`

**Counters to add:**

```text
terrainHiddenCandidates
terrainUnknownKeptCandidates
terrainVisibleCandidates
terrainHiddenShadowCandidates
```

**Important:**

Do not require readback for normal gameplay. The current `treeGpuCounts`/readback path already caused misleading perf data before. These counters should only be read when debug readback is explicitly enabled.

**Acceptance:**

- Gameplay path does not force GPU readback.
- Debug path can display hidden/kept counts.
- Tree info line shows terrain-hidden stats only when available.
- No `statsSyncMs` regression in normal gameplay.

---

### TVIS-004 — Wire CPU patch-level fallback culling

**Goal:** Make CPU fallback tree patches use the same conservative terrain-hidden idea.

**Files:**

- `tools/clod-poc/src/trees/tree_system_cpu_runtime.ts`
- `tools/clod-poc/src/trees/tree_system_types.ts`
- `tools/clod-poc/src/trees/tree_terrain_occlusion.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_controller.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_startup.ts`
- `tools/clod-poc/src/app/bootstrap/runtime/runtime_systems_startup.ts`
- `tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts`

**Existing helper:**

```ts
isTreeClusterTerrainOccluded(query: TreeTerrainOcclusionQuery): boolean
```

**Needed data flow:**

```text
clod_poc_bootstrap.ts
  naadfIntegration?.queryHeight(x, z, "render")
    -> RuntimeSystemsStartupInput
      -> VegetationStartupInput
        -> TreeStartupInput
          -> TreeControllerDeps
            -> TreeSystemOptions
              -> TreeCpuPatchRuntimeInput
```

**Patch point:**

In `updateTreePatchLods(...)`, after distance visibility is calculated and before per-instance LOD placement:

```ts
patch.visible = distance <= lodDistances.impostor + patch.radius;
patch.terrainOccluded = patch.visible && isTreeClusterTerrainOccluded(...);
patch.group.visible = patch.visible && !patch.terrainOccluded;
if (!patch.visible || patch.terrainOccluded) {
  flushPatchMeshes(...);
  continue;
}
```

**Acceptance:**

- CPU fallback path can cull whole hidden patches.
- `terrainOccludedPatches` increments.
- Unknown/missing NAADF data keeps patch visible.
- No crash when NAADF is not active.
- Existing CPU tree tests pass.

---

### TVIS-005 — Add CLOD debug UI toggles

**Goal:** Allow visual and perf testing without changing config files.

**Files:**

- `tools/clod-poc/src/app/clod_app_state.ts`
- UI startup/control files under `tools/clod-poc/src/app/bootstrap/ui/`
- `tools/clod-poc/src/trees/tree_info.ts`

**Toggles:**

```text
treeTerrainVisibilityEnabled
treeTerrainVisibilityDebugRays
treeTerrainVisibilityDebugClusters
treeTerrainVisibilityStats
```

**Display:**

```text
terrainHidden=<count>
unknownKept=<count>
visibleBeforeTerrain=<count>
visibleAfterTerrain=<count>
shadowBeforeTerrain=<count>
shadowAfterTerrain=<count>
```

**Acceptance:**

- Toggle can disable visibility culling at runtime.
- Stats panel updates without forcing readback unless debug counts are enabled.
- Debug overlays are off by default.

---

### TVIS-006 — Replace ridge approximation with NAADF/far-summary visibility provider

**Goal:** Move from shader-only heightfield ridge checks to a proper NAADF-backed visibility source.

**Files:**

- `tools/clod-poc/src/naadf/integration.ts`
- `tools/clod-poc/src/naadf/query.ts`
- `tools/clod-poc/src/naadf/farClipmap.ts`
- `tools/clod-poc/src/naadf/gpu/farSummaryAtlas.ts`
- `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`
- possible new file: `tools/clod-poc/src/vegetation/vegetation_visibility_provider.ts`

**Target interface:**

```ts
export interface VegetationVisibilityProvider {
  isClusterVisible(query: VegetationClusterVisibilityQuery): boolean;
  sampleTerrainVisibility(query: TerrainVisibilitySegmentQuery): TerrainVisibilityResult;
}
```

**Result shape:**

```ts
export type TerrainVisibilityReason =
  | "visible"
  | "terrain_hidden"
  | "unknown_kept"
  | "near_forced_visible"
  | "disabled";
```

**Acceptance:**

- NAADF scenes use NAADF/far-summary data for visibility when available.
- Non-NAADF scenes fall back to ridge/heightfield or disabled mode.
- Unknown data is visible.
- Tests cover unknown-kept behavior.

---

### TVIS-007 — Move to cluster/page-level culling before candidate generation

**Goal:** Avoid candidate generation work for fully hidden pages/clusters.

**Files:**

- `tools/clod-poc/src/trees/tree_system_cpu_runtime.ts`
- `tools/clod-poc/src/trees/tree_system_gpu_ring_runtime.ts`
- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- new possible file: `tools/clod-poc/src/vegetation/vegetation_cluster_visibility.ts`

**Current Phase 1 behavior:**

```text
candidate exists -> candidate is terrain-hidden -> reject before append
```

**Target behavior:**

```text
page/cluster is terrain-hidden -> skip candidate generation for that cluster
```

**Acceptance:**

- `gpuCandidateCount` drops in mountain/valley scenes, not just `gpuVisibleCount`.
- `terrainHiddenClusters` or `terrainOccludedPatches` is visible in stats.
- No visible popping during fast-turn and fast-flight scenes.

---

### TVIS-008 — Shared vegetation visibility for trees, grass, understory, and stones

**Goal:** Avoid duplicating terrain-hidden logic per vegetation system.

**Files:**

- `tools/clod-poc/src/runtime/vegetation/vegetation_startup.ts`
- `tools/clod-poc/src/runtime/vegetation/vegetation_types.ts`
- `tools/clod-poc/src/grass*`
- `tools/clod-poc/src/understory/*`
- `tools/clod-poc/src/stones/*`
- new possible file: `tools/clod-poc/src/vegetation/vegetation_visibility_provider.ts`

**Acceptance:**

- One provider feeds all vegetation systems.
- Each system has its own enable/disable gate.
- Counters are per system and shared total.
- Tree behavior is unchanged after provider extraction.

---

### TVIS-009 — Rust/Bevy parity plan

**Goal:** Port proven CLOD visibility behavior to the Rust renderer.

**Files to inspect first:**

- `src/rendering/naadf/`
- `assets/config/naadf.yaml`
- Rust vegetation/scatter/instance generation modules
- Rust render graph / indirect draw modules
- bench scenes under `bench/scenes/naadf/`

**Rust target:**

```text
VoxelWorld authoritative chunks
  -> NAADF derived cache
  -> vegetation page/cluster bounds
  -> conservative terrain visibility query
  -> compacted indirect draw
  -> debug counters + bench guard
```

**Acceptance:**

- NAADF disabled path is unchanged.
- Missing/unknown NAADF data keeps vegetation visible.
- Benchmark scene proves reduced vegetation work in occluded terrain.
- Visual regression shows no missing visible forest.

## Exact Step Sequence For The Next AI/Codex Pass

1. Run:

```bash
cd tools/clod-poc
npm test
```

2. Apply the existing local patch:

```bash
node scripts/apply-tree-terrain-cull.mjs
```

3. Re-run:

```bash
npm test
```

4. Inspect the diff. Expected files:

```text
tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl
tools/clod-poc/src/gpu/wgsl_modules.test.ts
```

5. Start a WebGPU CLOD scene:

```bash
npm run dev -- --host 127.0.0.1
```

6. Test URLs:

```text
http://127.0.0.1:5173/?scene=infinite-naadf-mountains&naadf=1&treeGpuCounts=0
http://127.0.0.1:5173/?scene=infinite-naadf-hills&naadf=1&treeGpuCounts=0
http://127.0.0.1:5173/?scene=infinite-naadf-fast-turn&naadf=1&treeGpuCounts=0
```

7. For debug-only count validation, use:

```text
&treeGpuCounts=1
```

Do not use debug readback timings as gameplay timings.

8. Capture before/after:

```text
gpuCandidateCount
gpuAcceptedCount
gpuVisibleCount
gpuShadowCasterCount
vegetationTotalMs
statsSyncMs
frame p50
```

9. If Phase 1 is visually safe, implement TVIS-002 config gating.

10. Then implement TVIS-003 counters.

## Validation Matrix

| Scene | Expected candidate count | Expected visible count | Expected shadow count | Visual expectation |
| --- | --- | --- | --- | --- |
| flat terrain | same | same or nearly same | same or nearly same | no visible change |
| hills | same in Phase 1 | lower in hidden valleys | lower | no missing ridge trees |
| mountains | same in Phase 1 | clearly lower | clearly lower | hidden back-side forest removed |
| fast-turn | same in Phase 1 | stable | stable | no popping |
| missing NAADF data | same | same | same | safe fallback visible |

Phase 7 changes the first column: candidate count should drop only after cluster/page-level culling happens before candidate generation.

## Performance Measurement Rules

Do not trust debug readback timings as gameplay timings.

Use two modes:

```text
Gameplay mode:
  treeGpuCounts=0
  use frame p50/p95, vegetationTotalMs, GPU draw counts if already available without readback

Debug mode:
  treeGpuCounts=1
  use counts only
  ignore frame timing and statsSyncMs for perf conclusions
```

This rule exists because previous tree-shadow/readback tests showed large false costs caused by GPU readback sync, not rendering.

## Quality Rules

The visibility test must never hide near trees.

Defaults:

```text
minDistanceM: 96
sampleCount: 6
heightMarginM: 1.75
crownHeightM: 5.5
unknown: visible
missing: visible
```

Recommended gates:

- near trees always visible;
- only mid/far/impostor first;
- use crown height, not trunk base;
- add positive margin;
- use hysteresis before page/cluster culling if popping appears.

## Debug UI Plan

Add toggles:

```text
treeTerrainVisibilityEnabled
treeTerrainVisibilityDebugRays
treeTerrainVisibilityDebugClusters
treeTerrainVisibilityStats
```

Add display:

```text
terrainHidden=<patches or clusters>
unknownKept=<count>
visibleBeforeTerrain=<count>
visibleAfterTerrain=<count>
shadowBeforeTerrain=<count>
shadowAfterTerrain=<count>
```

## Definition Of Done For CLOD

CLOD is done when:

- GPU tree-ring path rejects terrain-hidden far tree candidates;
- the feature is config/UI gated;
- normal gameplay mode has no forced readback;
- stats expose terrain-hidden counts in debug mode;
- mountain/valley scenes show lower visible and shadow counts;
- flat scenes stay visually and numerically close to baseline;
- no near-tree popping is visible;
- `npm test` passes;
- the design is ready to port to Rust/Bevy page-level vegetation culling.

## Definition Of Done For Rust/Bevy

Rust/Bevy is done when:

- NAADF derived terrain cache can answer conservative page/cluster visibility queries;
- vegetation draw generation consumes those visibility decisions;
- unknown/missing NAADF data safely falls back to visible;
- vegetation stats expose hidden cluster counts;
- benchmark scenes prove reduced CPU/GPU vegetation cost;
- visual regression captures show no missing visible forest.

## Recommendation

Implement in this order:

1. **TVIS-001:** activate the existing CLOD GPU ridge filter.
2. **TVIS-002:** gate it with config/UI.
3. **TVIS-003:** add debug counters without gameplay readback.
4. **TVIS-004:** wire CPU patch fallback.
5. **TVIS-006/007:** replace candidate checks with NAADF-backed page/cluster visibility.
6. **TVIS-009:** port proven behavior to Rust/Bevy.

That gives a safe short-term performance win and moves toward the correct architecture: NAADF as a shared terrain visibility accelerator for vegetation, not a per-tree renderer.
