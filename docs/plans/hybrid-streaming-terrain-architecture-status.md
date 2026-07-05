# Hybrid Streaming Terrain Architecture Status

Date: 2026-07-05

Source plan: `docs/plans/hybrid-streaming-terrain-architecture.md`

Scope completed in this pass: `tools/clod-poc` only. No Bevy/Rust terrain modules were changed.

## Verification

- Passed: `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run typecheck"`
- Passed: `npm --prefix tools/clod-poc test` — 404 files, 2228 tests.
- Passed: `npm --prefix tools/clod-poc run build`
- Not run: browser shot harness and perf harness. This change touches far-summary and far-shell timing-sensitive paths, but no pre-change perf baseline was captured before implementation, so no performance claim is made here.

## Work Package Status

| Item | Status | What was done |
|---|---|---|
| WP-0.1 Mark `InfiniteFarShell` canonical | Done | Added bootstrap comment at the legacy controller disable point. Existing docs already name `InfiniteFarShell` as canonical. |
| WP-0.2 Add `sampleMaterial(x, z)` to `ProceduralWorldSource` | Done | Added `WorldSource.sampleMaterial`; `ProceduralWorldSource` returns the biome id used by biome colors; streamed stub throws until implemented. |
| WP-0.3 Wire far-summary terrain sampler material | Done | Bootstrap far-summary sampler now routes `sampleMaterial` through `world.worldSource.sampleMaterial`. |
| WP-0.4 Add parity tests | Done | Added source material parity over `-8192m..8192m`; far-summary tile material test proves non-default material diversity. |
| WP-1.1 Add `ringCoverageMarginM` | Done | Added `stream.ringCoverageMarginM = 256` to far-summary config defaults. |
| WP-1.2 AABB-vs-annulus tile inclusion | Done | Replaced tile-center inclusion with tile-bounds annulus overlap plus coverage margin. |
| WP-1.3 Add `readTileSample` accessor | Done | Added exported `readTileSample`; runtime sampling now reads tile samples through this accessor. |
| WP-1.4 Preferred ring selection | Done | Added `ringIndexForDistance`, required `sampleFull` preferred ring, sampler center tracking, and convenience method ring resolution. |
| WP-1.5 Single shell summary lookup | Done | Added `sampleSummaryInto`; `InfiniteFarShell` uses a caller-owned scratch path when the provider supports it. |
| WP-1.6 Set-based missing accounting | Done | Added `countRequestStates(requests)` and integration metrics now count ready/building/missing/stale against the current request set. |
| WP-1.7 Split fallback counters | Done | Published procedural, lower-ring, and conservative fallback counters while retaining aggregate fallback samples. |
| WP-1.8 Acceptance counter config | Done | Added split fallback counters to acceptance required counters and YAML metrics list. |
| WP-1.9 Ring-edge tests | Done | Added tests for ring-edge sampling and coverage-margin tile request inclusion. Acceptance browser run remains not run. |
| WP-2.1 Remove legacy controller option from integration | Done | Removed `farShellController` option/import/block and `farSummaryShellRebuildInterval` handling from far-summary integration. |
| WP-2.2 Stop passing legacy controller; document disabled controller | Done | Bootstrap no longer passes the legacy controller to far-summary integration and comments why it remains disabled. |
| WP-2.3 Update removed-option tests | Done | No remaining tests referenced the removed option; full suite passes. |
| WP-3.1 Epoch invalidation restore | Done | Added cache invalidation epoch, built tile epoch stamps, stale/cooling restore to ready, and `far_summary_stale_restores`. |
| WP-3.2 Bounds-aware `markStale` and remove per-frame global stale call | Done | `markStale(bounds)` now invalidates only intersecting tiles; `integration.update` no longer calls `markStale(null)` every frame. |
| WP-3.3 Queue commit-budget overflow | Done | Completed builds now wait in a pending commit queue instead of being rebuilt/discarded; `far_summary_builds_discarded` is published and gated at zero. |
| WP-3.4 Wire `keepStaleUntilReplacement` | Done | Stale/cooling tiles are sample misses when `keepStaleUntilReplacement` is false. |
| WP-3.5 Publish stale restore diagnostic | Done | `far_summary_stale_restores` is published as a required diagnostic counter. |
| WP-4 Shell sampling and rebuild integrity | Not started | Bilinear sampling, 128m snap, rebuild restart counter, and fixed probes are still open. A small-shell rebuild determinism fix was added for tests, but it is not the WP-4 restart counter work. |
| WP-5 Ownership promotion and oracle scoping | Not started | `TerrainOwnershipRuntime` is still not hoisted into bootstrap in this pass. Packed keys, real residency feeds, and oracle gating remain open. |
| WP-6 CLOD parent coverage | Not started | Coarse-to-fine loading, parent retention, swap-not-pop CLOD assertions, and `clod_parent_coverage_violations` remain open. |
| WP-7 SoA tiles and worker builds | Not started | Typed-array tile storage and worker builds remain blocked until WP-1 through WP-6 are accepted. |
| WP-8 GPU summary atlas general flag | Not started | General `farSummaryAtlas=1` un-gating remains open. |

## Additional Fixes Made

- `InfiniteFarShell.update` now schedules an initial CPU height rebuild even when the first snapped center is unchanged.
- Tiny far-shell test geometries complete their CPU rebuild in one update; normal runtime-sized shells remain sliced by the configured budget.

## Remaining Acceptance Work

- Run deterministic browser acceptance for `infinite-islands` with settled samples and confirm:
  - `far_summary_tiles_missing = 0`
  - `far_summary_procedural_fallback_samples = 0`
  - `far_summary_lower_ring_fallback_samples = 0`
  - `far_summary_conservative_fallback_samples = 0`
  - `far_summary_builds_discarded = 0`
- Capture clod-poc perf harness data with a real before/after baseline for any later performance claims.
