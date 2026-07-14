# GPU CLOD Resident Hierarchy

## Purpose

This path keeps near streamed CLOD geometry in the WebGPU device, derives parent geometry on GPU,
and maps geometry to the CPU only when a requested page reaches the configured persistent readback
level. The existing GPU readback mesher and CPU worker remain hard fallbacks.

## Current rollout state

| Capability | State | Notes |
| --- | --- | --- |
| Persistent GPU page buffers | Implemented, opt-in | Byte-budgeted LRU with leased view ownership and first-view protection |
| Readback-free L0 rendering | Implemented, opt-in | Three WebGPU consumes the resident vertex/index buffers directly through `BufferGeometry` backend bindings |
| Selective readback | Implemented, opt-in | Default maps requested level 1+ roots; L0 remains GPU-only |
| GPU welding | Implemented, opt-in path | Quantized-position hash weld preserves normal, biome, paint-slot, and paint-weight seams |
| GPU parent simplification | Implemented, opt-in path | Border vertices remain locked; selective readback passes the existing final page validator |
| GPU meshlets | Implemented, opt-in path | GPU-generated bounds and indexed indirect commands are used for resident page rendering |
| GPU meshlet hierarchy | Implemented, resident metadata | GPU-generated parent bounds/hierarchy remain available for a later visibility-compaction pass |
| Hardware performance evidence | Capture workflow implemented | No hardware result is considered committed evidence until the self-hosted GPU gate succeeds |

## Runtime flags

The complete path is disabled unless explicitly enabled:

```text
liveClodGpuHierarchy=1
```

Defaults while the path is enabled:

```text
liveClodGpuResidentRender=1
liveClodGpuReadbackMinLevel=1
liveClodGpuResidentMaxLevel=0
liveClodGpuResidentBytes=268435456
liveClodGpuWeld=1
liveClodGpuSimplify=1
liveClodGpuSimplifyClusterCells=1.75
liveClodGpuHashProbe=96
liveClodGpuMeshlets=1
liveClodGpuMeshletVertices=64
liveClodGpuMeshletTriangles=64
```

Set `liveClodGpuReadbackMinLevel=0` to force every requested page back through the validated CPU
geometry contract while exercising the GPU weld/simplification pipeline. Set
`liveClodGpuResidentRender=0` to disable direct resident rendering without disabling the existing GPU
terrain mesher.

## Ownership and fallback rules

1. Resident rendering is used only when the mesher and Three renderer share the same `GPUDevice`.
2. Completed resident pages are adopted atomically per `buildPages` call.
3. New pages remain protected until their first render lease or until the bounded protection window expires.
4. Eviction retires a page immediately but destroys its buffers only after all active render leases release.
5. GPU-only node metadata is never serialized into the ordinary CPU page cache.
6. If resident initialization fails, creation falls back to the previous GPU readback mesher.
7. If that path fails, the existing streaming controller can use the CPU worker fallback.

## Rendering contract

Resident pages use the same Three WebGPU scene path as ordinary terrain. This preserves:

- terrain node materials and texture slots,
- depth and shadow passes,
- fog and post-processing,
- CLOD visibility and crossfade transitions,
- scene culling through resident page bounds.

GPU-only roots use crossfade transitions rather than the CPU-generated parent-height morph because
that morph requires CPU vertex positions.

## Counters

```text
live_clod_gpu_hierarchy_enabled
live_clod_gpu_hierarchy_failures_total
live_clod_gpu_hierarchy_runtime_disabled
live_clod_gpu_resident_pages
live_clod_gpu_resident_bytes
live_clod_gpu_resident_uploads_total
live_clod_gpu_resident_upload_bytes_total
live_clod_gpu_resident_adopted_total
live_clod_gpu_resident_evictions_total
live_clod_gpu_meshlets_resident
live_clod_gpu_hierarchy_nodes_resident
live_clod_stream_gpu_pool_count
live_clod_stream_gpu_pool_active
live_clod_stream_gpu_pool_max_active
live_clod_stream_gpu_pool_overlap_events_total
```

## Verification

```powershell
npm --prefix tools/clod-poc run typecheck

npm --prefix tools/clod-poc test -- `
  src/terrain/streaming/gpu_clod_hierarchy.test.ts `
  src/terrain/streaming/gpu_clod_root_mesher_pool.test.ts `
  src/rendering/webgpu_device_bridge.test.ts `
  src/rendering/webgpu_external_buffer_geometry.test.ts `
  src/terrain/streaming/root_height_morph.test.ts

npm --prefix tools/clod-poc run acceptance:clod:fast
```

Suggested first browser run:

```text
?scene=infinite-islands&liveClodGpuHierarchy=1&liveClodRootBoundsGuard=1
```

For an A/B that keeps GPU parent construction but forces CPU render geometry:

```text
?scene=infinite-islands&liveClodGpuHierarchy=1&liveClodGpuResidentRender=0&liveClodGpuReadbackMinLevel=0
```

## Hardware evidence

Run the self-hosted workflow on a runner labelled `gpu`:

```text
Actions -> CLOD GPU Hardware Evidence -> Run workflow
```

The workflow rejects software adapters, unequal requested/applied work, failed batches, and fallback
pages. It uploads raw JSON plus a Markdown report and can optionally commit the validated report.

## Remaining acceptance work

The code path is implemented, but these results still require real hardware execution:

- GPU weld/simplification visual parity across caves, cliffs, edits, and material seams,
- no-crack validation while moving across L0/L1 transitions,
- resident-buffer memory stability during long movement runs,
- direct resident rendering with shadows, post-processing, and debug modes,
- before/after frame, build, readback, and transfer measurements,
- hardware evidence commit produced by the GPU workflow.
