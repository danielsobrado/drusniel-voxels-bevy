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
- `tree_ring_shadow_casters.ts` includes CPU-side caster cascade selection and per-(cascade,species,lod) group count helpers for parity checks.
- `tree_ring_shadow_casters.test.ts` verifies cascade plane packing, cascade selection, group counts, and per-group overflow clamping.
- `tree_system_gpu_ring_draw.ts` can allocate optional `shadowCell` and `shadowIndirect` GPU buffers for per-cascade caster lists.
- `tree_ring.compute.wgsl` now has shadow counters, shadow indirect args, shadow-cell output, cascade frustum checks, and appends tree casters before visible camera frustum culling.
- `tree_ring_compute.ts` binds the shadow buffers, packs shadow cascade planes into the WGSL uniform layout, builds shadow indirect args, and disables shadow writes unless real output buffers are available.
- `realtime_sun_shadows.ts` exposes active sun shadow cascade cameras and assigns each cascade a dedicated shadow-only caster layer.
- `tree_system_gpu_ring_draw.ts` includes a tested `createTreeGpuRingShadowMesh(...)` helper for cascade-layered shadow-only ring meshes.
- `scripts/wire-tree-system-tree7-shadows.mjs` now physically wires the large `tree_system.ts` file for shadow buffers, cascade-plane dispatch, shadow-only meshes, and visible-ring `castShadow=false`.

Still required before calling TREE-7 complete:

- Run `npm --prefix tools/clod-poc run trees:wire-shadow-proxies` and commit the resulting `tree_system.ts` rewrite.
- Verify `tree_system.ts` now imports `markAsRealtimeSunShadowCaster`, `TREE_RING_SHADOW_CASCADE_COUNT`, and `treeRingShadowCasterGroupIndex`.
- Verify `createGpuRingDrawResources(...)` now creates `shadowRingBuffers`, one shadow material handle per cascade/species/LOD, and one `createGpuRingShadowTierDraw(...)` mesh per caster group.
- Verify visible GPU-ring meshes have `castShadow=false`, so they do not double-cast against the shadow-only meshes.
- Add GPU caster-count readback if we want full CPU/GPU caster-count parity instead of CPU contract coverage only.
- Capture a low-sun shot proving off-screen trees can still cast.

## TREE-8 current state

Implemented:

- `tree_crown_proxy_math.ts` provides fitted species crown dimensions, ellipsoid source geometry, edge keep probability, and impostor-band fade math.
- `tree_crown_proxy_math.test.ts` covers broad oak crowns, tall pine crowns, sparse dead-tree proxies, edge falloff, and impostor-boundary fade.
- `tree_crown_proxy_node_material.ts` provides a WebGPU/TSL crown proxy material handle using GPU ring storage cells, ellipsoid placement, world/screen anchored dither, crown-edge falloff, and numeric impostor fade masks.
- `tree_crown_proxy_node_material.test.ts` covers material construction and source-level placement/mask contract.
- `scripts/wire-tree-system-tree8-proxies.mjs` wires the large `tree_system.ts` file to use crown proxy geometry/materials for far/impostor shadow-only meshes.
- `npm --prefix tools/clod-poc run trees:wire-shadow-proxies` applies TREE-7 then TREE-8 in the required order.

Still required before calling TREE-8 complete:

- Run `npm --prefix tools/clod-poc run trees:wire-shadow-proxies` and commit the resulting `tree_system.ts` rewrite.
- Run `npm --prefix tools/clod-poc run typecheck` and `npm --prefix tools/clod-poc test`.
- Capture noon forest-interior and impostor-boundary shadow shots.

## TREE-9 current state

Implemented:

- `tree_species_expansion.ts` defines the six target species contract: oak, pine, dead, birch, willow, spruce.
- `tree_species_expansion.ts` includes default morphology/config values and distinct ecological niches for all six species.
- `tree_species_expansion.test.ts` verifies the six-species list, morphology differences, willow wet-bank preference, spruce high/cold slope preference, and dead-tree old-stressed-forest preference.
- `tree_ring_species_layout.ts` defines dynamic GPU ring layout offsets for arbitrary species counts.
- `tree_ring_species_layout.test.ts` confirms the existing 3-species layout remains compatible and shows the required 6-species offsets without uniform-slot collisions.

Still required before calling TREE-9 complete:

- Move live `TreeSpeciesId` / `TREE_SPECIES` from 3 to 6 only after `tree_ring_compute.ts` and `tree_ring.compute.wgsl` use the dynamic 6-species uniform layout.
- Extend `tree_material_bias.ts` and `config/trees.yaml` material bias values for birch, willow, and spruce.
- Extend the WGSL `select_species` branch from 3 to 6 species and keep the TS niche contract mirrored.
- Update group buffers/caps and GPU/CPU parity for 6×4 groups.
- Capture the ecology-sorted species gallery shot.

## Still required before calling Epic A+B closed

- Run `npm --prefix tools/clod-poc test`.
- Run `npm --prefix tools/clod-poc run typecheck`.
- Run the server-first shot/perf harness for the WebGPU path with impostors enabled.
- Capture slow dolly-out and frozen-boundary shots to confirm no far/impostor pop, holes, or double-draw.
- Feed real screenshot/perf measurements into the TREE-11 acceptance contract.

## Next implementation order

1. Finish TREE-7/TREE-8 physical `tree_system.ts` rewrites and shot evidence.
2. Move TREE-9 GPU uniform packing/WGSL to dynamic 6-species layout.
3. Flip live `TreeSpeciesId` / `TREE_SPECIES` to six species.
4. TREE-10 hero near-tree triangle audit.
5. TREE-12 closeout docs and evidence links.
