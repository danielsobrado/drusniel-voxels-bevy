# Near-field streaming items 2–7: measured session

Session: 2026-07-16. Scope: `tools/clod-poc` near-field bubble controller
(`src/terrain/near_field/near_field_bubble_controller.ts`, the live
`createNearFieldBubbleController`) and its frame-loop wiring
(`src/app/frame_loop/terrain_frame_phase.ts`).

Repo rule followed: no perf claim kept without before/after numbers from the harness,
and no change kept if it regresses frame time or visual quality. Flat or regressing
changes were reverted; nothing is merged this session. Baseline test state recorded
before any task: 609 files / 3215 passed / 3 skipped — all green (the prompt's feared
WIP failure is not present on this baseline).

## Environment

Native Windows shell. Vite dev server at `http://127.0.0.1:5180/` (started directly,
not through `rtk`). WebGPU + Playwright headless against it.
`npm --prefix tools/clod-poc run typecheck` (rtk OK) and
`npm --prefix tools/clod-poc test` (vitest, NO rtk) after every change.

## Baseline (Phase 0) — locked reference

Steady-state frame-time reference (`perf:main --world 8 --warmup 120 --frames 300
--case current-textured`):

```
frameMs p50/p95   4.80 / 6.70
renderMs p95      4.20
triangles         87755
```

Note: near-field bubble is OFF on `current-textured`, so `live_bubble_*` are absent
there. That case is only the steady frame-time reference.

Streaming/movement reference (`accept:infinite-islands:reuse -- --scene walk --gate perf`):

```
median / p95 / p99      5.35 / 8.80 / 9.20
movement p99 (n=522)    15.70,  max 18.10, workMax 0.00
draw_calls              470
terrain_draw_calls      95
triangles               3,017,033
clod holes (sum)        0
missing_live_chunks     0
live_bubble required    45
live_bubble ready       45
live_bubble building    0
live_bubble cached      64
streamed_collider_pages 10
collider_registrations  230
live_bubble_ms          max 2.6ms
cpu_work_unit_max_ms    max 0.000ms
gpu_apply_max_ms        max 1.0ms
```

## Task 2 — Share terrain material / merge per-chunk visual geometry to page level

Status: **implemented → measured → REVERTED.**

Material half was already done: `poolTerrainMaterial = isWebGpu`
(`src/app/bootstrap/renderer_startup.ts:140`), so on the WebGPU path every chunk
already resolves via `makeSharedVariantHandle` to a shared per-variant material
(`src/terrain/material/terrain_material_controller.ts:264`). Only the geometry half
remained.

Geometry half implemented surgically: kept per-chunk colliders (preserves the
`collider_registrations===4` contract and `nearFieldPageIntersectsVoxelOverlay`
footprints), merged only the visual geometry into one page-level `BufferGeometry`
via `three/examples/jsm/utils/BufferGeometryUtils.js#mergeGeometries`. Surveyed
all callers first: `replaceChunks` has zero callers (edits actually go through
`invalidatePage`), `applyTint` is base-color-only with one GUI caller, no external
reader touches `userData.liveChunkIndex`/chunk meshes (picking/raycast/stats use
the `TerrainColliderSet` BVH, never the scene graph). 18-test contract stayed green.

A/B (acceptance `walk/perf`, same scene/world):

| metric | baseline | after | Δ |
|---|---:|---:|---|
| renderer.draw_calls | 470 | 209 | **−261 (−56%)** |
| terrain_draw_calls | 95 | 88 | −7 |
| triangles | 3,017,033 | 3,074,451 | +1.9% |
| frame p95 | 8.80 | 10.70 | **+1.90 regression** |
| frame p99 | 9.20 | 14.10 | **+4.90 regression** |
| movement p99 | 15.70 | 17.90 | **+2.20 regression** |
| clod holes (sum) | 0 | 0 | none |
| missing_live_chunks | 0 | 0 | none |
| lb.ready/building/colliders | 45/0/230 | 45/0/230 | none |

Decision: **REVERTED.** The rule forbids keeping a frame-regressing change even with
a strong draw-call win.

Root cause (matches the prompt's stated tradeoff): `rebuildMergedGeometry` runs
`mergeGeometries` over all ~16 chunk geometries on **every** GPU chunk apply (up to
16 full merges per page during streaming convergence), and that
allocation/dispatch cost exceeds the draw-call saving. Visual/collision fidelity
was preserved (holes 0, fall-through counter 0, colliders unchanged) — the
regression is pure CPU remesh cost.

Fix path (not attempted, larger than "surgical"): build the merged geometry once
when a page transitions building→ready (or in-place-extend a single growing
BufferGeometry with an attribute write), instead of re-merging on every chunk
apply. That keeps the draw-call win without the per-apply remesh cost. Flagged for
a follow-up, not silently extended.

## Task 3 — Predictive velocity/camera prefetch

Status: **implemented → measured FLAT → REVERTED.**

Threading: module-level previous center in `terrain_frame_phase.ts`, per-frame
center delta passed as `NearFieldBubbleUpdate.velocity`. Controller reorders new
(not-yet-built) required coords by forward-alignment ahead of closest-first; existing
pages are touched first for free; the required set, collision radius, and budgets
are byte-identical. Zero-velocity path is byte-identical to original. Tests green
(3215/3218).

A/B (acceptance `walk/perf`): per-segment ready/building during motion were
identical (e.g. `east-a:4` both `ready 42 / bld 3`; `south-east:0` base `bld 1` vs
after `bld 2`). draw_calls/triangles/terrain_draw_calls/holes/missing_live_chunks/
lb.required/ready/building/collider_registrations all unchanged. Frame deltas
(p99 9.20→8.80, movement p99 15.70→14.30) are single-run noise with identical
mechanism counts — not attributable to prefetch per the "don't claim FPS without
the counter" rule.

Decision: **REVERTED.** Structural cause: the bubble radius pre-covers the entire
~380m walk corridor, so forward pages are already resident before the route
starts; with `chunkGroupBuildBudget=1` the single leading-edge page created per
frame is already the forward-most one, leaving the order-bias nothing to reorder.
The only path to a real win would be extending the required *visual* set forward
(the capsule), but that raises pending/inflight against an explicit guard on a
scenario the evidence shows is structurally covered — speculative headroom risk.
Flagged, not pursued.

## Task 4 — Numeric page IDs + incremental queues

Status: **no code change — confirmed SKIP by measurement.**

From baseline movement snapshots (bubble active, n=522):

```
live_bubble_ms           max 2.6ms
cpu_work_unit_max_ms     max 0.000ms
gpu_apply_max_ms         max 1.0ms
pending_chunks           max 0
inflight_chunks          max 33
```

The structures Task 4 targets (`pageGroupKey`/`parsePageGroupKey` string ops and
the global sorts in `drainGpuPendingBuilds`/`promoteGpuWaitBuilds`/
`evictColliderBearingCache`) operate over ≤64 pages (`cached_pages=64`,
`required=45`). A full sort of ~64 entries plus a handful of string-key parses is
sub-10µs — an unmeasurable fraction of the 2.6ms bubble time (which is itself
dispatch/apply-bound, not queue-ordering-bound). Well under the ~0.5ms run-to-run
noise floor.

Decision: **SKIPPED.** Matches the prompt's reality-check verbatim ("likely a
micro-optimization... if live_bubble_ms is already negligible, record that and
skip"). Would trade readability for an unmeasurable gain.

## Pending — Tasks 5, 6, 7 (not started)

These are recorded as pending tests; none were implemented or measured. Each
needs a real A/B before any claim.

### Task 5 — Adaptive budgets (dispatch / apply / collider) via moving averages

Pending. Replace fixed budgets (`gpuChunkDispatchBudget`, `GPU_APPLY_BUDGET_MS`,
collider caps) with scheduling that raises throughput when the GPU is underused
and the apply queue is short, and backs off when frame time or apply latency
rises. Signals to average: GPU mesh latency (`live_bubble_avg_chunk_ms`),
main-thread apply time (`live_bubble_gpu_apply_max_ms`), frame-time headroom,
oldest queued page age. Measure movement + steady; the win is faster convergence
without raising frameMs p95 or apply spikes. Guard against oscillation (hysteresis)
and prove stability over a long warmup.

Gate check against captured baseline: `live_bubble_ms` 2.6ms / `gpu_apply_max` 1.0ms
/ `cpu_work_unit_max` 0.0ms show the bubble is not the frame driver, so adaptive
tuning over these knobs is unlikely to move headline frame p95 against the
dominant upstream cost. High complexity; explicit "keep only if clear margin over
tuned fixed budgets" gate — likely a skip-after-measure.

### Task 6 — Coordinated adaptive controller (folds into 5)

Pending. Ensure the adaptive controller from Task 5 governs GPU dispatch, mesh
apply, and collider construction as one coordinated budget, not three
independent knobs fighting each other. Measure the combined effect against Task
5's own baseline. Same complexity/likelihood as Task 5.

### Task 7 — Coarse page colliders/heightfields for unchanged terrain; detailed BVH only for edited chunks

Pending. Reserve expensive per-chunk BVH colliders for edited/complex chunks; use a
cheap page-level heightfield/coarse collider for unedited terrain. Files:
`src/terrain/terrain_collider.ts` (`upsertPage`, footprints) and the collider
registration in `addChunkMesh`; edit/complex-overlay signals already present
(`voxelEditsRequireCpuDerivedMeshing`, `nearFieldPageIntersectsVoxelOverlay`).
Measure: collider construction time + frameMs p95 during streaming, plus a
gameplay/physics correctness check (player must not fall through coarse colliders);
track `live_bubble_collider_*` counters.

Baseline for this task: `collider_registrations=230`, `streamed_collider_pages=10`.
Clean counter to measure a win. Risk: player physics fall-through on coarse
colliders (must gate edited/complex chunks to keep detailed BVH via the existing
signals). Scoped for a separate effort; the physics-correctness guard makes this
the higher-friction of the concrete optimizations.

## Broader takeaway

At the current infinite-islands bubble scale (~45 required pages, ~64 cached,
buildBudget=1), the headline framing optimizations tested here (draw calls via
geometry merge, prefetch ordering, queue micro-opt) are **structurally absorbed**
by the bubble's pre-resident radius (Task 3) or **net-negative** in CPU cost
(Task 2's per-apply remesh). The bubble's own CPU time (`live_bubble_ms` 2.6ms)
is not the frame driver. The actual frame-time drivers on this path are upstream.

## What to look at next (evidence-grounded)

The baseline movement snapshots carry the per-phase `framePerf.p95.*` buckets and
the stream-refinement counters, so the next investigation does not require new
instrumentation — re-read
`tools/clod-poc/acceptance-runs/infinite-islands/2026-07-15T16-21-19/perf-walk-movement.json`.
Ranked by measured magnitude on the infinite-islands walk (n=522 frames, bubble
active):

1. **`farSummaryMs` p95 = 4.7ms — the single biggest phase bucket.** Larger than
   the bubble (2.9ms) and vegetation (2.5ms) combined-point buckets. This is the
   dominant CPU-phase cost on the streaming path. There is prior history here
   (`docs/performance/farsummary-sunlight-regression-2026-07-04.md` — a 335→3.9ms
   regression was fixed by restoring the resumable sun-light tile builder), so the
   subsystem is known-flaky. Next step: break `farSummaryMs` into its existing
   `farSum*Ms` sub-buckets (`farSumSunLightMs`, `farSumNaadfMs`, `farSumTilesMs`,
   `farSumShellMs`, `farSumShadowProxyMs`, `farSumBiomeStreamMs`,
   `farSumStatsDomMs`) to find which sub-driver is now costing 4.7ms, then profile
   that sub-bucket on a cold converge + a moving walk. Do not optimize
   `farSummaryMs` blind — the composite hides the driver.

2. **Root streamer refinement backlog.** During movement:
   `live_clod_stream_required_pages=183` vs `live_clod_stream_ready_pages=71`
   (~39% coverage), `live_clod_stream_refinement_pending_pages` max 120,
   `refinement_inflight=16`, `cached=92`. The near-field bubble rides on top of
   this root streamer; a bubble-only optimization (Task 3/Task 4) cannot move it
   when the backlog is at the root. Next step: profile the refinement pipeline's
   throughput — is `refinement_inflight=16` the bottleneck (budget cap) or GPU
   mesh latency? Compare `live_clod_stream_*` build/apply timings against
   `live_bubble_gpu_apply_max_ms` to see whether the root and the bubble are
   competing for the same GPU mesher lanes (`GpuChunkMesher`, 8 lanes). If so,
   coordinating root-vs-bubble dispatch (a variant of Task 5/6 but across the two
   systems, not within the bubble alone) is the real adaptive target.

3. **`renderMs` max 9.2ms and `otherMs` max 5.6ms.** Render-side cost is
   comparable to the total frame budget on the movement p99 frames. `otherMs` is
   the unattributed gap (postfx / stats sync / submission) — break it down with
   the prop-bucket and broad-bucket ranks already in the perf snapshot
   (`broadBucketsByP95`, `propBucketsByP95`) before assuming bubble/streaming is
   the ceiling.

4. **Task 2 geometry-merge, done right (follow-up, not this session).** The
   −56% draw-call win (470→209) is real and recoverable. The regression was
   purely the per-apply `mergeGeometries` re-running on every chunk completion.
   Next step: build the merged page geometry once at building→ready (or
   in-place-extend a single growing `BufferGeometry` with an attribute write per
   chunk apply, no full re-merge), then re-run the same acceptance A/B. Keep only
   if the draw-call win survives with frame p95 ≤ baseline. Per-chunk colliders
   stay (the edit/tint contracts are already non-load-bearing — surveyed above).

5. **Task 7 (coarse colliders).** Still the cleanest remaining concrete win —
   baseline `collider_registrations=230`, `streamed_collider_pages=10`. But the
   bubble is not the frame driver, so the expected frame p95 win is small; the
   real value is collider-build time during streaming convergence (not captured
   by a current counter — would need a `live_bubble_collider_build_ms` counter
   first, then A/B). Gate edited/complex chunks to keep detailed BVH via
   `voxelEditsRequireCpuDerivedMeshing`/`nearFieldPageIntersectsVoxelOverlay`.
   Physics fall-through check is mandatory before keeping.

Ranking by expected impact-per-effort: **#1 (farSummary sub-buckets) first** —
biggest measured bucket, known-flaky subsystem, single targeted investigation.
Then **#2 (root refinement backlog)**, since it bounds the bubble's readiness
from below. **#4 (geometry-merge done right)** is the cleanest *known* draw-call
win but only after #1/#2 stop dominating. Tasks 5/6/7 are lower priority given
the bubble is not the frame driver.

## Repro artifacts (this session, gitignored)

- `tools/clod-poc/perf-runs/baseline-steady/` — steady-state baseline.
- `tools/clod-poc/acceptance-runs/infinite-islands/2026-07-15T16-21-19/` — movement baseline (Task 2/3 before).
- `tools/clod-poc/acceptance-runs/infinite-islands/2026-07-16T01-14-27/` — Task 3 after.
- `tools/clod-poc/acceptance-runs/infinite-islands/2026-07-16T02-13-31/` — Task 2 after (regression).