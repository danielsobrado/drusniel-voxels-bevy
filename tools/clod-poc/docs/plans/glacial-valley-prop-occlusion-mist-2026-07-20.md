# Glacial Valley prop occlusion field and river mist — 2026-07-20

## Dependency

This slice is stacked on the large-prop occluder contract in PR #274.

Merge and squash #274 first, then retarget this branch to `main` before final validation.

## Scope

This slice turns the revisioned large-prop bounds into one shared coarse occupancy field and uses the fog channel to attenuate river-mist spawning inside ruin walls and other declared coarse fog proxies.

It does not create a second prop authority. The field only consumes `PropController.getOccluderSnapshot()` output from the existing custom-prop placement and asset metadata pipeline.

## Field behavior

The field stores, per world-space cell:

- GI footprint coverage;
- GI minimum and maximum world height;
- fog footprint coverage;
- fog minimum and maximum world height;
- the committed source revision.

GI and fog channels are independent because existing prop definitions can opt into either influence separately.

Overlapping prop coverage is combined conservatively using coverage union rather than simple addition.

## Stale-safe rebuild

When a new snapshot revision arrives:

1. the current committed field remains readable;
2. a separate pending field rasterizes individual cells;
3. no frame processes more than `large_prop_occlusion.build_cells_per_frame` cells;
4. a single oversized prop cannot bypass the budget;
5. the pending map replaces the active map atomically after completion.

A newer revision replaces an older pending build. Disabled or empty snapshots publish an empty field immediately.

Initial construction is fail-open until the first complete revision is committed. Rebuilds continue serving the previous valid revision instead of temporarily removing occlusion.

## River mist integration

River mist keeps the existing:

- production `EnvironmentQuery` ownership;
- coarse hydrology sample hint;
- invalid-authority fail-closed behavior;
- scan-cell budget;
- emitter and particle caps.

For candidate emitters with a positive mist signal, the overlay samples the active prop field without allocations. Mist strength is attenuated only when:

- the field has a committed valid revision;
- the cell contains fog occupancy;
- the candidate spawn height lies within the proxy's vertical interval.

Missing, disabled, not-yet-built, empty, or vertically separate prop data fails open so stale infrastructure cannot erase river ambience.

This first consumer clips new mist emission. It does not collide or remove particles that already drifted into a prop volume.

## Diagnostics

```text
large_prop_occlusion_active_revision
large_prop_occlusion_pending_revision
large_prop_occlusion_active_cells
large_prop_occlusion_pending_cells
large_prop_occlusion_pending
large_prop_occlusion_cells_last_step
large_prop_occlusion_swaps
large_prop_occlusion_readbacks
river_mist_prop_occlusion_samples
river_mist_prop_occlusion_clipped
river_mist_prop_occlusion_readbacks
```

Both readback counters must remain zero in normal gameplay.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/props/large_prop_occlusion_field.test.ts `
  src/water/river_mist_prop_occlusion.test.ts `
  src/water/riverMistOverlay.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed QA:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Use `scene=infinite-islands`, enable custom props and morning river mist, and place the ruin-wall proxy across a deterministic mist-producing reach. Confirm:

- mist emission is attenuated inside the wall footprint and vertical range;
- mist outside the footprint is unchanged;
- crates and props without a coarse fog proxy do not clip mist;
- moving or replacing the wall keeps the old valid field until the new revision swaps;
- no empty-field pop occurs during rebuild;
- `cells_last_step` never exceeds the YAML budget;
- both readback counters remain zero;
- cumulative river ambience remains inside its CPU and render budgets.

## Honest boundary

This PR does not yet integrate prop occupancy with far sun visibility or middle-distance water reflection.

The far-sun worker cannot safely consume this field until its request protocol carries a revisioned prop snapshot or raster representation and invalidation includes prop dirty regions. The water reflection tier should consume the same committed field only after the intended far-summary march exists.

This field is currently CPU-resident because its first consumer is a CPU emitter scan. A GPU texture upload should be added once a GPU consumer exists, not speculatively.
