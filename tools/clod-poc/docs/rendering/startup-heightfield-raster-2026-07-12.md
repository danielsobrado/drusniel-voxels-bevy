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

## Runtime wiring

- **Main thread**: `world_build_startup.ts` installs the sampler as the terrain surface override in
  unified infinite-islands mode.
- **CPU CLOD worker**: the raster rides the initial `build` request and is installed by
  `installWorkerTerrainOverride`. CPU fallback streamed roots reuse it inside its bounded domain
  and fall back to the procedural field outside.
- **GPU CLOD streamed roots**: use the direct procedural WGSL field. They intentionally do not own
  a raster resource.

The main thread retains its raster. `clod_worker_client_helpers.ts` creates one explicit copy and
transfers that copy's `ArrayBuffer` to the worker. This replaces the opaque structured-clone path
and exposes copy and transfer timings.

## Budget

The default limit is 16 MiB or 2,097,152 f64 samples, whichever is reached first. Planning happens
before allocation in `planStartupHeightfieldRaster`; over-budget rasters return `null` and the
runtime uses direct procedural sampling.

With the current 64-cell page span:

| Startup pages | Approximate raster bytes | Default policy |
| ---: | ---: | --- |
| 4 | 0.51 MiB | enabled |
| 8 | 2.04 MiB | enabled |
| 16 | 8.08 MiB | enabled |
| 32 | 32.16 MiB | disabled |

`heightfieldRaster=0` still disables the optimization for A/B runs. The lower-level budget remains
active even when the query flag requests the raster.

## Authority and fidelity

The procedural terrain field remains the geometry authority. The raster is a regenerable cache of
already-keyed inputs, not a hydrology carve and not an independent terrain source.

Integer cache reads are exact. Fractional direct reads remove the previous bilinear normal drift,
prop/collider/raycast height drift, and the derivative switch at the padded raster edge.

Hydrology remains independent: `HydrologySystem` binds `baseSurfaceHeight` directly before the
startup raster is installed, so sync and worker hydrology tile parity is unchanged.

## Cache identity

`TERRAIN_SOURCE_VERSION` is `world-modes-v6`.

The terrain-source key includes the raster descriptor:

- `worldCells`
- `minCell`
- `res`
- `sampleCount`
- `byteLength`
- `samplingMode: integer_lattice_only`

Raster contents are not hashed because they are a pure function of the terrain field configuration,
seed, and startup-world size already present in the key.

## Startup counters

- `startup.heightfield_raster_enabled`
- `startup.heightfield_raster_ms`
- `startup.heightfield_raster_res`
- `startup.heightfield_raster_samples`
- `startup.heightfield_raster_bytes`
- `startup.heightfield_raster_worker_clone_ms`
- `startup.heightfield_raster_worker_transfer_ms`

## Original measured result

The first raster implementation measured the following at `world=8`, seed 1, cold cache:

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

The harness records cold cache-disabled and warm cache-enabled startup runs for startup worlds
4, 8, 16, and 32. Results are written under `perf-runs/startup-heightfield-raster/` and include
build time, raster time, budget enablement, bytes, samples, worker copy/transfer time, and cache hit.
Use `--worlds=4,8` or `--timeout=600000` after `--` to narrow or extend a run.
