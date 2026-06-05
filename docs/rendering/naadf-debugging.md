# NAADF Debugging

Document status (2026-06-05): current debugging note; verify current behavior in code.

NAADF diagnostics are available in default builds. Use `--no-default-features`
only when intentionally testing the feature-missing fallback path.

```bash
rtk cargo run
```

## Debug UI

Open the debug UI and use the rendering controls to inspect:

- Selected voxel ray backend and experimental render mode.
- NAADF cache enablement.
- Sun visibility, terrain AO, and contact shadow toggles.
- Cache residency, dirty chunk backlog, and in-flight work.
- Streaming interest count.
- GPU memory estimate.
- GPU slot usage, reserved slots, free-list count, and fragmentation estimate.
- Upload queue depth and last-frame upload cost.
- GPU build queue backlog and oldest queued age.
- Last-frame average ray steps.

`F11` cycles backend state for quick A/B diagnosis. Backend switches invalidate GI/preview history generation so stale history is not reused after a backend change.

## Runtime Commands

`runtime.compareNaadfChunkOccupancy` compares a cached NAADF chunk against the authoritative `VoxelWorld` chunk.

Expected payload:

```json
{
  "type": "runtime.compareNaadfChunkOccupancy",
  "chunkId": [0, 0, 0],
  "maxMismatches": 16
}
```

`runtime.compareNaadfRay` compares current-backend and NAADF CPU ray results.

Expected payload:

```json
{
  "type": "runtime.compareNaadfRay",
  "origin": [256.0, 82.0, 220.0],
  "direction": [1.0, -0.2, 0.0],
  "maxDistance": 96.0,
  "purpose": "gi"
}
```

Supported purposes are parsed by `VoxelRayPurpose` and include GI, shadows, AO, preview, and debug use cases.

When the feature is disabled, both commands return an unsupported response instead of mutating runtime state.

## Visual Debug Flags

The config file keeps visual debug flags disabled by default:

```yaml
debug:
  visualize_chunks: false
  visualize_ray_steps: false
  visualize_aadf_bounds: false
  compare_cpu_gpu: false
  force_cpu_builder: false
  force_gpu_builder: false
```

Use chunk visualization to inspect cache residency and dirty/in-flight chunks. Use ray-step visualization to inspect debug ray hits and traversal cost after GPU readback is enabled.

## Common Fallback Causes

NAADF can fall back when:

- The `naadf` feature is not compiled because the binary was built with
  `--no-default-features`.
- `assets/config/naadf.yaml` has `enabled: false`.
- Integrated GPU policy blocks the backend.
- The cache is not warm or has a stale dirty/build backlog.
- GPU memory estimate exceeds `chunk_cache.max_gpu_memory_mb`.
- The selected experimental mode still routes rendering through current behavior.

Fallbacks should be treated as expected safety behavior unless a test or bench specifically requires NAADF to be active.
