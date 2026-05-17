# Fast authoring viewport plan

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

This plan defines the editor viewport as a fast authoring surface, not as a second game renderer.

## Viewport split

The editor should use two viewport roles:

- **ThreeJS / React authoring viewport**: the default editing surface for fast navigation, voxel selection, protected crust visibility, voxel material painting, texture assignment previews, brush previews, chunk bounds, voxel grids, and dirty chunk feedback.
- **Bevy native validation viewport**: the real game renderer for checking water, fog, shadows, GTAO, reflections, props, lighting, cinematics, diagnostics, screenshots, and final visual fidelity.

The ThreeJS viewport must stay deliberately simple. It should not reproduce the Bevy renderer, shader stack, prop renderer, water pipeline, compositor, lighting model, cinematic/photo mode, or post-processing features. Its job is immediate editing feedback and clear authoring state. Bevy remains the source of truth for final runtime validation.

## Existing alignment

This split matches the current editor roadmap:

- Sprint 6 already defines the viewport shell, overlays, selected outline, brush preview, grid toggles, and chunk/protected-area visibility.
- Sprint 7 already focuses on protected and unbreakable area workflows.
- Sprint 8 already focuses on voxel paint and texture atlas workflows.
- The runtime bridge already exposes viewport snapshots, runtime commands, atlas mapping, protected area commands, and `/assets/textures/atlas.png`.

The current `BevyCanvasHost` should remain the outer wrapper/orchestrator. It already owns the native Bevy attachment path, browser preview fallback, viewport snapshot consumption, overlays, and editor integration points. The browser preview implementation should evolve into a lightweight ThreeJS/R3F component named `LiteVoxelViewport`.

## Data contracts

Use the existing editor/runtime data contracts instead of inventing a new world format:

- `ViewportSnapshot`
- `ViewportMeshPayload`
- `ViewportMeshBuffer`
- `ProtectedArea`
- `BlockAtlasMap`
- `/editor/viewport/snapshot`
- `/assets/textures/atlas.png`
- Runtime commands for voxel edits, atlas mapping, and protected area rule operations

Suggested frontend module shape:

```text
editor/frontend/src/features/viewport/
  BevyCanvasHost.tsx          # wrapper/orchestrator, native validation host
  LiteVoxelViewport.tsx       # ThreeJS/R3F authoring viewport
  voxelGeometry.ts            # ViewportMeshBuffer -> BufferGeometry conversion
  voxelPicking.ts             # raycast -> voxel coordinate / face
  voxelEditPreview.ts         # local optimistic brush/edit previews
  protectedAreaMeshes.ts      # protected/unbreakable overlay geometry
```

Dependency decision:

- Add `three`.
- Add `@react-three/fiber`.
- Add `@react-three/drei` only if controls or helpers materially reduce local code.

## Runtime data flow

```text
Bevy runtime
  -> /editor/viewport/snapshot
  -> ViewportSnapshot
  -> LiteVoxelViewport

User edit
  -> local optimistic viewport patch
  -> runtime command
  -> Bevy marks affected chunks dirty and rebuilds
  -> refreshed snapshot or dirty chunk update
  -> LiteVoxelViewport replaces only affected chunk geometry
```

ThreeJS should treat protected/unbreakable areas as a rule overlay, not as geometry ownership. It may display and edit these areas, but it must not imply durability beyond the runtime rule system.

Important persistence warning: `world_data.bin` currently persists chunks, voxels, and face visibility. It does not currently persist protected areas or unbreakable zones. Protected/unbreakable areas must not be treated as durable game rules until the rules-file/schema or runtime persistence path is implemented and verified.

## Phases

### Phase 0: Contract and scope lock

- Document the authoring/validation split in editor docs.
- Make `LiteVoxelViewport` the intended browser/authoring implementation and keep `BevyCanvasHost` as the wrapper.
- State non-goals clearly: no GTAO, no reflections, no fog, no water shader, no real prop renderer, no physics, no full Bevy material fidelity, and no global remesh on mouse move.
- Confirm ThreeJS consumes `ViewportSnapshot` and runtime/editor state only. It must not introduce a second serialized world format.
- Record the protected area persistence warning as a hard implementation constraint.

### Phase 1: Lite viewport shell

- Replace the 2D canvas browser preview path with `LiteVoxelViewport`.
- Preserve `data-testid="bevy-canvas-host"` on the wrapper for existing tests and future native mounting.
- Render static terrain and water from `ViewportMeshBuffer` payloads.
- Convert payload positions, normals, UVs, colors, and indices into `THREE.BufferGeometry`.
- Preserve existing viewport affordances: fit loaded world, zoom/orbit, pan/navigation, status labels, and minimap/count readouts.
- Keep current native Bevy attachment behavior available for desktop validation mode.

### Phase 2: Authoring overlays

- Add overlay layers for voxel grid, chunk bounds, protected area volumes, selected object outline, brush radius, affected voxels, invalid target tint, and dirty chunk highlights.
- Drive overlay visibility from existing editor overlay state and command toggles.
- Render protected areas as transparent boxes, spheres, cylinders, chunk-set outlines, and polygon placeholders.
- Keep overlays lightweight and disposable. They should communicate editor rules and diagnostics, not become gameplay state.

### Phase 3: Picking and local edit preview

- Implement raycast picking from the ThreeJS scene to voxel coordinate and selected face.
- Support select, sculpt, paint, area, props, water, measure, and camera modes through the existing active mode/tool state.
- Add local optimistic previews for brush edits, material paint, selected face, and invalid targets.
- Send actual mutations through runtime commands such as voxel edits, atlas mapping, and protected area updates.
- Reconcile optimistic state after the runtime response. Rejected edits must clear the preview and surface the runtime rejection reason.
- Replace only dirty chunk geometry after refreshed snapshot data arrives. Do not rebuild the whole visible world on every pointer move.

### Phase 4: Texture atlas preview

- Load `/assets/textures/atlas.png` for authoring previews.
- Use nearest-neighbor sampling and simple face materials for block previews.
- Apply `BlockAtlasMap` to grass, dirt, rock, and sand top/side/bottom preview faces.
- Keep Bevy as the source of truth for texture array rebuild and save behavior.
- When atlas mapping changes, preview immediately in ThreeJS, then use runtime atlas commands to rebuild/save.

### Phase 5: Bevy validation mode

- Expose a clear viewport mode switch between authoring and validation:
  - **Authoring**: `LiteVoxelViewport`, default.
  - **Validate / Play / Preview**: native Bevy viewport.
- Use native Bevy for water, fog, shadows, GTAO, reflections, props, lighting, cinematics, diagnostics, screenshots, and visual regression checks.
- Keep any renderer-quality controls pointed at Bevy/runtime state. They should not change the ThreeJS authoring renderer except for simple diagnostic overlays.

### Phase 6: Performance and verification

- Add frontend coverage for viewport mounting, overlay toggles, protected area visibility, atlas preview, dirty chunk replacement, and basic picking.
- Add Playwright smoke coverage for authoring interactions.
- For editor UI-only changes, run:

```bash
rtk npm run typecheck
rtk npm run test:unit
rtk npm run test:smoke
```

- For changes that affect the editor runtime sidecar, Bevy runtime, Tauri integration, viewport behavior, or editor-visible UI, rebuild the editor runtime sidecar and restart the desktop editor before reporting verification.
- For changes that can affect rendering, terrain meshing, props, shadows, water, post-processing, or frame timing, follow the repo profiling workflow:

```bash
rtk cargo run --release -- --bench bench/scenes/visual/visual-regression.toml
```

- Compare `bench-runs/<run>/summary.json`, inspect fixed checkpoint screenshots for visual changes, and run `bench_guard` when the change touches known bottlenecks.

## Acceptance criteria

- The default editor viewport is a fast ThreeJS/R3F authoring view.
- The native Bevy viewport remains available as the validation view.
- ThreeJS consumes existing runtime/editor contracts and does not create a new world format.
- Voxel selection, brush preview, protected area overlays, chunk/grid overlays, dirty chunk feedback, and atlas previews are visible in the authoring viewport.
- Runtime commands remain the source of truth for actual voxel, protected area, and atlas changes.
- Protected/unbreakable areas are not represented as durable game rules until their persistence path is implemented.

