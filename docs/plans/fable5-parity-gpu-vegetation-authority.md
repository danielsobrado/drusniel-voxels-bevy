# Fable5 Parity 2 — Canonical GPU Vegetation Authority and Compaction

Status: implementation in progress.

Scope: `tools/clod-poc` first, then Rust/Bevy using the same data contracts and acceptance rules.

This document is prescriptive. The implementer must not choose a different ownership model, candidate flow, terrain source, compaction method, buffer layout, fallback policy, or validation threshold.

Cross-plan build order, the shared hash/terrain-sample contracts, and the reconciled frame and VRAM budget live in `fable5-parity-index-and-budget-2026-07-15.md`. Read it before implementing: this plan is the pipeline that Plans 4 and 5 extend, so its budget is a sub-allocation of the whole-frame gate, not an independent promise.

## Implementation status — 2026-07-15

| Milestone | Status | Evidence / remaining gate |
|---|---|---|
| VEG-GPU-1 | Code complete | Shared config, cluster grid/planner, integer PCG/hash modules, fixed surface/instance layouts, capacity validation, and packing/golden-vector tests are in `src/vegetation/gpu_authority`. The composed tree ring delegates to the shared PCG implementation. |
| VEG-GPU-2 | In progress | Canonical carved-height atlas and explicit toroidal-slot residency are bound to tree, grass, understory, and stone compute. Startup and streaming hydrology remain authoritative over the base height, canonical finite-difference normals are shared, understory no longer reads procedural height directly, and the CPU oracle fixes provider precedence. Exact GPU voxel/occupancy, project-prop exclusion, and far-summary bindings plus the native Windows river/lake parity capture remain. |
| VEG-GPU-3..8 | Pending | Do not start VEG-GPU-3 until the remaining VEG-GPU-2 bindings and native exit gate are complete. |

Verification completed for the landed code: focused Vitest coverage for contracts, hashes,
layouts, cluster planning, atlas residency, provider order, and composed WGSL; full
`tools/clod-poc` TypeScript typecheck; production Vite build; and the sample QA smoke
(reported `baseline_missing`, so it is not a visual baseline). Browser visual/performance
acceptance is not claimed from this non-Windows run.

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
  -> fused GPU candidate generation, terrain/ecology acceptance, and compaction
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
  maximum_cluster_distance_m:
    # Design defaults; VEG-GPU-6 tunes them only through measured preset changes.
    ultra:    { trees: 620, grass: 192, understory: 192, stones: 1024, dressing: 512 }
    balanced: { trees: 420, grass: 125, understory: 110, stones: 700,  dressing: 320 }
    perf:     { trees: 300, grass: 96,  understory: 80,  stones: 600,  dressing: 224 }
    potato:   { trees: 180, grass: 64,  understory: 56,  stones: 320,  dressing: 160 }
```

Each cluster is identified by:

```text
cluster_x = floor(world_x / 32)
cluster_z = floor(world_z / 32)
cluster_id_lo, cluster_id_hi = vegetationHash2(
  world_seed, category, schema_version, cluster_x, cluster_z, CLUSTER_ID_CHANNEL)
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

Candidate cells are a world-anchored lattice per category; they are not a rounded
`32 / spacing` grid local to each cluster. A cluster owns every lattice-cell center in
its half-open bounds `[cluster_min, cluster_max)`. Compute the inclusive/exclusive cell
range with `ceil(cluster_min / spacing)` and `ceil(cluster_max / spacing)`. This defines
an exact count even when spacing does not divide 32 m. Jitter and clustering offsets may
move the final point across the owner boundary, but ownership and identity remain with
the original global cell, so no neighboring cluster can duplicate it.

The global candidate-cell coordinates, category, channel, schema version, and world seed
determine all random values. A cluster-local enumeration index is diagnostic only and
must not become identity.

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

The semantic TypeScript contract is fixed:

```ts
export interface VegetationSurfaceSample {
  readonly positionWs: readonly [number, number, number];
  readonly normalWs: readonly [number, number, number];
  readonly materialWeights: readonly [number, number, number, number];
  readonly waterDepthM: number;
  readonly shoreDistanceM: number;
  readonly wetness: number;
  readonly moisture: number;
  readonly sediment: number;
  readonly deposition: number;
  readonly hardness: number;
  readonly flow: readonly [number, number];
  readonly canopyCoverage: number;
  readonly canopyHeightM: number;
  readonly caveCoverage: number;
  readonly structureCoverage: number;
  readonly validity: number;
  readonly flags: number;
}
```

Its WGSL mirror is fixed:

```wgsl
struct VegetationSurfaceSample {
    position_ws: vec3<f32>,
    normal_ws: vec3<f32>,
    material_weights: vec4<f32>,
    water_depth_m: f32,
    shore_distance_m: f32,
    wetness: f32,
    moisture: f32,
    sediment: f32,
    deposition: f32,
    hardness: f32,
    flow: vec2<f32>,
    canopy_coverage: f32,
    canopy_height_m: f32,
    cave_coverage: f32,
    structure_coverage: f32,
    validity: u32,
    flags: u32,
};
```

The host-shareable layout is 112 bytes: `position_ws` at 0, `normal_ws` at 16,
`material_weights` at 32, scalar fields at 48..75, `flow` at 80, and remaining
scalar/u32 fields at 88..111. TypeScript and Rust mirrors use these
explicit offsets; implicit host-language struct layout is forbidden. Dressing's GPU
sample preserves this 112-byte prefix exactly.

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
E. GPU generate, evaluate, and append accepted instances in one fused dispatch
F. GPU classify camera LOD and shadow cascades
G. GPU write indirect arguments
H. Render camera and shadow batches
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

Atomic append makes compacted output order nondeterministic even though instance identity
is stable. Streamed vegetation therefore uses only opaque or alpha-tested/coverage-dithered
materials: trees, grass, understory, and dressing cards are coverage-dithered; stones are
opaque. Order-dependent alpha blending is forbidden for these lists. A future category
that requires blending must add a stable GPU sort and include its cost in the budget.
Plan 6 determinism signatures are commutative multisets (count plus independent XOR and
sum accumulators over both stable-ID words), never hashes of append order.

### 6.2 Dispatch granularity

```text
cluster classification: one invocation per cluster
fused generation/acceptance: one workgroup per active cluster, with invocations striding
  the exact world-lattice cells owned by that cluster
LOD/cascade classification: one invocation per accepted instance
```

Workgroup sizes:

```text
cluster classification: 64 x 1 x 1
fused generation/acceptance: 128 x 1 x 1
LOD/cascade classification: 128 x 1 x 1
```

## 7. Buffer contracts

Create:

```ts
export interface VegetationClusterDescriptor {
  clusterX: number;
  clusterZ: number;
  category: number;
  candidateCount: number;
  terrainRevision: number;
  providerRevision: number;
  flags: number;
  reserved: number;
}
```

WGSL layout:

```wgsl
struct VegetationClusterDescriptor {
    cluster_x: i32,
    cluster_z: i32,
    category: u32,
    candidate_count: u32,
    terrain_revision: u32,
    provider_revision: u32,
    flags: u32,
    reserved: u32,
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

There is no global `VegetationCandidate` storage buffer. The fused dispatch keeps a
candidate in invocation registers, samples terrain/ecology immediately, and appends only
accepted records. The theoretical/generated/rejected counters remain available through
atomics.

Accepted records use one logical 48-byte identity/transform prefix. Layouts are flattened
in WGSL storage structs but preserve this exact prefix:

```wgsl
struct VegetationGenericInstance { // 64 bytes
    position_scale: vec4<f32>,
    rotation_normal_y: vec4<f32>,
    identity: vec4<u32>, // category, packed class|variant, stable_id_lo, stable_id_hi
    render0: vec4<f32>,  // moisture, exposure, wind phase, health
};

struct VegetationTreeInstance { // 96 bytes
    position_scale: vec4<f32>,
    rotation_normal_y: vec4<f32>,
    identity: vec4<u32>, // same 48-byte prefix
    morphology0: vec4<f32>,
    morphology1: vec4<f32>,
    morphology2: vec4<f32>,
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

VEG-GPU-1 creates shared `pcg2d.ts` and `pcg2d.wgsl` modules and changes the existing
tree-ring helpers to delegate to them. The integer core is the shipped PCG arithmetic:
`M = 1664525`, `C = 1013904223`, the existing `+40000` signed-cell bias and 14-bit salt
partition, and the same two xor-shift rounds. `treePcg2dU32` returns the unmasked
`a5,b5` words; `treePcg2d01` alone applies the existing low-24-bit mask and `1/2^24`
normalization.

Category assignments are fixed:

```text
TREE=1, GRASS=2, UNDERSTORY=3, STONE=4, DRESSING=5
```

Shared channel assignments are fixed:

```text
DOMAIN_CHANNEL=0x1001, CLUSTER_ID_CHANNEL=0x1002,
IDENTITY_CHANNEL=0x1003, JITTER_CHANNEL=0x1004,
CLASS_CHANNEL=0x1005, SCALE_CHANNEL=0x1006,
ROTATION_CHANNEL=0x1007, WIND_CHANNEL=0x1008,
AGE_CHANNEL=0x1009, HEALTH_CHANNEL=0x100a
```

Every caller uses this exact tuple fold (`rotl32` and all arithmetic wrap at u32):

```text
seed_hash = treePcg2dU32(bitcast_i32(world_seed),
                         bitcast_i32(rotl32(world_seed, 16) ^ schema_version),
                         DOMAIN_CHANNEL ^ category)
domain_salt = seed_hash.x ^ seed_hash.y
cell_hash = treePcg2dU32(global_cell_x, global_cell_z, domain_salt)
value_hash(channel) = treePcg2dU32(bitcast_i32(cell_hash.x), bitcast_i32(cell_hash.y),
                                   channel ^ seed_hash.y)
identity_channel = IDENTITY_CHANNEL ^ (class_or_species_id * 0x9e3779b9u)
identity_hash = value_hash(identity_channel)
stable_id_lo = identity_hash.x
stable_id_hi = identity_hash.y
```

Golden identity vectors (decimal u32) are normative:

| world seed | category | schema | global cell | class/species | stable lo | stable hi |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | (0, 0) | 2 | 3370872567 | 1728742118 |
| 19 | 5 | 1 | (-1, -1) | 17 | 682912007 | 910565973 |
| 4026531841 | 4 | 3 | (-40000, 40000) | 9 | 2440714017 | 2919868272 |

`channel` is a numeric constant from the shared module; callers may not invent
string hashing or reorder the tuple. Category and channel numeric assignments are
versioned data. The `bitcast_i32` conversion above is a bit reinterpretation
(`bitcast<i32>` in WGSL, `| 0` in TypeScript, `as i32` in Rust), not a saturating numeric
conversion. ID always uses the fixed identity-channel fold after class/species selection;
jitter, class selection, scale, rotation, and every other random value use their own
fixed channel. The GPU implementation must match the TypeScript and Rust CPU oracles
bit-for-bit, including negative cells and u32 wraparound. Golden vectors cover boundary
coordinates, all categories, multiple channels, and stable IDs. Plans 4 and 5 consume
the resulting two-word ID; their `hash64` notation means concatenating these words, not
introducing another hash family.

Candidate position:

```text
world cell center
+ deterministic jitter within 45% of spacing
+ category-specific clustering offset
```

The fused generation/acceptance dispatch samples canonical terrain and computes:

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
  maximum_cluster_distance_m:
    ultra:    { trees: 620, grass: 192, understory: 192, stones: 1024, dressing: 512 }
    balanced: { trees: 420, grass: 125, understory: 110, stones: 700,  dressing: 320 }
    perf:     { trees: 300, grass: 96,  understory: 80,  stones: 600,  dressing: 224 }
    potato:   { trees: 180, grass: 64,  understory: 56,  stones: 320,  dressing: 160 }

  candidate_spacing_m:
    trees: 3.4
    grass: 0.85
    understory: 1.7
    stones: 2.2
    dressing: 1.25

  # Design-stage starting allocations, not measurements. VEG-GPU-6 may change them
  # only with the same-preset harness evidence and updated memory accounting.
  accepted_instance_capacity:
    ultra:    { trees: 50000, grass: 262144, understory: 65536, stones: 131072, dressing: 262144 }
    balanced: { trees: 30000, grass: 131072, understory: 32768, stones: 65536,  dressing: 131072 }
    perf:     { trees: 16000, grass: 65536,  understory: 16384, stones: 32768,  dressing: 65536 }
    potato:   { trees: 8000,  grass: 32768,  understory: 8192,  stones: 16384,  dressing: 32768 }

  authority_buffer_vram_mib_max:
    ultra: 384
    balanced: 256
    perf: 160
    potato: 96
  portable_storage_binding_mib_max: 128

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

Unknown keys and invalid capacities fail startup. Active-cluster descriptor capacity is
derived at startup from the exact union of per-category cluster ranges for the selected
preset, not a hand-written constant.

The instance capacities above are initial design allocations and deliberately replace
the former global candidate buffers. Allocate one double-buffered storage pair per
category; never allocate one monolithic cross-category instance buffer. The active pair
remains renderable while the replacement pair is filled, then swaps coherently. At
startup, compute bytes as two times `tree_capacity * 96` plus two times
`other_capacity * 64`, then add active clusters, counters, and indirect arguments. The
total must fit the selected preset cap. Every category binding must fit both
`device.limits.maxStorageBufferBindingSize` and the 128 MiB portable ceiling. Startup
fails before allocation if either condition is false. Overflow is a hard failure. A smaller
preset never silently truncates or changes identity; VEG-GPU-6 must tune distance,
density acceptance, and capacity together and pass the worst-case acceptance scenes.

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
    generate_accept.compute.wgsl
    classify_lod_shadow.compute.wgsl
    finalize_indirect.compute.wgsl
```

Integration changes:

- existing tree, grass, understory, and stone GPU runtimes receive compacted instance buffers rather than generating independent candidate grids;
- existing render materials and geometry remain in place;
- existing CPU placement functions remain available only to tests, editor preview, and explicit oracle mode;
- the old CPU-built active-slot prefilter is removed after parity acceptance.

The existing per-category ring compute shaders are the code this pipeline replaces: `src/gpu/shaders/tree_ring.compute.wgsl`, `grass_ring.compute.wgsl`, `understory_ring.compute.wgsl`, and `stone_scatter.compute.wgsl`. For each, record in VEG-GPU-6 whether it is deleted or reduced to a thin wrapper that binds the unified compacted buffers, and delete the legacy scatter path at VEG-GPU-8. The §21 GPU budget must be booked as a net delta over this removed work, not as a fresh addition; measure the legacy scatter cost before removal so the delta is provable.

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
  generate_accept.wgsl
  classify_lod_shadow.wgsl
  finalize_indirect.wgsl
```

The Bevy render-world system consumes extracted immutable descriptors and GPU resources. Simulation-world systems do not inspect compacted instance lists.

## 17. Implementation sequence

### VEG-GPU-1 — Shared contracts

Status: code complete on 2026-07-15.

- Add config, cluster IDs, hashes, layouts, capacity validation, and CPU packing tests.
- Add canonical terrain-sample interface.

Exit gate: TypeScript/WGSL layouts and hashes match exactly.

### VEG-GPU-2 — Canonical terrain bindings

Status: in progress. Canonical height/hydrology integration is code complete; exact
GPU voxel/occupancy, project-prop exclusion, far-summary binding, and native visual
acceptance remain.

- Bind the carved tile atlas, hydrology atlas, voxel overlay, exclusions, and far summary.
- Remove direct procedural-height sampling from GPU understory and other active GPU categories.

Exit gate: river and lake placement parity shows no CPU/GPU height mismatch.

### VEG-GPU-3 — Cluster classification and compaction

- Implement probe classification, atomic active-cluster append, reason counters, and overflow handling.

Exit gate: conservative CPU/GPU classification matches on deterministic scenes.

### VEG-GPU-4 — Fused candidate generation and acceptance skeleton

- Enumerate the exact world-anchored lattice only for active clusters.
- Generate, sample, and accept within one dispatch; do not materialize a candidate buffer.
- Validate stable hashes, theoretical counts, generated counts, and positions.

Exit gate: candidate identities and positions match CPU oracle samples.

### VEG-GPU-5 — Ecology, exclusions, and accepted compaction

- Complete the fused kernel with ecology formulas and exclusions.
- Compact accepted generic/tree instance layouts.

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
vegetation_gpu_generate_accept_ms
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
