# Glacial Valley large-prop occluder contract — 2026-07-20

## Scope

This slice publishes one conservative, revisioned snapshot of custom-prop bounds for later lighting, fog, reflection, and mist consumers.

It does not add a second prop placement authority. The snapshot is derived from:

- the active `PropSystem` placement grid;
- loaded asset metadata from the existing GLB registry;
- each instance's stable position, yaw, scale, and revision;
- the existing `lighting_proxy.mode: coarse_bounds` asset contract;
- YAML-owned filtering and conservative footprint padding.

## Ownership

`PropController` owns the snapshot lifecycle because it already coordinates loaded metadata, placement replacement, enablement, colliders, and editing.

The snapshot refreshes only after:

- prop initialization completes;
- the placement scene is replaced;
- custom props are enabled or disabled;
- the controller is disposed.

There is no per-frame snapshot rebuild.

## Contract

Each accepted occluder contains:

- a stable asset/index key;
- the source instance revision;
- a conservative world-space AABB;
- world-space height;
- independent GI and fog influence flags.

Assets are excluded when:

- custom props or large-prop occlusion are disabled;
- no loaded metadata exists;
- `lighting_proxy.mode` is not `coarse_bounds`;
- neither GI nor fog influence is enabled;
- transformed bounds are invalid;
- the transformed height is below the configured minimum.

Yaw transforms every local XZ corner before forming the conservative world AABB. The configured footprint padding is applied after rotation.

## Configuration

Production values live in `config/custom_props.yaml`:

```text
large_prop_occlusion.enabled
large_prop_occlusion.cell_size_m
large_prop_occlusion.build_cells_per_frame
large_prop_occlusion.footprint_padding_m
large_prop_occlusion.minimum_height_m
large_prop_occlusion.mist_clip_strength
```

The build budget is expressed in raster cells, not occluders. A single very large bound therefore cannot bypass the per-frame limit in the follow-up field builder.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/props/prop_config.test.ts `
  src/props/prop_occluder_snapshot.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Headed QA should enable custom props, load the ruin-wall asset, edit or reload its placement, and verify that:

- the snapshot revision changes once per authoritative event;
- transformed bounds follow translation, yaw, and scale;
- disabling custom props publishes an empty disabled snapshot;
- ordinary crates and assets without a coarse lighting proxy remain excluded;
- no new work appears in the normal frame loop.

## Honest boundary

This PR publishes bounds only. It does not yet rasterize a shared coarse field and does not change sun visibility, water reflection, or river mist. Those integrations must consume this contract in later focused PRs.

The far-sun worker path is intentionally untouched. Adding prop occlusion there requires an explicit worker protocol and invalidation design; silently falling back to a main-thread-only path would be incorrect.
