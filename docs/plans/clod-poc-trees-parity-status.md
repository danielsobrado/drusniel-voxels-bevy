# clod-poc tree parity status

Status: In progress.

This status note tracks the implementation state for `docs/plans/clod-poc-trees-parity-plan.md`.

## Completed or mostly implemented

- TREE-1 WebGPU render-to-atlas baker: the baker now uses generic render-target renderer methods instead of the old WebGL `getContext()` gate.
- TREE-2 Normal+depth atlas channel: `TreeImpostorAtlas` carries albedo, normalDepth, radius, and centerY; the baker emits both albedo and normal/depth targets.
- TREE-3 Bake-config parity: impostors default to enabled, `bakeOnStart=true`, grid size 8, resolution 128, with a documented VRAM budget.
- TREE-4 Baked atlas geometry in GPU ring: `selectTreeGpuRingGeometry` selects baked impostor geometry when the species atlas is ready and falls back to the procedural card otherwise.
- TREE-5 Relit, 4-tile-blended ring impostor material: `tree_ring_impostor_node_material.ts` samples four octahedral atlas tiles, blends albedo/coverage/normal, sqrt-decodes albedo, and relights through the sun/hemispheric model.
- TREE-6 Crossfade continuity: `tree_lod_crossfade.ts` adds the pure far-to-impostor dither contract and `tree_lod_crossfade.test.ts` verifies complementary keep masks across the boundary.
- TREE-11 acceptance contract: `tree_impostor_acceptance.ts` defines litness, view-blend, near/impostor color, boundary hole/double-draw, and perf-speedup gates; `tree_impostor_acceptance.test.ts` and `visualHonesty.test.ts` cover the contract.

## TREE-7 current state

Implemented:

- `tree_ring_shadow_casters.ts` defines the per-cascade caster group layout, fixed cascade/frustum-plane packing, and cascade-plane extraction from `THREE.Camera`.
- `tree_system_gpu_ring_draw.ts` can allocate optional `shadowCell` and `shadowIndirect` GPU buffers for per-cascade caster lists.
- `tree_ring.compute.wgsl` now has shadow counters, shadow indirect args, shadow-cell output, cascade frustum checks, and appends tree casters before visible camera frustum culling.
- `tree_ring_compute.ts` binds the shadow buffers, packs shadow cascade planes into the WGSL uniform layout, builds shadow indirect args, and disables shadow writes unless real output buffers are available.
- `realtime_sun_shadows.ts` exposes the active sun shadow cascade cameras through `getRealtimeSunShadowCascadeCameras()`.
- `scripts/wire-tree-system-tree7-shadows.mjs` is ready to physically wire the large `tree_system.ts` file.

Still required before calling TREE-7 complete:

- Run `npm --prefix tools/clod-poc run trees:wire-tree7-shadows` and commit the resulting `tree_system.ts` rewrite.
- Verify `tree_system.ts` now allocates `shadowCell` / `shadowIndirect`, imports `TREE_GPU_RING_SHADOW_GROUP_COUNT`, packs cascade planes from `getRealtimeSunShadowCascadeCameras()`, and passes `maxShadowCastersPerGroup` / `shadowCascadePlanes` into `TreeGpuRingCompute.dispatch()`.
- Wire the generated shadow caster buffers into the realtime sun shadow draw path, or explicitly document why the current Three.js shadow pass cannot consume indirect GPU-ring caster buffers yet.
- Add CPU/GPU caster-count parity once shadow readback is available.
- Capture a low-sun shot proving off-screen trees can still cast.

## Still required before calling Epic A+B closed

- Run `npm --prefix tools/clod-poc test`.
- Run `npm --prefix tools/clod-poc run typecheck`.
- Run the server-first shot/perf harness for the WebGPU path with impostors enabled.
- Capture slow dolly-out and frozen-boundary shots to confirm no far/impostor pop, holes, or double-draw.
- Feed real screenshot/perf measurements into the TREE-11 acceptance contract.

## Next implementation order

1. Finish TREE-7 physical `tree_system.ts` wiring and shadow draw integration.
2. TREE-8 crown proxy casters.
3. TREE-9 species expansion.
4. TREE-10 hero near-tree triangle audit.
5. TREE-12 closeout docs and evidence links.
