# CLOD construction Phase 3 — coherent starter kit

Phase 3 turns the construction prototype into a small, internally compatible building kit. The catalog is intentionally limited to pieces needed for a closed cabin, a supported bridge, and a three-storey tower.

## Catalog

The default kit contains 24 pieces:

- Floors: 2x2, 1x1, and 2x1 half floor.
- Walls: 2x2, 2x1 half wall, door frame, and window wall.
- Structure: pillars at 1 m, 2 m, and 4 m; beams at 1 m, 2 m, and 4 m; one 2 m diagonal beam.
- Access: 2x2 stairs and a 2 m ladder.
- Roofs: 26° and 45° panels, ridge, outside corner, and inside corner.
- Ground/outdoor: 2x2 foundation block, fence, and gate.

The catalog is split by family under `config/construction_*.yaml`. Runtime settings remain in `config/construction.yaml`.

## Durable piece contract

A piece definition keeps these concerns independent:

- `dimensions_m`: logical outer size and selection footprint.
- `material`: default visual and structural material; player material selection may override it.
- `support_profile`: optional structural override for a specific shape.
- `geometry_kind` or `geometry_parts`: visible render geometry.
- `placement_boxes`: overlap and player-collider proxies.
- `snap_points`: placement frames and structural contacts.

Compound geometry parts support box, wedge, stairs, and cylinder primitives with per-part XYZ rotation and translation. Placement proxies remain conservative boxes, so render detail never leaks into broadphase rules.

## Open pieces

Door frames, window walls, ladders, gates, diagonal beams, roof ridges, and roof corners use compound render geometry. Door and window placement/collider proxies cover only their frames, preserving the opening instead of creating an invisible blocking wall.

## Snap rules

- Wall bottoms connect to floor edges and wall tops.
- Wall tops expose wall stacking, floor, roof, and generic structural contacts.
- Pillar tops accept beams and roof supports.
- Beams expose separate chain and downward support sockets.
- Roof eaves connect to wall tops; roof ridges and roof corners connect through `roof-edge` frames.
- Fence and gate ends share generic outdoor sockets.

All placement still uses the Phase 1 snap solver and the Phase 2 bidirectional stability graph.

## Acceptance gate

Phase 3 passes when deterministic tests can build these chains entirely from returned snap transforms:

1. Cabin: floor → wall/opening → roof panel → ridge.
2. Bridge: foundation → pillar → 4 m beam → floor span.
3. Tower: floor → stacked walls → upper floor, repeatable to three storeys.

No test may patch the returned world position or rotation after snapping.

Additional gates:

- Every required catalog ID is present exactly once.
- Compound/open pieces define render parts and placement proxies separately.
- Diagonal render parts preserve true XYZ rotation.
- Default catalog parsing is deterministic and contains 24 pieces.
