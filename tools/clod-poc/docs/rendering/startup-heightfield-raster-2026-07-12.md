# Startup-world heightfield raster cache

Fixes the unified-startup cold `startup.build_world_ms` regression introduced by hydrology Phase
3b without creating a second terrain authority.

## Current design

`src/terrain/startup_heightfield_raster.ts` stores `baseSurfaceHeight` at exact integer cell
corners, padded two cells past the startup-world bounds.

The raster is an **integer-lattice cache only**:

- Integer `(x, z)` samples inside the padded domain return the stored f64 value.
- Fractional samples use `baseSurfaceHeight` directly.
- Samples outside the padded domain use `baseSurfaceHeight` directly.

Surface Nets density corners are integer lattice reads, so startup CPU geometry keeps the cached
fast path and remains bit-identical to direct procedural evaluation. Normals, prop placement,
colliders, raycasts, and other fractional queries stay on the canonical procedural field.

This policy also matches the live GPU streamed-root mesher. The GPU path continues to evaluate the
procedural WGSL field directly; it does not upload or sample the startup raster. Because the CPU
raster no longer reconstructs fractional samples bilinearly, the two paths share the same normal
and derivative semantics. `startup_heightfield_gpu_parity.test.ts` locks the CPU sampler against
the GPU-shaped TypeScript field core at and across the raster boundary for multiple seeds.

## Canonical sampler contract

`src/world/heightfield_sampler.ts` is the shared surface-height interface for the continent work.
Phase 1 provides two base adapters:

- `proceduralHeightfieldSampler` delegates directly to `baseSurfaceHeight`.
- `startupRasterHeightfieldSampler` wraps the existing integer-lattice raster policy.

Phase 2 adds a third adapter, `heightfieldTileSampler`, but it remains a cache adapter rather than a
new authority. Its lookup order is:

1. startup raster for integer samples inside the padded startup domain;
2. resident 256 m heightfield tile for other integer samples;
3. direct procedural evaluation on a miss;
4. direct procedural evaluation for every fractional sample.

The wrappers are descriptive and do not change authority. `TERRAIN_SOURCE_VERSION` remains
`world-modes-v6`; tile authority is intentionally deferred until the coordinated Phase 3 carve
switch.

## Runtime wiring

- **Main thread startup**: `world_build_startup.ts` installs the startup-raster adapter's
  `sampleHeight` function as the terrain surface override in unified infinite-islands mode.
- **CPU CLOD worker**: the raster rides the initial `build` request and is installed by
  `installWorkerTerrainOverride`. CPU fallback streamed roots reuse it inside its bounded domain
  and fall back to the procedural field outside.
- **GPU CLOD streamed roots**: use the direct procedural WGSL field. They intentionally do not own
  a raster resource.
- **Optional Phase 2 tile cache**: `heightfield_tile_client_runtime.ts` wraps the initialized
  `ClodWorkerClient` build lifecycle. With `heightTiles=1`, it creates the tile cache after the
  initial world build, reuses the same worker for batches of at most two tiles, and updates once per
  rendered engine frame. Floating-origin offsets are added back before planning tile residency.

The main thread retains its raster. `clod_worker_client_helpers.ts` creates one explicit copy and
transfers that copy's `ArrayBuffer` to the worker. This replaces the opaque structured-clone path
and exposes copy and transfer timings.

## Phase 2 streamed tile format

Each canonical cache tile covers 256×256 m and stores a 257×257 `Float64Array`. The duplicated final
row and column are intentional: adjacent tiles share exact border samples without neighbour access.
At the default cap of 64 resident tiles, height payload residency is approximately 34 MiB.

`config/heightfield_tiles.yaml` is the single source of truth:

```yaml
enabled: false
radius_m: 768
max_resident_tiles: 64
max_inflight_batches: 1
max_tiles_per_batch: 2
evict_distance_multiplier: 1.5
retry_cooldown_frames: 120
prediction_seconds: 4
persistence_enabled: true
```

The cache is default-off and only eligible for `infinite_islands`/future `continent` world modes.
`?heightTiles=1` enables it for parity and soak testing. If a legacy carved terrain override is
active without a startup raster, the tile runtime stays disabled rather than replacing that
surface authority.

IndexedDB records are keyed by:

```text
terrainSourceHash / sourceRevision / WorldTileKey
```

Corrupt or stale records are treated as misses. Persistence failure falls back to the bounded
in-memory cache; worker build failures enter a frame-based retry cooldown rather than failing the
world.

## Budget

The startup raster default limit is 16 MiB or 2,097,152 f64 samples, whichever is reached first.
Planning happens before allocation in `planStartupHeightfieldRaster`; over-budget rasters return
`null` and the runtime uses direct procedural sampling.

With the current 64-cell page span:

| Startup pages | Approximate raster bytes | Default policy |
| ---: | ---: | --- |
| 4 | 0.51 MiB | enabled |
| 8 | 2.04 MiB | enabled |
| 16 | 8.08 MiB | enabled |
| 32 | 32.16 MiB | disabled |

`heightfieldRaster=0` still disables the startup optimization for A/B runs. The lower-level budget
remains active even when the query flag requests the raster.

## Authority and fidelity

The procedural terrain field remains the geometry authority. Both raster forms are regenerable
caches of already-keyed inputs, not hydrology carves and not independent terrain sources.

Integer cache reads are exact. Fractional direct reads remove the previous bilinear normal drift,
prop/collider/raycast height drift, and the derivative switch at cache boundaries.

Hydrology remains independent: `HydrologySystem` binds `baseSurfaceHeight` directly before either
cache adapter is installed, so sync and worker hydrology tile parity is unchanged.

## Cache identity

`TERRAIN_SOURCE_VERSION` is `world-modes-v6`.

The terrain-source key includes the startup raster descriptor:

- `worldCells`
- `minCell`
- `res`
- `sampleCount`
- `byteLength`
- `samplingMode: integer_lattice_only`

Startup raster contents are not hashed because they are a pure function of the terrain field
configuration, seed, and startup-world size already present in the key.

The Phase 1 `WorldManifest` stores the already-computed terrain-source hash as descriptive identity.
The manifest is attached only after the hash is computed and is explicitly excluded from v6 hash
normalization. Phase 2 tile config, query flags, residency state, and IndexedDB contents are also
excluded, so enabling the cache cannot invalidate or fork geometry identity.

## Counters

Startup raster counters:

- `startup.heightfield_raster_requested`
- `startup.heightfield_raster_budget_enabled`
- `startup.heightfield_raster_budget_reason_code` (`0=enabled`, `1=invalid`, `2=sample budget`, `3=byte budget`)
- `startup.heightfield_raster_enabled`
- `startup.heightfield_raster_ms`
- `startup.heightfield_raster_res`
- `startup.heightfield_raster_samples`
- `startup.heightfield_raster_bytes`
- `startup.heightfield_raster_worker_clone_ms`
- `startup.heightfield_raster_worker_transfer_ms`
- `world_manifest_present`
- `world_manifest_seed`

Phase 2 tile counters:

- `heightfield_tiles_enabled`
- `heightfield_tiles_resident`
- `heightfield_tiles_required`
- `heightfield_tiles_pending`
- `heightfield_tiles_inflight`
- `heightfield_tiles_builds_total`
- `heightfield_tiles_build_ms_p95`
- `heightfield_tiles_evictions_total`
- `heightfield_tiles_fallback_samples_total`
- `heightfield_tiles_bytes_resident`
- `heightfield_tiles_store_hits`
- `heightfield_tiles_store_misses`
- `heightfield_tiles_store_errors`
- `heightfield_tiles_failures_total`

## Original measured result

The first startup-raster implementation measured the following at `world=8`, seed 1, cold cache:

| Run | `startup.build_world_ms` | `startup.heightfield_raster_ms` | `startup.first_render_ready_ms` |
| --- | ---: | ---: | ---: |
| baseline before raster, two runs | 16072 / 15938 | — | 33029 / 31208 |
| first raster implementation, two runs | 5266 / 5392 | 688 / 694 | 22349 / 22458 |
| raster disabled control | 17220 | — | 32713 |

Those measurements predate the integer-only sampling and explicit worker-transfer follow-up.

## Current benchmark procedure

Start Vite, then run the browser harness:

```powershell
npm --prefix tools/clod-poc run dev
npm --prefix tools/clod-poc run perf:heightfield-raster
```

The harness records cold cache-disabled and warm cache-enabled startup runs for startup worlds 4,
8, 16, and 32. Results are written under `perf-runs/startup-heightfield-raster/` and include build
time, raster time, budget enablement, bytes, samples, worker copy/transfer time, and cache hit. Use
`--worlds=4,8` or `--timeout=600000` after `--` to narrow or extend a run.

For Phase 2 soak testing, run the same scene twice with and without `heightTiles=1`, then compare the
terrain-source hash, screenshots, frame metrics, tile build p95, fallback count, resident bytes, and
IndexedDB hit rate. Do not mark the Phase 2 Evidence checklist complete without recorded values.
