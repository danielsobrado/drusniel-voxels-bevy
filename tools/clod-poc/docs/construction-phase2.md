# Construction Phase 2 — Structural stability

Phase 2 replaces the previous binary parent-chain support rule with a deterministic, material-aware structural graph.

## Runtime model

- Every placed piece is a node in an undirected connection graph.
- Compatible sockets that meet within `connection_tolerance_m` become graph edges.
- A new piece may record several connections, so bridges and corners can keep independent support paths.
- Grounded nodes start at their profile's `max_support`.
- A max-priority propagation pass keeps the strongest support path for every node.
- Equal support classes lose support by directional decay.
- Stronger classes reset weaker targets to the target's maximum support.
- Weaker classes cannot structurally carry stronger targets.

Horizontal connections normally decay faster than vertical connections. A connection is treated as vertical when its vertical displacement ratio meets `vertical_connection_min_ratio`.

## Configuration

Global profiles live under `construction.support_profiles` in `config/construction.yaml`.

```yaml
support_profiles:
  wood:
    max_support: 1.0
    vertical_decay: 0.06
    horizontal_decay: 0.10
    support_class: wood
```

A piece may define `support_profile` to override the profile of its default material. Selecting another material still uses the selected material's global profile.

Structural runtime limits live under `construction.stability`:

```yaml
stability:
  collapse_threshold: 0.20
  epsilon: 0.0001
  max_island_size: 4096
  max_collapses_per_frame: 8
  connection_tolerance_m: 0.08
  vertical_connection_min_ratio: 0.55
```

## Dirty islands

Placement, deletion, terrain support changes, and collapse mark only affected graph nodes dirty. The runtime collects and solves each connected dirty island independently.

If an island exceeds `max_island_size`, the solve is skipped, prior values remain live, and a cap-hit counter is emitted. This fail-safe avoids a surprise full-world structural solve.

## Collapse

Deletion removes only the selected piece. It does not recursively delete descendants.

After the graph edge is removed:

1. The affected island is solved again.
2. Pieces below `collapse_threshold` enter the collapse queue.
3. At most `max_collapses_per_frame` are removed.
4. The remaining island is solved again after every removal.

This allows a bridge with two supports to survive loss of one support when its second path remains adequate.

## Build-mode feedback

Placed pieces and the preview use the same stability palette:

- Blue: directly grounded.
- Green: strong.
- Yellow: moderate.
- Orange: weak but valid.
- Red: below the collapse threshold or otherwise invalid.

The build menu displays the predicted support percentage before placement.

## Persistence

Phase 2 saves `connectionIds` and `stability`. Legacy `parentIds` are migrated to undirected connection IDs and removed on the next save. The full graph is rebuilt and solved after loading so saved values are never treated as authoritative.

## Diagnostics

The controller publishes:

- `construction_support_graph_nodes`
- `construction_support_graph_edges`
- `construction_stability_recompute_ms`
- `construction_stability_recompute_count`
- `construction_stability_islands_last`
- `construction_stability_largest_island`
- `construction_stability_relaxations_last`
- `construction_stability_cap_hits_total`
- `construction_stability_pending_collapses`
- `construction_stability_collapsed_total`
- `construction_stability_preview_value`

## Acceptance scenarios

- A bridge with two supports survives removal of one support when the remaining path is adequate.
- A horizontal wood cantilever weakens faster than a vertical wood stack.
- A stronger support class can carry a weaker class; the reverse is rejected.
- Multiple contacts use the strongest available path.
- Removing a support solves only its connected island.
- Collapse is paced and re-evaluated after each removed piece.
- Save/load produces the same graph-derived stability values.
- The 10,000-piece Phase 0 benchmark still uses local snap and overlap candidates.
