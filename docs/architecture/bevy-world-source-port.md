# Bevy WorldSource foundation port

ISLE-17 cannot be done as a single visual parity patch yet because the Bevy crate is behind `tools/clod-poc`:

- Bevy has an older `WorldShapeSampler` and four legacy biomes.
- `tools/clod-poc` now uses `WorldSource`, `IslandShapeConfig`, `BiomeRegionField`, and biome splat sampling.
- Bevy does not yet have the clod-poc texture-array splat terrain material path wired into its terrain renderer.

This patch lands the safe prerequisite layer first.

## Added modules

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

## Config

New YAML config:

```text
assets/config/world_source.yaml
```

It controls seed, sea level, island shaping, and bounded ocean rim mode. Runtime code can load it through:

```rust
use voxel_builder::world::source::ProceduralWorldSource;

let source = ProceduralWorldSource::load_or_default();
```

## Current boundary

This is a foundation port, not the full Bevy renderer parity pass.

Done:

- WorldSource trait and metadata contract.
- Procedural WorldSource resource.
- Island mask and ocean-rim shaping.
- BiomeRegionField with seven clod-poc biome IDs.
- CPU splat-weight contract.
- Tests for determinism, config load, island/ocean-rim behavior, biome classification, and splat normalization.

Still needed before visual parity:

1. Replace or bridge Bevy terrain generation callers to sample `WorldSource` instead of the old `WorldShapeSampler` path.
2. Expand Bevy content biomes from the legacy four-biome table to the seven clod-poc biome IDs.
3. Wire `BiomeSplatSample` into the Bevy terrain material/shader path.
4. Add clod-poc vs Bevy fixed-seed golden samples for height, biome, and splat layer parity.
5. Add a release-mode bench scene and compare `bench-runs/<run>/summary.json` before/after.

## Verification

Recommended commands:

```powershell
cargo test world::source
cargo test
cargo run --release -- --bench world_source
```

The last command depends on the future bench scene; the current patch only adds the source layer and unit tests.
