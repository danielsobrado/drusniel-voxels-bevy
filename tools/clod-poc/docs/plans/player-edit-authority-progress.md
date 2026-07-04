# Player edit authority and streaming stability progress

Scope: tools/clod-poc only. This document tracks player edit authority, construction commit control, acceptance convergence, and near-field cache/dirty-queue work.

## Done

- Added player editing YAML config at `config/player/player_editing.yaml`.
- Added shared player edit authority gates in `src/player/player_edit_authority.ts`.
- Added player edit authority tests.
- Gated terrain edit scheduling by player distance in `terrain_edit_startup.ts`.
- Added defense-in-depth terrain edit authority checks inside `terrain_edit_service.ts`.
- Gated construction terrain conform scheduling by player distance.
- Added defense-in-depth construction terrain conform checks inside `terrain_edit_service.ts`.
- Split construction preview and commit range in runtime startup.
- Added construction capture-phase commit guard.
- Made the construction commit guard support unbounded scenes.
- Disposed the construction commit guard with the construction controller wrapper.
- Cleaned up the construction commit guard if controller startup fails after the guard listener is installed.
- Added an explicit `unboundedWorld` flag to construction placement validation so persisted/preview validation does not reject streamed-world coordinates only because they are outside the startup grid.
- Relaxed live and persisted construction placement validation so unbounded placement does not require meaningful finite world bounds.
- Updated the construction controller terrain raycast to honor `unboundedWorld`, so negative streamed-world construction preview is not rejected by finite startup bounds.
- Avoided finite construction-controller bounds for positive streamed-world scenes by using an expanded construction world bound.
- Mirrored live-bubble GPU retry counters.
- Added acceptance threshold gates for live-bubble retry/failure counters.
- Fixed live-bubble GPU-empty pages so successful all-empty pages become `validEmpty`/ready instead of terminal failures after retries.
- Added/updated near-field tests to lock GPU-empty live pages as valid empty without CPU fallback.
- Added `TerrainEditDirtyQueue` and dirty edit event records with revision + world AABB + effect flags.
- Bounded `TerrainEditDirtyQueue` so it cannot grow forever before downstream consumers are added.
- Hardened the dirty queue bound so invalid constructor values cannot create an endless trim loop.
- Wired terrain edits and construction terrain conform into the dirty edit queue.
- Added tests for the dirty edit queue.
- Cached terrain page paint/biome typed arrays in `page_geometry.ts` to reduce repeated derived-data allocation while avoiding shared `THREE.BufferAttribute` ownership across geometries.

## Still pending

- Add direct construction-controller commit authority so the ghost turns invalid/red beyond commit range before click. Current protection is safe through the pre-controller capture guard and conform gate, but the controller itself does not yet own the commit-distance reason.
- Add explicit `live_bubble_gpu_retry_pages === 0` to `waitForConvergence()` in `tools/infinite-islands-acceptance.ts`. Current acceptance still fails via thresholds if retry pages remain, but the wait predicate itself is not yet retry-aware.
- Run local typecheck/tests/acceptance and fix any compile/runtime drift.
- Consider a deeper collider/BVH cache after profiling. The current safe cache reduces derived terrain paint/biome allocation only.
- Construction LOD/impostor rendering is still a larger follow-up feature.

## Validation required locally

Run after each coding slice:

```bash
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- src/player src/construction src/app/frame_loop src/app/bootstrap/ui src/app/bootstrap/runtime src/terrain/editing src/terrain/near_field
npm --prefix tools/clod-poc run accept:infinite-islands
```

## Notes

- No acceptance thresholds should be weakened.
- Far commits remain disabled unless explicitly enabled by query/config.
- Streamed CLOD roots and far shell remain render/cache systems, not terrain edit authorities.
- Streamed/far terrain is still not the source of truth for edits; committed edits remain near-field and are represented as sparse edit overlay data.
