# Sprint 9 � Water body editor

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 3 � Domain-specific systems

## Goal
Make water one of the strongest parts of the editor.

## Subtasks
- Implement full `WaterBodyInspector`.
- Add water body list in outliner.
- Add water debug modes:
  - off
  - mask
  - reflection only
  - blend factor
- Add reflection status panel:
  - active
  - sampled
  - reason
  - resolution scale
  - effective Hz
  - nearest water distance
  - visible water meshes
  - eligible meshes
- Add commands:
  - open reflection debug
  - toggle reflection mask
  - run water visual probe
  - focus nearest water body
  - classify selected water as lake
  - classify selected water as river
  - classify selected water as ocean
  - classify selected water as pond
- Add water preset cards:
  - Ocean
  - Lake
  - River
  - Pond
- Add mocked WaterVisualProbe output panel.
- Add viewport overlays:
  - water mask
  - reflection camera bounds
  - water body ID
  - material mode
  - near/far water material

Runtime already has water-body kinds, reflection status, debug view modes, mask stats, water presence, water material params, and a visual probe plugin, so mirror those directly.

## Acceptance criteria
- Selecting a lake shows lake settings.
- Debug mode can switch between off/mask/reflection/blend.
- Water visual probe panel shows structured mocked output.
- Agent can suggest `editor.water.runVisualProbe`.
