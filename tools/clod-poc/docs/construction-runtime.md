# CLOD-POC Construction Runtime

The CLOD-POC construction runtime uses deterministic placement, support, collision, terrain-transaction, and persistence contracts. Construction pieces remain ordinary world entities; terrain pages are dirtied only when an explicit foundation transaction changes terrain.

## Controls

| Key / input | Action |
|---|---|
| `B` | Toggle building mode and the build menu |
| Build menu buttons | Select construction piece |
| `1..9` | Select construction piece |
| `R` | Rotate the selected piece |
| `X` | Toggle snap mode |
| `Q` / `E` | Cycle snap candidates |
| Hold `Shift` | Temporarily suppress snapping |
| Left click | Place the current valid ghost |
| Middle click | Pick the aimed piece type |
| Right click | Remove the aimed piece |
| `Ctrl+Z` | Undo the latest construction placement receipt when still valid |
| `?construction=0` | Disable construction runtime |

## Current behavior

- A YAML-backed starter catalog provides floors, walls, openings, structure, access, roof, foundation, fence, and gate pieces.
- Snap frames are indexed in a spatial hash and support sticky selection and candidate cycling.
- Placement uses indexed broadphase plus oriented-box narrowphase validation.
- Visible geometry, placement proxies, and collision proxies share the same piece transform.
- Placed pieces participate in player collision and terrain support re-evaluation.
- The bidirectional support graph recomputes only affected connected islands.
- Terrain edits re-probe grounding for affected pieces.
- Unsupported pieces remain visible and collidable, are marked with the unsupported stability color, and persist as unsupported.
- Structural collapse is deferred; unsupported pieces are not automatically deleted.
- Explicit removal clears the mesh, collision proxy, snap points, overlap entry, graph node, and persisted connection metadata in one synchronous store operation.
- Placed pieces persist under the configured storage key with grounded, connection, stability, and unsupported state.
- Only explicit foundation pieces may request terrain conformance.
- Foundation placement previews a rotated authoritative footprint and rejects unavailable, unready, protected, over-fill, or over-cut terrain.
- Fill and trim commit through one composite voxel transaction before piece insertion.
- Failed piece insertion compensates the terrain transaction.
- Placement receipts support construction-plus-terrain undo; undo fails closed when later terrain edits overlap the original footprint.
- Manual deletion removes the piece but intentionally keeps its committed terrain change.

## Source files

```text
tools/clod-poc/config/construction.yaml
tools/clod-poc/config/construction-pieces/*.yaml
tools/clod-poc/src/construction/types.ts
tools/clod-poc/src/construction/config.ts
tools/clod-poc/src/construction/construction_controller.ts
tools/clod-poc/src/construction/construction_piece_store.ts
tools/clod-poc/src/construction/construction_support_graph.ts
tools/clod-poc/src/construction/construction_stability_runtime.ts
tools/clod-poc/src/construction/construction_collider.ts
tools/clod-poc/src/construction/construction_persistence.ts
tools/clod-poc/src/construction/construction_terrain_transaction.ts
tools/clod-poc/src/construction/construction_terrain_placement.ts
tools/clod-poc/src/terrain/editing/terrain_edit_service.ts
```

## Terrain boundary

Do not dirty terrain for walls, fences, pillars, roofs, or other prop-only pieces.

Dirty terrain only through an explicit terrain transaction, such as:

- foundation pad fill;
- terrain trim above a foundation;
- future terrain conform or flatten operations;
- future material or vegetation masks caused by construction.

## Deferred

- Structural collapse motion and physics.
- Damage and repair gameplay.
- Network authority and replication.
