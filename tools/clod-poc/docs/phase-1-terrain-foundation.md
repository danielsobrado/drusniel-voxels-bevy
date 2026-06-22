# Phase 1 Terrain Foundation

Phase 1 proves a deterministic 4 km terrain foundation for `tools/clod-poc` through
the WebGPU-gated `?scene=phase1-terrain` path. It reuses the Phase-0 browser gate,
diagnostics, hooks, fly camera, HUD, screenshot harness, and compare tool.

## What Phase 1 Proves

- Deterministic terrain input from `?seed=N`.
- LOD0 pages generated from a heightfield source.
- Parent CLOD pages derived from child page meshes.
- Parent derivation runs merge, border locking, simplification, normal recompute, and error accumulation.
- Runtime selection uses the shared `selectCut()` path.
- Debug captures for `final`, `lod`, `height`, `slope`, `normal`, `flow`, `biome`, and `paint_weights`.
- Page building completes before the animation loop.

## Shared CLOD Modules

Phase 1 scene code is intentionally thin. Reusable CLOD logic lives under `src/clod`:

- `heightfield_leaf_source.ts` adapts a deterministic heightfield into LOD0 pages.
- `page_mesh_merge.ts` merges child page meshes in deterministic order.
- `page_border_lock.ts` validates and counts outer border chains.
- `page_error_metric.ts` computes geometric parent error from source and parent meshes.
- `parent_page_derivation.ts` derives one parent from child nodes.
- `page_tree_builder.ts` builds the derived quadtree.

This keeps Phase 1 from becoming a parallel fake CLOD demo.

## Parent Derivation Rule

Parent pages are never directly sampled from the heightfield. Direct resampling would
hide cracks and error issues by creating a second terrain source per LOD. Drusniel CLOD
requires parent pages to be caches derived from child pages, so accumulated error and
border behavior remain honest.

## Commands

```powershell
npm run typecheck
npm run test
npm run build
npm run dev
```

With the dev server running:

```powershell
npm run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug final --freeze 1 --hud 1 --framealign 0 --cam "1800,360,3200,2.6500,-0.4300,55" --out shots/phase-1/terrain-final.png --stats shots/phase-1/terrain-stats.json
npm run battery
```

## Deferred Work

- Better simplification quality.
- GPU heightfield generation.
- Real hydrology and water.
- Vegetation.
- Atmosphere.
- Rust/Bevy integration.
