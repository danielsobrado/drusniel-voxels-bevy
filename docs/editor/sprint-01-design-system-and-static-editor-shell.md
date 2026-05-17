# Sprint 1 � Design system and static editor shell

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 1 � Editor Shell MVP

## Goal
Convert the visual design into reusable UI primitives, not a giant one-file mockup.

## Subtasks
- Add design tokens:
  - background colors
  - panel colors
  - border colors
  - status colors
  - typography scale
  - spacing
  - control heights
  - z-index layers
- Build shared components:
  - `PanelTitleBar`
  - `StatusPill`
  - `IconButton`
  - `ToolbarButton`
  - `SegmentedControl`
  - `InspectorSection`
  - `PropertyRow`
  - `Vector3Field`
  - `AgentHint`
  - `EmptyState`
  - `PanelSearchInput`
- Build top-level layout:
  - `App`
  - `AppShell`
  - `EditorMenubar`
  - `MainToolbar`
  - `DockLayout`
- Add docked panels with placeholder content:
  - `ViewportPanel`
  - `WorldOutlinerPanel`
  - `InspectorPanel`
  - `AssetBrowserPanel`
  - `ConsolePanel`
  - `ProfilerPanel`
  - `AgentWorkbenchPanel`
- Add dockview-react layout persistence to localStorage.
- Add deterministic data-testid values to all major regions.

## Acceptance criteria
- App visually matches the design direction.
- Dock layout appears.
- Panels can be resized/docked.
- Refreshing the page preserves layout.
- Playwright can find:
  - `editor-menubar`
  - `main-toolbar`
  - `viewport-panel`
  - `world-outliner-panel`
  - `inspector-panel`
  - `asset-browser-panel`
  - `agent-workbench-panel`
