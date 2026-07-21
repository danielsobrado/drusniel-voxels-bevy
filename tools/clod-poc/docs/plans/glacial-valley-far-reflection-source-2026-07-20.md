# Glacial Valley far-reflection source — 2026-07-20

## Dependency

This slice is stacked on PR #280, which depends on #277 and #274.

Merge and squash the prop-occlusion stack first, then retarget this PR to `main` before final validation.

## Scope

This slice publishes one compact camera-centered source for the planned middle-distance water-reflection march.

It does not modify the water material. That remains a separate consumer PR so this data authority can be reviewed, tested, and reverted independently of water shader work.

## Source layout

Each committed cell stores one `vec4`:

```text
x = conservative top Y
Y = terrain sample valid
z = GI-affecting large prop present
w = terrain or prop valid
```

The top is:

```text
max(far-summary terrain height, committed large-prop top)
```

A prop top remains a valid blocker when the terrain source is temporarily unavailable.

## Lifecycle

The source:

- uses the same coherent `FarClipmapSource` as the visible far clipmap;
- follows a snapped camera-centered world window;
- keys replacement builds by snapped origin, far-summary revision, prop authority generation, and committed prop revision;
- processes a strict configured number of cells per frame;
- replaces obsolete pending builds when a newer revision arrives;
- keeps the old immutable snapshot readable until the replacement completes;
- swaps the completed typed array atomically;
- registers one active runtime authority with identity-safe cleanup;
- performs no GPU readback.

The controller integration is opt-in. No producer is constructed unless the next YAML-backed consumer supplies an enabled `reflectionSource` configuration.

## Diagnostics

```text
far_reflection_source_registration_generation
far_reflection_source_active_generation
far_reflection_source_source_revision
far_reflection_source_prop_revision
far_reflection_source_pending
far_reflection_source_pending_cells
far_reflection_source_cells_last_step
far_reflection_source_fallback_samples_total
far_reflection_source_exception_samples_total
far_reflection_source_swaps
far_reflection_source_readbacks
```

The readback counter must remain zero.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/terrain/far_clipmap/far_reflection_source.test.ts `
  src/terrain/far_clipmap/far_reflection_source_runtime.test.ts `
  src/terrain/far_clipmap/far_clipmap_current_snap_controller.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance after consumer integration

Use `scene=infinite-islands` with the far clipmap, high-quality water, custom props, and the ruin-wall proxy enabled.

Verify:

- the source window follows snapped camera movement;
- old data stays active while a replacement builds;
- source and prop revision changes replace pending work rather than accumulating it;
- the configured cell budget is never exceeded;
- large props raise conservative reflection-source heights without terrain edits;
- registration is removed on far-clipmap disposal;
- no gameplay readbacks occur;
- source build cost remains outside the frame p95 budget.

## Honest boundary

This PR publishes data only. It does not yet upload the source to a water material, perform the bounded reflection march, choose a reflection tier, or change rendered water. The next PR owns YAML parsing, GPU storage upload, shader consumption, tier debugging, and visual/performance evidence.
