# Bevy WorldSource port order

ISLE-17 cannot be done as a single visual parity patch yet because the Bevy crate is behind `tools/clod-poc`:

- Bevy has an older `WorldShapeSampler` and four legacy biomes.
- `tools/clod-poc` now uses `WorldSource`, `IslandShapeConfig`, `BiomeRegionField`, biome splat sampling, and texture-window streaming.
- Bevy does not yet have the clod-poc texture-array splat terrain material path wired into its terrain renderer.

The safe path is to port contracts first, then bridge generation, then make the GPU material path the default. CPU and GPU must never become separate terrain truths.

## Non-negotiable GPU rule

The GPU terrain material path is the default target.

CPU sampling exists only for:

- chunk/voxel generation,
- collision/physics surface queries,
- offline golden parity tests,
- deterministic debug reports.

CPU code must consume the same source config and layer IDs that the GPU path consumes. Do not create a second CPU-only material system that can drift from GPU visuals. If a terrain/material rule cannot be shared or tested against the GPU path, do not add it as a gameplay rule.

## Port ladder

### 1. WorldSource contract foundation — done

Rust port lives under:

```text
src/world/source/
```

Files:

- `noise.rs` — clod-poc-compatible value noise, fBm, ridged fBm, and domain-warp helpers.
- `island_shape.rs` — island mask, shore distance, cliff weight, and ocean-rim height shaping.
- `biome_region_field.rs` — Valheim-style biome IDs and deterministic biome classification.
- `height_field.rs` — clod-poc-style procedural height field using the Bevy-safe Rust world-source config.
- `splat.rs` — shared splat layer/weight contract for the default GPU terrain material and CPU parity tests.
- `world_source.rs` — `WorldSource` trait and `ProceduralWorldSource` resource.
- `terrain_bridge.rs` — adapter from `WorldSource` samples to current legacy Bevy voxel materials.

### 2. Terrain-generation bridge — started

The bridge lets tests and future systems sample `WorldSource` without deleting the old terrain generator yet.

It maps the seven clod-poc biome IDs to current Bevy voxel materials:

| clod-poc biome | temporary Bevy voxel material |
| --- | --- |
| Meadows | `TopSoil` |
| Forest | `TopSoil` |
| Plains | `TopSoil` |
| Swamp | `Clay` at surface, `SubSoil` below |
| Mountain | `Rock` |
| Coast | `Sand` |
| Ocean | `Sand` below water |

It also preserves bedrock and fills water between terrain surface and sea level.

Next code change: add a runtime/config flag that allows chunk generation to choose between legacy `TerrainGenerator` and `WorldSourceTerrainBridge`.

### 3. Shared GPU splat config — next

Before renderer work, add one shared config for material layers and biome-to-layer weights.

Required properties:

- loaded by Bevy CPU tests,
- consumed by Bevy GPU terrain material setup,
- compatible with `tools/clod-poc` layer IDs,
- capped to the two-biome texture-window rule where streaming is active.

### 4. Golden parity samples

Add fixed-seed samples comparing Bevy and clod-poc for:

- height,
- biome ID,
- ocean mask,
- material/splat dominant layer.

This should use a small JSON fixture checked into the repo so parity can be tested without launching the renderer.

### 5. Replace Bevy chunk terrain sampling

After golden samples exist, wire chunk generation to use `WorldSourceTerrainBridge` behind a flag.

Do not remove legacy generation immediately. Keep the old path available until:

- chunk generation tests pass,
- existing save/load tests pass,
- runtime water and cave behavior is reviewed.

### 6. Expand Bevy biome/content tables

The current four-biome content table is too small. Expand content to seven IDs or introduce a compatibility layer that can read clod-poc biome IDs while legacy voxel material IDs still exist.

### 7. GPU terrain material renderer path

Wire the shared splat contract into the Bevy terrain material/shader path and make this GPU path the default.

This is where real visual parity starts. Until this step, Bevy can generate the right logical terrain, but it will still render using old voxel/atlas material assumptions.

### 8. Bench and acceptance

Add a release-mode bench/acceptance scene that records:

- terrain chunk generation time,
- mesh build time,
- draw count/material count,
- memory impact,
- fixed camera screenshot diff when renderer parity is available.

## Config

YAML config:

```text
assets/config/world_source.yaml
```

It controls seed, sea level, island shaping, and bounded ocean rim mode. Runtime code can load it through:

```rust
use voxel_builder::world::source::ProceduralWorldSource;

let source = ProceduralWorldSource::load_or_default();
```

The terrain bridge can be loaded through:

```rust
use voxel_builder::world::source::ProceduralWorldSourceTerrainBridge;

let terrain = ProceduralWorldSourceTerrainBridge::load_or_default();
```

## Current boundary

This is a foundation and bridge port, not the full Bevy renderer parity pass.

Done:

- WorldSource trait and metadata contract.
- Procedural WorldSource resource registered in `VoxelPlugin`.
- Island mask and ocean-rim shaping.
- BiomeRegionField with seven clod-poc biome IDs.
- Shared splat layer/weight contract.
- Terrain bridge from seven biome IDs to current legacy voxel materials.
- Tests for determinism, config load, island/ocean-rim behavior, biome classification, splat normalization, and bridge material mapping.

Still needed before visual parity:

1. Add shared GPU splat config and make Bevy's GPU terrain material consume it.
2. Add the runtime flag to choose `WorldSourceTerrainBridge` during chunk generation.
3. Add clod-poc vs Bevy fixed-seed golden samples for height, biome, ocean mask, and splat layer parity.
4. Expand Bevy content biomes from the legacy four-biome table to the seven clod-poc biome IDs.
5. Add a release-mode bench scene and compare `bench-runs/<run>/summary.json` before/after.

## Verification

Recommended commands:

```powershell
cargo test world::source
cargo test
```
