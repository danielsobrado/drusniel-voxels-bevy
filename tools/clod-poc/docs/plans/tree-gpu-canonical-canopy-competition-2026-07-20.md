# GPU Tree Canonical Canopy Competition

Status: draft implementation; native Dawn and headed verification pending.

## Problem

The WebGPU tree candidate pass derives morphology during acceptance, but its crown-pressure input was generated from a synthetic deterministic occupancy sampler.

The canonical forest-lighting field already publishes accepted-canopy competition in the alpha channel of its GPU detail texture. Tree impostor diagnostics and understory consume the same field, but GPU tree morphology did not.

As a result, tree age, width, health, and foliage density could describe a different canopy population from the field used by forest lighting, grass suppression, understory, and diagnostics.

## Fixed authority

```text
accepted tree and understory proxies
  -> forest-lighting field rebuild
  -> detailTexture.a = canonical scalar competition
  -> active shared GPU detail texture
  -> tree candidate compute binding 17
  -> bilinear world-space sample
  -> morphology age / width / health / foliage response
  -> one shared visible + shadow morphology record
```

The existing deterministic directional sampler remains responsible for `openLightDirectionXZ` and directional pressure because the canonical field currently stores only scalar competition.

## GPU lifecycle

The tree compute path:

- registers its WebGPU device with the existing forest-lighting GPU texture authority;
- owns one 1x1 zero-valued fallback texture;
- binds the fallback while no canonical field is available;
- detects shared detail-texture identity changes before dispatch;
- recreates only the bind group when the texture object changes;
- keeps normal in-place field uploads on the existing bind group;
- refreshes world-size, resolution, and enabled uniforms every dispatch;
- returns to the fallback if the field is disposed;
- never destroys the shared forest texture;
- adds no gameplay GPU readback.

## Sampling contract

The WGSL sampler matches the canonical CPU texture mapping:

```text
uv = clamp(world_xz / world_cells, 0, 1)
texel = uv * (resolution - 1)
competition = bilinear(detailTexture.a)
```

When the canonical texture is unavailable, disabled, invalid, or outside its world bounds, morphology uses the previous deterministic synthetic scalar pressure. Placement remains fail-open.

## Diagnostics

```text
tree_gpu_canopy_competition_active
tree_gpu_canopy_competition_rebinds
tree_gpu_canopy_competition_readbacks = 0
```

The current runtime fields are exposed as:

```text
TreeGpuRingStats.canopyCompetitionActive
TreeGpuRingStats.canopyCompetitionRebinds
TreeGpuRingStats.canopyCompetitionReadbacks
```

## Required verification

```powershell
npm --prefix tools/clod-poc test -- `
  src/gpu/tree_canopy_competition_binding.test.ts `
  src/gpu/tree_canopy_competition_wgsl_transform.test.ts `
  src/gpu/tree_canopy_competition_runtime_contract.test.ts `
  src/gpu/tree_ring_compute.test.ts `
  src/forest_lighting/forest_lighting_texture.test.ts `
  src/trees/morphology/competition.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

Dawn validation must compile all three tree compute pipelines with binding 17 present.

## Headed acceptance

Use deterministic clearing-edge and dense-forest poses with WebGPU trees enabled.

Verify:

- the authority starts fail-open if the forest field is not ready;
- it activates after the canonical detail texture appears without rebuilding tree geometry resources;
- dense accepted canopy reduces age, crown width, health, and foliage density;
- clearing-edge crowns remain less compressed;
- visible and shadow morphology stay identical;
- disabling or recreating the forest field switches texture authority safely;
- normal field updates do not increment the rebind counter;
- texture recreation increments the rebind counter once;
- competition readbacks remain zero;
- frame p95 regression remains within 5%;
- tree compute submit p95 does not regress by more than 0.15 ms.

## Honest boundary

The canonical field stores scalar competition only. Crown opening direction still uses the deterministic directional occupancy sampler.

This PR does not change CPU tree generation; CPU accepted-crown competition is isolated in PR #282. It also does not alter placement acceptance, stable identities, instance packing, LOD selection, impostor baking, crown proxies, or forest field generation.

Do not hide a performance or morphology mismatch by disabling the canonical field, weakening morphology formulas, or widening LOD transition bands.
