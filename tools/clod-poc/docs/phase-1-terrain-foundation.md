# Phase 1 Terrain Foundation

Phase 1 proves a deterministic, large-domain terrain foundation for `tools/clod-poc`.
It is a WebGPU-gated runtime scene, reached with `?scene=phase1-terrain`, and it reuses the
Phase-0 browser gate, diagnostics, hooks, fly camera, HUD, screenshot harness, and compare tool.

## What This Proves

- Deterministic world-scale terrain synthesis from `?seed=N`.
- A 4096 m terrain domain for long-view experiments.
- CPU heightfield data with height, slope, flow, biome, min/max, and signature outputs.
- A CLOD page runtime cut driven by the existing `selectCut()` path.
- Debug terrain materials for `final`, `lod`, `height`, `slope`, `normal`, `flow`, `biome`, and `paint_weights`.
- Stable Playwright screenshots and stats through `window.__drusnielClod`.

## Drusniel CLOD, Not Fable5 CDLOD

The fable5 reference uses a CDLOD-style terrain view. Drusniel keeps its CLOD page model:

- `VoxelWorld` remains the authoritative production terrain model.
- Pages remain derived caches.
- Page build happens before the render loop, not on the frame path.
- Runtime work is selection and visibility, not page generation.
- This phase uses a deterministic heightfield adapter to exercise the visual/runtime gate without replacing the voxel page architecture.

## Commands

```powershell
npm run typecheck
npm run test
npm run build
npm run dev
```

With the dev server running:

```powershell
npm run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug final --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-final.png --stats shots/phase-1/terrain-stats.json
npm run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug lod --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-lod.png
npm run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug height --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-height.png
npm run shoot -- --scene phase1-terrain --seed 1 --world 8 --terrainGrid 2048 --terrainDebug slope --freeze 1 --hud 1 --framealign 0 --out shots/phase-1/terrain-slope.png
npm run battery
```

## Deferred Work

- Full GPU 4096^2 terrain synthesis.
- Real hydrology and water rendering.
- Vegetation.
- Advanced atmosphere and clouds.
- Rust/Bevy port of the terrain foundation.
