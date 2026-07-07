# GPU Vegetation Candidate Rejection Plan

## Goal

Move grass, tree, stone, and understory candidate rejection from CPU-side loops into WebGPU compute, while keeping CPU fallback and parity checks.

The target path is:

```text
CPU:
  chooses canonical world-space ring center
  creates deterministic candidate descriptors / ring tiles
  uploads compact config and dirty tile descriptors
  reads only counters when debug/parity asks for them

GPU:
  generates or evaluates candidates in parallel
  samples terrain height/material/water/slope/biome summaries
  rejects invalid candidates
  compacts accepted grass/tree/stone/understory instances
  writes rejection counters

Renderer:
  draws accepted instance buffers directly
  avoids CPU-built instance arrays during startup/stabilization
```

This is the fourth step after:

```text
1. streamed-page bounds guard
2. canonical world-space center debug counters
3. GPU far-summary build
```

Do not implement this before center mismatches are diagnosable. Candidate rejection must use the same canonical center as terrain, far shell, water, and streamed roots.

## Why this matters

Vegetation placement is an ideal GPU workload:

- thousands of independent candidate probes;
- simple terrain/biome/water/slope rejection rules;
- predictable ring/tile layout;
- high startup/stabilization cost when done on CPU;
- direct output into renderable instance buffers;
- small counter readbacks only when needed.

The current failure mode of `grass: enabled 0 blades` is also hard to debug because the UI shows totals but not enough per-reason or per-tile detail. This plan makes rejection visible and cheap.

## Non-goals

- Do not rewrite tree/grass rendering shaders in this step.
- Do not remove existing CPU vegetation placement.
- Do not make WebGPU required.
- Do not add debug readbacks to perf runs.
- Do not change biome rules just to show more grass.
- Do not scatter vegetation around stale `controls.target` or finite-world origin.
- Do not make vegetation authoritative for gameplay collision.

## Invariants

```text
I1. CPU fallback remains correct and deterministic.
I2. WebGPU unavailable path keeps existing vegetation behavior.
I3. GPU vegetation output is a derived render cache.
I4. Candidate placement is deterministic for seed + tile + revision.
I5. Accepted instances must use world-space coordinates.
I6. Rejection counters must not require full instance readback.
I7. Perf runs must avoid mapped readbacks except tiny optional counters.
I8. Center must come from the canonical center module.
```

## Candidate groups

Start with four groups:

```text
grass
understory
trees
stones
```

Do not try to solve custom props in the first pass. Custom props usually need heavier placement rules, model selection, collision spacing, and persistence.

## Data flow

```text
canonical center
  -> vegetation ring planner
  -> dirty vegetation tiles
  -> GPU candidate rejection batch
  -> accepted instance buffers
  -> indirect or counted instanced draw path
  -> optional sampled parity readback
```

## Candidate tile model

Use ring tiles, not one giant global candidate list.

```ts
interface VegetationCandidateTile {
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  size: number;
  level: number;
  seed: number;
  revision: number;
  groupsMask: number;
}
```

Dirty reasons:

```text
startup
canonical_center_tile_shift
terrain_summary_ready
far_summary_ready
streamed_page_ready
terrain_edit
water_change
settings_change
debug_force
```

## Candidate descriptor model

Prefer GPU-generated candidates from tile descriptors first, not CPU-uploaded per-candidate arrays.

The GPU should derive candidate positions from:

```text
tile origin
tile size
candidate index
seed
species group
jitter hash
```

This avoids uploading huge candidate lists.

If exact CPU parity is hard, add a temporary CPU-uploaded candidate mode for tests only, then switch production to GPU-generated candidates once parity is proven.

## GPU output buffers

Separate accepted instances per group at first. Do not overgeneralize too early.

```text
grassInstancesBuffer
understoryInstancesBuffer
treeInstancesBuffer
stoneInstancesBuffer
```

Each has:

```wgsl
struct VegetationInstanceGpu {
    position_radius: vec4<f32>,  // xyz + radius/scale
    normal_yaw: vec4<f32>,       // normal xyz + yaw
    color_variant: vec4<f32>,    // tint rgb + variant
    meta: vec4<u32>,             // species/material/lod/flags
};
```

Later, this can be packed tighter. Keep it readable for the first parity phase.

## Counter buffer

Use one small storage buffer for counters.

```wgsl
struct VegetationRejectCountersGpu {
    candidates_total: atomic<u32>,
    accepted_total: atomic<u32>,
    rejected_below_water: atomic<u32>,
    rejected_height_range: atomic<u32>,
    rejected_too_steep: atomic<u32>,
    rejected_wrong_biome: atomic<u32>,
    rejected_rock: atomic<u32>,
    rejected_snow: atomic<u32>,
    rejected_density_mask: atomic<u32>,
    rejected_spacing: atomic<u32>,
    rejected_tile_budget: atomic<u32>,
    rejected_unknown: atomic<u32>,
};
```

Keep per-group counters too:

```text
grass candidates/accepted/rejected by reason
understory candidates/accepted/rejected by reason
trees candidates/accepted/rejected by reason
stones candidates/accepted/rejected by reason
```

## Rejection reasons

Use stable reason enum values.

```ts
type VegetationRejectReason =
  | "accepted"
  | "below_water"
  | "height_range"
  | "too_steep"
  | "wrong_biome"
  | "rock_weight"
  | "snow_weight"
  | "density_mask"
  | "spacing"
  | "tile_budget"
  | "missing_summary"
  | "non_finite_sample";
```

Counters should use names like:

```text
veg_gpu_grass_reject_wrong_biome
veg_gpu_tree_reject_too_steep
veg_gpu_stone_reject_below_water
veg_gpu_understory_reject_density_mask
```

Also preserve the already readable CPU-style counters where possible:

```text
grassReject.wrong_biome
treeReject.too_steep
understoryReject.wrong_biome
```

## Terrain sampling inputs

Initial GPU rejection can sample from one of two sources:

### Preferred source after number 3

GPU far-summary / terrain summary textures or buffers:

```text
height min/max/avg
normal/slope
water coverage
material/biome coverage
grass/tree eligibility
```

### Fallback source

Existing terrain field functions ported to WGSL for direct sample evaluation.

Preferred rollout:

```text
Phase A: use CPU reference and existing sampler for parity
Phase B: use GPU far-summary for broad early rejection
Phase C: use direct WGSL field sampling for near accurate placement when needed
```

## Compute passes

### Pass 1 — candidate evaluate + append

One compute dispatch per dirty tile batch.

```text
for each tile:
  for each candidate index:
    generate deterministic jittered candidate position
    sample height/material/water/slope/biome
    evaluate group-specific rules
    if accepted:
      atomicAdd group count
      write instance record
    else:
      atomicAdd reject reason counter
```

### Pass 2 — optional spacing/collision filter

For trees and stones, a second pass may be needed:

```text
coarse grid occupancy
reject candidates too close to already accepted candidate
```

Do not implement expensive perfect spacing first. Start with deterministic cell occupancy:

```text
one tree candidate per spacing cell
highest hash priority wins
```

### Pass 3 — indirect args build

When accepted counts are stable, build draw args:

```text
instanceCount = acceptedCount
firstInstance = buffer group offset
```

If the current renderer does not support indirect draws cleanly in Three.js/WebGPU, use counted instancing and keep CPU readback optional. The long-term target is no CPU instance array rebuild.

### Pass 4 — debug/parity readback

Only when requested:

```text
read small counter buffer
read first N accepted instances per group
compare against CPU reference for deterministic tiles
```

Never read back all instances in perf mode.

## Determinism rules

Candidate generation must be stable across CPU and GPU.

Use integer hash functions, not floating random generators.

Inputs:

```text
world seed
tileX/tileZ
candidate local index
group id
revision
```

Avoid shader functions that differ across browser/GPU vendors for candidate decisions. Use integer hash -> normalized float conversion with explicit constants.

## Group-specific rules

### Grass

Initial rules:

```text
reject below water
reject outside height range
reject if slope normalY < min
reject if rock/snow too high
reject if grass mask <= threshold
accept with density based on grass mask and distance LOD
```

### Understory

Initial rules:

```text
reject below water
reject too steep
reject wrong biome
reject low canopy/cover eligibility when required
accept sparse density
```

### Trees

Initial rules:

```text
reject below water
reject too steep
reject wrong biome
reject if tree eligibility too low
reject if spacing cell already occupied
select species from biome + hash
select LOD/impostor flag from distance
```

### Stones

Initial rules:

```text
reject below water unless shoreline stones allowed
reject if slope too extreme for selected stone type
prefer rock/sand/shoreline masks
select scale/yaw from hash
```

## CPU fallback and parity

Keep CPU placement as:

```text
fallback path
strict parity oracle
debug reason source
```

Fallback rules:

```text
WebGPU unavailable -> CPU placement
shader compile failure -> CPU placement
GPU batch failure -> CPU placement for dirty tiles
counter buffer overflow -> split batch or CPU fallback
instance buffer overflow -> reject extra candidates with tile_budget and schedule larger buffer later
strict parity failure -> fail acceptance
non-strict parity failure -> use CPU result for that tile and log
```

Do not let GPU and CPU both write instances for the same tile at the same time.

## Buffer sizing and caps

Add caps:

```yaml
vegetationGpu:
  enabled: true
  max_dirty_tiles_per_batch: 128
  grass_candidates_per_tile: 512
  understory_candidates_per_tile: 128
  tree_candidates_per_tile: 64
  stone_candidates_per_tile: 96
  max_grass_instances: 262144
  max_understory_instances: 65536
  max_tree_instances: 32768
  max_stone_instances: 32768
  debug_readback_instances: 64
```

Do not allocate worst-case unbounded buffers from radius alone. Split batches and cap by memory.

## Config and URL flags

```text
vegetationGpuReject=0|1
vegetationGpuStrictParity=0|1
vegetationGpuDebugReadback=0|1
vegetationGpuGrass=0|1
vegetationGpuTrees=0|1
vegetationGpuUnderstory=0|1
vegetationGpuStones=0|1
vegetationGpuMaxDirtyTiles=N
```

Initial default:

```text
manual populatedPerf: enabled when WebGPU available
acceptance diagnosis: enabled only in focused scenes until stable
normal fallback: CPU path remains available
```

## Counters

Top-level counters:

```text
veg_gpu_reject_enabled
veg_gpu_device_ready
veg_gpu_batches_dispatched
veg_gpu_dirty_tiles
veg_gpu_tiles_dispatched
veg_gpu_failed_batches
veg_gpu_fallback_tiles
veg_gpu_compute_ms_p50
veg_gpu_compute_ms_p95
veg_gpu_readback_ms_p95
veg_gpu_buffer_bytes
veg_gpu_instance_buffer_overflow
veg_gpu_counter_buffer_overflow
veg_gpu_parity_checked_tiles
veg_gpu_parity_failed_tiles
```

Per-group counters:

```text
veg_gpu_grass_candidates
veg_gpu_grass_accepted
veg_gpu_grass_rejected
veg_gpu_grass_reject_below_water
veg_gpu_grass_reject_height_range
veg_gpu_grass_reject_too_steep
veg_gpu_grass_reject_wrong_biome
veg_gpu_grass_reject_density_mask
veg_gpu_grass_reject_tile_budget

veg_gpu_tree_candidates
veg_gpu_tree_accepted
veg_gpu_tree_rejected
veg_gpu_tree_reject_below_water
veg_gpu_tree_reject_too_steep
veg_gpu_tree_reject_wrong_biome
veg_gpu_tree_reject_spacing
veg_gpu_tree_reject_tile_budget

veg_gpu_understory_candidates
veg_gpu_understory_accepted
veg_gpu_understory_rejected
veg_gpu_stone_candidates
veg_gpu_stone_accepted
veg_gpu_stone_rejected
```

Center counters:

```text
veg_gpu_center_x
veg_gpu_center_z
veg_gpu_center_distance_to_canonical_xz
veg_gpu_ring_revision
veg_gpu_last_tile_x
veg_gpu_last_tile_z
```

Readback split is mandatory. Do not merge it into `vegetationTotalMs`.

## Module layout

Suggested files:

```text
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_config.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_types.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_planner.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_builder.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_buffers.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_counters.ts
tools/clod-poc/src/vegetation/gpu/shaders/vegetation_reject.wgsl
```

Tests:

```text
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_planner.test.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_cpu_ref.test.ts
tools/clod-poc/src/vegetation/gpu/vegetation_gpu_reject_counters.test.ts
```

Adjust paths after reading latest `main`.

## Implementation phases

### Phase 1 — planner/config only

Build pure planning:

```text
ring tile selection from canonical center
dirty tile reasons
batch splitting
candidate counts per group
buffer byte estimates
fallback decision helpers
```

No WebGPU dispatch yet.

### Phase 2 — CPU reference adapter

Extract pure CPU reference:

```ts
buildCpuVegetationCandidates(tile, group, sampler, config): CpuVegetationCandidateResult
```

The CPU reference should produce:

```text
accepted instances
reject counters
first N debug samples
```

### Phase 3 — WGSL candidate generation parity

Add integer hash functions shared conceptually between CPU and WGSL.

Tests:

```text
same tile + seed produces same jitter sequence
same candidate index maps to same local cell
species/variant selection stable
```

### Phase 4 — WebGPU reject builder behind flag

Implement device/pipeline owner:

```text
compile once
reuse buffers
upload dirty tile descriptors
zero counters/counts
run compute once per batch
optionally read counters/debug samples
```

### Phase 5 — accepted instance rendering integration

First integration target:

```text
reuse existing grass/tree instance rendering if it can consume GPU-side buffers
otherwise bridge with temporary small readback only outside perf mode
```

Do not ship a perf path that reads back every accepted instance.

### Phase 6 — parity and focused acceptance

Strict parity on small tiles:

```text
CPU and GPU agree on reason distributions within tolerance
accepted count matches for deterministic simple tiles
first N accepted instances match within epsilon
```

Some edge-biome differences are acceptable initially only if counters explain them and CPU fallback is used for strict mode.

### Phase 7 — migrate groups one by one

Order:

```text
1. grass
2. stones
3. understory
4. trees
```

Trees last because spacing/species/LOD rules are usually more complex.

## Tests

Planner tests:

```text
canonical center creates expected ring tiles
moving within same tile does not dirty all tiles
crossing tile boundary dirties entering/leaving tiles
batch cap respected
buffer cap respected
groups mask filters groups correctly
```

CPU reference tests:

```text
grass below water rejected
grass wrong biome rejected
grass steep slope rejected
grass accepted on valid grass tile
tree spacing rejects duplicate cell
tree wrong biome rejected
stone accepted on rock/sand tile
understory accepted under valid biome mask
```

GPU wrapper tests without real WebGPU:

```text
compile failure falls back
batch failure falls back
strict parity failure throws
non-strict parity failure falls back per tile
perf mode disables instance readback
counter overflow is reported
instance overflow rejects extra with tile_budget reason
```

## Browser acceptance

Focused commands after implementation:

```bash
cd tools/clod-poc

npm run typecheck
npm test -- src/vegetation/gpu/vegetation_gpu_reject_planner.test.ts
npm test -- src/vegetation/gpu/vegetation_gpu_reject_cpu_ref.test.ts
npm test -- src/vegetation/gpu/vegetation_gpu_reject_counters.test.ts
npm test
npm run build

node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Manual populated URL should include:

```text
populatedPerf=1&worldCenterDebug=1&vegetationGpuReject=1&vegetationGpuDebugReadback=0
```

Hard checks once stable:

```text
veg_gpu_reject_enabled = 1
veg_gpu_device_ready = 1
veg_gpu_batches_dispatched > 0
veg_gpu_tiles_dispatched > 0
veg_gpu_failed_batches = 0
veg_gpu_readback_ms_p95 = 0 in perf runs
veg_gpu_center_distance_to_canonical_xz <= 8
vegetation_ring_unbounded = 1 for infinite-islands populated mode
```

For populated visual scenes, require at least one accepted group in a known vegetation-friendly biome fixture. Do not require grass on volcanic/rock/sand areas.

## Visual acceptance

Use three fixed camera locations:

```text
grass-friendly inland tile
shoreline / beach tile
rocky / volcanic tile
```

Expected:

```text
grass appears on grass-friendly tile
stones appear on rocky/shoreline tile
trees appear only where tree eligibility allows
zero grass in volcanic tile is explained by wrong_biome or rock/snow counters
vegetation ring follows terrain/camera center
no vegetation appears in a far offset ring
```

## Performance acceptance

Expected wins:

```text
startup stabilization frames decrease
vegetationTotalMs p95 drops or becomes flatter
canopy/vegetation CPU spikes reduce
readback stays zero in perf mode
GPU compute cost is visible and bounded
```

Do not expect render cost to drop. This targets CPU generation/rejection and stabilization.

## Risks and mitigations

### CPU/GPU placement drift

Mitigation:

```text
integer hash only
strict parity on simple tiles
CPU fallback per tile
first-N accepted instance debug readback
```

### Over-rejection from coarse far summaries

Mitigation:

```text
use far summaries only for broad rejection
fall back to detailed sampling near the camera
track missing_summary and wrong_biome separately
```

### Instance buffer overflow

Mitigation:

```text
fixed caps
atomic accepted count
reject extras as tile_budget
counter visible in HUD/acceptance
```

### Debug readback ruins perf

Mitigation:

```text
separate debug/parity flags
hard-check readback p95 = 0 for perf runs
```

### Tree spacing is too complex

Mitigation:

```text
do grass/stones first
tree pass starts with simple spacing-cell winner rule
do not attempt full prop persistence in this phase
```

## Rollout order

```text
1. Planner/config with no behavior change
2. CPU reference adapter and reason counters
3. Grass GPU rejection behind flag
4. Grass parity and visual fixture
5. Stones GPU rejection
6. Understory GPU rejection
7. Trees GPU rejection with simple spacing
8. Consumer/render integration without full readback
9. Acceptance hard checks
```

## Implementation prompts for follow-up agents

### Prompt 1 — planner/config

```text
Read latest main. Add GPU vegetation rejection config/planner only. Use canonical world center for ring planning. Add tests for tile planning, dirty reasons, batch caps, group masks, and buffer byte caps. Do not add WebGPU dispatch yet.
```

### Prompt 2 — CPU reference and counters

```text
Read latest main. Extract a pure CPU vegetation candidate reference for grass/stones/understory/trees. It must return accepted instances and stable rejection counters. Add tests for below_water, wrong_biome, too_steep, density_mask, spacing, and tile_budget.
```

### Prompt 3 — WGSL hash parity

```text
Read latest main. Add shared CPU/WGSL integer hash documentation and tests so candidate jitter/species/variant choices are deterministic for seed + tile + index + group.
```

### Prompt 4 — grass GPU rejection

```text
Read latest main. Add a WebGPU grass candidate rejection builder behind vegetationGpuReject=1. Batch dirty tiles, write accepted grass instances and reject counters, and avoid readback unless debug/parity is enabled. CPU fallback must remain intact.
```

### Prompt 5 — render integration

```text
Read latest main. Integrate accepted GPU grass instance buffers into the existing grass renderer without reading back full instance arrays in perf mode. Add counters for instance counts, buffer bytes, compute ms, and readback ms.
```

### Prompt 6 — trees/stones/understory

```text
Read latest main. Extend GPU vegetation rejection to stones, understory, and trees. Trees should use a simple deterministic spacing-cell winner rule first. Add per-group rejection counters and visual fixture checks.
```

### Prompt 7 — acceptance checks

```text
Read latest main. Add focused infinite-islands acceptance checks for vegetationGpuReject enabled, batches dispatched, no failed batches, readback p95 zero in perf runs, center distance within threshold, and rejection counters explaining zero-instance cases.
```

## Done criteria

```text
WebGPU unavailable path works
CPU fallback works
GPU compile failure falls back
strict parity can fail acceptance
perf runs do not read back full instances
center matches canonical center
zero grass is explained by counters
vegetation startup/stabilization CPU cost drops
manual populated infinite-islands no longer shows vegetation ring in a wrong far location
```
