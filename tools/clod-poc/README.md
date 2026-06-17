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

The local dev URL uses the GitHub Pages base path:

```text
http://127.0.0.1:5173/drusniel-voxels-web/
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

## Terrain Editing

The digging controls carve or raise terrain from the global density field. Edited LOD0
pages are rebuilt, ancestors are re-simplified, collider BVHs are refreshed, and cached
near-field chunks are invalidated.

The overlay reports the per-edit cost breakdown for LOD0 rebuilds, parent rebuilds, and
collider refreshes.

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
| `config/audio_events.yaml` | Audio event settings |
| `config/content/` | Materials, biomes, texture slots, snap pieces, and debug presets |
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
