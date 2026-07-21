# Glacial Valley far-summary water reflection — 2026-07-20

## Dependencies

This slice is stacked on PR #281, which is stacked on the large-prop occlusion series:

1. #274 — large-prop occluder snapshots;
2. #277 — stale-safe shared prop field and mist clipping;
3. #280 — prop heights in far sun visibility;
4. #281 — stale-safe far-reflection source;
5. this PR — middle-distance water consumer.

PR #276 also modifies the water material path. Merge or rebase #276 before final headed validation, then resolve the small `waterNodeMaterial.ts` composition point without dropping either decorator.

## Scope

This slice replaces reduced-step screen-space reflection on middle water rings with a bounded world-space march over the coherent far-reflection source.

The final tier policy is:

```text
fine rings   -> existing full SSR/refraction path
middle rings -> far-summary world march
coarse rings -> existing analytic sky/terrain fallback
```

The feature is disabled in production YAML until headed visual and performance acceptance is attached. It can be enabled with:

```text
waterFarReflection=1
```

Enabling the feature also enables reflection tier routing in the effective startup copy without mutating the loaded baseline configuration.

## Data and GPU ownership

All middle-ring water materials share one persistent `StorageBufferAttribute` for the configured source resolution.

Default footprint:

```text
65 × 65 × vec4<f32> = 67,600 bytes
```

The upload path:

- reads only committed source snapshots;
- copies only when runtime registration or committed source generation changes;
- clears and fails closed on missing, disabled, or incompatible snapshots;
- preserves immutable producer data;
- performs no GPU readback;
- binds the storage buffer only on middle-ring materials.

## March contract

The shader reflects the world-space camera ray against a lightweight animated water normal and performs a configured geometric-distance schedule.

Default schedule:

```text
16, 28.8, 51.84, 93.312, 167.9616, 302.33088 metres
```

Properties:

- five to eight steps, clamped by configuration;
- no sample beyond the configured maximum distance;
- 6-step default covers nearly the complete 320 m middle tier;
- source coordinates are checked before storage access;
- storage indices are unsigned;
- terrain and large-prop blockers use independent strengths;
- misses and invalid sources preserve the analytic sky fallback;
- live source-resolution changes fail closed because storage topology is compiled per material.

This is not screen-space sampling and does not read viewport color or depth.

## Material integration

The feature decorates the completed WebGPU water NodeMaterial rather than replacing the large base shader.

It preserves:

- existing near SSR and refraction;
- SSR miss routing;
- foam, glitter, caustics, suspended scatter, and body presets;
- current clipmap material factory and update lifecycle;
- WebGL behavior.

Only middle-ring materials receive the extra graph and storage binding.

## Debug and diagnostics

Water debug mode:

```text
farReflectionHit = 16
```

Runtime counters:

```text
far_reflection_source_*
water_far_reflection_source_valid
water_far_reflection_source_generation
water_far_reflection_source_uploads
water_far_reflection_source_bytes
water_far_reflection_source_readbacks
```

All readback counters must remain zero.

## Validation required

```powershell
npm --prefix tools/clod-poc test -- `
  src/terrain/far_clipmap/far_reflection_source_config_runtime.test.ts `
  src/water/water_far_reflection_config.test.ts `
  src/water/water_far_reflection_gpu_source.test.ts `
  src/water/water_far_reflection_schedule.test.ts `
  src/water/water_far_reflection_node_source.test.ts `
  src/water/water_reflection_tiers.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Start the infinite-islands scene with WebGPU, high-quality water, far clipmap, custom props, and the feature gate enabled.

Verify at deterministic river, lake, coast, and aerial poses:

- fine rings still use the existing SSR path;
- 8 m and 16 m rings show stable terrain reflection instead of reduced SSR bands;
- 32 m coarse rings remain analytic sky fallback;
- the ruin-wall proxy appears as a conservative reflection blocker;
- moving the wall keeps old committed reflection data until the new source swaps;
- source snapping does not create visible reflection discontinuities;
- debug mode 16 shows middle-tier hits only;
- one source generation creates at most one shared upload;
- source build cells never exceed the configured frame budget;
- gameplay readbacks remain zero;
- frame and render p95 remain inside the existing water acceptance budgets;
- WebGPU validation reports no storage binding, index, or Dawn syntax errors.

## Honest boundary

The middle tier reflects coarse blocker classes using stable terrain/prop colours rather than mesh-accurate albedo, normals, or ray-traced materials. Its water normal is a lightweight approximation derived from the existing ripple parameters because the base shader does not expose its internal normal node across module boundaries.

This is intentionally a bounded reflection proxy, not path tracing or full scene ray tracing. Production enablement must wait for headed evidence, comparison against the current fallback, and rebase validation with PR #276.
