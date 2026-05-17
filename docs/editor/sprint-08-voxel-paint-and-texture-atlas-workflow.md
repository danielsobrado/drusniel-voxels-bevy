# Sprint 8 � Voxel paint and texture atlas workflow

Document status (2026-05-17): planning record; use for rationale and sequencing, not as current execution instructions unless reconciled with code first.

Phase: 2 � Core Editor Workflows

## Goal
Build the material/atlas editing loop around the real block atlas mapping.

## Subtasks
- Implement `TextureAtlasPanel`.
- Add 8x8 or dynamic atlas grid.
- Add tile selection.
- Add block mapping editor:
  - grass top/side/bottom
  - dirt top/side/bottom
  - rock top/side/bottom
  - sand top/side/bottom
- Add `VoxelPalette`.
- Add `BlockPreview3D` using React Three Fiber.
- Add commands:
  - select atlas tile
  - assign tile to top
  - assign tile to side
  - assign tile to bottom
  - mark atlas mapping dirty
  - mock rebuild texture array
  - mock save atlas mapping
- Add material inspector:
  - blocky material
  - triplanar material
  - building material
  - props material
  - water material
- Add mocked save-to-YAML behavior.

Your Bevy code already treats atlas mapping as runtime-editable and saveable to YAML, and uses a needs_rebuild flag to rebuild the texture array after mapping changes.

## Acceptance criteria
- User can click atlas tile.
- User can assign tile to grass top/side/bottom.
- Dirty state appears.
- Mock �Rebuild Texture Array� clears dirty state.
- Mock �Save Mapping� produces serialized YAML preview.
