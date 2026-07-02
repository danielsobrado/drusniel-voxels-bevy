# NAADF Tree Visibility Current Status

Last updated: 2026-07-02
Scope: `tools/clod-poc`

## Implemented

### TVIS-001 — GPU camera terrain visibility rejection

Implemented through `tools/clod-poc/src/gpu/wgsl_modules.ts` and covered by `tools/clod-poc/src/gpu/wgsl_modules.test.ts`.

The composed tree-ring WGSL now performs camera terrain-visibility rejection after shadow-caster appends and before visible appends.

This preserves shadow casters for camera-hidden trees while skipping visible-list appends.

### TVIS-002 — Config gate

Implemented in:

- `tools/clod-poc/config/trees.yaml`
- `tools/clod-poc/src/trees/tree_config.ts`
- `tools/clod-poc/src/trees/tree_config.test.ts`

Config:

```yaml
trees:
  gpu:
    terrain_visibility:
      enabled: true
      min_distance_m: 96
      sample_count: 6
      height_margin_m: 1.75
      crown_height_m: 5.5
```

### TVIS-003 — GPU uniform wiring

Implemented in:

- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/gpu/tree_ring_species_layout.ts`
- `tools/clod-poc/src/gpu/tree_ring_wgsl_layout.ts`

The GPU ring key includes terrain visibility settings so pipeline/resources rebuild when the settings change.

### TVIS-004 — Debug counters

Implemented through the existing debug readback path only.

Normal gameplay mode must still use:

```text
treeGpuCounts=0
```

Debug counts may use:

```text
treeGpuCounts=1
```

Do not use debug readback frame time as gameplay performance evidence.

### TVIS-005 — CPU patch fallback

Implemented in:

- `tools/clod-poc/src/trees/tree_system_cpu_runtime.ts`
- `tools/clod-poc/src/trees/tree_terrain_occlusion.ts`
- `tools/clod-poc/src/runtime/vegetation/tree_startup.ts`
- `tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts`

CPU tree patches can be conservatively hidden by an optional NAADF-backed terrain height sampler. Unknown/missing data keeps patches visible.

### TVIS-006 — Shared vegetation visibility provider foundation

Implemented in:

- `tools/clod-poc/src/vegetation/vegetation_visibility_provider.ts`
- `tools/clod-poc/src/vegetation/vegetation_visibility_provider.test.ts`

The tree-specific occlusion helper delegates to this provider.

Reasons:

```text
visible
terrain_hidden
unknown_kept
near_forced_visible
disabled
```

### TVIS-007 — Visible-list cluster camera mask wiring

Implemented in:

- `tools/clod-poc/src/trees/tree_ring_cluster_visibility.ts`
- `tools/clod-poc/src/trees/tree_ring_cluster_visibility.test.ts`
- `tools/clod-poc/src/gpu/tree_ring_compute.ts`
- `tools/clod-poc/src/gpu/wgsl_modules.ts`
- `tools/clod-poc/src/trees/tree_system_gpu_ring_runtime.ts`

What is done:

- terrain-hidden GPU tree slots still generate shadow casters, then skip visible appends;
- CPU/GPU debug validation follows the same visible-list rejection order;
- a conservative tree-ring camera-visibility mask is built from the shared vegetation visibility provider;
- the cluster mask keeps unknown/missing terrain visible;
- a cluster is hidden only when every representative probe is terrain-hidden;
- representative probes include the nearest cluster point, center, and corners, not only the center;
- the cluster mask is stored as `Uint32Array` entries and uploaded to the GPU as a read-only storage buffer;
- the composed tree-ring shader reads the visible-cluster mask and skips visible-list appends for hidden visible clusters;
- shadow caster generation is not gated by the camera-visibility mask.

Important constraint:

- The cluster camera-visibility mask must **never** gate shadow caster generation. It is a camera occlusion result, so using it to skip the whole `process_tree_slot` path would incorrectly remove camera-hidden shadow casters. Keep it visible-list-only unless visible and shadow generation are split into separate dispatches.

### TVIS-007b — Visible-cluster stats

Implemented in:

- `tools/clod-poc/src/trees/tree_system_gpu_ring_runtime.ts`
- `tools/clod-poc/src/trees/tree_system_stats.ts`
- `tools/clod-poc/src/trees/tree_info.ts`
- `tools/clod-poc/src/trees/tree_system_stats.test.ts`

The HUD/debug line now reports visible-cluster mask counts when available:

```text
visibleClusters hidden=<n> visible=<n> unknown=<n>
```

These are CPU-side mask statistics. They do not require GPU readback and do not imply compacted dispatch.

## Partially implemented

### TVIS-007c — Compacted visible dispatch

Current state: **visible-list per-slot and visible-cluster rejection is wired and observable**, but not compacted dispatch.

What remains:

- GPU dispatch still covers the full tree ring slot grid;
- `gpuCandidateCount` may not drop yet;
- there is no compacted visible-cluster dispatch yet.

## Remaining architectural work

### TVIS-007c next step

Measure the current visible-cluster mask effect first, then decide whether compacted visible dispatch is worth the added complexity.

Acceptance before compacting:

- visible-cluster hidden count is near zero on flat terrain;
- visible-cluster hidden count increases in hills/mountains;
- shadow caster counts are not gated by visible-cluster hidden count;
- no visible popping in fast-turn scenes;
- frame time improves enough to justify compacted dispatch work.

### TVIS-008

Extend the shared provider to grass, understory, stones, and custom props.

### TVIS-009

Port proven behavior to Rust/Bevy using the Rust NAADF cache, not the browser heightfield approximation.

## Verification

Run:

```bash
cd tools/clod-poc
npm run typecheck
npm test
npm run trees:verify-terrain-cull
```

Manual scenes:

```text
http://127.0.0.1:5173/?scene=infinite-naadf-mountains&naadf=1&treeGpuCounts=0
http://127.0.0.1:5173/?scene=infinite-naadf-hills&naadf=1&treeGpuCounts=0
http://127.0.0.1:5173/?scene=infinite-naadf-fast-turn&naadf=1&treeGpuCounts=0
```

Use `treeGpuCounts=1` only for debug GPU readback counts.
