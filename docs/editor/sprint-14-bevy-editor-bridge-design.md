# Sprint 14 � Bevy editor bridge design

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 5 � Runtime integration

## Goal
Define the contract between React and Bevy before wiring it.

## Subtasks
- Choose integration approach:
  - Tauri commands
  - local WebSocket
  - local HTTP server
  - embedded webview + Bevy process
  - separate editor frontend controlling game runtime
- Create `types/runtime.ts`.
- Define runtime messages:
  - `RuntimeSnapshot`
  - `EditorCommandRequest`
  - `EditorCommandResult`
  - `SelectionChanged`
  - `ChunkUpdated`
  - `WaterProbeDump`
  - `RenderTimingUpdate`
  - `AtlasMappingChanged`
  - `ProtectedAreaRulesChanged`
- Define Bevy ? React events:
  - selected voxel
  - selected prop
  - selected water body
  - targeted block
  - dirty chunks
  - render metrics
  - console logs
  - water visual probe result
- Define React ? Bevy commands:
  - select entity
  - focus camera
  - rebuild chunk
  - set atlas mapping
  - create protected area
  - update protected area
  - run water visual probe
  - set water reflection debug mode
  - set render quality
  - save snapshot
- Add mocked `RuntimeClient`.
- Keep real runtime disabled behind a feature flag.

## Acceptance criteria
- UI uses `RuntimeClient` interface, not direct mock imports.
- Mock runtime works exactly like previous sprints.
- No Bevy code needs to change yet.
- Runtime contract is documented.
