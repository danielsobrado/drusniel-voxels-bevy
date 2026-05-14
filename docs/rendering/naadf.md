# NAADF Rendering Backend

NAADF is an experimental voxel ray acceleration backend for Drusniel. It is a derived cache built from the authoritative `VoxelWorld`; it does not replace terrain chunks, terrain meshing, PBR materials, water, props, or the current shipping renderer.

The current renderer remains the default. NAADF is opt-in through the Cargo feature and runtime config, and the checked-in config keeps it disabled.

## Enabling NAADF

Build with the feature:

```bash
rtk cargo run --features naadf
```

Enable the derived cache in `assets/config/naadf.yaml`:

```yaml
enabled: true
build_visible_chunks_only: true

chunk_cache:
  radius_chunks: 12
  hysteresis_chunks: 2
  max_chunks: 4096
  max_chunk_updates_per_frame: 4
  max_upload_bytes_per_frame: 4194304
  max_gpu_memory_mb: 512

gpu:
  allow_integrated_gpu: false
```

The debug UI exposes the same runtime switches when the `naadf` feature is enabled. Use `F11` to cycle the voxel ray backend state for diagnosis. The toggle changes backend state only; production GI, AO, shadow, and preview paths still keep fallback behavior unless their experimental modes are explicitly selected.

## Runtime Modes

`CurrentSdf` is the default backend and preserves existing behavior.

`Naadf` requests the NAADF backend. If NAADF is unavailable, stale, disabled, or blocked by GPU policy, the runtime falls back to the current SDF path.

`Auto` lets policy choose the active backend. Integrated GPUs do not enable NAADF by default.

Experimental render modes:

- `Current`: shipping renderer and current ray backend.
- `CurrentWithNaadfGi`: current renderer with NAADF selected for GI-side ray queries where available.
- `NaadfPreview`: experimental fullscreen/split/PIP preview path scaffold.

## Safety Policy

NAADF is default-off in three places:

- The Cargo feature is not enabled by default.
- `assets/config/naadf.yaml` has `enabled: false`.
- `RayTracingSettings` defaults to `CurrentSdf` and `ExperimentalRenderMode::Current`.

Integrated GPU fallback is conservative. `allow_naadf_on_integrated_gpu` and `gpu.allow_integrated_gpu` must be explicitly enabled before NAADF can run there.

## Current Limitations

GPU buffers, upload queues, shader helpers, preview state, temporal accumulation, and spatial resampling scaffolding are implemented, but the feature is still experimental.

The NAADF preview path is not yet accepted as a replacement renderer. It needs visual regression runs, screenshot inspection, and performance guard baselines before it can be considered for broader use.

No visual verification or bench execution has been run for this batch yet.
