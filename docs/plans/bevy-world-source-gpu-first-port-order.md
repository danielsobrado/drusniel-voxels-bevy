# Bevy WorldSource GPU-first port plan

This plan extends ISLE-17 from `docs/plans/infinite-streaming-biome-islands-jiras.md`.

## Core rule

CPU and GPU world generation must not diverge. GPU is the default runtime path where supported. CPU is only a fallback, reference, or debug path.

## Current status

Done:

- Bevy has `src/world/source/` with `WorldSource`, `ProceduralWorldSource`, island shaping, biome region classification, splat types, and the temporary terrain bridge.
- clod-poc and Bevy use named `BiomeRegionContract` payloads instead of classifier-local duplicated threshold literals.
- clod-poc WGSL classifier reads `contract.*` fields and its default WGSL payload is tested against TypeScript.
- Bevy tests parse the clod-poc WGSL default contract and compare it against Rust `BIOME_REGION_CONTRACT`.
- clod-poc NAADF far-shell height sampling defaults to GPU.
- clod-poc has `tools/clod-poc/scripts/export-world-source-golden.mts`.
- clod-poc has `tools/clod-poc/fixtures/world_source_golden_samples.json` with 70 samples, 10 per biome.
- Bevy has Rust fixture parity tests in `src/world/source/golden_fixture_tests.rs`.
- Bevy has `assets/config/terrain_source.yaml` with `gpu_world_source` as the target default.
- Bevy chunk generation now selects legacy or WorldSource bridge through terrain-source config.
- Bevy has `assets/shaders/world_source/biome_splat.wgsl` with GPU splat sampling and triplanar-weight conversion.
- Bevy Rust `BiomeSplatSample` has `triplanar_weights()` parity helpers and tests against the WGSL material-layer IDs.
- Bevy triplanar terrain shader imports `world_source/biome_splat.wgsl` and calls `biome_splat_resolve_triplanar_weights()` under `TERRAIN_GPU_BIOME_SPLAT`.
- Surface Nets terrain encodes a compatibility biome id in `uv0.y`; `uv0.x` remains baked AO.
- Bevy now has `BiomeContentTable` covering Meadows, Forest, Swamp, Mountain, Plains, Coast, and Ocean.
- WorldSource terrain generation uses `BiomeContentTable` instead of bridge-local material rules.
- Bevy now has `WorldSourceDriftGateReport` with explicit `passed`, `failed`, and `skipped` states for CPU/GPU drift checks.

Not done yet:

- Bevy renderer/material path currently receives a compatibility biome id inferred from legacy four-channel material weights; true WorldSource biome IDs should replace it before visual parity is claimed.
- GPU readback producer is not implemented yet; until it is available, the drift gate reports `skipped`, not `passed`.

## Shared contract source of truth

| Contract value | Canonical value | clod-poc CPU | clod-poc GPU | Bevy CPU/reference | Status |
| --- | ---: | --- | --- | --- | --- |
| Biome ids | 0..6 | `biome_region_field.ts` | `biome_region_field.wgsl` | `biome_region_field.rs` | Frozen |
| Region cell | `420m` | `BiomeRegionContract.regionCellM` | `BiomeRegionContract.regionCellM` | `BiomeRegionContract.region_cell_m` | Shared contract |
| Ocean height margin | `1.5m` | contract | contract | contract | Shared contract |
| Ocean island mask max | `0.08` | contract | contract | contract | Shared contract |
| Coast height band | `4m` | contract | contract | contract | Shared contract |
| Coast shore distance | `42m` | contract | contract | contract | Shared contract |
| Mountain above sea | `68m` | contract | contract | contract | Shared contract |
| Swamp above sea | `8m` | contract | contract | contract | Shared contract |
| Swamp noise max | `0.42` | contract | contract | contract | Shared contract |
| Plains distance min | `0.72` | contract | contract | contract | Shared contract |
| Plains noise min | `0.58` | contract | contract | contract | Shared contract |
| Forest noise min | `0.46` | contract | contract | contract | Shared contract |
| Sea level | default `18m` | config | uniform/config path | config | Config |
| Island shape | config | config | GPU parity path | config | Config |
| Ocean rim | config | config | GPU parity path | config | Config |
| Splat output | dominant layer plus weights | `sampleBiomeSplat` | pending Bevy WGSL | `BiomeSplatSample` + `biome_splat.wgsl` | GPU path wired |
| Voxel biome content | seven-biome table | compatibility | n/a | `BiomeContentTable` | Shared Bevy content |
| Drift gate status | pass/fail/skip | n/a | readback input | `WorldSourceDriftGateReport` | Explicit status |

## Jira tasks

### BVY-WS-01 — Freeze shared WorldSource contract

Status: Done.

Acceptance:

- [x] Plan lists shared constants and source of truth.
- [x] clod-poc region cell is locked to `420`.
- [x] Bevy region cell is locked to `420`.
- [x] No Bevy config exposes CPU-only values that GPU ignores.
- [x] Stubs fail loudly instead of returning placeholder terrain data.

### BVY-WS-02 — Add clod-poc golden sample exporter

Status: Done.

Outputs:

- `tools/clod-poc/scripts/export-world-source-golden.mts`
- `tools/clod-poc/fixtures/world_source_golden_samples.json`
- `tools/clod-poc/src/world_source/biome_splat.ts`

Acceptance:

- [x] Deterministic clod-poc script writes a JSON fixture.
- [x] Fixture includes 70 points, 10 per biome.
- [x] Fixture includes seed, sea level, island-shape config, bounds, ocean-rim flag, biome-region cell, and contract version.
- [x] Fixture is checked into `tools/clod-poc/fixtures/`.
- [x] Output order is deterministic for unchanged contract code.

### BVY-WS-03 — Add Bevy golden fixture reader and parity tests

Status: Done.

Acceptance:

- [x] Rust test loads `tools/clod-poc/fixtures/world_source_golden_samples.json`.
- [x] Height tolerance is explicit and small.
- [x] Biome ID matches exactly.
- [x] Ocean mask tolerance is explicit and small.
- [x] Dominant material layer matches through the temporary mapping.
- [x] Test fails on unsupported contract version.

### BVY-WS-04 — Add Bevy terrain-source mode config

Status: Done.

Modes:

- `gpu_world_source`: target default where GPU is supported.
- `legacy`: old Bevy terrain path during migration.
- `cpu_world_source_reference`: explicit CPU reference/debug mode.

Acceptance:

- [x] Config loads from YAML.
- [x] Default mode is `gpu_world_source` where GPU is supported.
- [x] CPU mode name clearly says reference/debug/fallback.
- [x] Legacy mode remains available during migration.
- [x] Invalid mode fails loudly.

### BVY-WS-05 — Bridge chunk generation behind source-mode flag

Status: Done.

Acceptance:

- [x] Chunk generation can use `WorldSourceTerrainBridge` behind a config flag.
- [x] Legacy path still works.
- [x] Bedrock floor is preserved.
- [x] Water fills between surface and sea level.
- [x] Seven clod-poc biome IDs map deterministically to temporary Bevy voxel materials.
- [x] Tests cover source-mode selection.

### BVY-WS-06 — Move biome-region constants into shared GPU uniform/config contract

Status: Done.

Acceptance:

- [x] Region cell size is supplied to WGSL classifier through `BiomeRegionContract`, not as a classifier-local hardcoded literal.
- [x] Biome thresholds are supplied from named TypeScript/Rust/WGSL contract payloads.
- [x] TypeScript tests verify WGSL default contract values equal the TypeScript contract and that classifier code reads `contract.*` fields.
- [x] Bevy tests parse the WGSL default contract and compare it against Rust `BIOME_REGION_CONTRACT`.
- [x] Bevy uses the same contract values through `BiomeRegionContract`.

### BVY-WS-07 — Port biome/splat WGSL to Bevy GPU terrain path

Status: Done.

Acceptance:

- [x] Bevy terrain material path consumes a biome id and splat weights on GPU.
- [x] GPU biome/splat WGSL module exists and is selected by default through terrain material specialization.
- [x] CPU/reference fallback is explicit as the `legacy_w` branch when `TERRAIN_GPU_BIOME_SPLAT` is absent.
- [x] Rust dominant/triplanar layer mapping is tested against the WGSL material-layer contract.
- [x] No CPU-only material tuning path is used by the default shader path.

Notes:

- The current Bevy mesh biome channel is a compatibility bridge inferred from the legacy four material weights.
- BVY-WS-09 should add a drift gate before this is treated as visual parity.

### BVY-WS-08 — Expand Bevy biome/content tables to seven biome IDs

Status: Done.

Acceptance:

- [x] Bevy content represents Meadows, Forest, Swamp, Mountain, Plains, Coast, Ocean through `BiomeContentTable`.
- [x] Temporary legacy material mapping is documented in `voxel::meshing::biome_channel`.
- [x] Missing biome content fails at compile time through exhaustive `BiomeId` matching, and the remaining mesh-side compatibility bridge is named as such.
- [x] Tests cover all seven IDs.

### BVY-WS-09 — Add CPU/GPU drift gate for Bevy

Status: Done.

Acceptance:

- [x] Gate compares CPU reference and GPU results where readback samples are supplied.
- [x] Biome ID and dominant layer exact-match.
- [x] Numeric tolerances explicit.
- [x] GPU/readback absence is skipped, not passed.
- [x] Acceptance report cannot mistake skipped GPU gate for pass through `is_acceptance_pass()`.

Notes:

- `WorldSourceDriftGateReport` is ready for BVY-WS-11 bench/acceptance JSON output.
- A GPU readback producer is still required before the gate can produce a real pass in runtime acceptance.

### BVY-WS-10 — Make GPU WorldSource default runtime path

Status: Next.

Acceptance:

- [ ] `gpu_world_source` default in config.
- [ ] Legacy mode opt-in only.
- [ ] CPU reference mode opt-in only.
- [ ] Startup diagnostics report active terrain source mode.
- [ ] Acceptance records GPU, CPU fallback, or legacy path.

### BVY-WS-11 — Add Bevy release bench and acceptance report

Status: Pending.

Acceptance:

- [ ] Release-mode bench runs.
- [ ] Report includes terrain source mode.
- [ ] Report includes chunk generation and mesh build time.
- [ ] Report includes material/draw count impact.
- [ ] Report includes CPU/GPU drift gate status.
- [ ] Writes `bench-runs/<run>/summary.json`.

### BVY-WS-12 — Remove temporary legacy bridge after visual parity

Status: Pending.

Acceptance:

- [ ] Visual parity scene passes.
- [ ] Bench within accepted thresholds.
- [ ] Legacy path removed or explicitly deprecated.
- [ ] Temporary seven-biome-to-legacy-material mapping removed from default path.
- [ ] Docs updated with final GPU WorldSource flow.

## Required order

BVY-WS-01, BVY-WS-02, BVY-WS-03, BVY-WS-04, BVY-WS-05, BVY-WS-06, BVY-WS-07, BVY-WS-08, BVY-WS-09, BVY-WS-10, BVY-WS-11, BVY-WS-12.

Do not make GPU WorldSource the runtime default before BVY-WS-09 passes or reports an explicit skip.

## Verification commands

clod-poc:

```powershell
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run acceptance:clod:fast
npm --prefix tools/clod-poc run build
```

Bevy:

```powershell
cargo test world::source::drift_gate
cargo test world::source
cargo test
```

Bevy bench after BVY-WS-11:

```powershell
cargo run --release -- --bench world_source
```
