# CLOD-POC construction Phase 0

Phase 0 establishes a measurable, world-size-independent construction preview path before adding richer snapping or structural simulation.

## Runtime architecture

`construction_controller.ts` now coordinates input, preview state, commands and UI. Dedicated modules own:

- `targeting.ts`: heightfield targeting fallback.
- `construction_preview.ts`: snap candidate selection and ghost rendering.
- `construction_controller_ui.ts`: input bindings, draggable menu and UI rendering.
- `construction_bounds.ts`: shared placement bounds math.
- `overlap_index.ts`: local broadphase overlap candidates.
- `construction_piece_store.ts`: placed meshes and runtime indexes.
- `construction_persistence.ts`: storage parsing, migration and restore ordering.
- `construction_terrain_conform.ts`: terrain-conform request creation.
- `construction_timing.ts`: rolling preview timings and counters.

The snap index ray query traverses only spatial cells touched by the ray tube. Placement validation receives candidates from the overlap spatial index. Neither preview operation scans every placed construction piece.

## Counters

The runtime publishes these counters when the normal CLOD stats counter map is available:

```text
construction_preview_total_ms
construction_preview_total_ms_p95
construction_targeting_ms
construction_snap_query_ms
construction_placement_validation_ms
construction_snap_visited_cells
construction_snap_candidates
construction_snap_traversal_truncated
construction_overlap_visited_cells
construction_overlap_candidates
construction_placed_meshes
construction_draw_calls_estimate
construction_terrain_conform_requests
construction_clod_invalidation_requests
```

The CLOD invalidation counter records requested invalidations triggered by terrain-conform commits. It is not a count of rebuilt pages.

## Deterministic benchmark

Run:

```bash
npm run perf:construction
```

The benchmark covers:

1. Small cabin.
2. Cantilever balcony.
3. Supported bridge.
4. Tall tower.
5. Sloped roof and corners.
6. Uneven terrain foundation.
7. A 10,000-piece settlement.

Reports are written under `construction-phase0-runs/<timestamp>/summary.json`.

The gate fails when the 10,000-piece scene increases local snap or overlap candidates beyond the configured bounds. Absolute timing is reported but not hard-gated because CI and developer machines differ.
