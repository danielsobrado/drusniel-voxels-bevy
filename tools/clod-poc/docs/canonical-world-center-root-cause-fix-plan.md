# 2.5 — Root-Cause Coordinate Fix (infinite-islands center split)

## Why this milestone exists

Plans 1 and 2 are diagnostic/guard only. Plan 1 explicitly says it "is not the final fix for the source coordinate bug." Plan 2 only makes center divergence a counter. Plans 3–6 are each gated on "center alignment fixed" — but with plans 1 and 2 alone, **nobody actually fixes the bug**. This milestone is that fix. It sits between plan 2 and plan 3 and is the true gate for the GPU-migration work.

The observed failure: terrain/mountains, the vegetation ring, and the ocean/far shell render in three different world-space regions in infinite-islands, most visibly in orbit mode.

## Entry criteria

- Plan 1 (streamed-page bounds guard) landed: `live_clod_stream_bounds_guard_*` counters exist and reject malformed pages.
- Plan 2 (center debug counters) landed: `camera_to_vegetation_ring_center_m`, `camera_to_water_ocean_center_m`, etc., plus the pre-existing `camera_to_clod_center_m` / `camera_to_far_shell_center_m`, are published.

## Success criteria (this is a fix, verified visually — not just counters)

1. In a headed/real-GPU run of `scene=infinite-islands` in **both** orbit and player mode:
   - every `camera_to_<system>_center_m` counter ≤ the plan-2 fail threshold (start 64 m, tighten to 8 m for non-snapped systems);
   - `live_clod_stream_bounds_guard_rejected_pages = 0` (the guard should stop firing once origins agree);
2. Deterministic shot-harness evidence (see CLAUDE.md "Shot Harness, Hooks, Fail-Loud Boot"): a fixed pose captured with `setPose()` + `settle()` shows terrain, vegetation, far shell, and ocean in the same world region, before and after, with the stats JSON attached.

## Diagnosis loop (do this first — do not guess the cause)

The bug class is "valid locally, wrong globally." Use the plan-1 guard reason and the plan-2 counters to localize before editing:

| Evidence | Localized cause | Fix site |
| --- | --- | --- |
| guard `origin_mismatch` / `xz_out_of_bounds` with correct extent | page inserted in wrong space | streamed-root apply in [src/terrain/streaming/clod_streaming_roots.ts](../src/terrain/streaming/clod_streaming_roots.ts) |
| `camera_to_vegetation_ring_center_m` large, `camera_to_clod_center_m` ~0 | vegetation ring uses `controls.target`, not camera | vegetation ring center injection (see below) |
| `camera_to_water_ocean_center_m` large | ocean plane anchored to finite-world center | water/ocean center source |
| `camera_to_far_shell_center_m` large, source = startup_world | far shell stuck at startup origin | far shell recenter |

Reproduce deterministically with a fixed pose and the debug flags on:

```text
?scene=infinite-islands&populatedPerf=1&worldCenterDebug=1&liveClodRootBoundsGuard=1
```

## The likely fix (confirm each against main before editing)

The plan-2 audit already identified the prime suspect: **in orbit mode the vegetation ring follows `controls.target` while terrain/streaming follow the camera.** The canonical center is the camera position (used by [src/far-summary/stream-center.ts](../src/far-summary/stream-center.ts) and [src/stream/ownership_coverage_oracle.ts](../src/stream/ownership_coverage_oracle.ts)). The fix is to route every ring/summary/ocean center through that same camera-derived center:

1. Compute the canonical center once per frame in [src/app/clod_frame_loop.ts](../src/app/clod_frame_loop.ts) (plan 2 already does this) and thread it into the vegetation, canopy, and water update calls that currently read `controls.target` or a cached finite-world origin.
2. For snapped systems (far clipmap, far summary rings), keep snapping — but snap the **camera-derived** center, and verify the snapped origin is within one snap interval of it (plan 2's snapped-center counters).
3. Re-run the guard: `rejected_pages` should fall to 0 if the streamed-root origin derivation was the cause; if it does not, the cause is in `clod_streaming_roots.ts` origin/space handling, not vegetation.

Search `main` for the actual `controls.target` / `centerX` / `startupWorld` reads before patching — the exact call sites move. Do not change center *semantics* for finite scenes; gate the change on `scene=infinite-islands`.

## Non-goals

- Do not start any GPU migration (plans 3–6) here.
- Do not weaken plan-1 or plan-2 thresholds to make counters pass.
- Do not "fix" the symptom by snapping everything to the CLOD center silently — the counters must show genuine agreement.

## Verification commands

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
# headed / real-GPU acceptance (headless = SwiftShader, does not exercise the real path):
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene biome-near
node tools/run-infinite-islands-acceptance.mjs --reuse --gate perf --scene walk
```

Attach: the before/after fixed-pose shot + stats JSON, and the `camera_to_*_center_m` values from the run summary.

## Exit criteria (gate for plans 3–6)

```text
camera_to_clod_center_m           <= 8
camera_to_vegetation_ring_center_m <= 8
camera_to_water_ocean_center_m    <= 8  (or <= snap interval if snapped)
camera_to_far_shell_center_m      <= snap interval
live_clod_stream_bounds_guard_rejected_pages = 0
two clean headed runs + one fixed-pose screenshot showing aligned regions
```

Only after this passes do plans 3, 4, 5, 6 begin.
