# CLOD-POC Construction Phase 1

Phase 1 makes placement authoritative, stable, and ready for non-cuboid pieces without replacing the existing construction architecture.

## Implemented

- Construction terrain targeting uses the loaded near-terrain collider BVH through `TerrainRaycastService.raycastAuthoritativeTerrain`.
- The procedural heightfield is disabled for construction unless `allow_heightfield_fallback: true` is explicitly configured for debugging.
- Terrain hits carry a density-derived surface normal. Groundable pieces reject surfaces below their configured `ground_normal_min_y`.
- Snap sockets now form an orientation frame: position, normal, tangent, compatibility groups, and allowed quarter-turn twists.
- Snap lookup traverses the spatial ray tube once, scores all legal rotations, and returns deterministic candidates.
- Snap selection is sticky inside a larger release radius. `Q` and `E` cycle candidates. Holding `Shift` temporarily disables snapping.
- Middle-click picks the aimed piece type and material.
- Ghost geometry is the same procedural geometry used by the placed piece. Supported kinds are box, wedge, stairs, and cylinder.
- Broadphase remains spatial AABB lookup. Narrowphase now uses yaw-oriented placement boxes with SAT tests, preventing diagonal-piece AABB false positives.
- Player collision geometry is built from the same configured placement boxes, keeping visual placement and collision ownership aligned.

## Authoring

```yaml
snap_points:
  - id: socket
    local_pos: [0, 0, 1]
    direction: [0, 0, 1]
    tangent: [1, 0, 0]
    allowed_twist_degrees: [0, 180]
    group: generic
    accepts: [generic]

geometry_kind: wedge
geometry_yaw_degrees: 0
placement_boxes:
  - center: [0, -0.35, 0]
    dimensions_m: [2, 0.3, 2]
    rotation_y_degrees: 0
```

`placement_boxes` are cheap validation and collision proxies. Render triangles are never used for placement overlap tests.

## Controls

- `B`: toggle building mode
- `R`: rotate
- `X`: toggle snapping
- Hold `Shift`: temporarily suppress snapping
- `Q` / `E`: cycle snap candidates
- Left-click: place
- Middle-click: pick piece and material
- Right-click: delete

## Acceptance

- Construction cannot attach to far CLOD terrain or an invented heightfield surface in normal gameplay.
- A current snap does not jitter to a higher-scoring neighbour while inside its release radius.
- Diagonal placement proxies can share broadphase cells without false overlap rejection.
- Ghost and placed pieces use the same geometry factory.
