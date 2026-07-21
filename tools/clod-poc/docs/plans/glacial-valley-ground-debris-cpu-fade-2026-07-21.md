# Glacial Valley ground-debris CPU ring-edge fade — 2026-07-21

## Goal

Hide the hard camera-local boundary of the CPU/WebGL dressing fallback without transparent blending, per-frame instance updates, or a second placement ring.

## Dependency

This slice is stacked on PR #287, which is stacked on PR #285.

Required merge order:

```text
#285 -> #287 -> this PR
```

## Implementation

Each shared CPU debris material receives one `onBeforeCompile` decoration.

Vertex stage:

- publishes the existing Three `worldPosition.xyz` through one varying.

Fragment stage:

- computes camera distance in world XZ;
- resolves the class profile's existing `fadeStartM` and `fadeEndM`;
- derives one deterministic hash from a 0.5 m world-space cell;
- discards instances/fragments when the stable hash exceeds visibility;
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

Shader injection fails loudly when Three removes or renames either required anchor:

```text
#include <worldpos_vertex>
#include <dithering_fragment>
```

Silent fallback to a hard ring edge is not accepted.

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

Run `scene=infinite-islands` with `dressingGpu=0` in WebGL and WebGPU CPU-fallback modes.

Walk straight and diagonally across each class's outer radius and verify:

- no circular or square boundary becomes visible;
- the pattern remains world anchored while the camera moves;
- no alpha-sorting halo appears;
- near debris remains unchanged;
- fully faded debris contributes no overdraw beyond 110 m;
- CPU frame update remains unchanged;
- render p95 regression over PR #287 remains `<= 0.05 ms`;
- gameplay readbacks remain zero.

## Honest boundary

The fade operates per fragment, not per instance compaction. Fully faded CPU instances still exist in the InstancedMesh until the normal movement rebuild. The current radius and small class geometry make this acceptable for the fallback path; CPU-side compaction should only be added after measurement.
