# Player edit authority progress follow-up — 2026-07-04

Scope: tools/clod-poc only.

## Added after the previous progress document

- `construction_controller.ts` now honors `unboundedWorld` in its own terrain raycast path.
- `construction_controller.ts` now owns the player build commit authority decision.
- Construction preview candidates beyond commit range become invalid before click, so the ghost/menu show the commit-distance reason.
- `runtime_systems_startup.ts` wires the same edit authority config, authority origin, and counters into the construction controller.
- The existing capture-phase construction commit guard remains as defense-in-depth.

## Current pending items

- Add `live_bubble_gpu_retry_pages === 0` to `waitForConvergence()` in `tools/infinite-islands-acceptance.ts`.
- Run local typecheck, targeted tests, build, and `accept:infinite-islands`.
- Fix any drift found by local validation.
- Deeper collider/BVH caching and construction LOD/impostors remain larger follow-up features after profiling.

## Local validation

```bash
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/player src/construction src/app/frame_loop src/app/bootstrap/ui src/app/bootstrap/runtime src/terrain/editing src/terrain/near_field
npm --prefix tools/clod-poc run accept:infinite-islands
```
