# NAADF Tree Visibility Current Status

Last updated: 2026-07-01
Scope: `tools/clod-poc`

## Implemented

### TVIS-001 — GPU terrain-hidden tree rejection

Implemented through `tools/clod-poc/src/gpu/wgsl_modules.ts` and covered by `tools/clod-poc/src/gpu/wgsl_modules.test.ts`.

The composed tree-ring WGSL now performs terrain visibility rejection after terrain/hydrology height is known and before:

- normal sampling;
- species selection;
- scale selection;
- LOD selection;
- visible appends;
- shadow appends.

This is still per-slot rejection, not page-level dispatch reduction.

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

Current state: **early per-slot rejection**, not true page/cluster dispatch reduction.

What is done:

- terrain-hidden GPU tree slots return before species/scale/LOD/appends;
- CPU/GPU debug validation now follows the same early-rejection order;
- shadow and visible lists both skip terrain-hidden slots.

What is not done:

- GPU dispatch still covers the full tree ring slot grid;
- `gpuCandidateCount` may not drop yet;
- true page/cluster masks are not uploaded to the compute shader;
- there is no compacted cluster dispatch yet.

## Remaining architectural work

### TVIS-007 next step

Add a cluster/page visibility mask before candidate generation.

Target shape:

```text
CPU/NAADF visibility provider
  -> compact cluster visibility mask
  -> GPU tree ring reads mask before per-slot work
  -> hidden cluster returns before candidate work
  -> future: dispatch only visible clusters
```

Acceptance:

- hidden cluster count is reported;
- per-slot work is skipped for hidden clusters;
- later, GPU candidate count drops when dispatch becomes cluster-compacted;
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
