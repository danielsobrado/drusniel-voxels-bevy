# GPU Vegetation Candidate Rejection Plan

## Status on main — read before implementing (revised 2026-07-08)

Audited against `main`. **The premise of this plan is mostly already true — grass, trees, and understory candidate rejection already run on the GPU with per-reason counters.** As written, this plan would build a *second, parallel* rejection system. Do not. Reframe it as: add stones to the existing path, wire the canonical center, and unify counters.

### Phase 4 implementation status

Done on `main`:

- Stone GPU scatter now writes early-reject counters in the existing `stone_scatter.compute.wgsl` path: candidates, below-water, too-steep, outside-world, too-far, density-mask, tile-budget, and class-budget.
- `StoneStats` now publishes GPU prefilter counters and `earlyTerrainReasonCounts`.
- `gpu_vegetation_early_reject_counters.ts` now aggregates stones alongside grass/tree/understory using the same camelCase + dotted `groupReject.reason` convention.
- `clod_frame_loop.ts` now mirrors stone stats into the existing vegetation GPU reject counter block.
- Stone scatter center preserves canonical infinite-world coordinates instead of clamping them back into `[0, worldCells]` before dispatch.

Still intentionally not done here:

- No new `src/vegetation/gpu/*` fork.
- No new `veg_gpu_*` snake-case counter family.
- Stone scatter still samples the shared GPU terrain field directly; it does not consume GPU far-summary as an authoritative placement source yet.

### What already exists (this is the mechanism the plan proposes to "build")

GPU ring compute + candidate generation + early rejection:
- [src/gpu/grass_ring_compute.ts](../src/gpu/grass_ring_compute.ts), [src/gpu/understory_ring_compute.ts](../src/gpu/understory_ring_compute.ts), [src/gpu/tree_ring_compute.ts](../src/gpu/tree_ring_compute.ts), [src/gpu/stone_scatter_compute.ts](../src/gpu/stone_scatter_compute.ts), [src/gpu/prop_ring_compute.ts](../src/gpu/prop_ring_compute.ts), with WGSL in `src/gpu/shaders/{grass_ring,understory_ring,tree_ring,stone_scatter}.compute.wgsl`.
- Tree runtime: [src/trees/tree_system_gpu_ring_runtime.ts](../src/trees/tree_system_gpu_ring_runtime.ts), [src/trees/tree_ring_cluster_visibility.ts](../src/trees/tree_ring_cluster_visibility.ts).

Rejection counters, **already with the per-reason breakdown this plan asks for**, in [src/vegetation/gpu_vegetation_early_reject_counters.ts](../src/vegetation/gpu_vegetation_early_reject_counters.ts):
- grass/tree/understory/stone `*GpuClustersTotal/RejectedEarly/Accepted`, source counters (`*SourceFarSummary/TerrainSampler/Fallback`), candidate budgets, and dotted reason counters `grassReject.wrong_biome`, `treeReject.too_steep`, `understoryReject.below_water`, `stoneReject.density_mask`, `stoneReject.tile_budget`, `*.height_range`, `*.outside_world`, `*.terrain_hidden`.
- Terrain rejection sampling already chooses far-summary → terrain-sampler → fallback for grass/tree/understory: [src/vegetation/vegetation_terrain_reject_provider.ts](../src/vegetation/vegetation_terrain_reject_provider.ts), `terrain_rejection_cache.ts`, `terrain_rejection_config.ts`, `vegetation_slot_prefilter.ts`.

### The actual delta this plan should deliver

1. **Stones.** Grass/tree/understory are wired into the early-reject counters; **stones are now wired too.** Stone reject counters mirror the existing group counter scheme in `gpu_vegetation_early_reject_counters.ts`. `StoneStats` lives in [src/stones/stone_instances.ts](../src/stones/stone_instances.ts).
2. **Canonical center.** Ensure every ring's center is the camera-derived canonical center from milestone 2.5, and publish `camera_to_vegetation_ring_center_m` (plan 2). This is the fix for "grass ring in a different region." Stone compute preserves this unbounded center in infinite-islands mode.
3. **Counter unification, not a new namespace.** Keep the existing camelCase + `groupReject.reason` dotted scheme. **Delete the invented `veg_gpu_grass_reject_*` snake_case names** — they would be a third convention. Where an acceptance counter is needed, add it via the standard `publishXStatsToCounters` translation used everywhere else.
4. **Parity/spacing gaps only.** If a group lacks a spacing/`tile_budget`/`density_mask` reason today, add it to that group's existing shader + counter block. Do not fork a new pipeline to host it.

### Do NOT create

- `src/vegetation/gpu/vegetation_gpu_reject_{config,types,planner,builder,buffers,counters}.ts` or `shaders/vegetation_reject.wgsl`. These duplicate the four existing `*_ring_compute.ts` + `gpu_vegetation_early_reject_counters.ts`. Extend those files instead.

### Corrected paths

| Plan says | Actually on main |
| --- | --- |
| new `src/vegetation/gpu/*` reject system | extend [src/gpu/*_ring_compute.ts](../src/gpu/) + [src/vegetation/gpu_vegetation_early_reject_counters.ts](../src/vegetation/gpu_vegetation_early_reject_counters.ts) |
| new WGSL `vegetation_reject.wgsl` | extend `src/gpu/shaders/{grass_ring,tree_ring,understory_ring,stone_scatter}.compute.wgsl` |
| far-summary source | [src/far-summary/](../src/far-summary/) via `vegetation_terrain_reject_provider.ts` for grass/tree/understory; stones currently use the shared GPU terrain field directly |

### Pinned decisions

- Integer-hash parity: reuse [src/naadf/hash.ts](../src/naadf/hash.ts) / existing ring hash helpers; do not add a new hash.
- Verification is headed/real-GPU. **Critical for this plan:** headless = SwiftShader renders **0 trees** and fakes GPU timers, so headless "acceptance" cannot validate vegetation GPU rejection at all. Use headed runs and the tree-perf harness notes.
- WGSL has no bool uniform (use u32 0/1); vitest needs `self = globalThis` for three/webgpu; never run vitest/`vite build` under `rtk` (only `tsc` typecheck is rtk-safe).

### Gate

Do not start until milestone [2.5 root-cause coordinate fix](canonical-world-center-root-cause-fix-plan.md) passes. This plan's whole point (rings on the correct center) depends on it.

---

## Goal

Move grass, tree, stone, and understory candidate rejection from CPU-side loops into WebGPU compute, while keeping CPU fallback and parity checks.

The target path is:

```text
CPU:
  chooses canonical world-space ring center
  creates deterministic candidate descriptors / ring tiles
  uploads compact config and dirty tile descriptors
  reads only counters when debug/parity asks for them

GPU:
  generates or evaluates candidates in parallel
  samples terrain height/material/water/slope/biome summaries
  rejects invalid candidates
  compacts accepted grass/tree/stone/understory instances
  writes rejection counters

Renderer:
  draws accepted instance buffers directly
  avoids CPU-built instance arrays during startup/stabilization
```

This is the fourth step after:

```text
1. streamed-page bounds guard
2. canonical world-space center debug counters
3. GPU far-summary build
```

Do not implement this before center mismatches are diagnosable. Candidate rejection must use the same canonical center as terrain, far shell, water, and streamed roots.

## Why this matters

Vegetation placement is an ideal GPU workload:

- thousands of independent candidate probes;
- simple terrain/biome/water/slope rejection rules;
- predictable ring/tile layout;
- high startup/stabilization cost when done on CPU;
- direct output into renderable instance buffers;
- small counter readbacks only when needed.

The current failure mode of `grass: enabled 0 blades` is also hard to debug because the UI shows totals but not enough per-reason or per-tile detail. This plan makes rejection visible and cheap.

## Non-goals

- Do not rewrite tree/grass rendering shaders in this step.
- Do not remove existing CPU vegetation placement.
- Do not make WebGPU required.
- Do not add debug readbacks to perf runs.
- Do not change biome rules just to show more grass.
- Do not scatter vegetation around stale `controls.target` or finite-world origin.
- Do not make vegetation authoritative for gameplay collision.

## Invariants

```text
I1. CPU fallback remains correct and deterministic.
I2. WebGPU unavailable path keeps existing vegetation behavior.
I3. GPU vegetation output is a derived render cache.
I4. Candidate placement is deterministic for seed + tile + revision.
I5. Accepted instances must use world-space coordinates.
I6. Rejection counters must not require full instance readback.
I7. Perf runs must avoid mapped readbacks except tiny optional counters.
I8. Center must come from the canonical center module.
```

## Candidate groups

Start with four groups:

```text
grass
understory
trees
stones
```

Do not try to solve custom props in the first pass. Custom props usually need heavier placement rules, model selection, collision spacing, and persistence.

## Data flow

```text
canonical center
  -> vegetation ring planner
  -> dirty vegetation tiles
  -> GPU candidate rejection batch
  -> accepted instance buffers
  -> indirect or counted instanced draw path
  -> optional sampled parity readback
```
