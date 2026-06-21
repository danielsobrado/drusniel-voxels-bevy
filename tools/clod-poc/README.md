# Drusniel CLOD Pages

Standalone Three.js/TypeScript voxel terrain viewer and CLOD page builder.

The app builds a page quadtree from deterministic chunk meshes, welds internal borders,
locks outer page borders, simplifies pages with `meshoptimizer`, and renders the active
runtime cut in the browser.

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

The local dev server is pinned to port 5180:

```text
http://127.0.0.1:5180/
```

For the high-load CLOD/WebGPU selection path, use:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

Convenience scripts are available:

```bash
scripts/startLocal.sh
scripts/startLocal.sh --skip-build
```

```powershell
.\scripts\startLocal.ps1
.\scripts\startLocal.ps1 -SkipBuild
```

## Checks

```bash
npm run typecheck
npm test
npm run build
```

`npm run build-pages` runs the headless page builder and prints per-level triangle counts,
build timing, border checks, reduction metrics, and validation status.

```bash
npm run build-pages
npm run build-pages 8
```

`npm run spike` verifies the `meshoptimizer` API behavior used by the builder.

The clod-poc QA harness consumes a web summary JSON and writes JSON/Markdown reports.
Use the sample summary as a smoke check:

```bash
npm run qa -- --summary tests/qa-sample-summary.json
```

To write reports to a named folder:

```bash
npm run qa -- --summary tests/qa-sample-summary.json --output qa-runs/local-smoke
```

## GitHub Pages

The production build is configured for:

```text
https://danielsobrado.github.io/drusniel-voxels-web/
```

The workflow at `.github/workflows/deploy-pages.yml` runs typecheck, tests, build, and
publishes `dist` through GitHub Pages. In the repository settings, set Pages deployment
source to GitHub Actions.

To preview the production build locally:

```bash
npm run build
npm run preview
```

To publish `dist` manually to the `gh-pages` branch:

```bash
scripts/publishPages.sh
scripts/publishPages.sh --skip-tests
```

```powershell
.\scripts\publishPages.ps1
.\scripts\publishPages.ps1 -SkipTests
```

## Viewer

The browser viewer builds a terrain world, selects visible CLOD pages each frame, and
shows runtime diagnostics for the active cut.

Available controls include:

- Screen-space error threshold
- Hysteresis-based page selection
- Optional 2:1 restricted quadtree selection
- Page boundary boxes
- Wireframe overlay
- Colour by LOD
- Normal-colour and recomputed-normal diagnostics
- Same-LOD seam points
- Floating per-node error labels
- Locked-border vertex highlights
- Procedural sky and lighting controls
- Terrain texture slots and height-band blending
- Terrain colour adjustment
- Postprocess controls
- Near-field bubble visualization
- Digging and raising terrain edits
- Player and orbit camera modes
- Fake water clipmap (lake/river visual POC)

## Terrain Editing

The digging controls carve or raise terrain from the global density field. Edited LOD0
pages are rebuilt, ancestors are re-simplified, collider BVHs are refreshed, and cached
near-field chunks are invalidated.

The overlay reports the per-edit cost breakdown for LOD0 rebuilds, parent rebuilds, and
collider refreshes.

## Water (fake clipmap)

A visual POC water layer (`config/water.yaml`, `src/water/`) renders fake lakes and
rivers as a clipmap that follows the camera. It is not hydrology, not
main Rust Bevy water, and not production water: no SSR, planar reflections,
caustics, or physics in this first pass.

The water layer is strictly separate from the CLOD page pipeline:

- Water meshes are a dedicated render layer and are never included in CLOD page
  source meshes, meshoptimizer simplification, page borders, page LOD selection,
  terrain colliders, or page validation.
- The dependency direction is scene -> water, never pages -> water.
- A page-source signature assertion (`src/water/water.test.ts`) guards that
  building and updating the water clipmap does not mutate page mesh signatures.

Each clipmap level is a square grid (`cells_per_level + 1` vertices per edge) at a
configured cell size. Per frame, after camera movement, every level snaps its
origin to `cell_size * snap_cells` and refills vertex Y from the `WaterField`
(`terrainY - dry_sentinel_depth` in dry areas, flat lake level, sloped river
level). The shader discards pixels inside the previous (finer) level's world
rectangle so only the ring between levels is drawn. Dry vertices (depth <= 0) are
also discarded, so dry areas never show water above terrain.

The `WaterField` exposes `waterYAt`, `depthAt`, `flowAt`, and `bodyMaskAt` and
reads terrain height through a small adapter over `surfaceHeight`. Lakes are flat
at `terrainHeight(center) + level_offset`; rivers use a capsule distance to the
polyline with a sloped level via `downstream_drop`; lake flow is near-zero with a
faint breeze fallback in the material, river flow follows the closest segment.

Controls (lil-gui "water (fake clipmap)" folder):

- `enabled` — show/hide the water layer.
- `debug mode` — `0 final`, `1 water depth`, `2 foam`, `3 fresnel`, `4 body mask`,
  `5 clipmap level color`.
- `depth write` — toggle water depth writes (off by default to avoid transparent
  sorting artifacts with grass).

The existing "freeze selection" toggle freezes CLOD page selection while water
keeps following the camera, because the water update runs every frame independent
of the freeze flag.

## Project Archives

The top toolbar can export a project ZIP containing:

- `project.json`
- An all-LOD `terrain.glb`
- Custom texture source files

Import validates the archive, reloads the saved world size, rebuilds terrain from saved
edits, and restores the GUI, texture slots, grass settings, and orbit camera.

## Project Layout

| Path | Role |
|---|---|
| `config/clod_pages.yaml` | CLOD page and selection settings |
| `config/water.yaml` | Fake water clipmap settings (lakes, rivers, visuals, debug) |
| `config/audio_events.yaml` | Audio event settings |
| `config/content/` | Materials, biomes, texture slots, snap pieces, and debug presets |
| `src/water/` | Fake water clipmap: config, field, material, clipmap, debug |
| `src/terrain.ts` | Deterministic terrain field and chunk meshing |
| `src/source_mesh.ts` | LOD0 page source mesh assembly |
| `src/weld.ts` | Spatial-hash vertex welding |
| `src/lock.ts` | Outer-border lock detection |
| `src/simplify.ts` | `meshoptimizer` integration |
| `src/quadtree.ts` | Page hierarchy build and rebuild logic |
| `src/selection.ts` | Runtime page-cut selection |
| `src/validate.ts` | Border, degenerate triangle, and mesh validation |
| `src/main.ts` | Browser viewer entry point |
| `textures/` | Built-in terrain textures |
