# Sprint 11 — Rendering, lighting, atmosphere, and diagnostics panels

Phase: 3 — Domain-specific systems

## Goal
Expose rendering systems as editor controls and debug panels.

## Subtasks
- Add `RenderingSettingsPanel`.
- Add render quality dropdown:
  - Low
  - Medium
  - High
  - Performance100
- Add quality-derived readouts:
  - water reflection resolution scale
  - water reflection update interval
  - water reflection distance
  - prop LOD distance scale
  - shadow quality
  - terrain material quality
- Add panels for:
  - GTAO
  - SSAO
  - baked AO
  - adaptive GI
  - radiance cascades
  - fog
  - god rays
  - volumetric clouds
  - shadow budget
  - ray tracing
  - photo mode
  - cinematic mode
  - render timings
  - GPU capabilities
- Add `ProfilerPanel`:
  - frame time graph
  - render timing table
  - counters
  - warnings
  - dirty chunks
  - prop instances
  - water reflection status
- Add `ConsolePanel`:
  - severity
  - source
  - message
  - timestamp
  - filter chips
- Add debug commands:
  - toggle GTAO debug
  - toggle shadow budget view
  - open render timings
  - open graphics capabilities
  - toggle ray tracing mock
  - toggle photo mode mock

Runtime rendering already includes GTAO, SSAO, cinematic/photo mode, enhanced water, water reflection, water compositor, water visual probe, water displacement, god rays, shadow budget, triplanar/blocky/building/props materials, and billboard materials.

## Acceptance criteria
- Render quality dropdown updates state.
- Profiler table shows mocked render timings.
- Debug panels are discoverable from command palette.
- Inspector can show selected debug resource.
- Agent observation includes render warnings and active quality preset.
