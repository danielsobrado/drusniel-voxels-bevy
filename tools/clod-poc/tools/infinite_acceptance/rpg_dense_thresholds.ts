/**
 * Dense RPG shipping-budget thresholds (Plan 2 D2).
 * Calibrated 2026-07-17 from perf-runs/rpg-dense-baseline aggregate
 * (village/base 5-run settled). Not cloned from sparse INFINITE_ISLANDS_FRAME_MS_P95_MAX.
 */

/** Primary discrete GPU tier — shipping budgets for dense settled poses. */
export const RPG_DENSE_PRIMARY_TIER = {
  id: "primary-discrete",
  villageSettledFrameMsP95Max: 80,
  villageSettledFrameMsMaxMax: 120,
  playerBaseSettledFrameMsP95Max: 20,
  playerBaseSettledFrameMsMaxMax: 100,
  /** Move route budgets filled after move-run aggregate; provisional until then. */
  moveFrameMsP95Max: 90,
  moveFrameMsMaxMax: 150,
  /** Storm responsiveness (D3) — distinct from traversal. */
  stormFrameMsMaxAfterWarmup: 100,
  stormFramesOver100MsMax: 0,
} as const;

export const RPG_DENSE_STREAMING_CLEANLINESS = {
  requireCoverageZeros: [
    "ring_boundary_holes",
    "live_clod_gap_holes",
    "clod_far_gap_holes",
    "priority_unowned_cells",
    "missing_live_chunks_in_required_radius",
    "missing_clod_pages_in_required_radius",
  ],
} as const;
