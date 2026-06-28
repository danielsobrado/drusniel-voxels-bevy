# Bevy WorldSource port order

ISLE-17 cannot be done as a single visual parity patch yet because the Bevy crate is behind `tools/clod-poc`:

- Bevy has an older `WorldShapeSampler` and four legacy biomes.
- `tools/clod-poc` now uses `WorldSource`, `IslandShapeConfig`, `BiomeRegionField`, biome splat sampling, and texture-window streaming.
- Bevy does not yet have the clod-poc texture-array splat terrain material path wired into its terrain renderer.

The safe path is to port contracts first, then bridge generation, then replace visuals.

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
- `splat.rs` — CPU material-layer splat contract for biome terrain materials.
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

### 3. Golden parity samples — next before renderer work

Add fixed-seed samples comparing Bevy and clod-poc for:

- height,
- biome ID,
- ocean mask,
- material/splat dominant layer.

This should use a small JSON fixture checked into the repo so parity can be tested without launching the renderer.

### 4. Replace Bevy chunk terrain sampling

After golden samples exist, wire chunk generation to use `WorldSourceTerrainBridge` behind a flag.

Do not remove legacy generation immediately. Keep the old path available until:

- chunk generation tests pass,
- existing save/load tests pass,
- runtime water and cave behavior is reviewed.

### 5. Expand Bevy biome/content tables

The current four-biome content table is too small. Expand content to seven IDs or introduce a compatibility layer that can read clod-poc biome IDs while legacy voxel material IDs still exist.

### 6. Splat/material renderer path

Wire `BiomeSplatSample` into the Bevy terrain material path.

This is where real visual parity starts. Until this step, Bevy can generate the right logical terrain, but it will still render using old voxel/atlas material assumptions.

### 7. Bench and acceptance

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
- Procedural WorldSource resource.
- Island mask and ocean-rim shaping.
- BiomeRegionField with seven clod-poc biome IDs.
- CPU splat-weight contract.
- Terrain bridge from seven biome IDs to current legacy voxel materials.
- Tests for determinism, config load, island/ocean-rim behavior, biome classification, splat normalization, and bridge material mapping.

Still needed before visual parity:

1. Add the runtime flag to choose `WorldSourceTerrainBridge` during chunk generation.
2. Add clod-poc vs Bevy fixed-seed golden samples for height, biome, ocean mask, and splat layer parity.
3. Expand Bevy content biomes from the legacy four-biome table to the seven clod-poc biome IDs.
4. Wire `BiomeSplatSample` into the Bevy terrain material/shader path.
5. Add a release-mode bench scene and compare `bench-runs/<run>/summary.json` before/after.

## Verification

Recommended commands:

```powershell
cargo test world::source
cargo test
```
