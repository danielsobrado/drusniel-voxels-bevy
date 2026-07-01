# PostFX WebGL Pipeline — Decommission Decision (POSTFX-804)

**Status:** Decided — keep as a frozen fallback.
**Date:** 2026-07-01

## Context

clod-poc has two post-processing implementations behind the `AppPostProcess` seam:

- `WebGpuPostProcessPipeline` (`src/gpu/webgpu_postprocess.ts`) — the default. A TSL
  `RenderPipeline`: single-sample MRT scene pass → physical aerial + froxel volumetrics →
  GTAO (merged half-res pass) → temporal resolve → bloom → contact shadows → screen-space
  bounce → GPU auto-exposure + per-time-of-day filmic grade → AgX. This is the parity target.
- `PostProcessPipeline` (`src/environment/postprocess.ts`) — a WebGL GLSL fullscreen-quad
  stack. Only runs on `?renderer=webgl`. Its effects are lower-fidelity, non-physical
  approximations (fixed-colour depth-mix haze, custom bright-pass bloom, custom TAA+FXAA;
  no GTAO / froxels / auto-exposure / colour-script).

## Decision

Keep the WebGL `PostProcessPipeline` as a **frozen fallback**. Do not remove it; do not bring
it to parity.

## Rationale

- The `?renderer=webgl` path is the documented recovery route when the WebGPU/D3D12 device is
  unavailable or recovering (see `rendering/renderer_backend.ts`). Removing it would delete
  that recovery path.
- It is a small, self-contained module with no dependence on the WebGPU stack, so it costs
  little to leave in place.
- Bringing it to parity would mean re-implementing the physical aerial, GTAO, froxels,
  auto-exposure and colour-script in GLSL — duplicate work with no product benefit, since
  WebGPU is the default on every supported target.

## Consequences / rules

- The WebGL pipeline is a **lower-fidelity fallback, not maintained at parity**. New PostFX
  work lands on the WebGPU/TSL pipeline only.
- No new effects are added to the WebGL path. Bug fixes are limited to keeping
  `?renderer=webgl` bootable.
- If a future decision drops WebGL support entirely, remove `PostProcessPipeline` and the
  `?renderer=webgl` branch together, and update `renderer_backend.ts` recovery guidance.

## Revisit when

- WebGPU reaches universal availability on all target browsers/OSes such that the recovery
  fallback is no longer needed, **or**
- the WebGL path starts blocking WebGPU work (maintenance drift), at which point remove it.
