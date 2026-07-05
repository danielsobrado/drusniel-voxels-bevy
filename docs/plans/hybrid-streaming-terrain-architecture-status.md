# Hybrid Streaming Terrain Architecture Status

Date: 2026-07-05

Source plan: `docs/plans/hybrid-streaming-terrain-architecture.md`

Scope completed in this pass: `tools/clod-poc` only. No Bevy/Rust terrain modules were changed.

## Verification

- Passed: `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run typecheck"`
- Passed: `npm --prefix tools/clod-poc test` - 404 files, 2228 tests.
- Passed: `npm --prefix tools/clod-poc run build`
- Earlier pass did not run browser shot harness or perf harness. That pass touched far-summary and far-shell timing-sensitive paths, but no pre-change perf baseline was captured before implementation, so no performance claim is made there.

Continuation verification:

- Passed: `npm --prefix tools/clod-poc test -- src/stream/ownership_residency.test.ts src/stream/ownership_coverage_oracle.test.ts src/stream/page_plan.test.ts src/stream/live_voxel_chunk_streamer.test.ts src/far-summary/clipmap-rings.test.ts src/long-view/infiniteFarShell.test.ts src/far-summary/integration.test.ts` - 7 files, 54 tests.
- Passed browser shot: `tools/clod-poc/shots/infinite-islands/core-after-residency-feeds.png` and `tools/clod-poc/shots/infinite-islands/core-after-residency-feeds-stats.json`.
- Browser shot counters: `far_summary_tiles_missing=0`, `far_summary_fallback_samples=0`, split fallback counters all `0`, `residency_missing_live=0`, `residency_missing_clod=0`, `priority_unowned_cells=0`, `far_shell_rebuild_pending=0`.
- Note: from the WSL UNC path, `rtk npm --prefix tools/clod-poc run typecheck` can start in `C:\Windows` and fail before typechecking. Use the explicit `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && ..."` form below.

Latest local verification:

- Passed: `npm --prefix tools/clod-poc test -- src/stream/ownership_residency.test.ts src/stream/ownership_coverage_oracle.test.ts src/terrain/near_field/near_field_bubble_controller.test.ts tools/infinite_acceptance/thresholds.test.ts tools/infinite_acceptance/thresholds_validation.test.ts` - 5 files, 41 tests.
- Passed: `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run typecheck"`.
- Passed: `npm --prefix tools/clod-poc run build`.
- Not run here: browser acceptance/perf runs. Long browser/perf validation is deferred to a native manual run.

WP-6 local verification:

- Passed: `npm --prefix tools/clod-poc test -- src/terrain/streaming/clod_streaming_roots.test.ts src/stream/ownership_coverage_oracle.test.ts src/phase0/long_view_frame_diagnostics.test.ts tools/infinite_acceptance/thresholds.test.ts tools/infinite_acceptance/thresholds_validation.test.ts` - 5 files, 41 tests.
- Passed: `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run typecheck"`.
- Passed: `npm --prefix tools/clod-poc run build`.
- Not run here: browser acceptance/perf runs. Long browser/perf validation is deferred to a native manual run.

WP-6 follow-up verification:

- Passed: `npm --prefix tools/clod-poc test -- src/terrain/streaming/clod_streaming_roots.test.ts src/stream/ownership_residency.test.ts src/stream/ownership_coverage_oracle.test.ts src/phase0/long_view_frame_diagnostics.test.ts tools/infinite_acceptance/thresholds.test.ts tools/infinite_acceptance/thresholds_validation.test.ts` - 6 files, 45 tests.
- Passed: `rtk npm --prefix tools/clod-poc run typecheck`.
- Passed: `npm --prefix tools/clod-poc run build`.
- Passed: `rtk git diff --check`.
- Existing partial browser acceptance run `tools/clod-poc/acceptance-runs/infinite-islands/2026-07-05T09-05-38` did not produce a final report because it stopped before `perf-final-horizon`; available stats show `stream_ready_frame=-1`, so WP-6 is not browser-accepted.

WP-6 streamed-root verification:

- Passed: `npm --prefix tools/clod-poc test -- src/terrain/streaming/clod_streaming_roots.test.ts src/stream/ownership_coverage_oracle.test.ts src/phase0/long_view_frame_diagnostics.test.ts tools/infinite_acceptance/thresholds.test.ts tools/infinite_acceptance/thresholds_validation.test.ts` - 5 files, 45 tests.
- `rtk npm --prefix tools/clod-poc run typecheck` could not run from the WSL UNC cwd because `cmd.exe` defaulted to `C:\Windows`; rerun passed with `rtk bash -lc "cd /home/drusniel/drusniel-voxels-bevy && npm --prefix tools/clod-poc run typecheck"`.
- Passed: `npm --prefix tools/clod-poc run build`.

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
| WP-1.9 Ring-edge tests | Done | Added tests for ring-edge sampling and coverage-margin tile request inclusion. Acceptance browser run is now covered by the continuation shot. |
| WP-2.1 Remove legacy controller option from integration | Done | Removed `farShellController` option/import/block and `farSummaryShellRebuildInterval` handling from far-summary integration. |
| WP-2.2 Stop passing legacy controller; document disabled controller | Done | Bootstrap no longer passes the legacy controller to far-summary integration and comments why it remains disabled. |
| WP-2.3 Update removed-option tests | Done | No remaining tests referenced the removed option; full suite passed in the earlier pass. |
| WP-3.1 Epoch invalidation restore | Done | Added cache invalidation epoch, built tile epoch stamps, stale/cooling restore to ready, and `far_summary_stale_restores`. |
| WP-3.2 Bounds-aware `markStale` and remove per-frame global stale call | Done | `markStale(bounds)` now invalidates only intersecting tiles; `integration.update` no longer calls `markStale(null)` every frame. |
| WP-3.3 Queue commit-budget overflow | Done | Completed builds now wait in a pending commit queue instead of being rebuilt/discarded; `far_summary_builds_discarded` is published and gated at zero. |
| WP-3.4 Wire `keepStaleUntilReplacement` | Done | Stale/cooling tiles are sample misses when `keepStaleUntilReplacement` is false. |
| WP-3.5 Publish stale restore diagnostic | Done | `far_summary_stale_restores` is published as a required diagnostic counter. |
| WP-4 Shell sampling and rebuild integrity | Mostly done | Bilinear sampling is routed through `readTileSample`, `rebaseSnapMeters` is 128, rebuild restarts are counted, initial sliced rebuilds no longer restart every frame, fixed probes are published, and the infinite-islands shot reports zero settled fallback samples. Remaining acceptance work is a dedicated recenter/popping screenshot pair if this becomes visually suspect. |
| WP-5 Ownership promotion and oracle scoping | Done pending browser acceptance | The duplicate diagnostics-local ownership runtime is gone; packed keys and oracle gating are in place. Added `ownership_residency.ts` and threaded `OwnershipResidencyFeeds` through diagnostics and the oracle, with tests proving feed holes trip oracle ownership. Production diagnostics now build feeds from renderer-owned ready state: live-bubble ready page keys expand to packed live chunks, and CLOD residency reads the streaming controller's applied ready page keys for infinite-streaming scenes instead of snapshot-loaded lists or all renderer nodes. Infinite acceptance rules are split into coverage gates (`ownershipOracle=1`, no frame-time gates) and perf gates (`ownershipOracle=0`, frame timing included). |
| WP-6 CLOD parent coverage | Implemented pending browser acceptance | Added CLOD stream hierarchy helpers for coarse-to-fine budget ordering and parent retention. The oracle now treats parent-covered missing descendants as covered CLOD footprints, so `missing_clod_pages_in_required_radius` reports uncovered missing pages. Added `stream_ready_frame`, seeded/published it from live readiness, coarsest CLOD residency, and far-summary readiness. Coverage acceptance now requires `stream_ready_frame >= 0`. The streamed root worker/client path now preserves requested `PageCoord.level` and builds standalone requested-level roots through the existing quadtree parent-building path, so applied ready keys are real streamed pages such as `L2:x,z` instead of L0-only substitutes. |
| WP-7 SoA tiles and worker builds | Not started | Typed-array tile storage and worker builds remain blocked until WP-1 through WP-6 are accepted. |
| WP-8 GPU summary atlas general flag | Not started | General `farSummaryAtlas=1` un-gating remains open. |

## Additional Fixes Made

- `InfiniteFarShell.update` now schedules an initial CPU height rebuild even when the first snapped center is unchanged.
- Tiny far-shell test geometries complete their CPU rebuild in one update; normal runtime-sized shells remain sliced by the configured budget.
- Far-summary tile request enumeration now scans out to `ring.endM + ringCoverageMarginM`, so margin-overlap tiles are actually requestable.
- Far-summary fallback counters publish the current settled sampling window instead of retaining startup misses forever.
- `FarSummaryDebugOverlay` and far-summary integration can be constructed in non-browser tests.

## Remaining Acceptance Work

- Run browser acceptance after the WP-5 feed/gate split and record the generated coverage/perf artifacts.
- Run browser acceptance after the multi-level streamed CLOD root path and record `stream_ready_frame`, `clod_parent_coverage_violations`, `priority_unowned_cells`, and coverage/perf split results.
- Capture a dedicated recenter/popping screenshot pair if WP-4 visual popping is suspected.
- Capture clod-poc perf harness data with a real before/after baseline for any later performance claims.
