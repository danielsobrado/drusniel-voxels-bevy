# NAADF Tree Visibility Current Status

Last updated: 2026-07-01
Scope: `tools/clod-poc`

## Implemented

### TVIS-001 — GPU terrain-hidden tree rejection

Implemented through `tools/clod-poc/src/gpu/wgsl_modules.ts` and covered by `tools/clod-poc/src/gpu/wgsl_modules.test.ts`.

The composed tree-ring WGSL now performs camera terrain-visibility rejection after shadow-caster appends and before visible appends.

This is still per-slot visible-list rejection, not page-level dispatch reduction.

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

## Partially implemented

### TVIS-007 — Pre-generation culling

Current state: **visible-list per-slot rejection plus tested CPU-side cluster camera-visibility mask foundation**, not true GPU compacted page dispatch.

Implemented foundation:

- `tools/clod-poc/src/trees/tree_ring_cluster_visibility.ts`
- `tools/clod-poc/src/trees/tree_ring_cluster_visibility.test.ts`
- `tools/clod-poc/scripts/wire-tree-visible-cluster-mask-gpu.mjs`

What is done:

- terrain-hidden GPU tree slots still generate shadow casters, then skip visible appends;
- CPU/GPU debug validation follows the same visible-list rejection order;
- a conservative tree-ring camera-visibility mask can be built from the shared vegetation visibility provider;
- the cluster mask keeps unknown/missing terrain visible;
- a cluster is hidden only when every representative probe is terrain-hidden;
- representative probes include the nearest cluster point, center, and corners, not only the center;
- the cluster mask is stored as `Uint32Array` entries so it can be uploaded directly to a WGSL `array<u32>` storage buffer;
- utility lookup maps tree-ring slots back to their cluster visibility;
- a deterministic local script can wire the mask into the GPU visible-list path only.

Important constraint:

- The cluster camera-visibility mask must **never** gate shadow caster generation. It is a camera occlusion result, so using it to skip the whole `process_tree_slot` path would incorrectly remove camera-hidden shadow casters. GPU wiring must apply the mask only to the visible-list path, or split visible and shadow generation into separate paths.

Current local wiring command:

```bash
cd tools/clod-poc
npm run trees:wire-visible-cluster-mask
npm run typecheck
npm test
```

What is not done on `main` until that wiring command is applied locally:

- cluster mask entries are not uploaded to the compute shader yet;
- the compute shader does not yet read a cluster mask before visible-list work.

What remains architecturally pending even after that command:

- GPU dispatch still covers the full tree ring slot grid;
- `gpuCandidateCount` may not drop yet;
- there is no compacted cluster dispatch yet.

## Remaining architectural work

### TVIS-007 next step

Apply and validate the visible-list-only cluster mask GPU wiring locally, then commit the generated diff if tests pass.

Target shape:

```text
CPU/NAADF visibility provider
  -> conservative cluster camera-visibility mask as Uint32Array entries
  -> storage binding exposed to GPU tree-ring compute
  -> GPU visible-list path reads mask before visible append work
  -> GPU shadow-caster path ignores camera-visibility mask
  -> future: compact visible dispatch only, or split visible/shadow dispatches
```

Acceptance:

- visible-list work is skipped for hidden visible clusters;
- shadow caster generation is not gated by the camera-visibility mask;
- later, visible candidate work drops when dispatch becomes cluster-compacted;
- unknown/missing data keeps clusters visible;
- no visible popping in fast-turn scenes.

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

Use `treeGpuCounts=1` only for debug counts.
