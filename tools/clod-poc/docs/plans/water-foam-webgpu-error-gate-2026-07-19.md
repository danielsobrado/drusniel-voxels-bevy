# Water Foam WebGPU Error Gate

Date: 2026-07-19

## Purpose

Make the headed foam proofs fail when any uncaptured WebGPU error occurs during
the browser session. Image metrics alone can pass after a poisoned submit or an
unrelated async pipeline failure, so the GPU error authority must be part of the
same runtime contract as the foam model.

## Authority

`src/diagnostics/webgpu_uncaptured_errors.ts` owns a session-cumulative counter.
It is incremented by the application WebGPU uncaptured-error handler and never
reset or decremented during a page session.

`getWaterFoamRuntimeDiagnostics()` now publishes:

```text
webGpuUncapturedErrors
```

The high/low foam visual runner and deterministic shade runner both read that
runtime diagnostic after their final capture work. The canonical WebGPU runtime
contract requires the value to equal zero.

Because the counter is cumulative, a final zero proves that no uncaptured error
occurred during startup, material compilation, scene discovery, captures,
temporal settling, shade overrides, or the final atlas reset. A separate
start/end counter implementation would duplicate the same authority without
providing additional detection.

## Renderer boundary

The WebGL acceptance contract intentionally ignores this field. WebGL uses its
separate bounded browser/shader error collector, which gates console errors,
shader/program warnings, uncaught errors, rejected promises, and context loss.
This keeps each renderer tied to the error authority it actually uses.

## Verification

```bash
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc run test -- \
  src/water/water_foam_diagnostics.test.ts \
  tools/water-foam-runtime-contract.test.ts \
  tools/water-foam-runtime-wiring-contract.test.ts \
  tools/water-foam-webgl-runtime-contract.test.ts
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run water:foam:accept:matrix
npm --prefix tools/clod-poc run water:foam:accept:shade
```

Headed reports must contain `runtimeDiagnostics.webGpuUncapturedErrors: 0`.
