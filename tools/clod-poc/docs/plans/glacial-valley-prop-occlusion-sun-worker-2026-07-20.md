# Glacial Valley prop occlusion in far sun visibility — 2026-07-20

## Dependency

This slice is stacked on PR #277, which is stacked on PR #274.

Merge and squash in order, retargeting each remaining PR to `main` before final validation:

1. #274 — prop occluder snapshot contract;
2. #277 — stale-safe shared field and river-mist consumer;
3. this PR — far-sun main/worker integration.

## Scope

This slice makes declared GI-affecting large props participate in the existing far sun-visibility cache without introducing a main-thread-only approximation.

The committed shared field exports one immutable sparse height payload:

- source revision;
- cell size;
- integer world cell coordinates;
- conservative maximum prop height per GI cell;
- aggregate world coverage bounds.

Fog-only proxy cells are excluded from the sun payload.

## Shared exactness path

Main-thread fallback and worker builds both use `createLargePropOcclusionHeightSampler`.

For every height query:

```text
height = max(terrain height, committed prop top for the containing cell)
```

When terrain is unavailable but a committed prop cell exists, the prop top remains a valid conservative blocker.

The worker receives cloned typed arrays. Their transfer cannot detach the active field's cached payload.

Worker parity tests compare complete built tile byte arrays for:

- terrain-only configuration;
- terrain plus sparse prop heights.

## Revision and invalidation policy

The light update reads only committed field revisions. Pending prop-field builds do not change lighting, so the old valid light input remains authoritative until the field swaps.

Authority identity combines:

- a monotonically increasing runtime registration generation;
- the controller-local committed field revision.

This prevents a disposed and recreated prop controller from silently reusing revision `1` and bypassing sun-cache invalidation.

When the committed prop authority key changes:

1. the main-thread height provider swaps to the new sparse payload;
2. old and new aggregate prop bounds become invalidation regions;
3. the existing cache expands those regions by maximum shadow-ray reach;
4. only intersecting built, pending, main-thread in-progress, and remote-inflight tiles are invalidated;
5. the worker receives a new configure ID and immutable payload;
6. results from older configure IDs are discarded and requeued;
7. the GPU sun atlas repacks from the resulting cache content revision.

If aggregate old and new bounds are identical, one invalidation region is sufficient because it covers internal height or occupancy changes.

Fog-only revision changes reconfigure the worker but do not invalidate sun tiles because they produce no GI payload region.

## Diagnostics

```text
large_prop_occlusion_generation
sun_light_prop_occlusion_generation
sun_light_prop_occlusion_revision
sun_light_prop_occlusion_cells
sun_light_prop_occlusion_readbacks
```

The readback counter must remain zero.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/props/large_prop_occlusion_field.test.ts `
  src/props/large_prop_occlusion_height.test.ts `
  src/props/large_prop_occlusion_runtime.test.ts `
  src/terrain/sun_visibility/sun_light_prop_occlusion.test.ts `
  src/terrain/sun_visibility/sun_light_worker_parity.test.ts `
  src/terrain/sun_visibility/sun_light_worker_client.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed QA:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Use `scene=infinite-islands`, enable custom props and the far sun cache, then place and move the ruin-wall proxy at a deterministic open terrain pose. Confirm:

- the wall creates a conservative far shadow response;
- moving it invalidates both the old and new shadow regions;
- unrelated distant light tiles stay resident;
- the old committed prop field remains live while a replacement field builds;
- disposing and recreating the prop controller still invalidates the previous authority;
- worker and forced main-thread fallback produce matching captures;
- config-ID races never adopt stale worker tiles;
- the sun atlas updates after affected cache content changes;
- normal gameplay performs zero readbacks;
- light-cache frame cost and worker backlog remain inside existing budgets.

## Honest boundary

This is conservative coarse-bounds occlusion, not mesh-accurate ray tracing. A partially covered cell uses the highest GI proxy top for the complete cell.

The payload currently uses aggregate old/new coverage bounds for invalidation. This is region-scoped and correct, but multiple distant edited props can invalidate the area between them. Per-component dirty regions should only be added if profiling shows meaningful wasted tile rebuilds.

Water reflection still does not consume prop occupancy. That belongs in the future far-summary middle reflection tier, not in this sun-cache worker protocol.
