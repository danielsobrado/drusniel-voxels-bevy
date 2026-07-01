# NAADF Tree Visibility Plan

Status: design and implementation plan  
Last updated: 2026-07-01  
Scope: `tools/clod-poc` first, Rust/Bevy parity later

## Goal

Use NAADF-style terrain visibility to reduce tree rendering cost without changing the visible forest result.

The immediate goal is not to ray trace trees. The goal is to use the terrain acceleration data we already have to avoid generating, drawing, and shadowing tree clusters that are fully hidden behind terrain.

In simple terms:

```text
camera
  -> frustum culling
  -> terrain occlusion / NAADF visibility
  -> tree cluster rejection
  -> GPU instance generation
  -> indirect draw
  -> shadow draw
```

This should make mountain, valley, and long-view scenes cheaper because forests behind ridges should not enter the visible tree draw lists.

## Why This Matters

The CLOD PoC already has a GPU tree-ring path that generates candidate trees, filters them, writes visible instance data, and builds indirect draw arguments. That is the right architecture for large forests.

The missing piece is terrain occlusion. Frustum culling only answers: "is this tree inside the camera view cone?" It does not answer: "is this tree hidden behind a hill?"

NAADF is useful here because it already represents terrain in a query-friendly form. For vegetation, we only need conservative visibility answers at cluster or candidate level. We do not need per-leaf, per-branch, or per-tree ray tracing.

## Non-Goals

Do not use NAADF for:

- per-leaf ray tracing;
- per-tree collision;
- replacing the current tree LOD system;
- replacing GPU frustum culling;
- replacing impostors;
- CPU readback-driven culling;
- exact visibility of every branch.

The system must remain conservative. A false negative is acceptable because it only means we draw a hidden tree. A false positive is not acceptable because it hides a visible tree.

## Current Status

Implemented support already committed:

- `tools/clod-poc/src/trees/tree_terrain_occlusion.ts`
  - small reusable terrain-hidden helper;
  - conservative line-of-sight style terrain sampling;
  - safe behavior for missing or unknown samples.

- `tools/clod-poc/src/trees/tree_system_stats.ts`
  - `terrainOccludedPatches` / terrain-hidden statistics field added.

- `tools/clod-poc/src/trees/tree_info.ts`
  - tree info line can show `terrainHidden=<count>` when patch-level culling is active.

- `tools/clod-poc/scripts/apply-tree-terrain-cull.mjs`
  - deterministic local patch script for the GPU tree shader edit that the GitHub connector blocked as a direct large-file write.

Not active yet:

- GPU tree-ring terrain-hidden rejection is not yet applied on `main` because direct connector updates to the large WGSL/composer file were blocked.
- CPU patch-level NAADF integration is scaffolded conceptually but not wired into `TreeSystem` yet.

## Immediate CLOD PoC Plan

### Phase 1 — Activate existing GPU ridge cull

There is already a `terrain_ridge_filter(...)` helper in `tools/clod-poc/src/gpu/shaders/tree_ring.compute.wgsl`.

The first step is to call it after a tree candidate has passed ecology/species acceptance and before it is appended to visible and shadow lists.

Target insertion point:

```wgsl
let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
if (terrain_ridge_filter(wpos, height, dist)) { return; }
append_shadow_lod_if_active(...);
```

This is not full NAADF yet, but it is the lowest-risk first step because:

- it is already in the shader;
- it uses the same terrain height field as the placement path after shader composition;
- it rejects only far/mid candidates hidden behind terrain ridges;
- it avoids CPU readback;
- it reduces both visible draw lists and shadow caster lists.

Local command:

```bash
cd tools/clod-poc
node scripts/apply-tree-terrain-cull.mjs
npm test
```

Acceptance for Phase 1:

- WGSL composition tests pass.
- Tree counts drop in mountain/valley views.
- Flat terrain counts stay almost unchanged.
- No visible trees disappear in near/mid views.
- No shadow-only popping is visible.

### Phase 2 — Add proper NAADF-backed query path

Replace the height-field ridge approximation with a NAADF summary query where available.

The query should remain conservative:

```text
for each accepted candidate or cluster:
  sample a small number of points from camera to crown
  if terrain summary is unknown -> keep tree
  if terrain is clearly above the sight line -> reject tree
  otherwise -> keep tree
```

Rules:

- unknown NAADF data keeps the tree;
- missing resident chunk keeps the tree;
- near trees skip the test;
- only mid/far/impostor candidates are eligible;
- no CPU readbacks;
- no per-frame allocation.

The first real NAADF version can use the CLOD far-summary atlas or a compact GPU visibility texture. It does not need full Rust NAADF parity.

### Phase 3 — Move from per-candidate to cluster/page culling

Per-candidate culling works but still costs one test per candidate. The better production shape is page/cluster-level culling.

Target shape:

```text
CLOD page / vegetation cluster
  -> bounding center + radius + height range
  -> NAADF terrain visibility test
  -> skip entire tree cluster if hidden
```

Benefits:

- fewer shader operations;
- fewer candidate evaluations;
- fewer shadow candidates;
- reusable for trees, grass, understory, and stones;
- maps better to Rust/Bevy chunk/page systems.

Acceptance:

- stats report hidden clusters/pages;
- visible tree count and shadow caster count drop in occluded mountain scenes;
- candidate count drops once cluster rejection happens before candidate generation;
- no visible popping during camera movement.

### Phase 4 — Shared vegetation visibility layer

Once tree cluster culling works, generalize the visibility decision.

Shared users:

- trees;
- understory;
- grass;
- stones;
- custom props, later;
- far forest shells, later.

The visibility layer should be owned by terrain/page streaming, not by each vegetation system independently.

Target API:

```text
VegetationVisibilityProvider
  isClusterVisible(clusterBounds, camera, lodBand) -> conservative bool
  visibilityReason -> frustum / distance / terrain-hidden / unknown-kept
```

This should feed both CPU fallback systems and GPU generation paths.

### Phase 5 — Rust/Bevy parity

After the CLOD PoC proves value, port the idea to Rust/Bevy.

Rust/Bevy target:

```text
VoxelWorld / CLOD page
  -> NAADF derived cache
  -> page visibility metadata
  -> vegetation cluster visibility
  -> GPU compacted indirect draw
```

Rust should not copy the browser heightfield approximation. It should use the shipped Rust NAADF derived cache and GPU query path where available.

## Statistics To Track

CLOD stats should eventually expose:

- tree candidate count;
- accepted tree count;
- visible tree count;
- shadow caster count;
- terrain-hidden tree candidate count;
- terrain-hidden patch/cluster count;
- unknown-kept count;
- fallback reason;
- GPU dispatch time;
- overflow flags.

The most important comparison is not only FPS. We need before/after counts:

```text
flat scene:
  candidate count should stay similar
  visible count should stay similar

mountain/valley scene:
  candidate count may stay similar in Phase 1
  visible count should drop
  shadow caster count should drop

cluster phase:
  candidate count should also drop
```

## Quality Rules

The visibility test must never hide near trees.

Suggested default gates:

- skip terrain-hidden cull under roughly the mid/far transition;
- use crown height, not trunk base height;
- include a positive safety margin;
- use hysteresis or temporal stability before cluster-level rejection if popping appears;
- treat unknown terrain as visible.

A safe cull is one where the terrain is clearly above the line from camera to tree crown. Borderline cases should remain visible.

## Test Scenes

Primary scenes:

- `infinite-naadf-mountains`;
- `infinite-naadf-hills`;
- `infinite-naadf-fast-flight`;
- `infinite-naadf-fast-turn`;
- normal tree-heavy CLOD scene with ridges and valleys.

Control scenes:

- flat terrain;
- low rolling hills;
- near forest at camera level.

Expected outcome:

- flat terrain: almost no difference;
- mountains: fewer visible and shadow tree instances;
- fast movement: no obvious popping;
- missing NAADF data: safe fallback to visible.

## Risks

### Over-culling

Visible trees disappear behind small terrain errors.

Mitigation:

- keep near trees always visible;
- use conservative margins;
- use crown height;
- keep unknown as visible;
- add debug overlay before default enable.

### Popping

Clusters can appear/disappear during camera movement.

Mitigation:

- add hysteresis;
- fade cluster visibility where possible;
- only cull far bands first;
- delay cluster rejection until stable for a few frames.

### Shader cost

Per-candidate visibility sampling may cost more than it saves in flat scenes.

Mitigation:

- distance-gate the test;
- only run for far/impostor bands at first;
- move to cluster-level rejection quickly;
- disable in flat scenes if no ridges are detected.

### Data mismatch

CLOD heightfield summary and Rust NAADF 16³ voxel cache are not identical.

Mitigation:

- keep browser PoC as validation only;
- implement Rust using Rust NAADF cache, not browser approximation;
- compare visual behavior scene-by-scene.

## Debug UI

Add toggles:

```text
treeTerrainCullEnabled
showTerrainHiddenTrees
showTerrainCullRays
showTerrainCullClusters
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

CLOD work is done when:

- GPU tree-ring path rejects terrain-hidden far tree candidates;
- stats expose terrain-hidden counts;
- mountain/valley scenes show lower visible and shadow counts;
- flat scene stays visually and numerically close to baseline;
- no near-tree popping is visible;
- local `npm test` passes;
- the design is ready to port to Rust/Bevy page-level vegetation culling.

## Definition Of Done For Rust/Bevy

Rust/Bevy work is done when:

- NAADF derived terrain cache can answer conservative page/cluster visibility queries;
- tree/vegetation draw generation consumes those visibility decisions;
- unknown/missing NAADF data safely falls back to visible;
- vegetation stats expose hidden cluster counts;
- benchmark scenes prove a measurable reduction in CPU/GPU vegetation cost;
- quality regression captures show no visible missing forest.

## Recommendation

Do this in two layers:

1. **Short term:** activate the existing GPU ridge filter in CLOD tree-ring shader.
2. **Medium term:** replace the ridge approximation with NAADF-backed page/cluster visibility.

That gives us a fast win now while moving toward the correct architecture: NAADF as a shared terrain visibility accelerator for all vegetation, not a per-tree renderer.
