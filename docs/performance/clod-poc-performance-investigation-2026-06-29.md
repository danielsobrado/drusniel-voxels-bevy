# clod-poc Performance Investigation - 2026-06-29

## Scope

This note summarizes the clod-poc performance investigation around lower reported FPS after the tree GPU cull path was simplified.

The investigation used the deterministic clod-poc perf process:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- ..."
```

Vite-based commands were run directly, not through `rtk`.

## Main Findings

The tree GPU path was not the remaining steady-state FPS regression.

The earlier fast GPU result was misleading because it rendered zero visible GPU trees:

- `diagnose-tree-gpu-before`: frame p95 `2.70ms`, render p95 `2.30ms`, visible GPU trees `0`, LOD `0/0/0/0`
- `diagnose-tree-gpu-after-cull-simplify`: frame p95 `4.60ms`, render p95 `3.60ms`, visible GPU trees `3,463`, LOD `49/2037/1377/0`

The later result is doing real work. It is slower than the zero-tree run, but materially faster than the CPU path:

- CPU tree path: frame p95 `12.00ms`, render p95 `10.90ms`, LOD `19/564/361/0`
- GPU tree ring: frame p95 `4.60ms`, render p95 `3.60ms`, LOD `49/2037/1377/0`

## High-Load CLOD Perf Mode

The documented high-load URL shape was measured first:

```text
http://127.0.0.1:5180/?world=16&clodPerf=1&webgpuSelection=1
```

Important detail: `clodPerf=1` intentionally disables trees unless `treeGpu=1` is also supplied. The first high-load matrix therefore measured the CLOD perf-mode baseline, not the tree GPU ring.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-highload-world16-now/summary.md`

Results:

| case | frame p50 | frame p95 | render p95 | tree GPU | visible trees |
| --- | ---: | ---: | ---: | --- | ---: |
| current-textured | `1.60ms` | `2.20ms` | `2.00ms` | disabled | 0 |
| trees-off | `1.60ms` | `2.10ms` | `1.90ms` | disabled | 0 |
| vegetation-off | `1.20ms` | `1.60ms` | `1.50ms` | disabled | 0 |
| water-weather-off | `1.40ms` | `2.00ms` | `1.80ms` | disabled | 0 |

This did not reproduce a steady-state FPS regression. It did show long startup before the perf hook appeared, especially on `world=16`.

## High-Load Tree GPU Mode

The tree GPU path was then measured with `clodPerf=1&treeGpu=1`.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-highload-world16-treegpu-now/summary.md`

Results:

| case | frame p50 | frame p95 | render p95 | visible GPU trees | LOD avg |
| --- | ---: | ---: | ---: | ---: | --- |
| tree-gpu-ring | `2.10ms` | `3.90ms` | `2.70ms` | 17,892 | `35/2685/8539/6633` |
| tree-gpu-visible-12k | `1.90ms` | `3.30ms` | `2.50ms` | 6,228 | `35/1891/2207/2095` |
| trees-off | `1.30ms` | `2.00ms` | `1.70ms` | 0 | `0/0/0/0` |

Tree GPU rendering adds measurable cost, but the high-load tree GPU case is still well below a 16.67 ms frame budget. The 12k cap reduces the tree count and p95 modestly.

## Normal World-8 Scene

The normal world-8 textured scene was measured next.

Artifact:

- `tools/clod-poc/perf-runs/diagnose-world8-normal-now/summary.md`

Results before the water-disabled fix:

| case | frame p50 | frame p95 | top phase p95 | top prop p95 | render p95 | visible GPU trees |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| current-textured | `1.70ms` | `2.60ms` | renderMs `1.70ms` | waterMs `0.60ms` | `1.70ms` | 6,592 |
| tree-gpu-visible-12k | `1.80ms` | `3.10ms` | renderMs `2.00ms` | waterMs `0.90ms` | `2.00ms` | 4,165 |
| trees-off | `2.30ms` | `3.40ms` | renderMs `3.10ms` | grassMs `0.10ms` | `3.10ms` | 0 |
| vegetation-off | `1.60ms` | `2.20ms` | renderMs `2.00ms` | waterMs `0.10ms` | `2.00ms` | 0 |
| water-weather-off | `2.20ms` | `7.10ms` | vegetationTotalMs `4.60ms` | waterMs `4.40ms` | `2.30ms` | 6,592 |

The anomaly was `water-weather-off`: the URL disabled water and weather, but `waterMs` still dominated.

## Fix

The frame loop always called the water controller update, even when `state.waterEnabled` was false.

Changed files:

- `tools/clod-poc/src/app/frame_loop/ui_state.ts`
- `tools/clod-poc/src/app/frame_loop/vegetation_frame_phase.ts`
- `tools/clod-poc/src/app/frame_loop/vegetation_frame_phase.test.ts`

Behavior change:

- `runVegetationFramePhase` now skips `waterController.update(...)` and `logDevInitOnce(...)` when `state.waterEnabled` is false.
- A unit test covers disabled and enabled water update behavior.

## Post-Fix Measurement

Artifact:

- `tools/clod-poc/perf-runs/diagnose-world8-water-off-after-skip/summary.md`

Results:

| case | frame p50 | frame p95 | top phase p95 | top prop p95 | render p95 | visible GPU trees |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| current-textured | `1.80ms` | `2.60ms` | renderMs `1.60ms` | waterMs `0.60ms` | `1.60ms` | 6,592 |
| water-weather-off | `1.40ms` | `2.00ms` | renderMs `1.40ms` | grassMs `0.20ms` | `1.40ms` | 6,592 |

The water-disabled anomaly was removed:

- Before: frame p95 `7.10ms`, `waterMs` p95 `4.40ms`
- After: frame p95 `2.00ms`, water no longer appears in the top prop buckets

## Verification

Passed:

```powershell
npm --prefix tools/clod-poc test -- src/app/frame_loop/vegetation_frame_phase.test.ts
```

Result:

- 1 test file passed
- 2 tests passed

Typecheck was run:

```powershell
rtk npm --prefix tools/clod-poc run typecheck
```

It failed in files unrelated to this change:

- `src/trees/tree_impostor_baker.ts`
- `src/trees/tree_impostor_material.ts`
- `src/trees/tree_system_gpu_ring_draw.test.ts`

## Remaining Notes

- `world=16` perf runs repeatedly spent a long time before the perf hook appeared. That is startup/world-build behavior, not steady-state FPS. It should be investigated separately if startup latency is the user-visible problem.
- The perf markdown currently reports tree visible counts and LOD distribution, but it does not surface tree GPU dispatch/readback timing. Adding those counters to the report would make future tree GPU investigations easier.
- The old zero-visible-tree GPU runs should not be used as performance targets for real tree rendering.
