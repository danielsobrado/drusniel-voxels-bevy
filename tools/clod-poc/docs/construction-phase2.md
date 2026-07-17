# CLOD construction Phase 2

Phase 2 replaces binary parent-chain support with an event-driven structural stability graph aligned with the Bevy building solver.

## Runtime model

- Successful snap contacts create bidirectional graph edges.
- Every coincident compatible socket is recorded, so one piece may have several independent supports.
- Grounded pieces seed a max-priority support propagation.
- Stronger support classes may fully support weaker classes; weaker classes cannot relay support into stronger classes.
- Equal-class support decays per connection, with separate vertical and horizontal values.
- Only dirty connected islands are recomputed after placement, removal, collapse, load, or terrain edits.
- Islands over `max_island_size` keep their previous values and increment the cap counter.
- Pieces below `collapse_threshold` enter a delayed collapse queue. Collapse removal and the next stability solve happen as separate stages.

## Visual feedback

While build mode is active:

- Blue: directly grounded.
- Green: strong support.
- Yellow: moderate support.
- Orange: weak but valid support.
- Red: invalid or pending collapse.

The placement ghost uses the predicted post-placement stability before a piece is committed.

## Configuration

All tuning lives under `construction.stability` in `config/construction.yaml`:

- `collapse_threshold`
- `epsilon`
- `max_island_size`
- `max_collapses_per_frame`
- `collapse_delay_ms`
- `connection_tolerance_m`
- `material_profiles.*.max_support`
- `material_profiles.*.vertical_decay`
- `material_profiles.*.horizontal_decay`
- `material_profiles.*.support_class`

## Diagnostics

The runtime publishes:

- `construction_stability_dirty_starts`
- `construction_stability_islands`
- `construction_stability_largest_island`
- `construction_stability_relaxations`
- `construction_stability_cap_hits`
- `construction_stability_pending_collapses`
- `construction_stability_collapsed_total`
- `construction_stability_solve_ms`

## Removal semantics

Manual deletion removes only the aimed piece. Its former neighbours are marked dirty, alternate support paths are recomputed, and only pieces that remain below the threshold are collapsed. Recursive descendant deletion is no longer used.
