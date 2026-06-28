# Bevy WorldSource GPU-first port plan

This plan extends ISLE-17 from `docs/plans/infinite-streaming-biome-islands-jiras.md`.

## Core rule

CPU and GPU world generation must not diverge. GPU is the default runtime path where supported. CPU is only a fallback, reference, or debug path.

## Current status

Done:

- Bevy has `src/world/source/` with `WorldSource`, `ProceduralWorldSource`, island shaping, biome region classification, splat types, and the temporary terrain bridge.
- Bevy locks `BiomeRegionField.region_cell_m` to `420` and rejects CPU-only overrides.
- clod-poc locks `BiomeRegionField.regionCellM` to `420` because WGSL currently hardcodes `420.0`.
- clod-poc NAADF far-shell height sampling defaults to GPU.
- clod-poc has `tools/clod-poc/scripts/export-world-source-golden.mts`.
- clod-poc has `tools/clod-poc/fixtures/world_source_golden_samples.json` with 70 samples, 10 per biome.
- Bevy has Rust fixture parity tests in `src/world/source/golden_fixture_tests.rs`.
- Bevy has `assets/config/terrain_source.yaml` with `gpu_world_source` as the target default.
- Bevy chunk generation now selects legacy or WorldSource bridge through terrain-source config.

Not done yet:

- Bevy does not yet have the clod-poc biome/splat WGSL path.
- Bevy content is still behind the seven-biome clod-poc model.
- Bevy renderer/material path does not yet consume `BiomeSplatSample`.

## Shared contract source of truth

| Contract value | Canonical value | clod-poc CPU | clod-poc GPU | Bevy CPU/reference | Status |
| --- | ---: | --- | --- | --- | --- |
| Biome ids | 0..6 | `biome_region_field.ts` | `biome_region_field.wgsl` | `biome_region_field.rs` | Frozen |
| Region cell | `420m` | `BIOME_REGION_CELL_M` | hardcoded `420.0` | `BIOME_REGION_CELL_M` | Frozen until uniformized |
| Ocean height margin | `1.5m` | constant | literal | constant | Frozen |
| Ocean island mask max | `0.08` | constant | literal | constant | Frozen |
| Coast height band | `4m` | constant | literal | constant | Frozen |
| Coast shore distance | `42m` | constant | literal | constant | Frozen |
| Mountain above sea | `68m` | constant | literal | constant | Frozen |
| Swamp above sea | `8m` | constant | literal | constant | Frozen |
| Swamp noise max | `0.42` | constant | literal | constant | Frozen |
| Plains distance min | `0.72` | constant | literal | constant | Frozen |
| Plains noise min | `0.58` | constant | literal | constant | Frozen |
| Forest noise min | `0.46` | constant | literal | constant | Frozen |
| Sea level | default `18m` | config | uniform/config path | config | Config |
| Island shape | config | config | GPU parity path | config | Config |
| Ocean rim | config | config | GPU parity path | config | Config |
| Splat output | dominant layer plus weights | `sampleBiomeSplat` | pending Bevy WGSL | `BiomeSplatSample` | Fixture contract |

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

Status: Next.

Acceptance:

- [ ] Region cell size supplied to WGSL as uniform/config, not hardcoded.
- [ ] Biome thresholds supplied from one shared source.
- [ ] CPU tests verify config equals GPU uniform payload.
- [ ] Bevy uses the same contract values.

### BVY-WS-07 — Port biome/splat WGSL to Bevy GPU terrain path

Status: Pending.

Acceptance:

- [ ] Bevy terrain material path consumes biome ID and splat weights on GPU.
- [ ] GPU selected by default where supported.
- [ ] CPU fallback explicit and recorded.
- [ ] Dominant layer matches fixture.
- [ ] No CPU-only material tuning path exists.

### BVY-WS-08 — Expand Bevy biome/content tables to seven biome IDs

Status: Pending.

Acceptance:

- [ ] Bevy content represents Meadows, Forest, Swamp, Mountain, Plains, Coast, Ocean.
- [ ] Temporary legacy material mapping documented.
- [ ] Missing biome content fails loudly or uses named compatibility adapter.
- [ ] Tests cover all seven IDs.

### BVY-WS-09 — Add CPU/GPU drift gate for Bevy

Status: Pending.

Acceptance:

- [ ] Gate compares CPU reference and GPU results where readback is available.
- [ ] Biome ID and dominant layer exact-match.
- [ ] Numeric tolerances explicit.
- [ ] GPU/readback absence is skipped, not passed.
- [ ] Acceptance report cannot mistake skipped GPU gate for pass.

### BVY-WS-10 — Make GPU WorldSource default runtime path

Status: Pending.

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

Do not start BVY-WS-07 before BVY-WS-06. Do not make GPU WorldSource the runtime default before BVY-WS-09 passes.

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
cargo test world::source
cargo test
```

Bevy bench after BVY-WS-11:

```powershell
cargo run --release -- --bench world_source
```
