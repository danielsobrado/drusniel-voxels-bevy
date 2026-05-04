# Sprint 17 — Protected areas runtime implementation

Phase: 5 — Runtime integration

## Goal
Turn protected/unbreakable areas from editor-only data into enforced game rules.

## Subtasks
- Add Bevy resource:
  - `ProtectedAreaRegistry`
  - `ProtectedAreaRule`
  - `ProtectedAreaShape`
  - `ProtectedAreaKind`
- Add serialization:
  - save/load world rules
  - schema version
  - migration path
- Add spatial query:
  - point in area
  - voxel in area
  - chunk intersects area
  - prop placement intersects area
- Enforce rules:
  - mining blocked
  - block placement blocked
  - painting blocked
  - prop scatter blocked
  - water editing blocked
  - quest lock override
- Add debug gizmos.
- Add editor bridge commands:
  - create area
  - update area
  - delete area
  - query rules at voxel
  - validate area conflicts
- Add tests for rule enforcement.

## Acceptance criteria
- Unbreakable area prevents voxel modification.
- No-build area prevents placement.
- No-prop area prevents scatter.
- Editor can create and edit areas.
- Agent can verify protected voxels cannot be modified.
