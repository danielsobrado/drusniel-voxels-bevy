# Unified streaming implementation handover

Created 2026-07-16.

## Outcome

The unified streaming plan is implemented and headlessly verified. The near bubble,
streamed CLOD roots, heightfield tiles, far summaries, far clipmap, shell-related work,
and downstream streams now share a single cursor and master freeze contract. Surface-cache
commits invalidate derived far summaries, and replace-mode clipmap ownership follows
rendered level-zero CLOD readiness per cell.

No manual visual QA was performed. The remaining work is deliberately limited to the
visual review listed below; no visual-quality, shimmer, or pop-in claim is made here.

## Post-review hardening

A code review after the initial handover found six real issues. They are fixed and covered
headlessly:

- The complementary refined-seam mask is now uploaded only to clipmap ring 0. Outer rings
  retain their annular inner clip, preventing coincident displaced layers in an unrefined
  seam sector.
- The performance probe retains all 1,320 long-route frames, and the gate requires all
  1,320 instead of accepting the most recent 1,024.
- Surface commits cancel only intersecting CPU base work and enrichment. Unrelated
  continent summary work is preserved instead of globally clearing the queues.
- Frozen frames preserve the last resident bubble stats without re-adding cached build and
  eviction events to cumulative counters.
- Root occupancy is published as `root_worker_batches_inflight`; the legacy
  `gpu_mesher_lane_busy_root` now correctly remains zero because root work uses workers,
  while `gpu_mesher_lane_busy_bubble` remains the actual bubble GPU inflight count.
- A bridge older than the retained 4,096-commit history now marks all summaries stale, and
  a failing commit listener is isolated from tile installation and other listeners.

The ready-frontier calculation now consumes the same rendered-ready page set as the
clipmap mask. Its internal set path and the per-frame clipmap readiness comparison avoid
sorting an unchanged cut twice.

## What landed

- Unified diagnostics: far-summary sub-bucket p95s, separate root worker-batch and bubble
  GPU occupancy, and `live_clod_stream_ready_frontier_m`.
- A master `terrain streaming` switch. Off freezes new work across all streaming layers
  without hiding resident meshes or clearing caches; on resumes from the current cursor.
- `StreamCursor`: one canonical center, real-delta velocity EMA, predicted center, and
  counters. The duplicate center implementation and far-summary velocity tracker were
  removed.
- A global surface-cache revision stream. Every heightfield tile install emits a bounded
  commit; the coalesced bridge marks intersecting summary tiles stale and handles commits
  that occurred while disconnected or while a summary build was in flight.
- A deterministic resident-vs-fallback parity probe and a continent acceptance threshold
  of 0.001 m. The final measured maximum error was 0 m.
- Per-cell seam ownership. Only rendered level-zero CLOD roots count as refined-ready;
  cached partial children behind a safety parent do not. The WebGPU clipmap stores the
  complementary mask and updates it only when readiness or the snapped ring origin changes.
- Movement-time gates for priority-unowned cells, CLOD/far gaps, clipmap ownership holes,
  and the diagnostic frontier-lag p95.
- A standing headless multi-kilometre gate:
  `npm --prefix tools/clod-poc run accept:unified-streaming-long-route`.
- A WebGPU startup blocker discovered by the continent gate was fixed: the thermal erosion
  shader no longer uses WGSL's reserved `target` identifier.

## Measured decisions

### Far-summary local optimization

`farSumTilesMs` was the largest sub-driver, but it was already only 0.5 ms p95 in the
baseline walk. A request-cadence experiment reduced movement p99 slightly but raised
`farSumTilesMs` p95 to 4.2 ms and total `farSummaryMs` p95 to 4.4 ms. It was removed; the
failed run remains at
`acceptance-runs/infinite-islands/2026-07-16T08-04-52/` as no-go evidence.

### StreamCapacity governor

Not implemented, by design. Root and bubble occupancy can overlap, but they use independent
GPU mesher implementations rather than a shared eight-lane pool. The final 3.06 km route
held movement p99 to 15.0 ms and the final far-summary p95 to 0.6 ms. This did not establish
the cross-system contention required by Phase 6, so no governor flag or scheduler layer was
added.

### Optional Phase 7 work

- Far-summary persistence: skipped because no revisit-cost measurement showed it was
  needed.
- Shared memory-pressure signal: skipped because the long route stayed bounded at 360
  bubble evictions and 125 root evictions, with no runaway evidence.
- Infinite-islands heightfield default: unchanged. Continent parity is proven, but there is
  no tiles-on islands performance A/B to justify switching the default procedural path.
- Annular shell ownership: unchanged until the manual visual comparison below supplies the
  evidence required by the plan.

## Headless verification

| Gate | Result |
| --- | --- |
| `npm --prefix tools/clod-poc run typecheck` | Pass |
| `npm --prefix tools/clod-poc test` | Pass: 623 files, 3270 tests; 1 file/3 tests skipped |
| `npm --prefix tools/clod-poc run build` | Pass |
| QA sample, `clod_poc_main_view` | Pass with expected `NON_AUTHORITATIVE` sample status |
| Full QA sample registry | Expected fail: the sample omits required checkpoints/counters for the other manifest scenes |
| Infinite walk | Pass; movement p99 14.90 ms, no ownership holes |
| Unified 3.06 km route after review fixes | Movement checks pass over 1320/1320 frames: p99 17.40 ms, max 24.90 ms, all movement seam counters zero. Overall gate fails only the separate settled p95 check at 8.20 ms versus the 8.00 ms limit. Two pre-optimization runs measured 8.50 ms and 8.20 ms. |
| Continent tiles/parity after review fixes | Pass; 70/70 resident, queues drained, fallback frame 0, parity 16 samples / 0 m error |

Performance comparison using the same `current-textured`, world 8, 120-frame warmup,
300-frame case:

| Metric | Baseline | Final |
| --- | ---: | ---: |
| frame p50 | 2.50 ms | 2.40 ms |
| frame p95 | 3.10 ms | 3.10 ms |
| render p95 | 2.20 ms | 2.10 ms |
| top phase | render, 2.20 ms p95 | render, 2.10 ms p95 |
| top prop bucket | forest lighting, 0.80 ms p95 | forest lighting, 0.80 ms p95 |

Primary artifacts:

- `perf-runs/unified-streaming-baseline/steady/summary.json`
- `perf-runs/unified-streaming-final/steady/summary.json`
- `acceptance-runs/infinite-islands/2026-07-16T08-39-32/report.json`
- `acceptance-runs/infinite-islands/2026-07-16T09-04-28/report.json`
- `acceptance-runs/infinite-islands/2026-07-16T11-25-38/report.json`
- `acceptance-runs/infinite-islands/2026-07-16T11-27-48/report.json`
- `acceptance-runs/infinite-islands/2026-07-16T11-33-37/report.json`
- `acceptance-runs/continent-tiles/unified-streaming-final/report.json`
- `acceptance-runs/continent-tiles/unified-streaming-review-fixes/report.json`
- `validation-runs/unified-streaming-review-fixes/report.md`

The acceptance harness generated its normal automated screenshots, but they were not
opened or visually assessed.

## Pending manual visual steps

1. Start the app in a native shell:

   ```text
   npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5173 --strictPort
   ```

2. Capture settled replace-mode seam shots at the route start, after crossing several page
   boundaries, and outside the startup window. Use both `farClipmapDebug=final` and
   `farClipmapDebug=ownership`; save the PNG and stats JSON for each pose. Example start
   capture:

   ```text
   npm --prefix tools/clod-poc run shoot -- --scene infinite-islands --seed 1 --world 16 --cam 2048,96,2048,2.65,-0.43,55 --farClipmap 1 --farClipmapMode replace --liveClodRootRadius 384 --farClipmapInnerRadius 384 --farClipmapDebug ownership --waitfar 1 --waitroots 1 --settle 180 --hud 1 --out shots/manual/unified-streaming-seam-start.png --stats shots/manual/unified-streaming-seam-start-stats.json
   ```

   Repeat near `(3248, 96, 2048)` and `(5048, 96, 2647)`. Confirm the stats still report
   `priority_unowned_cells=0`, `clod_far_gap_holes=0`, and
   `far_clipmap_ownership_holes=0`.

3. Observe an active traversal, not only settled poses. In ownership debug mode, watch
   several level-zero roots arrive. Check that each far cell disappears in the same sector,
   without a circular all-directions pull-in, a hole flash, checkerboard crawling, or
   double-render shimmer. Confirm that the complementary seam sector appears only on the
   innermost clipmap ring; outer rings must keep their center clipped. Record a short screen
   capture if any transient is visible.

4. Repeat in final shading at low grazing angles and over water/coast transitions. Look for
   height discontinuity, different normals/material tint across the 200–384 m band, water
   double surfaces, and page-transition pop. Compare with the ownership-debug capture at the
   same pose before attributing an artifact to geometry versus shading.

5. Exercise the GUI master `terrain streaming` switch while moving. Off should preserve the
   currently rendered near and far terrain with no void; on should resume toward the current
   player position without a one-frame rebuild storm or all-sector pop.

6. Make the shell-path decision only after the above evidence. Compare the same poses with
   the legacy annular shell path. If replace mode is clean, leave the shell unchanged. If the
   shell path independently shows the same sector-specific hole/pop, open a separate task for
   shell per-cell ownership; do not extend this implementation without that evidence.

7. Attach the manual PNGs, stats JSON files, observed transition notes, and the final
   shell-path decision to this handover or a new dated visual-QA document.
