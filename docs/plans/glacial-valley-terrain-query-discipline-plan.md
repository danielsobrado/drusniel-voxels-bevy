# Plan 4 — Shared Terrain Query Discipline (from glacial-valley)

> Created: 2026-06-17 · Status: Planning
> Scope (Bevy): a `TerrainQuery` service over `src/voxel/` (terrain gen, meshing
> material weights, water bodies), consumed by props/grass/colliders/editor/bench
> Scope (clod-poc): `tools/clod-poc/src/terrain.ts` + its consumers
> Parent: [`glacial-valley-port-overview.md`](glacial-valley-port-overview.md)

## What this is / is not

- **Is:** adopting glacial-valley's **discipline** — one authoritative place answers
  "what is the terrain doing at (x,z[,y])?" so mesh, physics, water, and placement
  never disagree — as a **shared query layer** in Drusniel.
- **Is not (GV-G0):** glacial-valley's *mechanism* (a single scalar `terrainH(x,z)`).
  Drusniel terrain is volumetric and editable; the shared answer is a **service over
  the voxel world**, returning best-effort surface/material/water/slope, not a height.

## Why this matters here

glacial-valley gets visual coherence for free because `terrainH` is the single source
for the mesh, the collider (`groundAt`, [main.js:926](../reference/glacial-valley/main.js#L926)),
water depth ([:400](../reference/glacial-valley/shaders.js#L400) `uWaterY - groundH`),
and **all** placement (`fine.sample` + `slopeAt` gates for grass/pebbles/flowers/trees/
splash, [main.js:419-424, 456, 505, 544, 744, 774](../reference/glacial-valley/main.js#L419-L424)).
Everything lines up because everything asks the same function.

Drusniel currently re-derives surface/slope/water/material in several places (mesher,
material weights [`material_weights.rs`](../../src/voxel/meshing/material_weights.rs),
water bodies, prop/grass placement, editor preview, benches). The river plan
([Plan 3](glacial-valley-braided-river-worldgen-plan.md)) and detail plan
([Plan 5](glacial-valley-biome-detail-masks-plan.md)) will **add more consumers** — so a
shared query is the thing that keeps them coherent. This plan is the **payback refactor**
for the others; sequence it when that duplication starts to bite, not before.

## The query surface (voxel-correct, not a height fn)

```text
TerrainQuery {
  surface_height_best_effort(x, z) -> Option<f32>   // topmost solid under (x,z); None over caves/void
  sample_density(x, y, z)          -> f32           // authoritative SDF/density
  material_weights(x, y, z)        -> Weights        // shares material_weights.rs
  water_depth(x, z)                -> f32            // from water_bodies + river channel
  slope(x, z)                      -> f32            // gradient of surface_height_best_effort
  visibility_summary(x, z)         -> f32            // far-field sun vis (Plan 2), best-effort
}
```

- `surface_height_best_effort` is explicitly **best-effort** and **optional** —
  honest about overhangs/caves where "the height" is undefined. That is the one-line
  difference from glacial-valley's total function, and it is what keeps GV-G0.
- It is a **read facade over existing data** (density gen + `material_weights.rs` +
  `water_bodies.rs`), not a new authority. No new source of truth.

## Bevy plan

### TQ-1 Extract the facade
- Create `src/voxel/query/` (or `terrain/query.rs`) wrapping the existing density
  generator, `material_weights.rs`, and `water_bodies.rs`. No behaviour change — it
  forwards to what already exists.
- **Verify:** unit tests show the facade matches the underlying functions to tolerance;
  no bench movement (it's a wrapper).

### TQ-2 Route one consumer through it (prove the seam)
- Pick the highest-duplication consumer (prop/grass placement or the editor preview)
  and route it through `TerrainQuery`. Keep the old path until parity is shown.
- **Verify (bench):** placement output identical (golden); `summary.json` flat.

### TQ-3 Migrate remaining consumers opportunistically
- As [Plan 3](glacial-valley-braided-river-worldgen-plan.md) (river depth/rapid mask)
  and [Plan 5](glacial-valley-biome-detail-masks-plan.md) (detail masks) land, have them
  consume `TerrainQuery` from day one rather than re-deriving slope/water/material.
- **Verify:** each migrated consumer keeps its golden output; benched if on a hot path.

## clod-poc plan

clod-poc already half-does this: [`terrain.ts`](../../tools/clod-poc/src/terrain.ts)
exposes `surfaceHeight`/`surfaceNormal`/`materialWeights` consumed by
[`grass.ts`](../../tools/clod-poc/src/grass.ts), the collider
([`terrain_collider.ts`](../../tools/clod-poc/src/terrain_collider.ts)), and materials.

| Step | Action |
|---|---|
| **TQ-c1** | Consolidate the scattered helpers into a single `TerrainQuery`-shaped module mirroring the Bevy surface (same method names) — `surfaceHeightBestEffort`, `slope`, `waterDepth`, `materialWeights`, `visibilitySummary`. |
| **TQ-c2** | Route grass/pebble/flower/splash placement (the river-spike consumers) through it, so clod-poc is the reference for the Bevy facade. |
| **Verify** | `vitest` covers the facade; Pages deploy green; placement visually unchanged. |

- **Parity:** method names/signatures match Bevy `TerrainQuery`; clod-poc is the
  canonical shape the Rust facade copies.

## Guardrails

- **GV-G0:** `surface_height_best_effort` is `Option`/best-effort, never an authority
  that flattens caves/overhangs. It reads the voxel field; it does not replace it.
- **No new source of truth:** the facade forwards to existing data. If a query starts
  *computing* terrain instead of *reading* it, that's drift.
- **Do this when duplication hurts**, not speculatively (CLAUDE.md simplicity rule);
  Plans 3 and 5 are the forcing functions.

## Reference index

- One-query discipline (placement gates): [`main.js:419-424`](../reference/glacial-valley/main.js#L419-L424), [`:456`](../reference/glacial-valley/main.js#L456), [`:926-929`](../reference/glacial-valley/main.js#L926-L929)
- Drusniel material weights: [`src/voxel/meshing/material_weights.rs`](../../src/voxel/meshing/material_weights.rs)
- Water bodies: [`src/voxel/runtime/water_bodies.rs`](../../src/voxel/runtime/water_bodies.rs)
- clod-poc fields: [`tools/clod-poc/src/terrain.ts`](../../tools/clod-poc/src/terrain.ts)
