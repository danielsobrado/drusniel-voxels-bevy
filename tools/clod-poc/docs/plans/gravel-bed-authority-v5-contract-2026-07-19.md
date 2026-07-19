# Gravel-Bed Authority V5 Contract

> Target: `tools/clod-poc`
> Branch: `agent/gv-clod-gravel-bed-authority-v5`
> Status: implementation in progress; default remains disabled

## Goal

Promote the existing pure gravel-bed safety evaluator into one serialized terrain authority without reviving the stale v2/v3 branch topology.

## Authority rules

- `gravel_bars` remains the deterministic visual and placement field.
- `gravel_bar_bed` owns terrain elevation only.
- Water Y never moves because of a gravel bar.
- Applied terrain elevation must preserve `depth == waterY - terrainY`.
- The same configuration and evaluator must reach finite hydrology, traced infinite hydrology, graph hydrology, startup raster generation, CLOD workers, heightfield-tile workers, colliders, and cache identity.
- No render-only displacement and no private consumer implementation.
- The feature remains disabled until headed continuity, non-floating, determinism, and performance acceptance passes.

## Required implementation

- [ ] Add a separate sanitized YAML/config object for gravel-bed elevation.
- [ ] Include the configuration in terrain-source cache identity.
- [ ] Serialize the configuration to CLOD and hydrology tile workers.
- [ ] Apply the evaluator to finite-grid carved beds.
- [ ] Apply the evaluator to traced hydrology samples and terrain heights.
- [ ] Apply the evaluator to graph hydrology samples and terrain heights.
- [ ] Keep startup raster, streamed roots, heightfield tiles, and collider terrain in parity.
- [ ] Publish deterministic candidates, accepted, rejection-reason, and maximum-elevation counters.
- [ ] Add scalar/worker/tile parity and feature-off identity tests.

## Acceptance before enablement

- river continuity remains 100%;
- minimum configured wet depth is preserved;
- no bar rises through the local bank-clearance ceiling;
- stones remain seated on the final terrain authority;
- tile eviction and rebuild remain bit-identical;
- startup and streamed terrain agree at the authority boundary;
- zero normal-gameplay GPU readbacks;
- no new synchronous frame-path build.
