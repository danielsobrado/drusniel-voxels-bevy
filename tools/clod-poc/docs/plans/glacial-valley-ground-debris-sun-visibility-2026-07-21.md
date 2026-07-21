# Glacial Valley ground-debris sun visibility — 2026-07-21

## Dependency

This slice is stacked on the grounded GPU debris renderer in PR #285.

## Goal

Make small ground debris respond to the same low-frequency terrain/prop sun occlusion used by other far-field consumers, without adding shadows, readbacks, render passes, or another visibility authority.

## Authority

```text
sun-light cache / worker
  -> canonical GPU visibility atlas
  -> shared fail-open TSL atlas helper
  -> debris instance world XZ
  -> restrained 0.78..1.0 albedo response
  -> existing MeshStandardNodeMaterial lighting
```

The atlas does not replace PBR direct and ambient lighting. It provides a subtle low-frequency visibility response so litter and stones under ridges or large occluders do not remain as bright as open terrain.

## Runtime contract

- use `buildSunLightGpuAtlasNodes`;
- sample at `position_scale.xz` from the existing accepted GPU record;
- use the helper's missing-value, outside-atlas, and invalid-atlas fail-open behavior;
- preserve the shared texture and uniforms;
- never create a private texture, CPU sampler, or visibility cache;
- never map or read back GPU data;
- add no shadow caster and no render pass;
- clamp the visual response to a 22% maximum darkening;
- retain wetness, stable variation, roughness, and ring-edge fade from PR #285.

## Required verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/gpu/ground_debris_sun_visibility_contract.test.ts `
  src/ecology/dressing/gpu/ground_debris_visuals.test.ts `
  src/ecology/dressing/gpu/ground_debris_geometry.test.ts `
  src/terrain/sun_visibility/__tests__/sun_light_gpu_atlas.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Use the same deterministic `infinite-islands` debris poses as PR #285, with the far sun-light cache active.

Capture:

1. open meadow debris;
2. debris behind a ridge;
3. forest-floor debris under canopy/ridge shade;
4. river cobbles moving from open sun into terrain shade;
5. a location outside the active atlas window;
6. a location while the atlas is temporarily invalid during refresh.

Verify:

- open debris retains the PR #285 appearance;
- blocked debris darkens subtly, never to black;
- wet darkening and sun visibility compose without sudden hue shifts;
- outside or invalid atlas coverage is fully fail-open;
- atlas updates introduce no material or pipeline recreation;
- the shared atlas texture remains the only visibility texture;
- no new draw call, shadow draw, render pass, or gameplay readback appears;
- render p95 regression over PR #285 remains `<= 0.05 ms`;
- total high-quality debris delta remains `<= 0.45 ms p95`.

## Honest boundary

This is low-frequency albedo modulation, not mesh-accurate shadowing. It does not add normal-map response, contact shadows, canopy-specific occlusion, Probe GI, seasonal colour, or direct-light cancellation. A stronger response would double-count the existing PBR lighting and is intentionally out of scope.
