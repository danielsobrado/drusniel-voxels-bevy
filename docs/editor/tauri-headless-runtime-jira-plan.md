# Tauri Editor Headless Runtime Delivery Plan

## Goal

Move the editor to a production desktop architecture where Tauri owns the editor window and the Bevy runtime runs as a backend process without opening its own editor window. The Tauri viewport renders runtime-provided world data inside the editor UI.

This plan intentionally avoids embedding Bevy's native WGPU surface into the Tauri webview. That path is platform-specific and brittle. The production path is a sidecar/runtime protocol: Bevy owns world state and mesh generation; Tauri owns UI, process lifecycle, and viewport presentation.

## Architecture Target

```text
Tauri desktop app
  React editor shell
  Canvas/WebGPU viewport
  command palette / inspector / dock UI
  sidecar lifecycle manager

        local IPC / localhost protocol

Bevy editor runtime
  no editor window
  VoxelWorld loading and mutation
  chunk meshing and material metadata
  runtime commands and snapshots
  viewport payload streaming
```

## JIRA Tickets

### DVX-EDT-101: Add Bevy Editor Runtime Mode

**Type:** Story  
**Priority:** P0  
**Owner:** Runtime  

Create a dedicated runtime mode that starts Bevy as an editor backend instead of the normal playable app.

**Scope**

- Add CLI/env entry point, for example `cargo run -- --editor-runtime` and `DRUSNIEL_EDITOR_RUNTIME=1`.
- Disable native game window creation in editor runtime mode.
- Keep ECS resources required for world loading, terrain state, meshing, atlas/material metadata, and runtime command handling.
- Skip player input, camera capture, game UI, menu UI, and systems that require a native swapchain.
- Keep existing game mode unchanged.

**Acceptance Criteria**

- `cargo run -- --editor-runtime` starts without opening a Bevy window.
- Runtime bridge is available and returns `/health`.
- Runtime can load `world_data.bin` and report chunk count.
- Normal `cargo run` still opens the playable Bevy app.

**Verification**

- `cargo check`
- `cargo run -- --editor-runtime` manual smoke
- `Invoke-RestMethod http://127.0.0.1:17777/health`
- Existing Playwright editor shell suite remains green.

---

### DVX-EDT-102: Add Tauri Sidecar Lifecycle Management

**Type:** Story  
**Priority:** P0  
**Owner:** Desktop  

Have Tauri start and stop the Bevy editor runtime automatically.

**Scope**

- Configure Tauri external binary/sidecar packaging for the editor runtime.
- On app startup, launch the runtime with editor-mode flags.
- Detect port readiness before the React app attempts world sync.
- On app shutdown, terminate the sidecar cleanly.
- Surface startup failures in a visible editor status panel.

**Acceptance Criteria**

- `pnpm run dev:desktop` starts the Tauri shell and launches the runtime automatically.
- No separate Bevy game window appears in editor mode.
- Runtime shutdown leaves no orphaned backend process.
- If the runtime cannot start, the editor shows an actionable error rather than falling back silently.

**Verification**

- `pnpm exec tauri build --debug --no-bundle`
- Manual start/close process check in Task Manager or `Get-Process`
- Runtime unavailable error path Playwright test.

---

### DVX-EDT-103: Define Runtime Viewport Payload Protocol

**Type:** Story  
**Priority:** P0  
**Owner:** Runtime + Frontend  

Replace coarse surface samples with a versioned viewport payload that can support real terrain visualization.

**Scope**

- Add `GET /editor/viewport/snapshot`.
- Add protocol versioning.
- Include world bounds, chunk coordinates, mesh generation state, dirty state, material atlas references, water mesh metadata, and camera defaults.
- Add chunk-level payload IDs for incremental updates.
- Keep current `WorldSummary.viewport` as a lightweight fallback until full mesh payloads are stable.

**Acceptance Criteria**

- Frontend can request a complete viewport snapshot after loading a world.
- Payload is bounded and paginated or chunk-filtered for large worlds.
- Payload schema has TypeScript and Rust definitions.
- Unsupported protocol versions return a typed error.

**Verification**

- Rust unit tests for serialization shape.
- TypeScript schema tests for payload parsing.
- Manual load of existing `world_data.bin`.

---

### DVX-EDT-104: Stream Chunk Mesh Data To The Tauri Viewport

**Type:** Story  
**Priority:** P1  
**Owner:** Runtime  

Expose mesh buffers from the Bevy meshing path for editor rendering.

**Scope**

- Reuse existing terrain meshing code where possible.
- Export per-chunk vertex positions, normals, UV/material indices, index buffers, and water meshes.
- Add mesh payload compression or binary transfer path if JSON becomes too heavy.
- Add dirty chunk rebuild events.
- Include mesh stats for inspector/profiler panels.

**Acceptance Criteria**

- Loading a world produces visible chunk geometry in the Tauri viewport.
- Dirty chunk rebuild updates the viewport without full reload.
- Water mesh data is distinguishable from terrain mesh data.
- Large worlds do not block the UI thread while loading.

**Verification**

- Runtime payload size tests.
- Mesh count parity with Bevy internal chunk state.
- Playwright canvas nonblank check after world load.

---

### DVX-EDT-105: Upgrade The Frontend Viewport Renderer

**Type:** Story  
**Priority:** P1  
**Owner:** Frontend  

Move from the current canvas surface preview to a production viewport renderer inside Tauri.

**Scope**

- Evaluate WebGPU first, WebGL fallback if WebGPU availability is a blocker.
- Render terrain chunks from runtime mesh payloads.
- Add camera orbit/fly controls inside the editor viewport.
- Add selection picking by chunk/voxel/mesh entity.
- Keep 2D overlays for protected areas, water debug, and agent targets.
- Add frame timing and payload timing counters.

**Acceptance Criteria**

- The viewport renders loaded world geometry, not placeholder blocks.
- Pan/zoom/fit controls continue to work or are replaced by 3D camera equivalents.
- Click selection updates outliner and inspector.
- Blank-canvas regressions are caught by automated tests.

**Verification**

- Playwright screenshot and canvas pixel checks.
- Desktop smoke on Windows WebView2.
- Inspector selection workflow tests.

---

### DVX-EDT-106: Remove Silent Mock Fallback In Desktop Mode

**Type:** Story  
**Priority:** P0  
**Owner:** Frontend  

Desktop editor mode must fail visibly when the backend is unavailable.

**Scope**

- In Tauri, never instantiate `MockEditorBackendClient` or `MockRuntimeClient`.
- Add explicit `DesktopRuntimeUnavailable` state.
- Keep mock clients only for tests and browser-only development.
- Add status bar and command palette diagnostics for backend connectivity.

**Acceptance Criteria**

- Tauri desktop mode cannot show "mock loaded".
- Browser dev mode can still use mock clients intentionally.
- Runtime errors are visible and actionable.

**Verification**

- Unit tests for provider selection.
- Playwright test with bridge unavailable.
- Manual Tauri launch without sidecar.

---

### DVX-EDT-107: Package Editor Runtime With Tauri

**Type:** Story  
**Priority:** P1  
**Owner:** Desktop + Build  

Make the desktop editor distributable.

**Scope**

- Build the Bevy editor runtime binary as part of desktop packaging.
- Include sidecar binary in Tauri bundle.
- Add Windows-specific process and path handling.
- Add release/debug build scripts.
- Document required pagefile/commit settings for Rust builds on Windows until build memory pressure is reduced.

**Acceptance Criteria**

- `pnpm run build:desktop` produces a desktop bundle.
- Installed app starts Tauri and runtime without requiring a separate terminal.
- Runtime logs are written to a known editor log directory.

**Verification**

- `pnpm exec tauri build`
- Install/run packaged artifact on Windows.
- Confirm no separate Bevy window opens.

---

### DVX-EDT-108: Performance And Visual Regression Benchmarks

**Type:** Story  
**Priority:** P1  
**Owner:** Rendering + QA  

Measure runtime and editor viewport performance.

**Scope**

- Run the repo release bench before and after runtime/viewport changes:

```powershell
cargo run --release -- --bench bench/scenes/visual-regression.toml
```

- Compare `bench-runs/<run>/summary.json`.
- Add editor viewport timing counters for mesh payload decode, upload, and draw.
- Add visual screenshot checks for loaded world in Tauri.

**Acceptance Criteria**

- Performance claims cite specific timing rows and deltas.
- Visual regressions are documented or fixed.
- `bench_guard` passes for relevant runs.

**Verification**

```powershell
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

---

## Sequencing

1. Commit current Tauri scaffold, backend world loading, and data-driven viewport.
2. Deliver DVX-EDT-101 and DVX-EDT-106 together so editor runtime mode cannot silently mock.
3. Deliver DVX-EDT-102 so Tauri owns runtime startup.
4. Deliver DVX-EDT-103 and DVX-EDT-104 to move from surface samples to mesh payloads.
5. Deliver DVX-EDT-105 for production 3D viewport rendering.
6. Deliver DVX-EDT-107 packaging.
7. Run DVX-EDT-108 benchmark and visual signoff.

## Current Baseline Already In Place

- Tauri shell scaffold exists under `editor/frontend/src-tauri`.
- Frontend detects Tauri desktop mode and defaults to the local bridge.
- Browser file load uploads persisted world bytes to the backend.
- Backend can deserialize a real world, replace `VoxelWorld`, and return a data-driven viewport preview.
- The old placeholder block viewport has been replaced by a canvas renderer.

## Known Gaps

- Tauri does not yet launch Bevy as a sidecar.
- Bevy editor runtime mode is not implemented yet.
- The viewport renders sampled world surfaces, not full mesh buffers.
- Desktop mode still depends on the local bridge being started externally until DVX-EDT-102 lands.
- Release render benchmarks have not been run for the editor viewport work.
