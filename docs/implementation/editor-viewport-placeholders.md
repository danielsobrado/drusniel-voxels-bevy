# Editor Viewport Placeholders

Document status (2026-05-17): current technical note; verify file paths against code when editing.

## Status

Classified as legacy/mock frontend code; no runtime code change made.

## Finding

The placeholder SVG voxel scene exists in the root-level legacy editor files:

- `editor/frontend/voxel-scene.jsx`
- `editor/frontend/viewport.jsx`
- `editor/frontend/refinements.jsx`
- `editor/frontend/Drusniel Voxels Editor.html`
- `editor/frontend/Drusniel Voxels Editor v2.html`

The active Vite/Tauri frontend path uses the TypeScript/React source under `editor/frontend/src`. Its viewport panel imports `BevyCanvasHost`, which renders `LiteVoxelViewport` for authoring and supports the native Bevy viewport role.

## Decision

No placeholder removal was made in this pass because deleting the root-level JSX/HTML mock files could break historical design-review artifacts or standalone mock launches. The important distinction is that those files are legacy/mock assets, not evidence that the active editor viewport is only an SVG placeholder.

## Verification

Source references were checked with:

```powershell
rtk rg --no-ignore --glob '!editor/frontend/dist/**' --glob '!editor/frontend/src-tauri/target/**' -n "voxel-scene|VoxelScene|LiteVoxelViewport|BevyCanvasHost" editor/frontend
```

The release Rust library compile also passed after the code changes in this implementation pass:

```powershell
rtk cargo check --release --lib --quiet
```

## Profiling

Not applicable. No active editor runtime or rendering code was changed for this classification item.
