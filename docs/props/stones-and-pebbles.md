# Stones And Pebbles

## Design Summary

Stones are a deterministic ground-detail prop layer over terrain. They are generated from
`assets/config/stones.yaml`, procedural rock meshes, and terrain/site samples. They do not enter
voxel terrain, terrain meshes, colliders, CLOD pages, or terrain edits.

Runtime generation uses `props::stones::generate_stones_for_chunk`. Dirty regeneration and future
persistence should call that same function.

## Invariants

- `VoxelWorld` stays authoritative.
- Stones are props, not terrain.
- Small and medium stones never edit or conform voxel terrain.
- Same terrain, seed, config, and chunk produce the same `StoneInstance` list.
- CLOD and terrain page inputs do not include stones.

## Config

Main file: `assets/config/stones.yaml`.

Key groups:

- `enabled`, `seed_salt`, `save_directory`
- `cell_size_m`, `max_instances`, `max_instances_per_chunk`
- `density`, `stress_density_multiplier`
- water, repose, cliff, stream, snow, clump, sink tuning
- `large`, `medium`, `small` class definitions
- `debug` toggles

`StoneConfig::config_hash()` records a stable hash for diagnostics and future persistence
invalidation.

## Verification

```powershell
rtk cargo fmt --check
rtk cargo test stones
rtk cargo run --release -- --bench bench/scenes/props/stones-visual-regression.toml
rtk cargo run --release -- --bench bench/scenes/props/stones-stress.toml
rtk cargo run --release -- --bench bench/scenes/props/stones-ab-disable.toml
rtk cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

## TODOs

- Persist stone chunks with terrain fingerprint and `StoneConfig::config_hash()`.
- Move runtime rendering from per-stone mesh entities to instanced batches by class, variant, LOD,
  material, and chunk/region.
- Add a custom stone shader that consumes `ATTRIBUTE_VDATA` for strata, moss, grain, and cavity AO.
- Track exact scatter rejection counters instead of recording zero placeholders for rejected sites.
