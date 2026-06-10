# CLOD Pages PoC (Phases 0–1)

Three.js/TypeScript sandbox for [`docs/plans/clod-execution-plan.md`](../../docs/plans/clod-execution-plan.md).
This is the **gate before any Rust** — validate that the merge → weld → lock → simplify
loop produces watertight, attribute-matched page LODs cheaply here, not in the Bevy codebase.

Shared config is the repo-root [`config/clod_pages.yaml`](../../config/clod_pages.yaml) — the
same file the future Rust builder will consume. The PoC does not fork these numbers.

## Setup

```bash
cd tools/clod-poc
npm install
```

## Phase 0 — API verification spike

```bash
npm run spike
```

Confirms `meshoptimizer`'s `simplifyWithAttributes` honours a per-vertex lock array and
attribute weights, that `['LockBorder']` locks topological borders, and the world-error
formula `error_world = result_error * simplifyScale`. Asserts locked border vertices
survive verbatim. (Exit criteria for §2.)

## Phase 1 — headless page builder

```bash
npm run build-pages        # 4x4 LOD0 pages, all quadtree levels
npm run build-pages 8      # 8x8 (one complete LOD3 node — the real Phase 3 input)
```

Prints per-level tris / avg `error_world` / low-benefit rate / build ms, the A2 cross-page
border-match check, and a **Phase 3 acceptance-gate verdict** (§5: A1 watertight, A2 seams,
A4 reduction, A5 build cost, A6 low-benefit — A3 stays a visual judgement). Any dirty input
(weld conflict, unwelded internal border, border mismatch, degenerate) is a **hard fail**.

The terrain ([terrain.ts](src/terrain.ts)) includes §4.4 stress features that cross page
borders: a ridge, a steep cliff straddling x=128, and a true 3D overhang lip at the
4-page corner (128,128). The 8×8 gate passes with these present — evidence A1 holds on
non-heightfield topology.

## Phase 2 — runtime viewer

```bash
npm run dev
```

Builds a 4×4 world in-browser and runs the real runtime (§4): per-frame **DAG-cut
selection** (screen-space error + hysteresis), the optional **2:1 restricted-quadtree
pass**, and a **dithered screen-door crossfade** when the cut changes. lil-gui controls:
error-threshold slider, 2:1 toggle, freeze-selection, page-boundary boxes, wireframe,
colour-by-LOD, and a **near-field bubble** folder (§4.4): inside the radius a LOD0 page is
drawn as its raw chunks instead of the welded page mesh. With "tint bubble red" OFF the
edge must be **invisible** (raw chunks === welded LOD0) — toggle the bubble and nothing
should change; with tint ON you see which pages it owns. The overlay shows the live cut
(nodes per level, tris rendered, forced splits). Move the camera and watch near pages
refine to LOD0 while far pages stay coarse.

Not yet built: forced neighbor LOD delta 2–3 sweep (needs an 8×8 in-browser build),
floating per-node error labels + locked-border highlight, and an explicit carved cave
tunnel (single-vertex Surface Nets can't split two sheets in one cell — a PoC mesher
limit, not a CLOD one; the engine's mesher handles caves).

## Module map (mirrors the Rust appendix §11)

| File | Role |
|---|---|
| `terrain.ts` | synthetic global field + per-chunk Surface Nets (stands in for the engine mesher) |
| `source_mesh.ts` | LOD0 page = welded chunk meshes (no re-extraction, I2) |
| `weld.ts` | spatial-hash weld; attribute conflict = `DirtyInput` hard fail |
| `lock.ts` | parent outer-footprint lock detection by quantized position |
| `simplify.ts` | **sole** meshoptimizer boundary; never `simplify_sloppy` |
| `quadtree.ts` | merge → weld → lock → simplify → error accumulation |
| `validate.ts` | border-chain + degenerate hard-fail assertions |

## Not in this PoC (later phases)

Phase 3 acceptance sweep (formal go/no-go + stress scenes §4.4); Phases 4–6 Rust/Bevy port.
The Rust-side Phase 0 lock confirms (`meshopt` crate) are deferred to Phase 4.
