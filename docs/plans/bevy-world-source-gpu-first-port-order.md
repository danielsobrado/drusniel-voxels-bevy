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
- Bevy chunk generation selects legacy or WorldSource bridge through terrain-source config.
- Bevy has `assets/shaders/world_source/biome_splat.wgsl` with GPU splat sampling and triplanar-weight conversion.
- Bevy Rust `BiomeSplatSample` has `triplanar_weights()` parity helpers and tests against the WGSL material-layer IDs.
- Bevy triplanar terrain shader imports `world_source/biome_splat.wgsl` and calls `biome_splat_resolve_triplanar_weights()` under `TERRAIN_GPU_BIOME_SPLAT`.
- Surface Nets terrain encodes biome id in `uv0.y`; `uv0.x` remains baked AO.
- Bevy mesh biome channel now resolves biome id from true WorldSource material tags, then active `ProceduralWorldSource`, then the named legacy compatibility adapter.
- Bevy now has `BiomeContentTable` covering Meadows, Forest, Swamp, Mountain, Plains, Coast, and Ocean.
- WorldSource terrain generation uses `BiomeContentTable` instead of bridge-local material rules.
- Bevy now has `WorldSourceDriftGateReport` with explicit `passed`, `failed`, and `skipped` states for CPU/GPU drift checks.
- Bevy now has `TerrainSourceStartupReport` and config-bound startup diagnostics for active terrain source mode.
- Bevy now has `world_source_acceptance`, a release-oriented acceptance bench that writes `bench-runs/<run>/summary.json`.
- Bevy has opt-in render-app WorldSource drift readback infrastructure: request population, compute dispatch, staging-buffer map/decode, shared-result publication, and runtime drift-gate evaluation when `VOXEL_WORLD_SOURCE_DRIFT_READBACK=1` or `--runtime-assisted` is enabled.
- Runtime-assisted WorldSource readback writes `bench-runs/world-source-runtime-acceptance/summary.json` by default, or `VOXEL_WORLD_SOURCE_DRIFT_ACCEPTANCE_OUT` when overridden.
- `bench/scenes/terrain/world-source-readback-acceptance.toml` is the minimal no-screenshot runtime scene for collecting that readback artifact.
- Native Windows runtime verification on 2026-06-30 produced accepted GPU readback evidence in `bench-runs/world-source-runtime-acceptance/summary.json`: `acceptance_pass: true`, no blockers, `gpu_readback.status: available`, 5 samples, `drift_gate.status: passed`, 5 comparisons, and 0 failures.
- `src/voxel/runtime/generation.rs` was restored to the full runtime module after an accidental truncation.

Not done yet:

- The standalone `world_source_acceptance` report still uses the unavailable readback provider, so `acceptance_pass` must remain `false` with `gpu_readback_unavailable` and `drift_gate_not_passed` until real GPU samples feed the report.
- The final acceptance decision still needs to choose whether `world_source_acceptance` consumes real GPU readback directly or remains paired with the reviewed runtime-assisted artifact.
- MC/Transvoxel remains a legacy/fallback mesh path and is not a blocker for the CLOD/WorldSource default path.
- Legacy bridge removal is still pending final visual parity and accepted bench thresholds.

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
| Mesh biome channel | seven-biome id in `uv0.y` | n/a | triplanar shader | material tag / active WorldSource / compatibility fallback | CLOD path wired |
| MC/Transvoxel | legacy/fallback only | n/a | n/a | not blocking CLOD path | Legacy |
| Drift gate status | pass/fail/skip | n/a | readback input | `WorldSourceDriftGateReport` | Explicit status; skipped blocks acceptance |
| Terrain source runtime path | GPU default / CPU reference / legacy | n/a | n/a | `TerrainSourceStartupReport` | Explicit status |
| Acceptance summary | `bench-runs/<run>/summary.json` | n/a | n/a | `world_source_acceptance` | Explicit report; unavailable readback blocks pass |

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

- The active CLOD/WorldSource path resolves biome id from true material tags or active `ProceduralWorldSource` before using the legacy compatibility adapter.
- MC/Transvoxel is legacy/fallback for this port and does not block GPU biome/splat parity.
- BVY-WS-09 should add a real GPU-readback producer before this is treated as full runtime visual parity.

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
- [x] Acceptance report cannot mistake skipped GPU gate for pass through `is_acceptance_pass()` or `world_source_acceptance.acceptance_pass`.

Notes:

- `WorldSourceDriftGateReport` is ready for BVY-WS-11 bench/acceptance JSON output.
- Runtime readback infrastructure now has accepted native Windows evidence, but the final acceptance report still needs to consume that evidence directly or explicitly pair with the runtime artifact.

### BVY-WS-10 — Make GPU WorldSource default runtime path

Status: Done.

Acceptance:

- [x] `gpu_world_source` default in config.
- [x] Legacy mode opt-in only.
- [x] CPU reference mode opt-in only.
- [x] Startup diagnostics report active terrain source mode.
- [x] Acceptance can record GPU, CPU fallback/reference, or legacy path through `TerrainSourceStartupReport` and `TerrainSourceMode::acceptance_label()`.

### BVY-WS-11 — Add Bevy release bench and acceptance report

Status: Done.

Acceptance:

- [x] Release-mode bench command documented as `cargo run --release --bin world_source_acceptance`.
- [x] Report includes terrain source mode.
- [x] Report includes chunk generation and mesh build time.
- [x] Report includes material/draw count impact.
- [x] Report includes CPU/GPU drift gate status.
- [x] Writes `bench-runs/<run>/summary.json`.

Notes:

- The standalone report still uses the unavailable readback provider, so `gpu_readback.status` is expected to be `unavailable`, `drift_gate.status` is expected to be `skipped`, and `acceptance_pass` is expected to be `false` until real GPU samples are accepted.
- The acceptance bench measures sampled WorldSource chunk generation and mesh generation outside the full Bevy render loop.

### BVY-WS-12 — Remove temporary legacy bridge after visual parity

Status: Next.

Acceptance:

- [ ] Visual parity scene passes.
- [x] Opt-in runtime GPU readback produces matching samples and a passed drift gate.
- [ ] Final acceptance report consumes real GPU readback or records the reviewed runtime-assisted acceptance artifact from `bench-runs/world-source-runtime-acceptance/summary.json`.
- [ ] Bench within accepted thresholds.
- [ ] Legacy path removed or explicitly deprecated.
- [ ] Temporary seven-biome-to-legacy-material mapping removed from default path.
- [ ] Docs updated with final GPU WorldSource flow.

## Required order

BVY-WS-01, BVY-WS-02, BVY-WS-03, BVY-WS-04, BVY-WS-05, BVY-WS-06, BVY-WS-07, BVY-WS-08, BVY-WS-09, BVY-WS-10, BVY-WS-11, BVY-WS-12.

Do not remove the legacy bridge until the acceptance path has explicit terrain source, real GPU readback status, and a passed drift gate.

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
rtk cargo test --bin world_source_acceptance
rtk cargo test world::source
rtk cargo test voxel::meshing::biome_channel
rtk cargo test voxel::runtime::world_source_generation
rtk cargo test
```

Bevy bench after BVY-WS-11:

```powershell
rtk cargo run --release --bin world_source_acceptance
```

Runtime-assisted GPU readback artifact, from a native Windows shell:

```powershell
rtk cargo run --release -- --runtime-assisted --bench bench/scenes/terrain/world-source-readback-acceptance.toml --bench-out bench-runs/world-source-runtime-readback
```
