# Bevy WorldSource GPU-first port plan

This plan extends **ISLE-17 — Port WorldSource + BiomeRegionField + splat to Bevy** from `docs/plans/infinite-streaming-biome-islands-jiras.md`.

## Core rule

> CPU and GPU world generation must not diverge. GPU is the default runtime path where supported. CPU is only a fallback/reference path.

## Current status

Already started:

- `src/world/source/` exists as the Bevy-side foundation.
- Bevy has a Rust `WorldSource` trait and `ProceduralWorldSource` resource.
- Island/ocean-rim shaping has been ported to Rust.
- `BiomeRegionField` has been ported to Rust.
- `BiomeSplatSample` and `MaterialLayerId` exist as a CPU-side splat contract.
- `WorldSourceTerrainBridge` exists as a temporary adapter from clod-poc biome IDs to current Bevy voxel materials.
- `assets/config/world_source.yaml` exists.
- `tools/clod-poc` now defaults NAADF far-shell height sampling to GPU.
- `tools/clod-poc` now locks `BiomeRegionField.regionCellM` to the GPU contract value `420` because WGSL currently hardcodes `420.0`.
- Bevy now locks `BiomeRegionField.region_cell_m` to the same GPU contract value and rejects CPU-only overrides.

Not done yet:

- Bevy chunk generation does not default to `WorldSourceTerrainBridge`.
- Bevy does not yet have the clod-poc biome/splat WGSL path.
- Bevy content is still behind the seven-biome clod-poc model.
- Bevy has no CPU/GPU parity fixture gate for WorldSource, biome, ocean mask, and splat.
- Bevy renderer/material path does not yet consume `BiomeSplatSample`.

## Non-negotiable port rules

1. **GPU default.**
   - Runtime terrain/material sampling should use GPU where supported.
   - CPU remains a fallback/reference/debug path only.
   - Any explicit CPU mode must be named as fallback/debug in config and docs.

2. **Single contract.**
   - CPU constants and GPU/WGSL constants must match.
   - Better: both CPU and GPU should read from the same config/uniform source.
   - Until that exists, hardcoded GPU constants must be locked on CPU.

3. **No silent CPU-only knobs.**
   - Do not expose config values on CPU that GPU ignores.
   - Current example: `BiomeRegionField.regionCellM`/`region_cell_m` must stay fixed to `420` until WGSL accepts it as a uniform.

4. **Parity before visual richness.**
   - Do not tune Bevy visuals before the fixed-seed CPU/GPU parity tests pass.
   - Do not port more material layers until the dominant material/splat fixture is stable.

5. **Fail loudly.**
   - Stubs must throw or return explicit errors.
   - No fake heights, fake biomes, fake ocean masks, or fake splat values.

## Shared contract source of truth

These values are canonical for the Bevy port until BVY-WS-06 moves them into one shared CPU/GPU uniform/config payload.

| Contract value | Canonical value | clod-poc CPU | clod-poc GPU/WGSL | Bevy CPU/reference | Status |
| --- | ---: | --- | --- | --- | --- |
| Biome ids | Meadows=0, Forest=1, Swamp=2, Mountain=3, Plains=4, Coast=5, Ocean=6 | `tools/clod-poc/src/world_source/biome_region_field.ts` | `tools/clod-poc/src/gpu/shaders/biome_region_field.wgsl` | `src/world/source/biome_region_field.rs` | Frozen |
| Biome region cell | `420m` | `BIOME_REGION_CELL_M` | hardcoded `420.0` | `BIOME_REGION_CELL_M` | Frozen until BVY-WS-06 |
| Ocean height margin | `1.5m` | `BIOME_OCEAN_HEIGHT_MARGIN_M` | WGSL literal | `BIOME_OCEAN_HEIGHT_MARGIN_M` | Frozen |
| Ocean island-mask max | `0.08` | `BIOME_OCEAN_ISLAND_MASK_MAX` | WGSL literal | `BIOME_OCEAN_ISLAND_MASK_MAX` | Frozen |
| Coast height band | `4m` | `BIOME_COAST_HEIGHT_BAND_M` | WGSL literal | `BIOME_COAST_HEIGHT_BAND_M` | Frozen |
| Coast shore distance | `42m` | `BIOME_COAST_SHORE_DISTANCE_M` | WGSL literal | `BIOME_COAST_SHORE_DISTANCE_M` | Frozen |
| Mountain height above sea | `68m` | `BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M` | WGSL literal | `BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M` | Frozen |
| Swamp height above sea | `8m` | `BIOME_SWAMP_HEIGHT_ABOVE_SEA_M` | WGSL literal | `BIOME_SWAMP_HEIGHT_ABOVE_SEA_M` | Frozen |
| Swamp noise max | `0.42` | `BIOME_SWAMP_NOISE_MAX` | WGSL literal | `BIOME_SWAMP_NOISE_MAX` | Frozen |
| Plains distance min | `0.72` | `BIOME_PLAINS_DISTANCE_MIN` | WGSL literal | `BIOME_PLAINS_DISTANCE_MIN` | Frozen |
| Plains noise min | `0.58` | `BIOME_PLAINS_NOISE_MIN` | WGSL literal | `BIOME_PLAINS_NOISE_MIN` | Frozen |
| Forest noise min | `0.46` | `BIOME_FOREST_NOISE_MIN` | WGSL literal | `BIOME_FOREST_NOISE_MIN` | Frozen |
| Sea level | config-driven, default `18m` | `TerrainFieldConfig.seaLevel` | uniform/config dependent path | `TerrainFieldConfig.sea_level` | Config |
| Island shape | config-driven | `IslandShapeConfig` | GPU parity shader path where present | `IslandShapeConfig` | Config |
| Ocean rim | config-driven | `IslandShapeConfig.oceanRim` | GPU parity shader path where present | `IslandShapeConfig.ocean_rim` | Config |
| Splat output | 4 layers + 4 normalized weights | `BiomeSplatSample` equivalent path | pending Bevy WGSL port | `BiomeSplatSample` | CPU contract until BVY-WS-07 |

### Current source-of-truth policy

- If a value appears in WGSL today, CPU must match it exactly.
- If a value is not yet wired to WGSL, it must not be exposed as a runtime tuning knob for only CPU.
- Bevy may keep CPU reference code, but runtime default must move to GPU after BVY-WS-09 passes.

---

# Jira tasks

## BVY-WS-01 — Freeze the shared WorldSource contract

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** Current `src/world/source/` foundation

### Description

Define the canonical shared contract for Bevy and clod-poc world sampling. This must include height, biome ID, ocean mask, and splat output. Record which values are GPU-default, which are CPU-reference, and which constants are frozen until moved into uniforms.

### Acceptance criteria

- [x] `docs/plans/bevy-world-source-gpu-first-port-order.md` lists all shared constants and their source of truth.
- [x] `BiomeRegionField.regionCellM` remains locked to `420` until WGSL uniformization lands.
- [x] No Bevy config exposes CPU-only values that the GPU path ignores.
- [x] Any source stub fails loudly instead of returning fake data.

### AI execution prompt

```text
Obey the GPU-first rule. Audit clod-poc and Bevy world-source code for CPU-only config knobs. Document every shared constant used by height, biome classification, ocean mask, and splat. If a constant is hardcoded in WGSL, lock the CPU value to the same value or add a TODO to move both to shared config/uniforms. Do not add visual tuning. Do not add fake fallback samples.
```

---

## BVY-WS-02 — Add clod-poc golden sample exporter

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-01

### Description

Generate fixed-seed golden samples from clod-poc for a small grid of world positions. The fixture must include height, biome ID, ocean mask, and dominant splat/material layer.

### Acceptance criteria

- [ ] Add a deterministic clod-poc script or test helper that writes a JSON fixture.
- [ ] Fixture includes at least 64 points across coast, ocean, meadow, forest, swamp, mountain, and plains conditions.
- [ ] Fixture includes explicit seed, sea level, island-shape config, and biome contract version.
- [ ] Fixture is checked into `tools/clod-poc/fixtures/` or `assets/fixtures/`.
- [ ] Re-running the exporter produces byte-identical output unless the contract version changes.

### AI execution prompt

```text
Create a deterministic clod-poc golden-sample exporter for WorldSource. Use the canonical WorldSource, BiomeRegionField, island/ocean-rim shape, and splat sampling. Export JSON with config metadata, contract version, and sample rows: x,z,height,biomeId,oceanMask,dominantLayer,splatWeights. Cover ocean, coast, meadow, forest, swamp, mountain, and plains. Make output stable and checked into repo. No renderer required.
```

---

## BVY-WS-03 — Add Bevy golden fixture reader and parity tests

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-02

### Description

Load the clod-poc golden fixture in Rust tests and compare Bevy `ProceduralWorldSource` results against it.

### Acceptance criteria

- [ ] Rust test loads the JSON fixture.
- [ ] Height tolerance is explicit and small.
- [ ] Biome ID must match exactly.
- [ ] Ocean mask tolerance is explicit and small.
- [ ] Dominant splat/material layer must match exactly.
- [ ] Test fails loudly if the fixture contract version is unsupported.

### AI execution prompt

```text
Add Bevy Rust tests that load the clod-poc WorldSource golden fixture. Compare Bevy ProceduralWorldSource height, biome ID, ocean mask, and dominant splat/material layer. Keep tolerances explicit. Exact-match biome and dominant layer. Fail on unsupported contract version. Do not touch renderer yet.
```

---

## BVY-WS-04 — Add Bevy terrain-source mode config

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-03

### Description

Add a Bevy config flag that chooses terrain source mode without deleting the legacy terrain generator.

### Proposed modes

```yaml
terrain_source:
  mode: gpu_world_source
```

Allowed values:

- `gpu_world_source` — default target mode.
- `legacy` — old Bevy terrain path, temporary compatibility mode.
- `cpu_world_source_reference` — explicit CPU reference/debug mode only.

### Acceptance criteria

- [ ] Config loads from YAML, not hardcoded code.
- [ ] Default mode is `gpu_world_source` where GPU is supported.
- [ ] CPU mode name clearly says reference/debug/fallback.
- [ ] Legacy mode remains available during migration.
- [ ] Invalid mode fails loudly.

### AI execution prompt

```text
Add a Bevy terrain-source config with modes gpu_world_source, legacy, and cpu_world_source_reference. Default to gpu_world_source where supported. CPU mode must be explicitly named reference/debug/fallback. Load from YAML. Invalid modes must error. Do not remove legacy generation yet.
```

---

## BVY-WS-05 — Bridge chunk generation behind the source-mode flag

**Type:** Story  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-04

### Description

Use `WorldSourceTerrainBridge` for chunk generation when the source mode selects world-source terrain. Keep the legacy `TerrainGenerator` path intact behind `legacy` mode.

### Acceptance criteria

- [ ] Chunk generation can use `WorldSourceTerrainBridge` behind a config flag.
- [ ] Legacy path still works.
- [ ] Bedrock floor is preserved.
- [ ] Water fills between terrain surface and sea level.
- [ ] Seven clod-poc biome IDs map deterministically to temporary Bevy voxel materials.
- [ ] Tests cover terrain source mode selection.

### AI execution prompt

```text
Wire Bevy chunk generation to select between legacy TerrainGenerator and WorldSourceTerrainBridge using the terrain-source config. Preserve the legacy path. In world-source mode, use WorldSource height/biome/ocean-mask and map seven clod-poc biome IDs to current temporary voxel materials. Preserve bedrock and water fill. Add tests for both modes.
```

---

## BVY-WS-06 — Move biome-region constants into a shared GPU uniform/config contract

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-03

### Description

Remove the long-term risk of CPU/GPU divergence by moving biome-region thresholds and region cell size into a shared config/uniform path consumed by both CPU and WGSL.

### Acceptance criteria

- [ ] `BIOME_REGION_CELL_M` is supplied to WGSL as a uniform/config value, not hardcoded.
- [ ] Ocean/coast/mountain/swamp/plains/forest thresholds are supplied from one shared source.
- [ ] CPU tests verify config values equal the GPU uniform payload.
- [ ] Existing WGSL mirror tests remain or are replaced with stronger uniform-payload tests.
- [ ] Bevy port uses the same contract values.

### AI execution prompt

```text
Move BiomeRegionField constants out of CPU-only and WGSL-hardcoded paths into a shared contract. Feed WGSL via uniforms/config. Keep CPU and GPU tests that prove the same values are used. Do not re-enable configurable regionCellM until WGSL reads it from the same source.
```

---

## BVY-WS-07 — Port biome/splat WGSL to Bevy GPU terrain path

**Type:** Story  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-06

### Description

Port the clod-poc biome and splat GPU logic into Bevy's terrain material path. GPU must be the default material classification path. CPU splat remains reference/fallback only.

### Acceptance criteria

- [ ] Bevy terrain material path can consume biome ID and splat weights on GPU.
- [ ] GPU is selected by default when supported.
- [ ] CPU fallback is explicit and logs/records fallback mode.
- [ ] Dominant material layer matches the golden fixture.
- [ ] No CPU-only material tuning path exists.

### AI execution prompt

```text
Port clod-poc biome/splat WGSL into Bevy's terrain material path. GPU classification and splat should be default where supported. CPU splat is only a reference/fallback path and must be explicit. Validate against golden fixture dominant layer. Do not tune visuals until parity passes.
```

---

## BVY-WS-08 — Expand Bevy biome/content tables to seven clod-poc biome IDs

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-05

### Description

Replace or bridge the old four-biome Bevy content table with the seven clod-poc biome IDs.

### Acceptance criteria

- [ ] Bevy content can represent Meadows, Forest, Swamp, Mountain, Plains, Coast, and Ocean.
- [ ] Temporary legacy material mapping remains documented until splat renderer is complete.
- [ ] Missing biome content fails loudly or falls back through a named compatibility layer.
- [ ] Tests cover all seven biome IDs.

### AI execution prompt

```text
Expand Bevy biome/content support from the legacy four-biome model to the seven clod-poc biome IDs. Keep temporary material mapping documented. Missing biome content must fail loudly or pass through a named compatibility adapter. Add tests for all seven IDs.
```

---

## BVY-WS-09 — Add CPU/GPU drift gate for Bevy

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-07, BVY-WS-08

### Description

Add an automated drift gate that compares CPU reference and GPU result for fixed sample points.

### Acceptance criteria

- [ ] Gate compares height/material classification where GPU readback is available.
- [ ] Gate compares biome ID and dominant splat layer exactly.
- [ ] Numeric tolerances are explicit.
- [ ] Gate runs in CI only where GPU/readback is available, otherwise emits a clear skipped status.
- [ ] Skipped GPU gate cannot be mistaken for a pass in release acceptance reports.

### AI execution prompt

```text
Add a CPU/GPU drift gate for Bevy WorldSource and material classification. Compare fixed sample points for height where possible, biome ID, and dominant splat layer. GPU readback absence must be a clear skipped status, not a pass. Keep tolerances explicit and fail on drift.
```

---

## BVY-WS-10 — Make GPU WorldSource the default runtime path

**Type:** Story  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-09

### Description

Flip Bevy's runtime terrain source to GPU WorldSource by default after parity gates pass.

### Acceptance criteria

- [ ] `gpu_world_source` is default in config.
- [ ] Legacy mode still exists but is explicitly opt-in.
- [ ] CPU reference mode still exists but is explicitly opt-in.
- [ ] Startup logs/diagnostics report active terrain source mode.
- [ ] Acceptance report records whether GPU path, CPU fallback, or legacy path was used.

### AI execution prompt

```text
After parity gates pass, make gpu_world_source the default Bevy runtime terrain path. Keep legacy and CPU reference modes as explicit opt-ins. Add startup diagnostics and acceptance counters showing active source mode. Do not silently fallback to CPU without recording it.
```

---

## BVY-WS-11 — Add Bevy release bench and acceptance report

**Type:** Task  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-10

### Description

Add a release-mode bench/acceptance scene for the Bevy port.

### Acceptance criteria

- [ ] Bench runs in release mode.
- [ ] Report includes terrain source mode.
- [ ] Report includes chunk generation time.
- [ ] Report includes mesh build time.
- [ ] Report includes material/draw count impact.
- [ ] Report includes CPU/GPU drift gate status.
- [ ] Report writes `bench-runs/<run>/summary.json`.

### AI execution prompt

```text
Add a Bevy release-mode bench scene for the GPU-first WorldSource path. Record terrain source mode, chunk generation time, mesh build time, draw/material counts, memory impact if available, and CPU/GPU drift status. Write bench-runs/<run>/summary.json. Compare before/after numbers per CLAUDE.md performance rules.
```

---

## BVY-WS-12 — Remove temporary legacy bridge only after visual parity

**Type:** Cleanup  
**Epic:** Bevy WorldSource GPU-first port  
**Depends on:** BVY-WS-11 and visual sign-off

### Description

Remove temporary adapters only after Bevy visually matches clod-poc for fixed-seed island/biome/material scenes.

### Acceptance criteria

- [ ] Visual parity scene passes.
- [ ] Bench does not regress beyond accepted thresholds.
- [ ] Legacy compatibility path is either removed or kept behind an explicit deprecated flag.
- [ ] Temporary seven-biome-to-legacy-material mapping is removed from default path.
- [ ] Docs updated to show final GPU WorldSource flow.

### AI execution prompt

```text
After Bevy GPU WorldSource visual parity and bench acceptance pass, remove temporary compatibility adapters from the default path. Keep legacy only behind an explicit deprecated flag if still needed. Remove seven-biome-to-legacy-material mapping from the default path. Update docs to show final GPU WorldSource flow.
```

---

## Required task order

1. BVY-WS-01
2. BVY-WS-02
3. BVY-WS-03
4. BVY-WS-04
5. BVY-WS-05
6. BVY-WS-06
7. BVY-WS-07
8. BVY-WS-08
9. BVY-WS-09
10. BVY-WS-10
11. BVY-WS-11
12. BVY-WS-12

Do not start BVY-WS-07 before BVY-WS-06. Do not make GPU WorldSource the runtime default before BVY-WS-09 passes.

## Verification commands

For clod-poc contract work:

```powershell
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run acceptance:clod:fast
npm --prefix tools/clod-poc run build
```

For Bevy contract work:

```powershell
cargo test world::source
cargo test
```

For Bevy runtime/bench work after BVY-WS-11:

```powershell
cargo run --release -- --bench world_source
```
