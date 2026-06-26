# CLOD-POC Construction Reuse Audit

## Decision

Reuse the existing Drusniel construction architecture. Do not replace it with a direct port from RustLikeGame.

RustLikeGame is useful as a reference for the placement loop:

```text
select piece -> show ghost -> raycast -> snap candidate search -> validate -> place
```

The repository should not copy Unity code directly. The Drusniel Bevy runtime already has the higher-value pieces in engine-native form.

## Existing reusable code

The Bevy-side construction system already has:

- typed `SnapGroup` values instead of fragile string-only tags
- `BuildingPieceRegistry` with content-driven building pieces
- `SnapPointIndex` spatial hash for fast nearby snap queries
- ghost preview with valid, invalid, grounded, and stability states
- placement validation against voxels, protected areas, and coarse grid occupancy
- placed-piece graph connections
- event-driven structural stability propagation
- collapse handling for unstable pieces

These are reusable as design source for CLOD-POC.

## Gaps found

The existing Bevy implementation should be extended, not replaced:

1. YAML `compatible_groups` are loaded by content types but not currently honored by snap scoring.
2. Snapped placement allows same coarse grid cell, but does not yet do true oriented overlap tests against placed building pieces.
3. Ghost and placed geometry use simple cuboids even when a piece has a mesh path.
4. CLOD-POC has no runtime construction module yet.
5. CLOD page invalidation hooks are not needed until construction starts editing/conforming terrain.

## CLOD-POC implementation target

The CLOD-POC implementation should stay small and runtime-only:

- YAML config in `tools/clod-poc/config/construction.yaml`
- TypeScript registry and typed snap groups
- spatial snap index
- ghost preview mesh with green/red/blue states
- right-click placement
- `B` toggle building mode
- `R` rotate
- `X` toggle snap
- `1..9` select piece
- local persistence for placed pieces

## Do not do yet

- Do not voxel-edit terrain during placement.
- Do not dirty or rebuild CLOD pages until terrain conforming exists.
- Do not add meshlet, physics, or collider integration to CLOD-POC construction yet.
- Do not copy RustLikeGame Unity classes.

## Acceptance

CLOD-POC is good enough for the first pass when:

- a floor can be freely placed on terrain
- a wall can snap to a floor edge
- ghost color clearly shows valid, invalid, and snapped states
- placed pieces expose snap points to later pieces
- reload restores placed pieces from local storage
