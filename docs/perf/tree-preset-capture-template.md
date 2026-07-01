# Tree Preset Performance Capture Template

## Capture Metadata

| Field | Value |
|---|---|
| Date | TODO |
| Commit SHA | TODO |
| Branch | TODO |
| Browser | TODO |
| Browser version | TODO |
| OS | TODO |
| GPU | TODO |
| CPU | TODO |
| RAM | TODO |
| Window size | TODO |
| Render scale | TODO |
| WebGPU enabled | TODO |
| Notes | TODO |

## Scene Setup

Use one fixed dense-forest view for all captures.

| Field | Value |
|---|---|
| World seed | TODO |
| Camera position | TODO |
| Camera direction | TODO |
| Biome / area | TODO |
| Time of day / lighting | TODO |
| Weather / postprocess state | TODO |
| Capture duration per run | TODO |
| Runs per URL | 3 |
| Recorded value | Median |

## Preflight Checks

Run before measuring:

```bash
cd tools/clod-poc
npm run typecheck
npm test
npm run build
```

Browser checks:

- Open DevTools console.
- Confirm no shader compile errors.
- Confirm no WebGPU initialization errors.
- Confirm the overlay or lil-gui tree summary is visible.
- Confirm camera and scene are stable before recording.

## Primary Preset Results

Use these runs to compare real user-facing preset cost. Keep debug readback off.

| URL | Runtime path | FPS | Frame ms | Total / counts | LOD n/m/f/i | Visual notes |
|---|---|---:|---:|---|---|---|
| `?quality=ultra&treeGpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=balanced&treeGpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=potato&treeGpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- All WebGPU-capable primary runs should show `gpu-ring`.
- Normal GPU runs should show `counts=off` unless a debug/count flag is present.
- `perf` should reduce tree workload versus `ultra`.
- `potato` should be the cheapest tree preset.

## Debug Count Results

Use these runs only for measurement detail. These are not normal gameplay settings because they enable readback.

| URL | Runtime path | FPS | Frame ms | Dispatch ms | Candidates | Accepted | Visible | Shadow casters | Shadow overflow | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `?quality=ultra&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=balanced&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=potato&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- `dispatch ms` should be stable after warmup.
- `shadow overflow` should remain false.
- Candidate and accepted counts should drop from `ultra` to `potato`.

## CPU Fallback Control Results

Use these to prove the switch paths work and to compare GPU ring versus CPU patches.

| URL | Runtime path | FPS | Frame ms | Total / counts | LOD n/m/f/i | Notes |
|---|---|---:|---:|---|---|---|
| `?quality=perf&treeGpu=0` | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpuForceCpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1` | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- `treeGpu=0` and `treeGpuForceCpu=1` should not show `gpu-ring`.
- `treeGpu=1` should show `gpu-ring` on supported browsers/devices.
- GPU ring should avoid CPU patch churn.

## Shadow Budget Results

Use these to prove `treeShadowMaxLod` changes the GPU shadow workload.

| URL | Runtime path | FPS | Frame ms | Dispatch ms | Shadow casters | Shadow overflow | Visual shadow notes |
|---|---|---:|---:|---:|---:|---|---|
| `?quality=perf&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=none` | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=near` | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=balanced&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=mid` | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=ultra&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=far` | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- `treeShadowMaxLod=none` should report zero shadow casters.
- `near` should report fewer shadow casters than `mid` or `far` in the same dense view.
- No shadow budget should produce shader errors.
- `near` should not remove important near-camera shadows.

## CPU/GPU Validation Run

Use this only after the normal GPU path works. Validation enables readback and may affect performance.

| URL | Runtime path | Console warnings | FPS | Frame ms | Notes |
|---|---|---|---:|---:|---|
| `?quality=perf&treeGpu=1&treeGpuValidate=1` | TODO | TODO | TODO | TODO | TODO |

Expected:

- No repeated false-positive CPU/GPU parity warnings caused by hash/jitter or shadow LOD mismatch.
- Some small tolerance differences can still happen because validation is a debug guard, not a perfect oracle.

## Visual Artifact Notes

| URL | Missing near trees | Popping | Broken shadows | Shader errors | Notes |
|---|---|---|---|---|---|
| TODO | TODO | TODO | TODO | TODO | TODO |

## Decision Summary

| Question | Result |
|---|---|
| Is the WebGPU tree path active? | TODO |
| Does `perf` materially improve frame time over `ultra`? | TODO |
| Does `potato` provide the cheapest safe path? | TODO |
| Does CPU fallback still work? | TODO |
| Does shadow LOD gating reduce shadow caster work? | TODO |
| Are there visible regressions? | TODO |
| Should we tune preset values further? | TODO |

## Follow-up Actions

- TODO: Tune preset ring/density values if `perf` is still too expensive.
- TODO: Tune `treeShadowMaxLod` defaults if shadow loss is too visible.
- TODO: Add per-preset shadow caster capacity only if shadow LOD gating is not enough.
- TODO: Measure GPU-tree card prepass only after the current presets are validated.
