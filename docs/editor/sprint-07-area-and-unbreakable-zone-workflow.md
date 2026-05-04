# Sprint 7 — Area and unbreakable-zone workflow

Phase: 2 — Core Editor Workflows

## Goal
Build the first world-editing workflow: protected/unbreakable areas.

## Subtasks
- Create editor-side `ProtectedArea` model.
- Add area kinds:
  - unbreakable
  - no_dig
  - no_build
  - no_props
  - quest_lock
  - spawn_protection
  - custom
- Add area shapes:
  - box
  - sphere
  - cylinder
  - chunk set
  - polygon placeholder
- Implement commands:
  - create unbreakable box
  - create no-build zone
  - create no-dig zone
  - duplicate area
  - delete area
  - lock/unlock area
  - focus selected area
- Add `AreaModeToolbar`.
- Add area overlay visualization.
- Add conflict warnings:
  - overlapping areas
  - equal priority conflict
  - locked but editable
  - missing name
- Add audit log placeholder.
- Add export format design (JSON or RON/YAML world-rule file).
  - later consumed by Bevy

## Acceptance criteria
- Command palette can create an unbreakable area.
- New area appears in outliner.
- Inspector switches to `ProtectedAreaInspector`.
- Area bounds are editable.
- Rule matrix updates state.
- Playwright test verifies full flow.

This sprint is important because protected areas are central to your editor idea, but they appear to be a new feature rather than an existing runtime resource in the retrieved code.
