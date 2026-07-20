# Canopy/ecology P0 completion — 2026-07-20

## Scope

P0 establishes one accepted-tree-derived canopy/ecology authority for vegetation, ecological dressing, forest lighting, atmosphere hints, and water reflection misses. It does not include terrain-relative probe GI; that remains the separate PGI-1 through PGI-8 renderer project.

## Completed

- Canonical field channels:
  - canopy density;
  - canopy height in metres;
  - broadleaf coverage;
  - conifer coverage;
  - forest edge;
  - understory density;
  - competition;
  - grass suppression;
  - ambient occlusion, shadow proxy, fog density, and sun-shaft mask.
- The field is built from accepted tree and understory proxies with the existing amortized, double-buffered rebuild.
- CPU consumers use bilinear sampling from the packed live field.
- GPU consumers receive three `rgba8unorm` textures. Normal gameplay adds no GPU-to-CPU readback.
- GPU understory uses canonical canopy density and forest edge, with deterministic procedural fallback before the field is ready.
- GPU grass uses canonical forest lighting for direct-sun visibility and density suppression.
- Ecological dressing uses canonical species coverage, forest edge, competition-derived moisture, sky exposure, and sun exposure while retaining existing stable IDs, hydrology affinity, LODs, diagnostics, and rendering.
- High-quality WebGPU water uses canonical canopy at the active view to shift SSR misses toward terrain/vegetation fallback and away from open-sky fallback. SSR hits are unchanged. Fallback strengths are quantized to prevent continuous material refresh while moving.

## Invariants

- No gameplay GPU readback is introduced.
- Existing synthetic fields are startup/fail-open fallbacks only where the canonical field may not yet exist.
- Existing tree, understory, dressing, and water ownership remain unchanged.
- The original large dressing and TSL water implementations are preserved as base modules; the public modules contain the canopy-specific integration layer.

## Verification

Run from the repository root:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test -- `
  src/forest_lighting/forest_lighting_ecology.test.ts `
  src/forest_lighting/forest_lighting_texture.test.ts `
  src/gpu/grass_sun_visibility_wgsl_transform.test.ts `
  src/gpu/understory_canopy_ecology_wgsl_transform.test.ts `
  src/gpu/understory_ring_compute.test.ts `
  src/ecology/dressing/dressing_canopy_environment.test.ts `
  src/water/water_canopy_reflection_fallback.test.ts
npm --prefix tools/clod-poc run build
```

Headed acceptance should use `scene=infinite-islands` and confirm:

- grass density decreases under dense accepted canopy without a hard ring edge;
- ferns, moss, fungi, deadfall, and flowers follow the visible forest instead of an independent noise field;
- water SSR misses near forested shores retain more terrain/vegetation response and less open-sky response;
- GPU readback counters remain zero in normal gameplay;
- no new frame spike appears when crossing canopy-field texels.

## Remaining outside P0

- PGI-1 through PGI-8 terrain-relative probe GI;
- per-fragment spatial canopy sampling in the water reflection fallback;
- production Bevy/Rust port of the validated CLOD-POC contracts.
