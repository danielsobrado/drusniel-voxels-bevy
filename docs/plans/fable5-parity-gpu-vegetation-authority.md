# Fable5 Parity 2 — Canonical GPU Vegetation Authority and Compaction

Status: implementation plan.

Scope: `tools/clod-poc` first, then Rust/Bevy using the same data contracts and acceptance rules.

This document is prescriptive. The implementer must not choose a different ownership model, candidate flow, terrain source, compaction method, buffer layout, fallback policy, or validation threshold.

## 1. Goal

Move tree, grass, understory, stones, and ecological dressing candidate classification and compaction fully onto the GPU while keeping Drusniel's canonical carved terrain, voxel edits, caves, persistent props, construction exclusions, and deterministic world identity authoritative.

The completed path must:

- consume the canonical carved heightfield tile atlas;
- consume voxel/NAADF occupancy and edit masks where heightfields are insufficient;
- consume hydrology body, shore, wetness, and flow channels;
- reject clusters before candidate generation;
- generate candidates only for accepted clusters;
- compact accepted and visible instances on the GPU;
- classify camera LOD and shadow-cascade membership on the GPU;
- issue indirect draws without normal gameplay readback;
- keep CPU generators as deterministic test oracles only;
- remain safe when data is missing by keeping uncertain work rather than creating holes.

## 2. Fixed ownership model

The vegetation pipeline has one authority chain:

```text
WorldManifest + terrain source hash
  -> canonical carved heightfield tiles
  -> hydrology graph/atlas
  -> voxel overlay and saved edit masks
  -> unified far-summary / NAADF visibility providers
  -> deterministic vegetation cluster records
  -> GPU cluster classification
  -> GPU candidate generation
  -> GPU candidate acceptance and compaction
  -> GPU LOD/cascade classification
  -> indirect render and shadow draws
```

No vegetation shader may call the legacy procedural `surfaceHeightField()` when the canonical tile atlas is available.

No CPU placement path may be used in normal gameplay for streamed tree, grass, understory, or stone rings after the default flip.

Persistent hand-placed or saved project props remain separate and continue through the existing prop persistence system.

## 3. Vegetation categories

Use exactly these GPU categories:

```text
TREE
GRASS
UNDERSTORY
STONE
DRESSING
```

`UNDERSTORY` contains shrubs, ferns, saplings, flowers, dead logs, and stumps until the ecological-dressing plan expands its class table.

`DRESSING` contains lightweight cosmetic clusters that are regenerated deterministically and do not have individual save records.

Every category uses the same cluster authority, terrain sampling contract, active-cluster buffer format, and rejection semantics.

## 4. Spatial hierarchy

### 4.1 Cluster grid

Use a world-anchored square cluster grid:

```yaml
vegetation_gpu_authority:
  schema_version: 1
  cluster_size_m: 32
  cluster_probe_grid: 3
  near_force_visible_radius_m: 64
  maximum_cluster_distance_m: 4096
```

Each cluster is identified by:

```text
cluster_x = floor(world_x / 32)
cluster_z = floor(world_z / 32)
cluster_id = stableHash(world_id, category, cluster_x, cluster_z)
```

Cluster identity must not depend on camera location, ring index, residency order, or frame number.

### 4.2 Candidate cells

Within a cluster, each category uses fixed candidate-cell spacing:

```yaml
candidate_spacing_m:
  trees: 3.4
  grass: 0.85
  understory: 1.7
  stones: 2.2
  dressing: 1.25
```

The candidate count per cluster is derived only from cluster size and spacing. Candidate index plus cluster ID and world seed determine all random values.

No candidate arrays are generated on the CPU.

## 5. Canonical terrain sampling

Create one GPU sampling module used by all vegetation kernels:

```text
tools/clod-poc/src/vegetation/gpu_authority/terrain_sampling.wgsl
```

It must sample in this order:

1. Canonical heightfield tile atlas for base height, normal, material, sediment, hardness, wetness, water, shore distance, and flow.
2. Voxel overlay surface correction within voxel-overlay residency.
3. Saved terrain edit mask and project-prop exclusion mask.
4. NAADF/occupancy summary for caves, voids, ceilings, overhangs, and conservative terrain visibility.
5. Unified far summary outside exact residency.

The returned structure is fixed:

```wgsl
struct VegetationSurfaceSample {
    position_ws: vec3<f32>,
    normal_ws: vec3<f32>,
    material_weights: vec4<f32>,
    water_depth_m: f32,
    shore_distance_m: f32,
    wetness: f32,
    flow: vec2<f32>,
    canopy_coverage: f32,
    cave_coverage: f32,
    structure_coverage: f32,
    validity: u32,
    flags: u32,
};
```

Validity values:

```text
0 = missing/unknown
1 = coarse conservative summary
2 = canonical heightfield
3 = canonical heightfield plus exact voxel overlay
```

Unknown samples are never rejected solely because they are unknown.

## 6. Fixed GPU pipeline

The frame pipeline is:

```text
A. Plan required world-anchored cluster ranges on CPU
B. Upload only cluster range descriptors and revisions
C. GPU classify clusters
D. GPU compact active clusters with atomic append
E. GPU generate candidates for active clusters only
F. GPU evaluate terrain/ecology/exclusions
G. GPU compact accepted instances
H. GPU classify camera LOD and shadow cascades
I. GPU write indirect arguments
J. Render camera and shadow batches
```

CPU work is limited to planning ring bounds, uploading small descriptors, and binding resources.

### 6.1 Compaction method

Use atomic append counters. Do not implement a scan/prefix-sum system in this phase.

Every output list has:

```text
atomic count
fixed-capacity storage buffer
atomic overflow flag
```

Overflow is a hard acceptance failure, not a silently dropped condition.

### 6.2 Dispatch granularity

```text
cluster classification: one invocation per cluster
candidate generation: one workgroup per active cluster
candidate acceptance: one invocation per candidate
LOD/cascade classification: one invocation per accepted instance
```

Workgroup sizes:

```text
cluster classification: 64 x 1 x 1
candidate generation: 64 x 1 x 1
candidate acceptance: 128 x 1 x 1
LOD/cascade classification: 128 x 1 x 1
```

## 7. Buffer contracts

Create:

```ts
export interface VegetationClusterDescriptor {
  clusterX: number;
  clusterZ: number;
  category: number;
  candidateStart: number;
  candidateCount: number;
  terrainRevision: number;
  providerRevision: number;
  flags: number;
}
```

WGSL layout:

```wgsl
struct VegetationClusterDescriptor {
    cluster_x: i32,
    cluster_z: i32,
    category: u32,
    candidate_start: u32,
    candidate_count: u32,
    terrain_revision: u32,
    provider_revision: u32,
    flags: u32,
};
```

Active cluster record:

```wgsl
struct ActiveVegetationCluster {
    descriptor_index: u32,
    rejection_mask: u32,
    visibility_class: u32,
    reserved: u32,
};
```

Candidate record:

```wgsl
struct VegetationCandidate {
    position_ws: vec4<f32>,      // xyz + scale
    rotation_normal: vec4<f32>,  // rotationY + normal xyz
    identity: vec4<u32>,         // category, class/species, variant, stable id low
    ecology: vec4<f32>,          // moisture, exposure, forest influence, age
    aux: vec4<f32>,              // wind phase, shore affinity, slope, health
};
```

Accepted instance record:

```wgsl
struct VegetationInstance {
    position_scale: vec4<f32>,
    rotation_normal_y: vec4<f32>,
    identity: vec4<u32>,
    morphology0: vec4<f32>,
    morphology1: vec4<f32>,
};
```

All structures are 16-byte aligned and mirrored by TypeScript packing tests.

## 8. Cluster rejection rules

Cluster classification samples a fixed `3 x 3` probe grid at ground level plus one elevated center probe.

A cluster may be rejected only when all required probes agree on a conservative reason.

Fixed rejection bits:

```text
1 << 0 OUTSIDE_WORLD
1 << 1 TERRAIN_HIDDEN
1 << 2 NO_SURFACE_COVERAGE
1 << 3 WATER_ONLY
1 << 4 CAVE_VOID_ONLY
1 << 5 STRUCTURE_EXCLUDED
1 << 6 EDIT_EXCLUDED
1 << 7 DISTANCE_CULLED
```

Category rules:

- Trees: reject `WATER_ONLY`, `CAVE_VOID_ONLY`, and excessive slope; preserve river-bank trees where dry-bank probes remain.
- Grass: reject water, rock-dominant steep surfaces, cave void, structure footprints, and dense canopy where configured grass density is zero.
- Understory: require forest influence or configured open-biome class coverage.
- Stones: allow rock, river bank, talus, and shore; reject deep water and unsupported overhang positions.
- Dressing: obey class-specific surface and parent-attachment rules.

Missing sampler data, mixed probes, uncertain summaries, or stale revisions keep the cluster active.

Near clusters inside `near_force_visible_radius_m` bypass terrain-visibility rejection but still obey water, void, and explicit edit exclusions.

## 9. Candidate generation

Candidate random values use a common integer hash:

```text
hash(world_seed, category, cluster_x, cluster_z, candidate_index, channel)
```

The GPU hash implementation must match the CPU oracle bit-for-bit.

Candidate position:

```text
world cell center
+ deterministic jitter within 45% of spacing
+ category-specific clustering offset
```

Candidate generation writes positions only for active clusters. It must not sample terrain yet.

Candidate acceptance samples canonical terrain and computes:

- exact surface height;
- exact or conservative normal;
- material weights;
- water depth and shore distance;
- slope acceptance;
- biome and ecology weights;
- project-prop and construction exclusions;
- saved destruction exclusions;
- voxel void/support validation;
- class/species selection;
- scale, rotation, wind phase, age, health, and morphology seed.

Accepted records are atomically appended to the per-category instance buffer.

## 10. Ecology parity

Use the existing ecology functions as the semantic source. Port their formulas to WGSL without changing thresholds:

```text
tree_ecology.ts
understory_ecology.ts
tree_material_bias.ts
understory terrain bias
stone scatter terrain affinity
hydrology shore/wetness rules
```

Create paired modules:

```text
tools/clod-poc/src/vegetation/gpu_authority/ecology_cpu.ts
tools/clod-poc/src/vegetation/gpu_authority/ecology.wgsl
```

The CPU module is the oracle. Existing category-specific ecology helpers must delegate to it so there is one formula set.

## 11. Voxel and edit preservation

### 11.1 Voxel overlay

Within exact voxel-overlay residency:

- sample the voxel surface rather than the base heightfield where the overlay changes the surface;
- reject candidates inside carved voids;
- allow cave-floor vegetation only when the class explicitly supports caves;
- reject floating candidates whose support ray has no solid hit within the configured support depth;
- align instances to the actual voxel surface normal.

### 11.2 Saved edits

Saved terrain and prop edits provide GPU exclusion/inclusion masks keyed by stable world cells.

A destroyed environmental prop adds its stable ID to the exclusion store. GPU candidate acceptance checks a compact cuckoo/hash table of excluded IDs.

A terrain edit invalidates only overlapping clusters. It does not regenerate the entire ring.

### 11.3 Construction

Construction footprints upload conservative AABB/OBB exclusion records. Candidate acceptance rejects vegetation under structures and within configured work margins.

The construction system remains authoritative. Vegetation never edits or moves construction entities.

## 12. LOD and shadow classification

After accepted-instance compaction, one compute pass writes category-specific groups.

Tree groups:

```text
6 species x 4 visual LODs
6 species x 4 shadow cascades x 3 shadow geometry classes
```

Grass groups:

```text
near blades
mid clumps
far coverage cards
```

Understory groups:

```text
class x near/mid/far
class x shadow near/proxy
```

Stone groups:

```text
class x near/mid/far
```

Crossfade masks are complementary and world/screen anchored as already established by the tree path.

Shadow-cascade classification occurs before camera-frustum rejection so off-screen casters remain valid.

## 13. No-readback policy

Normal gameplay:

```text
GPU count readback: off
GPU instance readback: off
CPU parity comparison: off
indirect argument readback: off
```

Debug and acceptance may request asynchronous count readbacks after the measured frame window. A readback-enabled run must be labeled as debug and must never be used to claim gameplay performance.

## 14. Configuration

Create `tools/clod-poc/config/vegetation_gpu_authority.yaml`:

```yaml
vegetation_gpu_authority:
  schema_version: 1
  enabled: true
  cluster_size_m: 32
  cluster_probe_grid: 3
  near_force_visible_radius_m: 64
  maximum_cluster_distance_m: 4096
  active_cluster_capacity: 65536

  candidate_spacing_m:
    trees: 3.4
    grass: 0.85
    understory: 1.7
    stones: 2.2
    dressing: 1.25

  capacities:
    tree_candidates: 262144
    grass_candidates: 2097152
    understory_candidates: 1048576
    stone_candidates: 524288
    dressing_candidates: 1048576
    tree_instances: 262144
    grass_instances: 1572864
    understory_instances: 786432
    stone_instances: 393216
    dressing_instances: 786432

  rejection:
    maximum_tree_slope_degrees: 38
    maximum_grass_slope_degrees: 32
    maximum_understory_slope_degrees: 42
    support_ray_depth_m: 4
    deep_water_m: 0.20

  invalidation:
    camera_cluster_snap: 1
    terrain_revision_required: true
    provider_revision_required: true

  debug:
    readback_counts: false
    validate_against_cpu: false
    show_cluster_reasons: false
```

Unknown keys and invalid capacities fail startup.

## 15. TypeScript module layout

Create:

```text
tools/clod-poc/src/vegetation/gpu_authority/
  config.ts
  constants.ts
  types.ts
  hashes.ts
  cluster_grid.ts
  cluster_planner.ts
  buffer_layout.ts
  buffer_pool.ts
  terrain_bindings.ts
  hydrology_bindings.ts
  voxel_bindings.ts
  exclusion_bindings.ts
  ecology_cpu.ts
  pipeline.ts
  dispatch.ts
  indirect_groups.ts
  invalidation.ts
  counters.ts
  validation.ts
  integration.ts
  shaders/
    common.wgsl
    hash.wgsl
    terrain_sampling.wgsl
    ecology.wgsl
    classify_clusters.compute.wgsl
    generate_candidates.compute.wgsl
    accept_candidates.compute.wgsl
    classify_lod_shadow.compute.wgsl
    finalize_indirect.compute.wgsl
```

Integration changes:

- existing tree, grass, understory, and stone GPU runtimes receive compacted instance buffers rather than generating independent candidate grids;
- existing render materials and geometry remain in place;
- existing CPU placement functions remain available only to tests, editor preview, and explicit oracle mode;
- the old CPU-built active-slot prefilter is removed after parity acceptance.

## 16. Rust/Bevy module layout

Create:

```text
src/rendering/vegetation/gpu_authority/
  mod.rs
  config.rs
  types.rs
  buffers.rs
  cluster_grid.rs
  planner.rs
  pipelines.rs
  bind_groups.rs
  dispatch.rs
  indirect.rs
  invalidation.rs
  diagnostics.rs

assets/shaders/vegetation_gpu_authority/
  common.wgsl
  hash.wgsl
  terrain_sampling.wgsl
  ecology.wgsl
  classify_clusters.wgsl
  generate_candidates.wgsl
  accept_candidates.wgsl
  classify_lod_shadow.wgsl
  finalize_indirect.wgsl
```

The Bevy render-world system consumes extracted immutable descriptors and GPU resources. Simulation-world systems do not inspect compacted instance lists.

## 17. Implementation sequence

### VEG-GPU-1 — Shared contracts

- Add config, cluster IDs, hashes, layouts, capacity validation, and CPU packing tests.
- Add canonical terrain-sample interface.

Exit gate: TypeScript/WGSL layouts and hashes match exactly.

### VEG-GPU-2 — Canonical terrain bindings

- Bind the carved tile atlas, hydrology atlas, voxel overlay, exclusions, and far summary.
- Remove direct procedural-height sampling from GPU understory and other active GPU categories.

Exit gate: river and lake placement parity shows no CPU/GPU height mismatch.

### VEG-GPU-3 — Cluster classification and compaction

- Implement probe classification, atomic active-cluster append, reason counters, and overflow handling.

Exit gate: conservative CPU/GPU classification matches on deterministic scenes.

### VEG-GPU-4 — Candidate generation

- Generate candidate positions only from active clusters.
- Validate stable hashes and counts.

Exit gate: candidate identities and positions match CPU oracle samples.

### VEG-GPU-5 — Acceptance and ecology

- Port ecology formulas and exclusions.
- Compact accepted instances.

Exit gate: species/class distributions, rejection reasons, and accepted positions meet parity thresholds.

### VEG-GPU-6 — LOD, cascades, and indirect draws

- Classify visual groups and shadow groups.
- Produce indirect args and connect existing render geometry/materials.

Exit gate: no direct per-frame CPU instance uploads remain for streamed categories.

### VEG-GPU-7 — Invalidation and voxel edits

- Add cluster-local dirtying for terrain, construction, save, and provider revisions.
- Preserve old valid buffers until replacements commit.

Exit gate: edits produce no one-frame vegetation holes or full-ring rebuild spikes.

### VEG-GPU-8 — Default flip and cleanup

- Make GPU authority default-on.
- Remove legacy active-slot CPU construction from normal gameplay.
- Keep explicit oracle mode for tests only.

Exit gate: all acceptance and performance gates pass.

## 18. Tests

Required tests:

- world-anchored cluster IDs remain stable across camera movement;
- hash values match CPU and WGSL;
- buffer layouts match byte-for-byte;
- unknown terrain samples keep clusters active;
- mixed visible/hidden probes keep clusters active;
- all-hidden probes reject terrain-hidden clusters;
- carved river terrain produces identical CPU/GPU height placement;
- water-only clusters reject trees, grass, and normal understory;
- shore clusters preserve configured bank vegetation and stones;
- cave void rejects unsupported surface vegetation;
- cave floor accepts cave-enabled classes only;
- construction and saved exclusions reject matching stable IDs;
- terrain revision invalidates only overlapping clusters;
- old buffers remain visible until coherent replacement;
- off-screen tree casters remain in shadow cascades;
- indirect counts equal compacted group counts;
- every capacity overflow fails the test;
- normal gameplay path performs zero readbacks.

## 19. Acceptance scenes

```text
vegetation-canonical-river
  trees, grass, stones, and understory across carved banks

vegetation-cave-mouth
  voxel void, cave floor, overhang, and unsupported surface cases

vegetation-construction-edit
  place/delete structure and confirm local invalidation

vegetation-destruction
  destroy environmental props and confirm persistent exclusion

vegetation-occluded-valley
  terrain-hidden clusters proving early rejection

vegetation-4km-traverse
  long route through dense forest, shore, meadow, rock, and cave regions
```

Each scene captures GPU-authority and CPU-oracle outputs with identical seed and camera.

## 20. Counters

Expose:

```text
vegetation_gpu_clusters_total
vegetation_gpu_clusters_active
vegetation_gpu_clusters_rejected
vegetation_gpu_clusters_unknown_kept
vegetation_gpu_reject_outside_world
vegetation_gpu_reject_terrain_hidden
vegetation_gpu_reject_no_surface
vegetation_gpu_reject_water_only
vegetation_gpu_reject_cave_void
vegetation_gpu_reject_structure
vegetation_gpu_reject_edit
vegetation_gpu_candidates_before_reject
vegetation_gpu_candidates_generated
vegetation_gpu_candidates_accepted
vegetation_gpu_instances_visible
vegetation_gpu_shadow_casters
vegetation_gpu_overflow_count
vegetation_gpu_readback_count
vegetation_gpu_classify_ms
vegetation_gpu_generate_ms
vegetation_gpu_accept_ms
vegetation_gpu_lod_shadow_ms
vegetation_gpu_finalize_ms
```

Per-category copies of candidate and accepted counters are required.

## 21. Performance gates

Dense 4 km forest route on target desktop GPU:

```text
normal gameplay GPU readbacks = 0
capacity overflows = 0
main-thread vegetation p95 <= 1.0 ms
GPU authority total p95 <= 2.5 ms
candidate generated / candidate theoretical <= 0.70 in occluded-valley scene
frame p95 must not regress by more than 5% versus the accepted GPU-ring baseline
movement max frame must not contain a monolithic vegetation rebuild spike above 8 ms
```

A lower visible-instance count alone is not a performance proof. Candidate budget, pass timing, frame timing, and visual parity must all be recorded.

## 22. Visual and correctness gates

- No floating or buried vegetation around graph-carved water.
- No vegetation inside saved cave voids or construction footprints.
- No visible holes caused by uncertain summaries.
- No camera-relative pattern swimming.
- No LOD boundary double draw or empty band.
- Near, far, and impostor tree placement represents the same deterministic forest.
- Off-screen shadow casters remain valid.
- Species and understory distributions stay within 2% of CPU oracle counts per accepted scene.
- Sampled accepted positions differ by no more than 1 cm and normals by no more than 0.5 degrees from CPU oracle values.

## 23. Explicit non-goals

Do not:

- replace canonical tiles with procedural shader height;
- make vegetation authoritative over terrain or saves;
- read back instance lists during gameplay;
- rebuild every cluster after a local edit;
- silently drop overflowed candidates;
- reject uncertain clusters;
- merge persistent project props into the streamed candidate system;
- remove existing geometry, materials, wind, impostors, or shadow proxy systems;
- port the CLOD-POC heightfield approximation as Bevy's voxel truth.
