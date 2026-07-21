# Glacial Valley ground-debris biome response — 2026-07-21

## Goal

Make GPU ground debris participate in the same seasonal, wet, frost, and altitude story as terrain and vegetation without adding another environmental authority or material polling loop.

## Dependency

This slice is stacked on PR #286, which is stacked on PR #285.

Required merge order:

```text
#285 -> #286 -> this PR
```

## Existing authority

The shared biome visual state already resolves:

- autumn amount;
- frost amount;
- dew amount;
- snowline height;
- enabled/disabled state.

The existing biome material runtime already ticks when grass updates and updates terrain and vegetation bindings only when the resolved state signature changes.

## Implementation

One module-level TSL uniform set is shared by every ground-debris material:

```text
enabled
autumn
frost
dew
snowlineM
```

The existing biome material runtime updates that set on initial installation and on normal biome-state ticks. No ecological-dressing scene traversal or per-material polling is added.

## Per-class policy

Organic debris receives restrained autumn response:

- leaf litter: strongest;
- needle litter: moderate;
- twigs and bark chips: subtle.

Mineral debris receives no autumn tint.

All owned debris classes can receive frost and altitude snow response. River cobbles and wet stones receive stronger dew response than dry talus and wood fragments.

## Material composition order

```text
shared dry/wet class profile
  + max(per-instance wetness, biome dew response)
  + organic-only autumn tint
  + frost / snowline tint and roughness
  + stable per-instance variation
  + canonical far-sun visibility response
```

The slice preserves PR #286's far-sun authority and PR #285's stable ring-edge dither.

## Performance contract

- one shared uniform set for all debris materials;
- no material or pipeline recreation during season changes;
- no new texture, storage buffer, draw call, render pass, or gameplay readback;
- no CPU environmental sampling;
- no scan of the ecological-dressing scene root;
- unchanged 87 indirect draw groups;
- incremental render p95 regression over PR #286 `<= 0.05 ms`.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/gpu/ground_debris_biome_policy.test.ts `
  src/ecology/dressing/gpu/ground_debris_biome_state.test.ts `
  src/ecology/dressing/gpu/ground_debris_biome_contract.test.ts `
  src/ecology/dressing/gpu/ground_debris_sun_visibility_contract.test.ts `
  src/environment/biome_visual_material_routing.test.ts `
  src/environment/biome_visual_state_runtime.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Run `scene=infinite-islands` with WebGPU, `dressing=1`, and `dressingGpu=1`.

Capture identical fixed poses for:

- green summer;
- autumn peak;
- wet weather/dew;
- frost morning;
- below and above snowline;
- ridge shadow with far-sun visibility active.

Verify:

- leaf litter warms more than needles, twigs, or bark;
- stones do not acquire an autumn-orange tint;
- dew darkens/polishes through the existing wet profile without abrupt switching;
- frost cools colour and increases roughness;
- debris above snowline receives the altitude response;
- biome and far-sun response compose without blackening;
- season changes update uniforms without recreating materials or pipelines;
- draw groups remain 87;
- gameplay readbacks remain zero;
- render p95 regression over PR #286 remains `<= 0.05 ms`.

## Honest boundary

This is material response only. It does not change debris density, placement, persistence, geometry, snow accumulation thickness, texture arrays, normal maps, grass contact suppression, or CPU-fallback seasonal parity.
