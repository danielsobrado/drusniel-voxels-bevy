# GPU Far-Summary Build Plan

## Status on main — read before implementing (revised 2026-07-08)

Audited against `main`. **This is not greenfield. A full CPU far-summary pipeline and a GPU summary atlas already exist.** Reframe this plan as "insert a WebGPU compute *build* stage that produces the existing summary records and feeds the existing cache/atlas," not "create a new far-summary module."

### What already exists (reuse it — do NOT create `src/terrain/far_summary/`)

CPU pipeline in [src/far-summary/](../src/far-summary/):
- `summary-tile-builder.ts` — builds one summary tile per cell from a `FarTerrainSampler`. **This is your CPU parity oracle. Do not write a new one** (the plan's "Phase 2 CPU reference extraction" is already done here).
- `types.ts` — `FarSummaryTile`, `FarSummaryStats`. **The GPU pass must emit records with these exact fields**, not the invented `FarSummaryTileRecord` below. Read this file and match it.
- `summary-cache.ts` (`FarSummaryCache`), `clipmap-sampler.ts` (`FarSummaryClipmapSampler`, `FarHeightProvider`), `clipmap-rings.ts` (`computeRequiredFarSummaryTiles` — this is your dirty-tile planner), `config.ts` (`FarSummaryConfig`, `DEFAULT_FAR_SUMMARY_CONFIG`, `applyFarSummaryQueryOverrides`), `stats.ts`, `stream-center.ts`, `integration.ts` (`FarSummaryIntegration.update()` — the runtime entry point where the GPU build hooks in).

GPU atlas in [src/naadf/gpu/farSummaryAtlas.ts](../src/naadf/gpu/farSummaryAtlas.ts):
- Already uploads CPU-built `FarSummaryTile`s into a GPU texture atlas with **dirty-rect uploads**, packing (`farSummaryAtlasPacking.ts`: `packUnorm8`, `estimateFarSummaryAtlasBytes`), upload config (`farSummaryAtlasUploadConfig.ts`) and **upload counters** (`farSummaryAtlasUploadCounters.ts`). `summaryStreamer.ts`, `farClipmap.ts`, `canopyBridge.ts` are the downstream consumers.

So the pipeline today is **CPU build → `FarSummaryCache` → (CPU `FarHeightProvider` sampling) + (upload to `farSummaryAtlas` for shaders)**.

### The actual delta this plan should deliver

Add a WebGPU compute pass that samples the terrain field (reuse the WGSL in [src/gpu/terrain_field_core.ts](../src/gpu/terrain_field_core.ts)) and produces the **same `FarSummaryTile` records** the CPU builder produces, then writes them into the existing `FarSummaryCache` / `farSummaryAtlas`. Everything else in this plan (parity oracle, dirty planner, consumers, counters) already exists and is reused, not rebuilt.

- CPU parity oracle: existing `summary-tile-builder.ts`.
- Dirty-tile planner: existing `computeRequiredFarSummaryTiles` in `clipmap-rings.ts`. Do not add a new `gpu_far_summary_planner.ts` unless it wraps that.
- Consumers ("Integration phases → Phase 6"): grass/tree/understory early-reject already consult the summary (see plan 4 status), the far shell/canopy shells already sample it. You are changing *how the summary is built*, not adding consumers.

### Corrected paths

| Plan says | Actually on main |
| --- | --- |
| `src/terrain/far_summary/*` | [src/far-summary/](../src/far-summary/) (CPU) + [src/naadf/gpu/](../src/naadf/gpu/) (GPU atlas) |
| new `gpu_far_summary_planner.ts` | reuse `far-summary/clipmap-rings.ts` |
| new CPU reference builder | reuse `far-summary/summary-tile-builder.ts` |
| `src/runtime/long_view_frame_diagnostics.ts` | [src/phase0/long_view_frame_diagnostics.ts](../src/phase0/long_view_frame_diagnostics.ts) |
| `src/runtime/terrain_frame_phase.ts` | [src/app/frame_loop/terrain_frame_phase.ts](../src/app/frame_loop/terrain_frame_phase.ts) |
| new shader dir | `src/far-summary/shaders/` or reuse `src/gpu/shaders/` + `terrain_field_core.ts` |

### Pinned decisions

- **GPU output type = existing `FarSummaryTile`.** Delete the invented `FarSummaryTileRecord` / `FarSummaryGpuRecord` structs unless they are an internal packing detail that unpacks to `FarSummaryTile`.
- Counters extend the existing `FarSummaryStats` + `farSummaryAtlasUploadCounters`, published via the standard `publishXStatsToCounters` snake_case pattern (see [bounds-guard plan](streamed-page-gpu-bounds-guard-plan.md#counter-plumbing-fixed-convention--applies-to-all-six-plans)). Note `farSummaryMs` is an existing grab-bag bracket; report the new GPU build as its own `farSum*Ms` subphase, not folded into it.
- Verification is headed/real-GPU. Headless = SwiftShader and will not run the compute build (it will silently stay on the CPU builder). Pure-TS parity tests (GPU record vs `summary-tile-builder` output for fixed tiles) run under vitest.

### Gate

Do not start until milestone [2.5 root-cause coordinate fix](canonical-world-center-root-cause-fix-plan.md) passes. A faster GPU summary must not make a wrong-origin summary harder to see.

---

## Goal

Move infinite-islands far-summary and stabilization summary work from repeated CPU-side scans into WebGPU compute-built textures/buffers.

The desired end state is:

```text
CPU:
  decides which far-summary tiles/roots are dirty
  uploads compact tile descriptors and edit/version data
  reads only small counters/debug samples when needed

GPU:
  samples terrain/field data for many tiles in parallel
  builds height/material/slope/water/biome summaries
  writes stable summary textures/buffers used by far shell, canopy, vegetation, and diagnostics

Renderer/shaders:
  consume summary textures directly when possible
  avoid per-frame CPU rebuilds during startup/stabilization
```

This is the first serious stabilization-speed step after the streamed-page bounds guard. The bounds guard must exist first because faster GPU summaries should not make wrong-origin streamed terrain harder to diagnose.

## Why this matters

Startup and stabilization are currently expensive because too much derived world data is prepared or validated on the CPU. Far summary is a good first GPU target because it is:

- spatially regular;
- mostly read-only per tile once built;
- highly parallel;
- useful to several systems;
- safe to build with CPU parity and fallback;
- not directly responsible for collider correctness.

This follows the broader Drusniel NAADF direction: keep visible terrain/material rendering, but build terrain acceleration summaries on the GPU and expose near/far residency layers to downstream systems.

## Non-goals

- Do not replace visible terrain rendering.
- Do not move near-field editable Surface Nets meshing to this pass.
- Do not move final CLOD page correctness decisions to the GPU.
- Do not remove the CPU far-summary fallback.
- Do not require WebGPU for loading the scene.
- Do not weaken acceptance convergence thresholds.
- Do not add readback-heavy debug paths to normal perf runs.

## Invariants

```text
I1. CPU fallback remains correct and available.
I2. WebGPU unavailable path must behave as today.
I3. GPU summaries are derived caches, not authoritative world state.
I4. A stale valid summary is better than a half-built invalid summary.
I5. Missing summaries must not mark streamed terrain ready by themselves.
I6. GPU failure must not produce a renderable/ready state.
I7. Debug readbacks are opt-in and separated from perf counters.
```

## Current systems that should consume the summary later

Initial consumers:

```text
far shell / far terrain shading
canopy density and far forest impostors
vegetation candidate rejection
long-view diagnostics
streaming readiness counters
```

Later consumers:

```text
shader-displaced far clipmap grids
NAADF/visibility queries
fog shaft occlusion
sun/ambient summary lighting
```

Do not convert all consumers in one patch. First build the GPU summary and parity-check it against CPU summary data. Then migrate consumers one by one.

## Summary products

Build one summary record per far-summary tile/root cell.

Recommended first summary fields:

```ts
interface FarSummaryTileRecord {
  tileX: number;
  tileZ: number;
  level: number;
  revision: number;

  minHeight: number;
  maxHeight: number;
  avgHeight: number;
  avgNormalX: number;
  avgNormalY: number;
  avgNormalZ: number;

  waterCoverage: number;
  landCoverage: number;
  grassCoverage: number;
  rockCoverage: number;
  snowCoverage: number;
  sandCoverage: number;

  dominantMaterial: number;
  materialVariance: number;
  slopeMean: number;
  slopeMax: number;

  treeEligibility: number;
  grassEligibility: number;
  canopyDensity: number;
  occupancyMask: number;
}
```

Use packed GPU storage, not this exact TS shape, for the actual buffer.

## GPU data layout

Use a storage buffer for build input and output first. Add textures later only where shader sampling benefits from texture filtering/cache locality.

### Input descriptor buffer

```wgsl
struct FarSummaryTileDescriptor {
    tile_x: i32,
    tile_z: i32,
    level: u32,
    sample_step: u32,
    origin_x: f32,
    origin_z: f32,
    size_x: f32,
    size_z: f32,
    revision: u32,
    flags: u32,
    _pad0: u32,
    _pad1: u32,
};
```

### Output summary buffer

Keep this 64-byte aligned.

```wgsl
struct FarSummaryGpuRecord {
    height_min_max: vec2<f32>,      // min, max
    height_avg_slope: vec2<f32>,    // avgHeight, slopeMean
    normal_avg: vec4<f32>,          // xyz + slopeMax
    material_cover_a: vec4<f32>,    // water, land, grass, rock
    material_cover_b: vec4<f32>,    // snow, sand, treeEligibility, grassEligibility
    canopy_occ: vec4<f32>,          // canopyDensity, occupancyMaskFloat, materialVariance, reserved
    meta: vec4<u32>,                // dominantMaterial, revision, flags, sampleCount
};
```

If storage pressure becomes an issue later, pack coverage fields to `u16`/`u8`. Do not start packed; keep parity easy first.

## WebGPU pipeline shape

### Pass 1 — tile summary build

One workgroup per tile or per tile block.

```text
for each tile descriptor:
  sample N x N points
  evaluate height/material/water/normal/slope
  reduce into summary record
  write output record
```

Start with a fixed `N=16` or `N=32` sample grid per tile. Make it configurable.

### Pass 2 — optional mip/ring reduction

After per-tile records are stable, add parent summaries:

```text
4 child summaries -> 1 parent summary
```

This creates clipmap-friendly far levels for long-view and shader-displaced terrain.

### Pass 3 — optional debug readback

Only for parity and acceptance diagnostics:

```text
copy selected output records to readback buffer
map once
compare with CPU reference
```

Never map the full summary buffer during perf runs.

## CPU fallback

The existing CPU summary path remains the fallback and the parity oracle.

Fallback rules:

```text
WebGPU unavailable -> CPU far summary
shader compile failure -> CPU far summary
GPU dispatch failure -> CPU far summary for dirty tiles
GPU parity failure in strict mode -> CPU far summary and fail acceptance
summary buffer overflow -> split dirty tiles into sub-batches or CPU fallback
```

No GPU failure should block basic scene loading.

## Dirty tile scheduling

Do not rebuild every summary every frame.

Use a dirty queue:

```ts
interface FarSummaryDirtyTile {
  tileX: number;
  tileZ: number;
  level: number;
  reason: "startup" | "camera_ring_shift" | "streamed_page_ready" | "edit" | "water_change" | "debug_force";
  revision: number;
}
```

Dirty reasons:

```text
startup: initial summary for visible rings
camera_ring_shift: camera crossed summary tile/ring boundary
streamed_page_ready: new CLOD/root data became available
edit: terrain edit touched the tile
water_change: water/body state changed
fallback_rebuild: invalid or missing GPU summary
```

Budget per frame:

```yaml
farSummaryGpu:
  enabled: true
  max_dirty_tiles_per_batch: 256
  max_batches_per_frame: 1
  sample_grid: 16
  strict_parity: false
  debug_readback_tiles: 8
```

## Integration phases

### Phase 1 — scaffold and pure planning

Files:

```text
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_types.ts
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_config.ts
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_planner.ts
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_planner.test.ts
```

Build:

```text
config parsing
dirty tile planning
batch splitting
buffer byte estimates
counter names
fallback decision helpers
```

No WebGPU dispatch yet.

### Phase 2 — CPU reference extraction

Add a stable CPU reference function:

```ts
buildCpuFarSummaryRecord(tileDescriptor, fieldSampler): FarSummaryTileRecord
```

This must be deterministic and used by tests.

Do not reuse a large mutable runtime path directly. Wrap the existing logic into a pure adapter where possible.

### Phase 3 — WebGPU device/pipeline owner

Files:

```text
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_builder.ts
tools/clod-poc/src/terrain/far_summary/gpu_far_summary_buffers.ts
tools/clod-poc/src/terrain/far_summary/shaders/far_summary_build.wgsl
```

Responsibilities:

```text
own GPUDevice references passed from existing WebGPU runtime
compile shader module once
reuse descriptor/output/readback buffers
split large dirty queues into safe batches
record one compute pass per batch
submit once per batch
perform optional sampled readback only in parity/debug mode
```

### Phase 4 — runtime integration behind flag

Add config/URL flags:

```text
farSummaryGpu=0|1
farSummaryGpuStrictParity=0|1
farSummaryGpuDebugReadback=0|1
farSummaryGpuSampleGrid=16|32
farSummaryGpuMaxTilesPerBatch=N
```

Default initially:

```text
normal manual dev: off until stable
acceptance diagnosis: on for selected runs
final target: on by default when WebGPU available
```

### Phase 5 — parity acceptance

For a small deterministic tile set:

```text
build CPU summary
build GPU summary
read back selected records
compare within tolerances
```

Tolerances:

```text
height min/max: <= 0.25m initially, tighten later
coverage: <= 0.05 initially, tighten later
dominant material: exact for stable non-border tiles
slope: <= 0.05
eligibility: <= 0.05
```

Do not compare noisy biome edges too tightly in the first pass.

### Phase 6 — consumer migration

Migrate consumers one at a time.

Order:

```text
1. long-view diagnostics reads GPU summary counters when available
2. far shell/far terrain reads summary for height/material hints
3. canopy density reads summary
4. vegetation rejection uses summary as early rejection before detailed sampling
5. shader-displaced far clipmap grids sample summary/height textures directly
```

Each consumer migration needs a kill switch.

## Expected performance win

Startup/stabilization should improve because the CPU stops doing repeated spatial scans.

Expected counters after stable implementation:

```text
farSummaryMs p95 drops
longViewDiagnosticsMs stays low
startup stabilization frames decrease
CPU dirty tile build count decreases
GPU dirty tile batch count increases
readback time remains near zero unless debug enabled
```

This will not necessarily reduce `renderMs`; it targets CPU startup/stabilization and far-summary phase cost.

## Counters

Add these counters:

```text
far_summary_gpu_enabled
far_summary_gpu_device_ready
far_summary_gpu_dirty_tiles
far_summary_gpu_tiles_dispatched
far_summary_gpu_batches_dispatched
far_summary_gpu_fallback_tiles
far_summary_gpu_failed_batches
far_summary_gpu_compute_ms_p50
far_summary_gpu_compute_ms_p95
far_summary_gpu_readback_ms_p95
far_summary_gpu_parity_checked_tiles
far_summary_gpu_parity_failed_tiles
far_summary_gpu_summary_records_live
far_summary_gpu_buffer_bytes
far_summary_gpu_dropped_stale_batches
far_summary_cpu_fallback_ms_p95
```

Split compute and readback. Do not hide readback inside general summary time.

## Debug counters for center and coordinate alignment

Because recent failures were caused by inconsistent centers, also publish:

```text
far_summary_center_x
far_summary_center_z
far_summary_tile_origin_min_x
far_summary_tile_origin_max_x
far_summary_tile_origin_min_z
far_summary_tile_origin_max_z
far_summary_ring_revision
far_summary_gpu_last_tile_x
far_summary_gpu_last_tile_z
```

These should be compared against terrain, vegetation, water, and stream centers from the canonical-center debug work.

## Failure behavior

```text
GPU unavailable:
  use CPU summary

GPU shader compile fails:
  log once, disable GPU summary, use CPU summary

GPU batch fails:
  mark batch failed, fall back dirty tiles to CPU

GPU parity fails in non-strict mode:
  log and keep CPU summary for those tiles

GPU parity fails in strict mode:
  fail acceptance

consumer reads missing GPU summary:
  use last valid CPU summary or conservative missing summary
```

No consumer should crash from missing GPU summaries.

## Tests

### Planner tests

```text
plans startup rings deterministically
camera ring shift dirties only changed tiles
edits dirty expected tile set
batch size cap respected
buffer byte cap respected
fallback selected when WebGPU unavailable
```

### CPU reference tests

```text
flat tile produces equal min/max/avg height
water tile reports water coverage
grass tile reports grass eligibility
rock/slope tile rejects grass eligibility
mixed material tile has material variance
```

### GPU wrapper tests without WebGPU

Use fake device/backend interfaces where possible:

```text
shader compile failure routes fallback
batch failure routes fallback
strict parity failure throws
non-strict parity failure falls back per tile
readback disabled in perf mode
```

Do not unit test real WebGPU dispatch headlessly unless the project already has a browser/device harness.

## Browser acceptance

Add a focused acceptance mode later:

```bash
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near --far-summary-gpu
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk --far-summary-gpu
```

If wrapper flags are not implemented, use URL params:

```text
farSummaryGpu=1&farSummaryGpuStrictParity=0&farSummaryGpuDebugReadback=0
```

Hard checks once stable:

```text
far_summary_gpu_enabled = 1
far_summary_gpu_device_ready = 1
far_summary_gpu_batches_dispatched > 0
far_summary_gpu_tiles_dispatched > 0
far_summary_gpu_failed_batches = 0
far_summary_gpu_fallback_tiles = 0 or low during initial warmup
far_summary_gpu_readback_ms_p95 = 0 in perf runs
farSummaryMs p95 lower than CPU baseline
```

## Visual acceptance

Use the known broken manual scenes after the bounds guard.

Expected:

```text
far terrain summary center matches camera/player center
far shell does not jump to a different world region
canopy does not appear around a stale finite-world origin
water/ocean summary boundaries align with terrain
no new stretched terrain pages are introduced
```

## Rollout strategy

1. Land pure planner and config with GPU disabled.
2. Land CPU reference summary adapter.
3. Land WebGPU builder behind `farSummaryGpu=1`.
4. Run parity on small tile samples only.
5. Enable non-strict GPU summary for manual populated infinite-islands testing.
6. Move diagnostics consumer.
7. Move far shell/canopy consumers after parity is clean.
8. Add hard acceptance checks only after two clean manual runs.

## Source files likely to change

```text
tools/clod-poc/src/terrain/far_summary/*
tools/clod-poc/src/terrain/far_summary/shaders/far_summary_build.wgsl
tools/clod-poc/src/runtime/long_view_frame_diagnostics.ts
tools/clod-poc/src/runtime/terrain_frame_phase.ts
tools/clod-poc/src/runtime/clod_frame_loop.ts
tools/clod-poc/tools/infinite_acceptance/thresholds.ts
tools/clod-poc/tools/infinite_acceptance/convergence.ts
```

Adjust paths after reading latest `main`. Do not assume these exact files exist.

## Implementation prompts for follow-up agents

### Prompt 1 — planner/config only

```text
Read latest main. Add GPU far-summary planner/config only, no WebGPU dispatch. Create pure tests for dirty tile planning, batch splitting, byte caps, and fallback decision helpers. Do not change runtime behavior yet.
```

### Prompt 2 — CPU reference adapter

```text
Read latest main. Extract a deterministic CPU far-summary record builder from the existing far-summary logic. Keep it pure and testable. Add tests for flat, water, grass, rock, and mixed-material tiles.
```

### Prompt 3 — WebGPU builder behind flag

```text
Read latest main. Add a WebGPU far-summary builder behind farSummaryGpu=1. Reuse one device/module/pipeline, batch dirty tiles, submit once per batch, and avoid readback unless parity/debug is enabled. CPU fallback must remain intact.
```

### Prompt 4 — parity and counters

```text
Read latest main. Add sampled GPU/CPU parity checks for far-summary records, split compute/readback counters, and acceptance-visible counters. Perf runs must not do debug readbacks.
```

### Prompt 5 — migrate first consumer

```text
Read latest main. Migrate long-view diagnostics to read GPU far-summary records when available, with CPU fallback and center-alignment counters. Do not migrate far shell or canopy yet.
```

## Done criteria

The feature is done only when:

```text
CPU fallback works
WebGPU unavailable works
GPU shader compile failure falls back
strict parity can fail acceptance
perf mode has no summary readback
farSummaryMs p95 improves in reuse perf scenes
startup/stabilization time improves or dirty frame count drops
visual centers remain aligned
bounds guard reports zero bad pages in clean runs
```
