# Glacial Valley ground-debris WebGPU CPU-fallback fade — 2026-07-21

## Goal

Give CPU ecological-dressing placement the same stable ring-edge disappearance under the WebGPU renderer that PR #288 provides for the classic WebGL renderer.

## Dependency

This slice is stacked on PR #287, which is stacked on PR #285.

Required merge order:

```text
#285 -> #287 -> this PR
```

PR #288 is a sibling of this PR. It owns classic WebGL shader injection and does not need to merge before this WebGPU NodeMaterial slice.

## Root cause

`?dressingGpu=0` intentionally clears the GPU dressing device and backend before creating `DressingSystem`. That correctly disables GPU placement, but it also erased the fact that the active renderer was WebGPU.

The CPU fallback could therefore only create classic `MeshStandardMaterial` resources. Its classic `onBeforeCompile` fade is not a WebGPU NodeMaterial implementation and must not be treated as one.

## Authority after this slice

```text
renderer WebGPU availability
  -> useWebGpuMaterials flag
  -> force CPU placement may still clear gpuDevice/gpuBackend
  -> CpuDressingSystem
  -> shared grounded geometry
  -> MeshStandardNodeMaterial
  -> class fade range + stable world hash
```

Renderer identity and placement authority remain separate decisions.

## Material policy

For each owned debris class:

- use the existing shared dry colour and roughness;
- use the shared wet colour and roughness for `wet_stone_cluster`;
- compute world-space camera distance from `positionWorld.xz`;
- use the existing class `fadeStartM` and `fadeEndM` values;
- hash a stable 0.5 m world cell;
- keep the fragment when the stable hash is below visibility;
- remain opaque and depth-writing;
- cast no individual debris shadow.

## Performance contract

- no compute dispatch;
- no CPU candidate change;
- no per-instance CPU update;
- no per-frame material recreation;
- no texture fetch;
- no extra draw call or render pass;
- no gameplay GPU readback;
- one distance, world-cell hash, and mask comparison in the existing material graph.

## Required tests

```powershell
npm --prefix tools/clod-poc test -- `
  src/ecology/dressing/ground_debris_cpu_node_material.test.ts `
  src/ecology/dressing/ground_debris_cpu_renderer_mode.test.ts `
  src/ecology/dressing/dressing_cpu_webgpu_mode_contract.test.ts `
  src/ecology/dressing/ground_debris_cpu_resources.test.ts `
  src/ecology/dressing/dressing_cpu_ground_debris_contract.test.ts

npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run build
```

## Headed acceptance

Run `scene=infinite-islands` with WebGPU, `dressing=1`, and `dressingGpu=0`.

Walk straight and diagonally across the outer debris radius and verify:

- CPU placement remains active;
- no GPU ecological-dressing compute dispatch appears;
- the WebGPU material path is used;
- no circular or square boundary is visible;
- the dither remains fixed in world space;
- near debris matches PR #287;
- all owned classes reach zero by 110 m;
- no transparent halo appears;
- no new draw call, render pass, or readback appears;
- render p95 regression over PR #287 remains `<= 0.05 ms`.

Force a GPU dressing initialization failure and confirm the runtime fallback chooses the same WebGPU CPU material path.

## Honest boundary

The CPU instance record still carries transforms only. This PR does not add per-instance wetness, colour variation, far-sun visibility, seasonal response, texture arrays, normal maps, or CPU candidate compaction.

PR #288 remains the classic WebGL fade implementation. The two renderer paths share fade ranges and deterministic policy, but not shader code.
