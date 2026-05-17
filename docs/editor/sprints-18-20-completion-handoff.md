# Editor sprints 18-20 completion handoff

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Date: 2026-05-04

## Included

- Sprint 18 now has a frontend persistence safety layer on top of the existing mock/backend save flow:
  - `editor.file.loadDefaultWorld` and `editor.file.save` keep their existing backend-client behavior.
  - `editor.file.saveSnapshot` records the runtime snapshot request and stores a frontend editor state snapshot.
  - `editor.history.undo` and `editor.history.redo` restore editor state snapshots captured before undoable area, water, props, material, and stress commands.
  - `editor.snapshot.create` and `editor.snapshot.restoreLatest` expose manual editor checkpoints.
- Sprint 19 now has large-world guardrails for the current React-only editor:
  - `editor.performance.loadLargeMockWorld` loads 960 chunks, 4,200 props, 180 protected areas, 96 water bodies, and 1,200 console rows.
  - The World Outliner caps initial rendering to 500 matching nodes and asks the user to filter/search when the list is larger.
  - The Console panel caps visible rows to the newest 250 entries.
- Sprint 20 now has agent and handoff affordances:
  - Agent Workbench shows history/snapshot counts, large-world readiness, and the current handoff boundary.
  - `editor.help.showHandoff` records the implementation boundary in the agent timeline.
  - Toolbar and menubar expose load, save, snapshot, undo/redo, large mock world, and help commands.

## Not included

- A local React-to-Bevy runtime bridge is now available, but it is opt-in:
  - Start Bevy with `DRUSNIEL_EDITOR_BRIDGE=1` to expose `http://127.0.0.1:17777`.
  - Start the frontend with `VITE_DRUSNIEL_RUNTIME_BRIDGE=local-http`, add `?runtimeBridge=local-http`, or set `localStorage["drusniel.editor.runtimeBridge"] = "local-http"` to install `window.drusnielRuntime`.
  - Override the bridge URL with `DRUSNIEL_EDITOR_BRIDGE_ADDR` on the Bevy side and `VITE_DRUSNIEL_RUNTIME_BRIDGE_URL` or `localStorage["drusniel.editor.runtimeBridgeUrl"]` on the frontend side.
- The React editor still renders the mock viewport and mock world summaries. It does not render the binary `world_data.bin` voxel chunks directly.
- Frontend snapshots are in-memory editor state checkpoints, not a new disk format.
- No new voxel world file format was introduced.
- Props and explicit water-body overrides remain editor/mock-domain state. Runtime commands now cover render quality, water reflection debug/probe, chunk rebuild, atlas mapping, and protected area rule operations when the local bridge is enabled.

## Verification

- Unit coverage includes undo/redo, explicit snapshots, large mock world loading, backend save/load command routing, command registration, and serialization boundaries.
- Smoke coverage exercises the editor world flow through Playwright and captures screenshots in Playwright test output.
- Rust-side protected area checks are validated separately from these frontend sprint additions.
