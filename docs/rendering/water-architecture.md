# Water Rendering Architecture

## Ownership Rules

Water is rendered by dedicated water systems. CLOD pages are terrain caches only.

```text
W1. VoxelWorld remains authoritative for editable water state.
W2. CLOD page source meshes must never include water surfaces.
W3. Near editable water is owned by live voxel water meshes.
W4. Large or far water may be owned by the water clipmap renderer once enabled.
W5. Hidden or unsupported water bodies must fall back to the live voxel path or be explicitly hidden.
W6. Exactly one renderer owns a visible water footprint at a time.
```

## Renderer Ownership Modes

| Owner | Use case | Notes |
|---|---|---|
| `NearVoxelMesh` | Near editable lakes, rivers, ponds, shallow floods | Current safe path. Supports voxel edits and existing material presets. |
| `Clipmap` | Future large/far lakes, river continuations, coast/ocean surfaces | Disabled by default. Camera-following renderer only; never part of CLOD pages. |
| `Hidden` | Debug suppression or bodies intentionally hidden by material mode | Must be visible in ownership/debug counters. |
| `Fallback` | Missing metadata or unsupported body state | Must degrade safely, never black pixels or duplicate water. |

## CLOD Boundary

CLOD pages should consume only main terrain surface exports. Water, skirts, aprons, collider-only meshes, debug geometry, and any future clipmap water are outside the page-builder contract.

Durable source-level rule:

```rust
/// Water surfaces are never included in CLOD page source meshes.
/// CLOD pages are derived terrain caches only. Water is rendered by the
/// dedicated water renderer to avoid stale water geometry, z-fighting,
/// and mismatched hydrology state.
```

## Current Implementation Status

- `WaterOwnershipPlugin` owns shared ownership stats and debug state.
- `WaterClipmapPlugin` is disabled by default and only creates placeholder level entities when explicitly enabled.
- Existing live voxel water, planar reflections, compositor, caustics, and displacement remain the default path.

## TODO

- TODO(WATER-101): Wire ownership counts to real `WaterBodyRegistry` body ownership decisions.
- TODO(WATER-102): Replace clipmap placeholder entities with shared concentric grid meshes.
- TODO(WATER-104): Add deterministic per-body selection between live voxel meshes and clipmap water.
