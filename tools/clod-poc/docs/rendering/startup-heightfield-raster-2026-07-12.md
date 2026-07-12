# Startup-world heightfield raster cache

Fixes the unified-startup cold `startup.build_world_ms` regression (~16.0 s vs ~6.7 s legacy
at world=8) introduced by hydrology Phase 3b. Legacy mode installed the carved hydrology grid
as the terrain surface override, so build-time `surfaceHeight` sampling was a bilinear array
lookup; unified mode set the override to null and every sample evaluated the full procedural
noise field.

## Design

`src/terrain/startup_heightfield_raster.ts` rasterizes `baseSurfaceHeight` once over the
startup world at **exact cell resolution** (one f64 sample per integer cell corner, padded two
cells past the world bounds) and installs the bilinear sampler as the terrain surface override:

- **Main thread**: installed in `world_build_startup.ts` where unified mode previously set the
  override to null, so live-bubble chunks, colliders, and prop placement share the build-time
  sampler.
- **CLOD worker**: the raster rides the `build` request (`startupHeightfield`) and is installed
  by `installWorkerTerrainOverride`, which prefers the raster over the legacy carved-grid path.
  Streamed roots need no special bounding: the raster falls back to `baseSurfaceHeight`
  outside its padded domain.

Gated to unified infinite-islands mode, `worldCells <= 4096`, and the `heightfieldRaster=0`
query param disables it for A/B runs.

## Authority and fidelity

The procedural terrain field remains the geometry authority; the raster is a regenerable cache
of it, not a hydrology-carve side effect. The Surface Nets mesher reads corner densities only
at integer lattice coordinates, where the raster returns the exact stored f64 sample, so
**vertex positions are bit-identical** to direct procedural evaluation — unlike the legacy
hydrology grid, whose coarser resolution effectively low-passed geometry.

The remaining reconstruction difference is confined to fractional (x, z) samples: normal
gradients (±0.5 offsets around vertex positions) and prop/collider/raycast queries see the
bilinear reconstruction between exact lattice samples instead of the true field.
`startup_heightfield_raster.test.ts` locks position bit-parity and bounds the normal
divergence. Hydrology is unaffected: `HydrologySystem` binds `baseSurfaceHeight` directly, so
tile parity between sync and worker hydrology tiles is untouched.

## Cache identity

`TERRAIN_SOURCE_VERSION` bumped to `world-modes-v5`. The raster is a pure function of inputs
already in the key (terrain field config, seed, startup world size), so identity carries only
its descriptor (`worldCells`, `minCell`, `res`) — never hashed contents — preserving the
input-derived identity semantics established by `world-modes-v4`.

## Startup counters

- `startup.heightfield_raster_enabled` (0/1)
- `startup.heightfield_raster_ms` — raster build cost on the main thread
- `startup.heightfield_raster_res` — samples per axis

## Measured result (world=8, seed=1, cache=0, cold, shoot harness)

`scene=infinite-islands`, stats in `shots/heightfield-raster/*-stats.json`:

| Run | `startup.build_world_ms` | `startup.heightfield_raster_ms` | `startup.first_render_ready_ms` |
| --- | --- | --- | --- |
| baseline (pre-change) ×2 | 16072 / 15938 | — | 33029 / 31208 |
| after (raster on) ×2 | **5266 / 5392** | 688 / 694 | 22349 / 22458 |
| after + `heightfieldRaster=0` control | 17220 | — | 32713 |

Cold world build is ~3× faster (−10.6 s); the toggle-off control reproduces the regression,
confirming attribution. `startup.hydrology_ms` is unchanged (~450 ms) in all runs. Screenshot
pixel diff baseline↔after is 0.39/255 mean (convergence-state noise; position bit-parity is
locked by unit test).
