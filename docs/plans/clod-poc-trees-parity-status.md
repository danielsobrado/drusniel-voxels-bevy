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

## Still required before calling Epic A+B closed

- Run `npm --prefix tools/clod-poc test`.
- Run `rtk npm --prefix tools/clod-poc run typecheck`.
- Run the server-first shot/perf harness for the WebGPU path with impostors enabled.
- Capture slow dolly-out and frozen-boundary shots to confirm no far/impostor pop, holes, or double-draw.

## Next implementation order

1. TREE-11 visual/perf acceptance gate for the already-implemented A+B path.
2. TREE-7 per-cascade tree caster cull.
3. TREE-8 crown proxy casters.
4. TREE-9 species expansion.
5. TREE-10 hero near-tree triangle audit.
6. TREE-12 closeout docs and evidence links.
