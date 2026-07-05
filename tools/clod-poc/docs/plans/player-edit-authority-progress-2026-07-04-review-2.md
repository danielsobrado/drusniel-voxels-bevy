# Player edit authority progress follow-up 2 — 2026-07-04

Scope: tools/clod-poc only.

## Added in this review pass

- `construction_controller.ts` owns the build commit authority check.
- `runtime_systems_startup.ts` wires authority config, origin, and counters into the construction controller.
- The pre-controller construction commit guard remains as defense-in-depth.
- `terrain_frame_phase.ts` mirrors `live_bubble_building_pages` as nonzero while `live_bubble_gpu_retry_pages` is nonzero.
- This makes the existing `waitForConvergence()` predicate retry-aware without weakening acceptance thresholds: convergence cannot become quiet while GPU retry pages remain.
- `terrain_frame_phase.test.ts` now locks the retry-aware building mirror behavior.

## Current local validation target

```bash
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/player src/construction src/app/frame_loop src/app/bootstrap/ui src/app/bootstrap/runtime src/terrain/editing src/terrain/near_field
npm --prefix tools/clod-poc run accept:infinite-islands
```

## Remaining larger follow-ups

- Deeper collider/BVH cache after profiling.
- Construction LOD/impostor rendering.
- Direct edit-journal consumers for the dirty edit queue.
