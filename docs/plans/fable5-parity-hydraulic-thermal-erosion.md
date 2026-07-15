# Fable5 Parity 1 — Deterministic Hydraulic and Thermal Erosion

Status: implementation plan.

Scope: `tools/clod-poc` first, then the Rust/Bevy world generator through the same persisted artifact contract.

This plan is prescriptive. The implementation must follow the architecture, data formats, ordering, defaults, file placement, tests, and gates below. No representation or algorithm choice is left to the implementer.

## 1. Goal

Add real hydraulic erosion, sediment transport, deposition, and thermal talus relaxation to Drusniel's canonical continent-generation pipeline while preserving all voxel-specific capabilities:

- `VoxelWorld` remains authoritative for editable terrain.
- Caves, arches, overhangs, floating terrain, destructive edits, and construction remain voxel features.
- Erosion changes only the generated base surface used before the hydrology graph and voxel overlay are applied.
- Erosion never runs on the gameplay frame path.
- The result is deterministic, versioned, persisted, content-addressed, resumable, and invalidates dependent artifacts through the existing world-manifest hash chain.

The target is geological parity with the useful part of the Fable5 pipeline: drainage-shaped valleys, transported sediment, depositional areas, and hardness-aware talus. The target is not Fable5's fixed 4 km heightfield architecture.

## 2. Fixed generation order

The canonical world build order is:

```text
seeded macro base field
  -> deterministic hydraulic erosion artifact
  -> deterministic thermal relaxation artifact
  -> eroded macro field at 16 m lattice spacing
  -> continental priority-flood and flow graph
  -> connected river/lake records
  -> graph-based river and lake carving into 256 m heightfield tiles
  -> canonical carved heightfield tiles
  -> CLOD terrain and far summaries
  -> voxel/cave/structure overlay
  -> live voxel edits and persistence deltas
```

The hydrology graph must always be rebuilt from the eroded macro field. The old order, where graph carving is applied directly to an uneroded macro field, is removed for continent worlds after acceptance.

The erosion pass must never consume the river graph. This prevents a circular authority chain.

## 3. Representation firewall

Erosion owns only the generated base surface artifact.

It must not:

- write directly into `VoxelWorld`;
- modify saved voxel deltas;
- remove caves or overhangs;
- become a runtime terrain sampler independent of canonical tiles;
- create a second water authority;
- run when a player digs or builds;
- be sampled directly by render shaders after canonical tiles exist.

After world creation, consumers read canonical carved heightfield tiles and voxel overlays exactly as they do now. Erosion is an upstream generation step, not a new runtime representation.

## 4. Numerical model

Use a deterministic fixed-point pipe-model simulation inspired by the Fable5 erosion pass, implemented with integer arithmetic.

### 4.1 Grid

```yaml
erosion:
  schema_version: 1
  enabled: true
  cell_size_m: 16
  border_cells: 2
  hydraulic_iterations: 192
  thermal_iterations: 48
  checkpoint_every_iterations: 8
```

For the default 32,768 m continent this produces a `2049 x 2049` canonical lattice before the two-cell simulation border is added.

The grid origin and cell indexing must exactly match the macro field consumed by `src/world/hydrology_graph/`. No resampling transform is permitted between erosion output and hydrology input.

### 4.2 Fixed-point scales

Use these exact storage scales:

```text
terrain height: signed i32, 1 unit = 1/256 m
water depth:    unsigned u32, 1 unit = 1/4096 m
sediment:       unsigned u32, 1 unit = 1/65536 m-equivalent
flux:           unsigned u32, 1 unit = 1/65536 m per simulation step
hardness:       unsigned u16, 0..65535
velocity:       signed i32 x/z, 1 unit = 1/4096 cell per step
deposition:     signed i32, 1 unit = 1/65536 m-equivalent
```

Every multiplication that can overflow 32 bits must be promoted to 64-bit arithmetic in the CPU oracle. The production TypeScript implementation must emulate the same operations using `BigInt` only in the oracle tests; the runtime worker uses bounded 32-bit integer operations with explicit widening split helpers. WGSL uses `i32/u32` and helper functions that decompose 32x32 products into high/low words. Float arithmetic is forbidden in canonical state updates.

### 4.3 Per-iteration pipeline

Each hydraulic iteration performs these stages in order:

1. Rain injection.
2. Four-direction hydraulic-head flux update.
3. Flux normalization so outflow never exceeds available water.
4. Water-depth update from flux divergence.
5. Velocity derivation from directional flux.
6. Sediment-capacity calculation from velocity, slope, water depth, and hardness.
7. Hardness-limited erosion or deposition.
8. Semi-Lagrangian sediment advection using deterministic fixed-point bilinear weights.
9. Evaporation.
10. Boundary drainage.

After every four hydraulic iterations, execute one thermal-relaxation iteration. After the 192 hydraulic iterations complete, execute the remaining thermal iterations until the configured total of 48 is reached.

### 4.4 Constants

Add `tools/clod-poc/config/terrain_erosion.yaml` with these defaults:

```yaml
erosion:
  schema_version: 1
  enabled: true
  cell_size_m: 16
  border_cells: 2
  hydraulic_iterations: 192
  thermal_iterations: 48
  checkpoint_every_iterations: 8

  rain:
    amount_per_iteration_m: 0.0025
    spatial_variation: 0.20

  water:
    gravity_m_s2: 9.81
    time_step_s: 0.04
    evaporation_fraction: 0.012
    max_velocity_cells_per_step: 2.0

  sediment:
    capacity_factor: 0.55
    erosion_rate: 0.24
    deposition_rate: 0.45
    minimum_slope: 0.008
    maximum_erosion_per_iteration_m: 0.04
    maximum_deposition_per_iteration_m: 0.06

  thermal:
    rate: 0.12
    soft_talus_degrees: 30.0
    hard_talus_degrees: 72.0

  persistence:
    compression: zstd
    quantized_height_step_m: 0.00390625
    keep_water_field: false
    keep_sediment_field: true
    keep_deposition_field: true
```

The parser must reject unknown keys and values outside validated ranges. There are no hidden fallback constants in implementation files.

## 5. Hardness field

The erosion simulation must consume one canonical hardness sample per macro cell.

Hardness is computed before erosion from the existing macro terrain source and material geology fields:

```text
base hardness
  + exposed bedrock contribution
  + ridge/core-rock contribution
  - soil and valley-fill contribution
  - weathering contribution
```

Normalize to `u16`.

Required semantic ranges:

```text
0.10..0.30: soil, alluvium, beach, soft sediment
0.30..0.55: weathered rock and mixed ground
0.55..0.80: normal exposed rock
0.80..1.00: massif core, hard cliffs, protected structural ridges
```

The hardness field is persisted in the erosion artifact because sediment-derived material classification and regression debugging require it.

## 6. Artifact contract

Extend `WorldManifest.artifacts` with:

```ts
export interface ErosionArtifactRef {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly hash: string;
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly sourceTerrainHash: string;
  readonly configHash: string;
}
```

Persist one binary artifact:

```text
world-artifacts/<world-id>/erosion-v1.bin.zst
```

Binary layout:

```text
64-byte header
  magic = DREROSN1
  schema version
  width / height
  cell size in millimetres
  origin x/z in millimetres
  source terrain hash prefix
  config hash prefix

height field       i32[width * height]
hardness field     u16[width * height]
sediment field     u32[width * height]
deposition field   i32[width * height]
```

The artifact hash covers the uncompressed canonical bytes. Compression does not affect identity.

The world manifest hash chain must include:

```text
terrain generator version
macro terrain config hash
erosion schema version
erosion config hash
erosion artifact hash
hydrology graph schema/config/hash
carve config hash
```

A mismatch invalidates erosion, hydrology graph, carved tiles, CLOD pages, far summaries, and deterministic environmental placement caches in that order.

Saved voxel deltas remain valid because they are applied after regeneration through stable world-space coordinates. A generator-version migration must surface a warning before applying old deltas to changed base terrain.

## 7. TypeScript module layout

Create:

```text
tools/clod-poc/src/world/erosion/
  config.ts
  constants.ts
  types.ts
  fixed_point.ts
  hardness_field.ts
  state.ts
  rain.ts
  flux.ts
  water.ts
  sediment_capacity.ts
  erode_deposit.ts
  sediment_advection.ts
  thermal_relaxation.ts
  checkpoint.ts
  artifact_codec.ts
  artifact_store.ts
  worker_protocol.ts
  erosion_worker.ts
  erosion_client.ts
  integration.ts
  diagnostics.ts
```

Rules:

- `fixed_point.ts` is the only module containing fixed-point multiplication/division helpers.
- `artifact_codec.ts` is the only module that knows the binary layout.
- `artifact_store.ts` owns IndexedDB and downloadable-file persistence.
- `integration.ts` is the only module allowed to connect erosion output to the hydrology graph builder.
- The pure simulation modules must not import Three.js, DOM APIs, renderer code, save code, or hydrology code.
- The worker must expose progress and cancellation after every configured checkpoint.

## 8. GPU execution

Use the existing WebGPU device owned by the application. Do not request a second adapter or device.

Create:

```text
tools/clod-poc/src/world/erosion/gpu/
  buffers.ts
  layouts.ts
  pipeline.ts
  dispatch.ts
  readback.ts
  parity.ts
  shaders/
    erosion_init.compute.wgsl
    erosion_rain.compute.wgsl
    erosion_flux.compute.wgsl
    erosion_water.compute.wgsl
    erosion_capacity.compute.wgsl
    erosion_apply.compute.wgsl
    erosion_advect.compute.wgsl
    erosion_evaporate.compute.wgsl
    erosion_thermal.compute.wgsl
```

The GPU path is the production builder. The CPU path is the exact oracle and small-grid fallback.

Dispatch rules:

- Workgroup size is `8 x 8`.
- Ping-pong buffers are used for height, water, and sediment.
- A single command encoder records one checkpoint group of iterations.
- Submit after each checkpoint group so progress and cancellation remain responsive.
- Read back only the final height, hardness, sediment, and deposition buffers.
- Do not read back per iteration.
- Timestamp each named pass through the existing GPU profiler.

The GPU output must be bit-identical to the CPU oracle for all canonical test grids. A GPU implementation that is only visually similar does not pass.

## 9. Hydrology integration

Modify the continent world creation path so `buildHydrologyGraphFromMacro` receives an `ErodedMacroField`, not a generic sampler.

Add:

```ts
export interface ErodedMacroField {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  readonly originX: number;
  readonly originZ: number;
  readonly heightFixed: Int32Array;
  readonly hardness: Uint16Array;
  readonly sediment: Uint32Array;
  readonly deposition: Int32Array;
  sampleHeightMeters(x: number, z: number): number;
}
```

Only `sampleHeightMeters` converts fixed point to float. Hydrology graph generation, tile building, and renderer-facing APIs continue to operate in metres.

The startup sequence is:

```text
load valid erosion artifact
  or build and persist it
then build/load hydrology graph keyed by erosion hash
then build/load carved heightfield tiles keyed by both hashes
```

World creation must show separate progress phases:

```text
Generating base terrain
Eroding terrain
Building watersheds
Carving rivers and lakes
Preparing world tiles
```

## 10. Material and ecology outputs

Expose these derived channels to canonical tile construction:

```text
sediment depth
net deposition
hardness
wetness seed
```

They influence material classification only:

- positive deposition increases soil, mud, sand, and alluvium weight;
- high hardness increases exposed rock weight;
- strongly negative deposition exposes rock and reduces soil;
- wetness seed influences vegetation ecology but does not create water bodies.

These channels must not alter hydrology body ownership. Rivers and lakes remain graph records.

## 11. Rust/Bevy port

After the CLOD-POC acceptance gate passes, port the artifact consumer first and the builder second.

Create:

```text
src/world/generation/erosion/
  mod.rs
  config.rs
  types.rs
  fixed_point.rs
  artifact.rs
  sampler.rs
  builder.rs
  gpu.rs
  diagnostics.rs
```

Add:

```text
assets/config/terrain_erosion.yaml
```

The Rust artifact decoder must read the exact TypeScript binary format. Golden artifacts produced by TypeScript must decode byte-for-byte in Rust.

The Rust runtime initially consumes prebuilt erosion artifacts. The Rust GPU builder lands only after artifact compatibility, world regeneration, and visual parity are proven.

## 12. Implementation sequence

### ERO-1 — Contracts and config

- Add config, parser, fixed-point constants, types, manifest reference, and artifact header.
- Add unknown-field and range validation.
- Add hash-chain integration.

Exit gate: config and artifact header round-trip tests pass.

### ERO-2 — CPU oracle

- Implement every stage as pure typed-array code.
- Add checkpoint serialization.
- Add cancellation.

Exit gate: synthetic exact tests pass and a interrupted build resumes bit-identically.

### ERO-3 — GPU parity path

- Implement integer WGSL kernels.
- Add pass timestamps and final readback.
- Compare against CPU oracle.

Exit gate: bit-identical on all golden grids and three random seeded grids.

### ERO-4 — Artifact persistence

- Add IndexedDB load/store and download support.
- Add corruption detection and rebuild.
- Add warm-load timing counters.

Exit gate: cold build, browser reload, and warm load return the same artifact hash.

### ERO-5 — Hydrology authority switch

- Require erosion artifact before graph construction.
- Re-key hydrology and tile caches.
- Remove direct continent graph sampling from the uneroded macro field.

Exit gate: every river terminates correctly and all existing hydrology validators pass.

### ERO-6 — Materials and ecology

- Feed sediment, deposition, and hardness into tile material classification and ecological sampling.
- Do not modify body IDs or water levels.

Exit gate: material debug views show sensible alluvium and exposed-rock regions with stable hydrology.

### ERO-7 — Acceptance and default flip

- Capture visual and timing evidence.
- Make erosion default-on for `scene=continent`.
- Retain `terrainErosion=0` only as a temporary diagnostic A/B flag for one release cycle.

Exit gate: all gates below pass.

## 13. Tests

Required unit tests:

- flat plane remains planar apart from boundary drainage;
- bowl retains a basin and deposits sediment at its floor;
- tilted plane forms distributed flow without checkerboard or axis locking;
- hard ridge erodes less than soft shoulders;
- thermal pass moves material only when local talus exceeds the hardness-derived limit;
- total terrain plus suspended sediment mass stays within the fixed rounding tolerance;
- no water or sediment underflow/overflow occurs;
- checkpoint resume equals uninterrupted output;
- CPU and GPU results are bit-identical;
- artifact corruption is detected;
- artifact hashes are stable across repeated runs;
- hydrology graph identity changes when the erosion artifact changes;
- voxel overlay and saved voxel deltas are not included in the erosion hash.

Required visual scenes:

```text
erosion-ridge
  hard central ridge with soft flanks

erosion-valley
  broad catchment with tributary formation

erosion-lake-basin
  lake depression with depositional margins

erosion-cliff
  hard cliff with talus fan

erosion-continent-vista
  4 km long view comparing disabled/enabled output
```

## 14. Diagnostics and counters

Expose:

```text
erosion_enabled
erosion_schema_version
erosion_artifact_cache_hit
erosion_artifact_bytes
erosion_build_ms
erosion_gpu_ms
erosion_readback_ms
erosion_checkpoint_count
erosion_progress_percent
erosion_height_min_m
erosion_height_max_m
erosion_total_eroded_m3
erosion_total_deposited_m3
erosion_mass_error_ratio
erosion_cpu_gpu_mismatch_count
erosion_artifact_hash_prefix
```

The HUD must have debug views for:

```text
original height
eroded height
height delta
hardness
sediment
deposition
flow accumulation after graph build
```

## 15. Performance gates

Default 32 km continent on target desktop GPU:

```text
cold erosion build <= 30 s
final GPU readback <= 1.5 s
warm artifact load <= 250 ms
peak erosion GPU buffers <= 320 MiB
main-thread blocking slice <= 4 ms
steady-state gameplay frame cost = 0 ms
```

The erosion builder may increase world-creation time. It may not add steady-state gameplay work.

## 16. Correctness and visual gates

A release passes only when:

- CPU/GPU mismatch count is zero;
- repeated builds produce the same artifact hash;
- all rivers and lakes pass existing graph semantics;
- no new tile seams appear;
- no CLOD ownership or fallback regression appears;
- no caves, overhangs, voxel edits, or construction features are removed;
- valleys and talus are visible without relying on fog;
- erosion does not create one-cell trenches or obvious four-direction artifacts;
- material classification uses deposition and hardness coherently;
- continent movement acceptance remains within its existing frame-time gate after warmup.

## 17. Explicit non-goals

Do not implement:

- runtime erosion after player edits;
- fluid simulation for gameplay water;
- erosion directly on voxel chunks;
- a replacement for the continental hydrology graph;
- an alternate terrain renderer;
- per-tile independent erosion that can produce seams;
- float-based canonical GPU state;
- silent fallback to the uneroded world after an artifact error.

An artifact failure must be surfaced and rebuilt. It must never silently produce a different world under the same manifest identity.
