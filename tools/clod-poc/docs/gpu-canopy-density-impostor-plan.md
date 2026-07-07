# GPU Canopy Density and Impostor Buffer Plan

## Goal

Move far canopy and far-forest generation from CPU-side per-frame or per-stabilization work into GPU-built density maps and impostor instance buffers.

The target path is:

```text
CPU:
  chooses canonical world-space center
  plans dirty canopy tiles/rings
  uploads compact tile descriptors and settings
  keeps CPU fallback/parity path
  reads only small counters/debug samples when needed

GPU compute:
  samples far-summary / terrain-summary data
  builds canopy density per tile
  generates deterministic canopy impostor candidates
  rejects invalid candidates
  compacts accepted impostor instances
  writes draw counts and rejection counters

Renderer:
  draws canopy impostor buffers directly
  fades/morphs with near trees and far terrain
  avoids CPU canopy rebuild loops during startup/stabilization
```

This is step 6 after:

```text
1. streamed-page bounds guard
2. canonical world-space center debug counters
3. GPU far-summary build
4. GPU vegetation candidate rejection
5. shader-displaced far clipmap grids
```

Do not build this before the canonical center diagnostics are in place. The canopy must follow the same center as terrain, streamed roots, far grid, ocean, and vegetation.

## Why this matters

`canopyMs` has been one of the remaining real costs after diagnostic overhead was removed. Far canopy is a good GPU target because it is:

- spatially regular;
- visually approximate by nature;
- independent per tile/candidate;
- driven by terrain/biome/slope/water summaries;
- suitable for impostors instead of detailed meshes;
- not authoritative for gameplay collision.

The CPU should not walk thousands of far canopy cells every stabilization pass when the GPU can build density and instance buffers in parallel.

## Non-goals

- Do not replace near detailed trees.
- Do not replace tree collision or gameplay interaction.
- Do not remove CPU fallback.
- Do not force canopy to appear in wrong biomes.
- Do not make canopy authoritative terrain data.
- Do not read back all canopy instances in perf runs.
- Do not merge this with custom prop persistence.
- Do not change tree art assets or leaf shaders in the first implementation.

## Invariants

```text
I1. Near tree/vegetation systems remain authoritative for close visible vegetation.
I2. GPU canopy is a far visual cache only.
I3. All canopy tile planning derives from canonical world-space center.
I4. Missing far-summary data must produce safe empty/low-density canopy, not random impostors.
I5. CPU fallback remains deterministic and available.
I6. GPU compile/dispatch failure must not mark canopy ready.
I7. Perf runs must not map full canopy buffers.
I8. Canopy must fade or hand off cleanly to near tree/vegetation ownership.
```

## Relationship to GPU vegetation rejection

This feature is not the same as near vegetation GPU rejection.

```text
GPU vegetation rejection:
  grass/trees/stones/understory near and mid ring candidates
  accepted per-instance vegetation
  more detailed placement rules

GPU canopy:
  far visual forest mass
  lower frequency density/impostor buffers
  mostly silhouette/color/occlusion impression
  no collision/persistence
```

They can share:

```text
canonical center
terrain/far-summary sampling helpers
integer hash functions
rejection counters
GPU buffer utility code
```

They should not share one giant renderer or one giant candidate buffer at first.

## Canopy zones

Use three zones:

```text
near vegetation zone:
  detailed grass/tree/understory/stone systems
  real tree impostors or meshes
  controlled by vegetation GPU rejection or CPU fallback

canopy transition zone:
  near vegetation fades out
  canopy impostors fade in
  no z-fighting with near trees

far canopy zone:
  GPU canopy density and impostor buffers
  visual only
  follows far terrain/clipmap center
```

Initial radii:

```yaml
canopyGpu:
  near_exclusion_radius: 192
  fade_start: 192
  fade_end: 320
  outer_radius: 4096
```

These must be tuned after visual tests.

## Data model

### Canopy tile descriptor

Use ring/tile descriptors derived from canonical center.

```ts
interface CanopyTileDescriptor {
  tileX: number;
  tileZ: number;
  originX: number;
  originZ: number;
  size: number;
  ring: number;
  level: number;
  sampleGrid: number;
  maxCandidates: number;
  revision: number;
  flags: number;
}
```

GPU layout:

```wgsl
struct CanopyTileDescriptor {
    origin_size: vec4<f32>,   // originX, originZ, size, sampleGrid
    ring_lod: vec4<f32>,      // ring, level, fadeStart, fadeEnd
    meta: vec4<u32>,          // tileX, tileZ, revision, flags
};
```

### Canopy density record

One density record per tile or per tile cell.

```wgsl
struct CanopyDensityRecord {
    density_cover: vec4<f32>,   // density, canopyCover, treeEligibility, biomeWeight
    height_range: vec4<f32>,    // minHeight, maxHeight, avgHeight, slopeMean
    color_aux: vec4<f32>,       // avgColor/tint rgb + materialVariance
    meta: vec4<u32>,            // dominantBiome, revision, flags, sampleCount
};
```

### Canopy impostor instance

```wgsl
struct CanopyImpostorInstance {
    position_radius: vec4<f32>, // x, y, z, crownRadius
    height_yaw: vec4<f32>,      // trunkHeight, yaw, fadeNear, fadeFar
    tint_lod: vec4<f32>,        // tint rgb + lod/impostor kind as float
    meta: vec4<u32>,            // tile id, species group, flags, seed/debug id
};
```

Keep this readable at first. Pack later only if memory or bandwidth demands it.

## GPU passes

### Pass 1 — density build

For each dirty canopy tile:

```text
sample N x N terrain/far-summary points
estimate tree/canopy eligibility
accumulate canopy density
record avg height/slope/material/biome/tint
write tile density record
```

Start with `N=8` or `N=16` per tile. Do not over-sample.

### Pass 2 — impostor generation and rejection

For each tile:

```text
use density record to choose candidate count
for candidate index:
  derive deterministic position from integer hash
  sample local summary/height/biome
  reject below water / wrong biome / too steep / low density / too close
  if accepted:
    atomicAdd accepted count
    write impostor instance
  else:
    increment reject counter
```

Use broad placement rules. Far canopy does not need per-tree precision.

### Pass 3 — spacing / density cap

Use simple deterministic spacing cells:

```text
one canopy impostor per spacing cell
highest hash priority wins
```

Do not implement complex nearest-neighbor spacing first.

### Pass 4 — draw args / renderer handoff

Build or update the draw count for the canopy renderer.

If direct indirect drawing is hard in the current Three.js/WebGPU path, allow a temporary counted-draw bridge, but do not read back all instances in perf mode.

### Pass 5 — optional parity/debug readback

Only when enabled:

```text
read counter buffer
read first N density records
read first N instances
compare with CPU reference
```

Perf mode must keep this disabled.

## Terrain and biome inputs

Preferred input stack:

```text
GPU far-summary records from step 3
shader-displaced far clipmap height/material resources from step 5
canonical center counters from step 2
```

Fallback input stack:

```text
CPU far-summary data uploaded to a buffer
existing CPU terrain sampler through CPU fallback
empty safe canopy if no summary is available
```

Missing input behavior:

```text
missing far-summary tile -> no canopy for that tile + missing_summary counter
missing height -> fallback avg height or skip tile
missing material/biome -> low density, not random forest
```

## Rejection reasons

Stable enum:

```ts
type CanopyRejectReason =
  | "accepted"
  | "missing_summary"
  | "below_water"
  | "height_range"
  | "too_steep"
  | "wrong_biome"
  | "low_density"
  | "spacing"
  | "tile_budget"
  | "outside_ring"
  | "near_exclusion"
  | "non_finite_sample";
```

Counters:

```text
canopy_gpu_reject_missing_summary
canopy_gpu_reject_below_water
canopy_gpu_reject_height_range
canopy_gpu_reject_too_steep
canopy_gpu_reject_wrong_biome
canopy_gpu_reject_low_density
canopy_gpu_reject_spacing
canopy_gpu_reject_tile_budget
canopy_gpu_reject_near_exclusion
canopy_gpu_reject_non_finite_sample
```

## CPU fallback and parity

Keep CPU canopy generation as:

```text
fallback path
strict parity oracle
debug reference for density and rejection counters
```

Fallback rules:

```text
WebGPU unavailable -> CPU canopy path
shader compile failure -> CPU canopy path
GPU dispatch failure -> CPU fallback for dirty tiles
instance buffer overflow -> reject extras with tile_budget and log counter
strict parity failure -> fail acceptance
non-strict parity failure -> use CPU result for those tiles
```

If GPU and CPU both fail a tile, render no canopy for that tile and surface the reason. Do not retry forever.

## Buffer sizing and caps

Initial config:

```yaml
canopyGpu:
  enabled: true
  max_dirty_tiles_per_batch: 128
  density_sample_grid: 8
  candidates_per_tile: 64
  max_density_records: 16384
  max_impostor_instances: 65536
  spacing_cell_size: 24
  near_exclusion_radius: 192
  fade_start: 192
  fade_end: 320
  outer_radius: 4096
  debug_readback_records: 64
  debug_readback_instances: 64
```

Hard rules:

```text
never allocate by infinite radius directly
cap instances
split dirty batches
track overflow
```

## Config and URL flags

```text
canopyGpu=0|1
canopyGpuStrictParity=0|1
canopyGpuDebugReadback=0|1
canopyGpuDensityGrid=8|16
canopyGpuMaxDirtyTiles=N
canopyGpuCandidatesPerTile=N
canopyGpuMaxInstances=N
canopyGpuFallback=0|1
```

Initial rollout defaults:

```text
manual populatedPerf: opt-in
acceptance diagnosis: opt-in
normal dev: off until visual parity is good
final target: on when WebGPU available, fallback on
```

## Module layout

Suggested files:

```text
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_config.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_types.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_planner.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_cpu_ref.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_builder.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_buffers.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_counters.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_renderer.ts
tools/clod-poc/src/vegetation/canopy_gpu/shaders/canopy_density.wgsl
tools/clod-poc/src/vegetation/canopy_gpu/shaders/canopy_impostors.wgsl
```

Tests:

```text
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_planner.test.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_cpu_ref.test.ts
tools/clod-poc/src/vegetation/canopy_gpu/canopy_gpu_counters.test.ts
```

Adjust paths after reading latest `main`.

## Center integration

Canopy must use the canonical center service.

Publish:

```text
canopy_gpu_center_x
canopy_gpu_center_z
canopy_gpu_center_distance_to_canonical_xz
canopy_gpu_ring_revision
canopy_gpu_last_tile_x
canopy_gpu_last_tile_z
```

Acceptance should fail when:

```text
canopy_gpu_center_distance_to_canonical_xz > 8
```

For snapped canopy tiles, report both requested center and snapped origin:

```text
canopy_gpu_requested_center_distance_xz
canopy_gpu_snapped_origin_x
canopy_gpu_snapped_origin_z
canopy_gpu_snap_error_x
canopy_gpu_snap_error_z
```

## Near/far fade and ownership

Canopy must not double-render over near trees too aggressively.

Initial rule:

```text
near detailed tree zone owns inside near_exclusion_radius
canopy alpha = 0 inside near_exclusion_radius
canopy alpha fades in between fade_start and fade_end
```

Shader fade:

```wgsl
let d = distance(instance.position_radius.xz, canonical_center_xz);
let fade = smoothstep(fade_start, fade_end, d);
alpha *= fade;
```

If near trees are not present because the biome rejects them, canopy still respects the zone. Do not use canopy to fake near trees.

## Impostor rendering strategy

Start simple:

```text
camera-facing or axial billboards
one quad per canopy cluster
height/radius/tint from instance buffer
distance fade and fog in shader
```

Later options:

```text
crossed billboards
meshlet clumps
horizon cards
impostor texture atlas
shadow/occlusion proxy integration
```

Do not start with complex impostor baking. First remove CPU canopy generation cost safely.

## Shadow and lighting policy

Initial canopy GPU impostors:

```text
visible color/fog only
no individual shadow casting
optional broad canopy shadow later through far-summary/NAADF proxy
```

Reason: shadow-casting impostors can explode render cost and create unstable far shadows.

Later:

```text
inject low-frequency canopy opacity into sun/fog/NAADF queries
```

## Counters

Top-level counters:

```text
canopy_gpu_enabled
canopy_gpu_device_ready
canopy_gpu_batches_dispatched
canopy_gpu_dirty_tiles
canopy_gpu_tiles_dispatched
canopy_gpu_failed_batches
canopy_gpu_fallback_tiles
canopy_gpu_density_records_live
canopy_gpu_impostor_instances_live
canopy_gpu_buffer_bytes
canopy_gpu_instance_buffer_overflow
canopy_gpu_counter_buffer_overflow
canopy_gpu_compute_ms_p50
canopy_gpu_compute_ms_p95
canopy_gpu_readback_ms_p95
canopy_gpu_parity_checked_tiles
canopy_gpu_parity_failed_tiles
```

Density counters:

```text
canopy_gpu_density_tiles_built
canopy_gpu_density_avg
canopy_gpu_density_max
canopy_gpu_density_missing_summary_tiles
canopy_gpu_density_empty_tiles
```

Reject counters:

```text
canopy_gpu_candidates
canopy_gpu_accepted
canopy_gpu_rejected
canopy_gpu_reject_missing_summary
canopy_gpu_reject_below_water
canopy_gpu_reject_height_range
canopy_gpu_reject_too_steep
canopy_gpu_reject_wrong_biome
canopy_gpu_reject_low_density
canopy_gpu_reject_spacing
canopy_gpu_reject_tile_budget
canopy_gpu_reject_near_exclusion
canopy_gpu_reject_non_finite_sample
```

Renderer counters:

```text
canopy_gpu_draw_instances
canopy_gpu_draw_tiles
canopy_gpu_fade_instances
canopy_gpu_visible_instances
canopy_gpu_renderer_ready
canopy_gpu_fallback_renderer_active
```

Timing split is mandatory:

```text
compute ms
readback ms
render CPU ms
```

Do not bury GPU readback in `canopyMs`.

## Implementation phases

### Phase 1 — planner/config only

Add pure canopy tile planning:

```text
canonical center -> snapped ring origin
tile descriptors
near exclusion/fade metadata
dirty tile reasons
batch splitting
buffer caps
```

No WebGPU dispatch.

### Phase 2 — CPU reference extraction

Create a pure CPU reference:

```ts
buildCpuCanopyTile(tile, summarySampler, config): CpuCanopyTileResult
```

It returns:

```text
density record
accepted impostor instances
reject counters
```

### Phase 3 — hash/parity utilities

Use deterministic integer hash shared conceptually with vegetation GPU rejection.

Tests:

```text
same tile/seed/candidate creates same jitter
species/tint/yaw stable
spacing cell stable
```

### Phase 4 — GPU density pass behind flag

Build density records only. No impostor rendering yet.

Acceptance:

```text
GPU density records exist
CPU/GPU sampled parity is acceptable
missing summary tiles are counted
```

### Phase 5 — GPU impostor generation behind flag

Generate and compact impostor instances.

Acceptance:

```text
accepted counts reasonable
reject counters explain empty tiles
no full instance readback in perf mode
```

### Phase 6 — debug renderer

Render simple colored billboards for accepted impostors.

Debug modes:

```text
ring color
biome color
density color
reject heatmap
fade alpha visualization
```

### Phase 7 — visual material and fog

Add far canopy shading:

```text
tint from biome/species
fog/aerial perspective
wind sway optional later
fade with distance and near ownership
```

### Phase 8 — replace CPU canopy generation in target mode

When `canopyGpu=1` and resources are ready:

```text
skip CPU canopy generation for far canopy zone
keep CPU fallback for failures
```

This is the actual performance step.

### Phase 9 — acceptance hard checks

Add perf/visual hard checks only after manual runs are clean.

## Tests

Planner tests:

```text
canonical center creates expected canopy tiles
snapping stable within tile interval
crossing boundary dirties expected tiles
near exclusion marks inner tiles/fade band
batch cap respected
buffer cap respected
```

CPU reference tests:

```text
missing summary creates empty tile and counter
water tile rejects candidates
wrong biome rejects candidates
valid forest summary accepts candidates
low density creates few/zero impostors
tile budget caps accepted instances
spacing rejects duplicate cell
```

GPU wrapper tests without real WebGPU:

```text
compile failure falls back
batch failure falls back
strict parity failure throws
non-strict parity failure uses CPU tile
perf mode disables debug readback
instance overflow increments tile_budget/overflow counters
```

Renderer tests where possible:

```text
empty instance buffer draws zero
fade band computes expected alpha
debug mode maps density to stable color code
```

## Browser acceptance

Commands:

```bash
cd tools/clod-poc

npm run typecheck
npm test -- src/vegetation/canopy_gpu/canopy_gpu_planner.test.ts
npm test -- src/vegetation/canopy_gpu/canopy_gpu_cpu_ref.test.ts
npm test -- src/vegetation/canopy_gpu/canopy_gpu_counters.test.ts
npm test
npm run build

node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Manual populated URL should include:

```text
populatedPerf=1&worldCenterDebug=1&farSummaryGpu=1&farClipmapGrid=1&canopyGpu=1&canopyGpuDebugReadback=0
```

Hard checks once stable:

```text
canopy_gpu_enabled = 1
canopy_gpu_device_ready = 1
canopy_gpu_batches_dispatched > 0
canopy_gpu_tiles_dispatched > 0
canopy_gpu_failed_batches = 0
canopy_gpu_readback_ms_p95 = 0 in perf runs
canopy_gpu_center_distance_to_canonical_xz <= 8
canopy_gpu_renderer_ready = 1
canopy_gpu_instance_buffer_overflow = 0
```

If a scene is expected to have forest:

```text
canopy_gpu_impostor_instances_live > 0
```

If a scene is volcanic/rock/sand and no canopy is expected:

```text
canopy_gpu_impostor_instances_live may be 0
reject counters must explain it
```

## Visual acceptance

Use fixed camera locations:

```text
forest-friendly inland biome
shoreline biome
rocky/volcanic biome
high mountain biome
```

Expected:

```text
canopy appears only in forest-friendly areas
canopy follows terrain/far grid center
canopy does not appear around stale finite-world origin
canopy fades before detailed near trees
no billboard wall or grid pattern obvious at gameplay height
no severe shimmer while walking
empty rocky/volcanic canopy explained by counters
```

## Performance acceptance

Expected after target mode:

```text
canopyMs p95 decreases
startup stabilization frames decrease
CPU canopy rebuild count decreases
GPU canopy compute appears as bounded cost
readback p95 remains zero in perf mode
```

If render cost rises:

```text
reduce impostor count
increase spacing cell size
reduce tile radius/rings
use coarser density sample grid
stronger distance fog/fade
frustum cull canopy tiles
```

## Risks and mitigations

### Canopy appears in wrong location

Mitigation:

```text
canonical center counters
requested and snapped center reports
acceptance threshold on center distance
```

### Canopy overdraw too high

Mitigation:

```text
instance caps
distance fade
tile frustum culling
coarser rings
larger impostor clusters
```

### Visual grid pattern

Mitigation:

```text
jittered deterministic positions
cross-tile hash seed mixing
density blur / neighbor-aware density later
```

### CPU/GPU parity drift

Mitigation:

```text
integer hash only
sampled parity readback
CPU fallback per tile
simple first rules
```

### Missing far summaries produce holes

Mitigation:

```text
missing_summary counters
use last valid density tile when safe
or render empty tile with conservative fallback
```

### Shadow mismatch

Mitigation:

```text
do not cast individual shadows first
later add low-frequency canopy opacity to lighting/fog summaries
```

## Rollout order

```text
1. planner/config only
2. CPU reference and counters
3. deterministic hash helpers
4. GPU density records behind flag
5. GPU impostor generation behind flag
6. debug renderer
7. visual material/fog/fade
8. skip CPU canopy generation in target mode
9. acceptance hard checks
10. tune density/spacing/ring settings
```

## Implementation prompts for follow-up agents

### Prompt 1 — planner/config

```text
Read latest main. Add canopy GPU config and pure tile planner. It must use canonical world center, produce snapped canopy tiles, near exclusion/fade metadata, dirty reasons, batch caps, and buffer estimates. Do not dispatch WebGPU yet.
```

### Prompt 2 — CPU reference

```text
Read latest main. Extract a pure CPU canopy tile reference that builds density records, deterministic impostor candidates, accepted instances, and rejection counters from far-summary inputs. Add tests for missing summary, water, wrong biome, low density, valid forest, spacing, and tile budget.
```

### Prompt 3 — GPU density pass

```text
Read latest main. Add WebGPU canopy density pass behind canopyGpu=1. Batch dirty tiles, sample far-summary data, write density records and counters, and avoid readback unless debug/parity is enabled. CPU fallback must remain intact.
```

### Prompt 4 — GPU impostor pass

```text
Read latest main. Add GPU canopy impostor generation/compaction from density records. Write accepted impostor instance buffers and rejection counters. Keep strict parity and CPU fallback.
```

### Prompt 5 — debug renderer

```text
Read latest main. Add a simple canopyGpu debug renderer for accepted impostor buffers with ring/density/biome debug colors. It must follow canonical center and fade out near detailed vegetation.
```

### Prompt 6 — production visual pass

```text
Read latest main. Add far canopy impostor material/fog/fade and connect to existing far terrain/fog look. Do not add individual shadow casting yet. Add visual counters and keep CPU fallback.
```

### Prompt 7 — disable CPU canopy in target mode

```text
Read latest main. When canopyGpu=1 and resources are ready, skip CPU far canopy generation for the far canopy zone. Add skipped CPU build counters and ensure fallback restores old behavior on failure.
```

### Prompt 8 — acceptance checks

```text
Read latest main. Add infinite-islands acceptance checks for canopyGpu enabled, device ready, batches dispatched, no failed batches, readback p95 zero, center distance within threshold, renderer ready, and no instance buffer overflow. Do not weaken existing perf thresholds.
```

## Done criteria

```text
WebGPU unavailable path works
CPU fallback works
GPU compile failure falls back
strict parity can fail acceptance
perf runs do not read back full canopy buffers
canopy follows canonical center
zero canopy is explained by counters
far canopy does not render around stale finite-world origin
canopyMs p95 drops or CPU canopy rebuild counters drop to near zero
manual populated infinite-islands shows aligned terrain, far grid, water, vegetation, and canopy
```
