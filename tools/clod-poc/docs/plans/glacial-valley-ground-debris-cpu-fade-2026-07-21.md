# Glacial Valley ground-debris classic CPU ring-edge fade — 2026-07-21

## Goal

Hide the hard camera-local boundary of the classic WebGL CPU dressing fallback without transparent blending, per-frame instance updates, or a second placement ring.

## Dependency

This slice is stacked on PR #287, which is stacked on PR #285.

Required merge order:

```text
#285 -> #287 -> this PR
```

## Renderer boundary

This implementation uses `MeshStandardMaterial.onBeforeCompile`, which is the classic WebGL shader-decoration path.

It must not be claimed as the WebGPU CPU-fallback solution. WebGPU requires a separate NodeMaterial decorator using the same pure fade policy and is intentionally left for a later measured slice.

The material remains valid when the hook is not consumed, but the fade acceptance in this PR applies to WebGL only.

## Implementation

Each shared classic CPU debris material receives one `onBeforeCompile` decoration.

Vertex stage:

- publishes the existing Three `worldPosition.xyz` through one varying.

Fragment stage:

- computes camera distance in world XZ;
- resolves the class profile's existing `fadeStartM` and `fadeEndM`;
- derives one deterministic hash from a 0.5 m world-space cell;
- discards fragments when the stable hash exceeds visibility;
- runs before the existing Three dithering fragment chunk.

The fade is world anchored and has no time input, so movement does not cause crawling noise.

## Class ranges

The ranges remain owned by `ground_debris_visuals.ts`:

```text
leaf litter:       70 -> 102 m
needle litter:     70 -> 102 m
twigs:             74 -> 104 m
bark chips:        72 -> 103 m
small talus:       84 -> 110 m
river cobbles:     86 -> 110 m
wet stones:        86 -> 110 m
```

Every class reaches zero before or at the CPU dressing radius.

## Performance contract

- no new draw call;
- no transparent sorting;
- no per-frame uniform upload;
- no CPU instance mutation;
- no texture fetch;
- no readback;
- one small hash and distance calculation in fragment shading;
- material program identity includes shader revision and class fade range.

## Failure policy

Shader injection fails loudly when Three removes or renames either required classic shader anchor:

```text
#include <worldpos_vertex>
#include <dithering_fragment>
```

Silent fallback to a hard WebGL ring edge is not accepted.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/ground_debris_cpu_fade.test.ts `
  src/ecology/dressing/ground_debris_cpu_resources.test.ts `
  src/ecology/dressing/dressing_cpu_ground_debris_contract.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Run `scene=infinite-islands` with `dressingGpu=0` under the classic WebGL renderer.

Walk straight and diagonally across each class's outer radius and verify:

- no circular or square boundary becomes visible;
- the pattern remains world anchored while the camera moves;
- no alpha-sorting halo appears;
- near debris remains unchanged;
- fully faded debris contributes no overdraw beyond 110 m;
- CPU frame update remains unchanged;
- render p95 regression over PR #287 remains `<= 0.05 ms`;
- gameplay readbacks remain zero.

A WebGPU CPU-fallback capture is only a regression smoke check in this PR: it must continue rendering, but fade parity is not claimed until a NodeMaterial implementation exists.

## Honest boundary

The fade operates per fragment, not per instance compaction. Fully faded CPU instances still exist in the InstancedMesh until the normal movement rebuild. The current radius and small class geometry make this acceptable for the classic fallback path; CPU-side compaction should only be added after measurement.
