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

## GitHub Pages

The production build is configured for the project-site URL
`https://danielsobrado.github.io/drusniel-voxels-bevy/`.

The repository workflow `.github/workflows/deploy-clod-poc-pages.yml` tests, typechecks,
builds, and publishes only this PoC when relevant files change on `main`. Before its first
deployment, set the repository's **Settings → Pages → Build and deployment → Source** to
**GitHub Actions**. The workflow can also be launched manually from the Actions tab.

To verify the same subpath locally:

```bash
npm run build
npm run preview
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

The terrain ([terrain.ts](src/terrain.ts)) ports the runtime Bevy/Rust base-height path
from `src/voxel/terrain/height.rs`: the same default height range, value-noise fBm,
ridged mountains, broad massif mask, uplift, valley carve, hills, detail, and softened
height cap. Runtime-only water-body carving, caves, trees, and biome voxel typing are
not generated in the PoC; the page builder still gets deterministic same-resolution chunk
meshes with borders that weld exactly.

## Phase 2 — runtime viewer

```bash
npm run dev
```

Builds a 4×4 world in-browser and runs the real runtime (§4): per-frame **DAG-cut
selection** (screen-space error + hysteresis), the optional **2:1 restricted-quadtree
pass**, and a **dithered screen-door crossfade** when the cut changes. lil-gui controls:
error-threshold slider, 2:1 toggle, freeze-selection, page-boundary boxes, wireframe,
colour-by-LOD, normal-colour/recomputed-normal diagnostics, same-LOD seam points, a
camera-following procedural sky dome with sun disk, glow, horizon haze, and exposure
controls, and a **terrain
texture** folder. The **grass shader** folder controls animated instanced grass with
deterministic placement sampled from LOD0 terrain. Grass patches are independent from
the active CLOD cut, so selection changes do not duplicate or pop blades; this remains a
visual-only viewer feature and is not part of CLOD validation. Use "load image files" to
open the texture modal. It shows four
square slots for low→high terrain bands; click a square to load or replace that single
texture, or use "Load all" to fill slots from one multi-file selection. Each texture slot
has its own low/high height range. The right-side `blend mode` control switches between
hard bands, where the shader uses the range containing the current vertex height, and
blend bands, where adjacent ranges crossfade across the configured `blend height`. Gaps
fall back to the nearest loaded slot. Textures are sampled in world X/Z with repeat
wrapping, and the global "texture scale" controls tiling density. With `colour by LOD`
enabled the page colour is applied as a light tint over the texture, so the image remains
visible on every LOD while ownership is still readable. Turn `colour by LOD` off for a
neutral textured terrain pass.

The sky/environment shader lives in a reusable module that owns the scene background and
synchronizes sun, sky-fill, and ground-fill lighting across terrain, near-field bubble
chunks, and grass. It is visual-only and does not participate in CLOD selection or validation.

The **terrain color** folder provides brightness, contrast, saturation, and warmth controls.
They adjust terrain albedo before lighting, without affecting the normal-colour or normal
divergence debug modes. This makes texture and LOD readability quick to tune without
editing texture assets; the reset action restores the current visual defaults.

The **postprocess** folder controls a small manual render-target pipeline. `copy` mode
shows the rendered scene with only copy opacity applied, while `output` mode adds final-pass
exposure, contrast, saturation, and vignette controls. Turning the feature off, or selecting
`off` mode, renders the scene directly. This is visual-only and does not affect CLOD
selection or validation.

The top toolbar exports a versioned project ZIP containing `project.json`, an all-LOD
`terrain.glb`, and any custom texture source files. Import validates and stages that archive,
reloads at its saved world size, rebuilds terrain from the saved terraform edits, and restores
the GUI, texture slots, grass settings, and orbit camera. Built-in demo textures remain stable
ID references and are not duplicated in the archive. The GLB groups every page by LOD and is
intended for geometry interchange; `project.json` is authoritative for editable round-trips.

The **near-field bubble** folder (§4.4): pages intersecting the bubble are force-split to
LOD0, and inside the radius a LOD0 page is drawn as its raw chunks instead of the welded
page mesh. With "tint bubble red" OFF the edge must be **invisible** (raw chunks ===
welded LOD0) — toggle the bubble and nothing should change; with tint ON you see which
pages it owns. The overlay shows the live cut (nodes per level, tris rendered, 2:1 forced
splits, and bubble forced splits). Move the camera and watch near pages refine to LOD0
while far pages stay coarse. The **world size** selector (or `?world=8`, `?world=16`,
`?world=32`) loads larger worlds in-browser and shows a build progress panel while LOD0
pages and parent LOD nodes are generated. With the current `quadtree_levels: 4`, 8×8 is
the first full LOD0→LOD3 gate world; 16×16 and 32×32 keep the same max LOD but produce
more LOD3 roots and can still freeze briefly inside individual node builds. Get close to
one corner, then toggle the 2:1 constraint to see large neighbor LOD deltas appear and get
bounded.

The **digging** folder ports the engine's terrain-lower tool (`src/terrain/tools/`):
click the terrain to carve a sphere of air. In orbit mode a click-without-drag digs at
the cursor; in player mode a click digs at the crosshair, **holding** the button keeps
digging on a fixed cadence, and **Shift+wheel** adjusts the radius (mirroring the
engine's Shift+scroll). A translucent sphere previews the carve at the current aim
point. Player movement uses acceleration-based horizontal control with reduced air
control, plus coyote time and jump buffering, so cave hopping feels intentional. Each dig is a CSG subtraction on the global
density field with a bedrock guard at y=1, so halo recomputation stays byte-identical and
all weld/border invariants hold. The dug LOD0 pages are rebuilt synchronously, every
ancestor is re-simplified (merge → weld → lock → simplify with the same hard-fail
validation), the collider BVHs are refreshed (you can walk into the cave), and any cached
near-field raw chunks are invalidated. The overlay's `dig:` line and the console report
the per-edit cost breakdown — LOD0 page rebuild, parent re-simplify, collider — which is
the number this experiment exists to measure: what a single terrain edit costs under
CLOD's "decimate, never re-extract" rule. Digging below the surface carves real caves;
the LOD1+ cuts show the simplified cave mouths. Known limits: grass placement is not
re-sampled after digs (blades can float over holes), and single-vertex Surface Nets still
can't split two surface sheets inside one cell, so very thin walls between digs can look
chunky (a PoC mesher limit, not a CLOD one; the engine's mesher handles caves).

Not yet built: floating per-node error labels + locked-border highlight.

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
