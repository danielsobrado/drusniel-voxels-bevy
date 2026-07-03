# CLOD-POC P0 Troubleshooting Handoff

## Tested revision

- git commit captured at validation setup: 08925321ea718ff7a7743b816c81dc08b543cbe4
- git commit at handoff finalization: 9b4df0efd0a0ad6879ab1ff1d7a8fb66f1c82eea
- note: HEAD changed during or after collection; compare artifacts against the captured logs before treating either commit as an isolated clean baseline.
- branch: main
- artifact dir: validation-artifacts\clod-poc-p0-20260703T102957Z
- timestamp UTC: 2026-07-03T10:30:07Z

## Machine / browser / GPU notes

- platform: Windows_NT Drusniel 10.0 22631 x86_64 MS/Windows (Windows 11)
- node: v22.21.1
- npm: 11.1.0
- P0 baseUrl: http://localhost:5173/
- requested renderer: webgpu
- WebGPU browser/device details were not emitted as explicit environment fields in the summary; the run did execute WebGPU cases successfully for four cases.

## Exit codes

| command | exit |
| --- | ---: |
| npm-ci | 0 |
| typecheck | 0 |
| test | 1 |
| perf-p0-webgpu | 1 |

## Command outcomes

- TypeScript passed: yes
- Vitest passed: no
- WebGPU P0 completed: yes; summary.json and summary.md were generated
- First fatal WebGPU case error: Perf probe timed out after 240000ms: 162/300 samples, 282 observed frames
- Auto fallback run: no; failure was not an adapter/device/browser launch failure

## P0 gates

- overall status: failed
- failed count: 2

| gate | status | detail |
| --- | --- | --- |
| required-cases-present | passed | all required P0 cases are present |
| cases-passed | failed | failed cases: gpu-early-reject-enabled-with-debug-oracle, combined-cache-and-early-reject-enabled |
| p0-dirty-atlas-exercise-completed | passed | dirty atlas exercise completed cases=4/4 bestMoveM=435.20 |
| terrain-material-cache-evidence | passed | cache evidence hits=304.00 ready=35.00 stale=0.00 |
| vegetation-early-reject-evidence | passed | early reject evidence before=213,449 after=211,264 rejectedClusters=16.00 |
| far-summary-source-evidence | failed | early-reject enabled cases did not expose far-summary source usage |
| far-summary-atlas-packing-evidence | passed | atlas packing savings detected bestSavingsPct=0.84 |
| far-summary-atlas-dirty-upload-evidence | passed | dirty upload evidence case=gpu-early-reject-disabled dirtyUploads=3.00 dirtyPixels=2,048 totalPixels=76,800 dirtyPct=0.03 |

## Failed gates

- cases-passed: failed cases: gpu-early-reject-enabled-with-debug-oracle, combined-cache-and-early-reject-enabled
- far-summary-source-evidence: early-reject enabled cases did not expose far-summary source usage

## P0 cases

| case | status | renderer | frame p50 | frame p95 | frame p99 | veg p95 | render p95 | warnings | errors | failure |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| terrain-material-cache-disabled | passed | webgpu | 31.70 | 619.80 | 636 | 5.40 | 2.30 | 2 | 0 | - |
| terrain-material-cache-enabled | passed | webgpu | 33.20 | 383.40 | 415.10 | 3.70 | 1.60 | 2 | 0 | - |
| gpu-early-reject-disabled | passed | webgpu | 34.30 | 411 | 418.50 | 3.50 | 1.40 | 2 | 0 | - |
| gpu-early-reject-enabled | passed | webgpu | 31.90 | 375 | 385.20 | 3.60 | 1.50 | 2 | 0 | - |
| gpu-early-reject-enabled-with-debug-oracle | failed | webgpu | - | - | - | - | - | 2 | 0 | Perf probe timed out after 240000ms: 162/300 samples, 282 observed frames |
| combined-cache-and-early-reject-enabled | failed | webgpu | - | - | - | - | - | 3 | 2 | Missing window.__drusnielPerf snapshot |

## Evidence counters

| case | terrainMaterialCacheHits | terrainMaterialCacheMisses | terrainMaterialCacheReady | terrainMaterialCacheStale | vegetationGpuClustersRejectedEarly | vegetationGpuClustersAccepted | vegetationGpuClustersSummaryMissing | vegetationGpuSourceFarSummary | vegetationGpuSourceTerrainSampler | vegetationGpuSourceFallback | treeGpuPrefilterSourceFarSummaryAvg | treeGpuPrefilterSourceTerrainSamplerAvg | treeGpuPrefilterSourceFallbackAvg | grassGpuPrefilterSourceFarSummaryAvg | grassGpuPrefilterSourceTerrainSamplerAvg | grassGpuPrefilterSourceFallbackAvg | understoryGpuPrefilterSourceFarSummaryAvg | understoryGpuPrefilterSourceTerrainSamplerAvg | understoryGpuPrefilterSourceFallbackAvg | naadf.farSummaryAtlas.memorySavingsPct | naadf.farSummaryAtlas.upload.modeCode | naadf.farSummaryAtlas.upload.fallbackReasonCode | naadf.farSummaryAtlas.upload.dirtyUploads | naadf.farSummaryAtlas.upload.fullUploads | naadf.farSummaryAtlas.upload.dirtyPct | dynamicResolution.active | dynamicResolution.renderScale | dynamicResolution.reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| terrain-material-cache-disabled | - | - | - | - | 16 | 585 | 0 | 0 | 9 | 592 | 0 | 0 | 0 | 0 | 0 | 576 | 0 | 9 | 16 | 0.84 | 2 | 5 | 3 | 3 | 1 | 0 | 0.85 | 1 |
| terrain-material-cache-enabled | 304 | 184 | 35 | 0 | 16 | 585 | 0 | 0 | 9 | 592 | 0 | 0 | 0 | 0 | 0 | 576 | 0 | 9 | 16 | 0.84 | 2 | 5 | 2 | 18 | 1 | 0 | 0.85 | 1 |
| gpu-early-reject-disabled | 310 | 189 | 35 | 0 | 0 | 601 | 0 | 0 | 0 | 601 | 0 | 0 | 0 | 0 | 0 | 576 | 0 | 0 | 25 | 0.84 | 1 | 0 | 3 | 18 | 0.03 | 0 | 0.85 | 1 |
| gpu-early-reject-enabled | 310 | 189 | 35 | 0 | 16 | 585 | 0 | 0 | 9 | 592 | 0 | 0 | 0 | 0 | 0 | 576 | 0 | 9 | 16 | 0.84 | 1 | 0 | 3 | 18 | 0.03 | 0 | 0.85 | 1 |
| gpu-early-reject-enabled-with-debug-oracle | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| combined-cache-and-early-reject-enabled | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |

## Dynamic resolution check

- terrain-material-cache-disabled: active=0, renderScale=0.85, reason=1
- terrain-material-cache-enabled: active=0, renderScale=0.85, reason=1
- gpu-early-reject-disabled: active=0, renderScale=0.85, reason=1
- gpu-early-reject-enabled: active=0, renderScale=0.85, reason=1
- gpu-early-reject-enabled-with-debug-oracle: active=-, renderScale=-, reason=-
- combined-cache-and-early-reject-enabled: active=-, renderScale=-, reason=-

## Blunt diagnosis

- typecheck/test failure
- runtime fatal
- P0 evidence gate failure
- missing counter instrumentation

## Next troubleshooting target

Fix the runtime evidence path for far-summary source usage first: the only failed evidence gate is `far-summary-source-evidence`, and passed early-reject cases report far-summary source counts as 0 while terrain-sampler/fallback counts are non-zero. Separately investigate the debug-oracle timeout and combined-case missing `window.__drusnielPerf` snapshot because they are the failed cases behind `cases-passed`.

## Gates object

```json
{
  "status": "failed",
  "failedCount": 2,
  "results": [
    {
      "name": "required-cases-present",
      "status": "passed",
      "detail": "all required P0 cases are present"
    },
    {
      "name": "cases-passed",
      "status": "failed",
      "detail": "failed cases: gpu-early-reject-enabled-with-debug-oracle, combined-cache-and-early-reject-enabled"
    },
    {
      "name": "p0-dirty-atlas-exercise-completed",
      "status": "passed",
      "detail": "dirty atlas exercise completed cases=4/4 bestMoveM=435.20"
    },
    {
      "name": "terrain-material-cache-evidence",
      "status": "passed",
      "detail": "cache evidence hits=304.00 ready=35.00 stale=0.00"
    },
    {
      "name": "vegetation-early-reject-evidence",
      "status": "passed",
      "detail": "early reject evidence before=213,449 after=211,264 rejectedClusters=16.00"
    },
    {
      "name": "far-summary-source-evidence",
      "status": "failed",
      "detail": "early-reject enabled cases did not expose far-summary source usage"
    },
    {
      "name": "far-summary-atlas-packing-evidence",
      "status": "passed",
      "detail": "atlas packing savings detected bestSavingsPct=0.84"
    },
    {
      "name": "far-summary-atlas-dirty-upload-evidence",
      "status": "passed",
      "detail": "dirty upload evidence case=gpu-early-reject-disabled dirtyUploads=3.00 dirtyPixels=2,048 totalPixels=76,800 dirtyPct=0.03"
    }
  ]
}
```
