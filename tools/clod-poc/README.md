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

## Current LOD model and crack invariants

This PoC builds a configured page quadtree, not a general meshlet DAG. LOD0 pages are
welded from chunk meshes, each parent merges `2x2` children, hierarchy depth comes from
`quadtree_levels`, and simplification targets `target_ratio_per_level: 0.5`.

Crack prevention relies on two invariants:

- Builder invariant: before simplifying a parent, weld the child meshes and lock the
  parent's outer topological boundary. Old child borders are internal and must already
  have welded away; the new parent border survives simplification verbatim.
- Runtime invariant: selection is a consistent monotonic cut of the hierarchy. At any
  point, either a group renders or one of its ancestors/descendants renders, but never
  both and never neither.

Under those rules, any cut across the built quadtree levels should be watertight. The
optional 2:1 restriction in the viewer is for visual density gradients, not crack
prevention. Validation currently checks same-level border matches plus builder
locking/welding; it does not yet run an explicit cross-level adjacency sweep.

The near-field bubble is a separate runtime constraint, not the 2:1 rule. When the bubble
is enabled, any page that intersects the bubble plus one LOD0 page of padding is
force-split to LOD0 before raw chunks are drawn. That keeps the live/raw chunk side of the
bubble bordered by LOD0 page meshes, not an LOD1+ parent.

### Current visual seam status

The viewer can still show persistent same-LOD page-boundary scars. These are visible
shading/mesh scars, not necessarily cracks: LOD0 pages are separate meshes, page outer
edges intentionally remain open topological boundaries for parent locking, and only chunks
inside a page are welded together. Adjacent pages can therefore have matching border
position/normal/material chains while their one-cell interior bands still shade differently.
Wireframe and page-boundary overlays make these seams especially obvious because each page
has real boundary edges.

The current A1/A2 checks prove the border chain is watertight and attribute-matched at the
sampled edge; they do not prove visual continuity in the triangles immediately inside that
edge. Use the viewer's "same-LOD seam points", "normal colours", and "recomputed normals"
debug controls to classify a scar before changing the builder. If a scar follows seam
points, investigate same-level page-border normal reconciliation; if it changes under
recomputed normals, investigate post-simplification normal recomputation/smoothing. Treat
this as A3 visual quality work, not as evidence that the DAG-cut selection is drawing
both/neither.

Manual visual checks:

- Toggle the near-field bubble off/on. A large blue/white edge that only appears with the
  bubble is a bubble ownership bug; the overlay's "bubble forced splits" counter should
  become non-zero when nearby parent nodes are force-split to LOD0.
- Toggle "same-LOD seam points". A scar that follows the red points is likely page-border
  shading; a scar away from them is probably terrain/simplification structure.
- Toggle "normal colours". A scar that is clearer in normal colour mode is in the normal
  field, not just albedo/LOD colouring.
- Toggle "recomputed normals". A scar that changes under this debug toggle points at
  source/simplified normal handling; a scar that remains points at geometry density or
  triangulation.

## Phase 1 — headless page builder

```bash
npm run build-pages        # 4x4 LOD0 pages, quick informational run (tops out at LOD2)
npm run build-pages 8      # 8x8, one complete LOD3 node — the formal Phase 3 gate input
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
colour-by-LOD, normal-colour/recomputed-normal diagnostics, same-LOD seam points, and a
**near-field bubble** folder (§4.4): pages intersecting the bubble are force-split to LOD0,
and inside the radius a LOD0 page is drawn as its raw chunks instead of the welded page
mesh. With "tint bubble red" OFF the edge must be **invisible** (raw chunks === welded
LOD0) — toggle the bubble and nothing should change; with tint ON you see which pages it
owns. The overlay shows the live cut (nodes per level, tris rendered, 2:1 forced splits,
and bubble forced splits). Move the camera and watch near pages refine to LOD0 while far
pages stay coarse. The **world size** selector (or `?world=8`) loads the full LOD0→LOD3
8×8 world (~8s build): get close to one corner, then toggle the 2:1 constraint to see
large neighbor LOD deltas appear and get bounded.

Not yet built: floating per-node error labels + locked-border highlight, and an explicit carved cave
tunnel (single-vertex Surface Nets can't split two sheets in one cell — a PoC mesher
limit, not a CLOD one; the engine's mesher handles caves).

## Module map (mirrors the Rust appendix §11)

| File | Role |
|---|---|
| `terrain.ts` | synthetic global field + per-chunk Surface Nets (stands in for the engine mesher) |
| `source_mesh.ts` | LOD0 page = welded chunk meshes (no re-extraction, I2) |
| `weld.ts` | spatial-hash weld; attribute conflict = `DirtyInput` hard fail |
| `lock.ts` | parent outer-border lock detection by open topological boundary |
| `simplify.ts` | **sole** meshoptimizer boundary; never `simplify_sloppy` |
| `quadtree.ts` | merge → weld → lock → simplify → error accumulation |
| `validate.ts` | border-chain + degenerate hard-fail assertions |

## Not in this PoC (later phases)

Phase 3 acceptance sweep (formal go/no-go + stress scenes §4.4); Phases 4–6 Rust/Bevy port.
The Rust-side Phase 0 lock confirms (`meshopt` crate) are deferred to Phase 4.
