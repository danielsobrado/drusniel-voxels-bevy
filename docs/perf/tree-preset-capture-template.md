# Tree Preset Performance Capture Template

## Capture Metadata

| Field | Value |
|---|---|
| Date | TODO |
| Commit SHA | TODO |
| Branch | TODO |
| Browser | TODO |
| Browser version | TODO |
| Chrome major | TODO |
| OS | TODO |
| GPU | TODO |
| GPU vendor/device/backend | TODO |
| Driver | TODO |
| CPU | TODO |
| RAM | TODO |
| Viewport | `2560 x 1440` |
| Device pixel ratio | `1` |
| Render resolution preset | `high` |
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
| World | `8` |
| Scene | `trees-perf` |
| Warmup frames | `600` |
| Measured frames | `300` |
| Runs per profile | 3 |
| Recorded value | Median of run-level p95s |

## Preflight Checks

Run before measuring:

```powershell
npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
```

Browser checks:

- Start Vite directly with `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort`.
- Confirm no shader or WebGPU initialization errors.
- Confirm every timing summary records `gpu-ring`, the fixed scene/profile, 600 warmup
  frames, at least 300 measured frames, and all debug/readback flags false.
- Manual overlay/log snapshots belong only in the diagnostic sections below.

## Primary Preset Results

Use the deterministic perf harness. Keep debug readback off. Repeat this command shape
three times per quality, changing only `quality`, run suffix, and output directory:

```powershell
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 8 --warmup 600 --frames 300 --case tree-gpu-ring --params scene=trees-perf,quality=balanced --out perf-runs/tree-balanced-1"
```

| Quality | `summary.json` paths | Path | frame p50 ms | frame p95 ms | render p95 ms | Top phase/prop | LOD n/m/f/i | Triangles/rendered | Notes |
|---|---|---|---:|---:|---:|---|---|---|---|
| `ultra` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `balanced` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `perf` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `potato` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- All WebGPU-capable primary runs should show `gpu-ring`.
- Normal GPU runs should show `counts=off` unless a debug/count flag is present.
- `perf` should reduce tree workload versus `ultra`.
- `potato` should be the cheapest tree preset.

## Debug Count Results

Use these runs only for diagnostic detail after all measured windows finish. They enable
readback and cannot support performance claims. FPS/frame columns are intentionally
absent.

The `Capture Table Row` from the console matches this table shape.

| URL | Runtime path | Dispatch ms (diagnostic) | Candidates | Accepted | Visible | Shadow casters | Shadow overflow | Notes |
|---|---|---:|---:|---:|---:|---:|---|---|
| `?quality=ultra&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=balanced&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |
| `?quality=potato&treeGpu=1&treeGpuCounts=1` | TODO | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Expected:

- `dispatch ms` should be stable after warmup.
- `shadow overflow` should remain false.
- Candidate and accepted counts should drop from `ultra` to `potato`.

## CPU Fallback Control Results

Use these to prove the switch paths work and to compare GPU ring versus CPU patches.

| URL | Runtime path | Total / counts | LOD n/m/f/i | Notes |
|---|---|---|---|---|
| `?quality=perf&treeGpu=0` | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpuForceCpu=1` | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1` | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpuStrict=1` | TODO | TODO | TODO | Should fail loud instead of CPU fallback if GPU trees cannot run. |

Expected:

- `treeGpu=0` and `treeGpuForceCpu=1` should not show `gpu-ring`.
- `treeGpu=1` should show `gpu-ring` on supported browsers/devices.
- `treeGpuStrict=1` should keep `fallbackToCpu=false`; on unsupported GPU-tree setup it should show `unsupported` or `error`, not `fallback-cpu`.
- GPU ring should avoid CPU patch churn.

## Shadow Budget Results

Use these to prove `treeShadowMaxLod` changes the GPU shadow workload.

The `Capture Table Row` from the console also works here. Ignore the accepted/visible columns if you only care about shadow cost.

| URL | Runtime path | Dispatch ms (diagnostic) | Shadow casters | Shadow overflow | Visual shadow notes |
|---|---|---:|---:|---|---|
| `?quality=perf&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=none` | TODO | TODO | TODO | TODO | TODO |
| `?quality=perf&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=near` | TODO | TODO | TODO | TODO | TODO |
| `?quality=balanced&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=mid` | TODO | TODO | TODO | TODO | TODO |
| `?quality=ultra&treeGpu=1&treeGpuCounts=1&treeShadowMaxLod=far` | TODO | TODO | TODO | TODO | TODO |

Expected:

- `treeShadowMaxLod=none` should report zero shadow casters.
- `near` should report fewer shadow casters than `mid` or `far` in the same dense view.
- No shadow budget should produce shader errors.
- `near` should not remove important near-camera shadows.

## CPU/GPU Validation Run

Use this only after the normal GPU path works. Validation enables readback and may affect performance.

| URL | Runtime path | Console warnings | Notes |
|---|---|---|---|
| `?quality=perf&treeGpu=1&treeGpuValidate=1` | TODO | TODO | TODO |

Expected:

- No repeated false-positive CPU/GPU parity warnings caused by hash/jitter or shadow LOD mismatch.
- Some small tolerance differences can still happen because validation is a debug guard, not a perfect oracle.

## Snapshot Blocks

Paste selected full `log perf snapshot` console outputs here.

```text
TODO
```

## Visual Artifact Notes

| URL | Missing near trees | Popping | Broken shadows | Shader errors | Notes |
|---|---|---|---|---|---|
| TODO | TODO | TODO | TODO | TODO | TODO |

## Decision Summary

| Question | Result |
|---|---|
| Is the WebGPU tree path active? | TODO |
| Does `perf` materially improve harness frame p95 over `ultra`? | TODO |
| Does `potato` provide the cheapest safe path? | TODO |
| Does CPU fallback still work? | TODO |
| Does strict GPU mode fail loud instead of using CPU fallback? | TODO |
| Does shadow LOD gating reduce shadow caster work? | TODO |
| Are there visible regressions? | TODO |
| Should we tune preset values further? | TODO |

## Follow-up Actions

- TODO: Tune preset ring/density values if `perf` is still too expensive.
- TODO: Tune `treeShadowMaxLod` defaults if shadow loss is too visible.
- TODO: Add per-preset shadow caster capacity only if shadow LOD gating is not enough.
- TODO: Measure GPU-tree card prepass only after the current presets are validated.
