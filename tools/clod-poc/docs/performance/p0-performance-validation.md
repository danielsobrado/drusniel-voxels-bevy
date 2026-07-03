# CLOD-POC P0 performance validation

This document tracks the evidence runner for the P0 CLOD-POC validation work.

## Status

The runner is implemented in:

```text
tools/clod-poc/tools/perf-p0.ts
```

It is exposed through:

```bash
npm --prefix tools/clod-poc run perf:p0
```

The runner produces:

```text
perf-runs/p0-<timestamp>/summary.json
perf-runs/p0-<timestamp>/summary.md
```

Each case also writes an individual JSON artifact. Failed cases are kept in the final report instead of aborting the entire run.

## Cases

The P0 suite runs:

```text
terrain-material-cache-disabled
terrain-material-cache-enabled
gpu-early-reject-disabled
gpu-early-reject-enabled
gpu-early-reject-enabled-with-debug-oracle
combined-cache-and-early-reject-enabled
```

## Browser fallback

Default renderer mode is `auto`.

The runner first attempts WebGPU. If the WebGPU attempt fails before sample collection with a WebGPU/device/adapter style failure, the case is retried with the WebGL/Chromium fallback so the report still contains a pass/fail record.

The selected renderer is written into both `summary.json` and `summary.md`.

## Commands

Start the app in one terminal:

```bash
npm --prefix tools/clod-poc run dev
```

Run the default P0 suite:

```bash
npm --prefix tools/clod-poc run perf:p0
```

Run a WebGPU-only P0 suite and write to a stable output folder:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --renderer webgpu --out perf-p0-webgpu --failOnGateFailure
```

Short smoke run:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --warmup 10 --frames 30 --timeout 60000
```

Run one case:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --case terrain-material-cache-enabled
```

Force WebGL:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --renderer webgl
```

Fail the process when any case fails:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --failOnCaseFailure
```

Fail the process when P0 evidence gates fail:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --failOnGateFailure
```

Use a custom dev-server URL only when Vite is intentionally running somewhere other than the package default:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --baseUrl http://127.0.0.1:5180/
```

Disable the built-in dirty-atlas exercise:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --params p0DirtyAtlasExercise=0
```

Tune the dirty-atlas exercise movement and settle window:

```bash
npm --prefix tools/clod-poc run perf:p0 -- --params dirtyAtlasMoveM=1024,dirtyAtlasSettleFrames=24
```

## Atlas packing profiles

`far_summary_atlas.format` supports:

```text
debug_rgba32f
balanced
packed
packed_low_bandwidth
```

Use `balanced` for normal P0 validation. Use `debug_rgba32f` for oracle/debug precision checks. Use `packed` for the aggressive low-bandwidth profile. `packed_low_bandwidth` remains accepted as a legacy alias.

Coverage atlas storage is now:

```text
debug_rgba32f: RGBA32F, canopy/water/debug/debug
balanced: RG8, canopy/water
packed: RG8, canopy/water
packed_low_bandwidth: RG8, canopy/water
```

## Dirty-atlas exercise

For NAADF scenes with `perfProbe=1`, the frame loop runs a P0 dirty-atlas exercise by default. The P0 runner also passes explicit defaults:

```text
p0DirtyAtlasExercise=1
dirtyAtlasMoveM=768
dirtyAtlasSettleFrames=18
```

The exercise:

```text
1. Waits until perf warmup frames are observed.
2. Moves the real automation camera along X.
3. Lets far-summary streaming settle for a few frames.
4. Resets the perf probe.
5. Collects the final perf sample window from the moved position.
```

This makes dirty-rect atlas uploads deterministic for P0 instead of depending on incidental camera motion.

The exercise mirrors these counters into `window.__drusnielClod.stats.counters`:

```text
p0DirtyAtlasExercise.enabled
p0DirtyAtlasExercise.status
p0DirtyAtlasExercise.moveM
p0DirtyAtlasExercise.triggeredFrame
p0DirtyAtlasExercise.resetFrame
p0DirtyAtlasExercise.settleRemaining
```

Status codes are:

```text
0 = disabled
1 = pending
2 = settling
3 = done
4 = skipped
```

## Metrics captured

The report includes p50/p95/p99 for:

```text
frameMs
selectionUpdateMs
farSummaryMs
vegetationTotalMs
statsSyncMs
renderMs
```

It also records the exposed P0 counters for:

```text
terrain material cache
vegetation early rejection
vegetation rejection source telemetry
page geometry cache
render node cache
material churn
far-summary atlas memory estimate
far-summary atlas dirty/full upload state
p0 dirty-atlas exercise state
```

Vegetation source telemetry reports GPU-ring cluster prefilter decisions across trees, grass, and understory as aggregate counters:

```text
vegetationGpuSourceFarSummary
vegetationGpuSourceTerrainSampler
vegetationGpuSourceFallback
```

The markdown report also prints per-kind source columns from the perf snapshot:

```text
treeGpuPrefilterSourceFarSummaryAvg
treeGpuPrefilterSourceTerrainSamplerAvg
treeGpuPrefilterSourceFallbackAvg
grassGpuPrefilterSourceFarSummaryAvg
grassGpuPrefilterSourceTerrainSamplerAvg
grassGpuPrefilterSourceFallbackAvg
understoryGpuPrefilterSourceFarSummaryAvg
understoryGpuPrefilterSourceTerrainSamplerAvg
understoryGpuPrefilterSourceFallbackAvg
```

Use this to check whether the far-summary source is actually decisive, or whether the runtime silently falls back to terrain sampler / conservative fallback in one vegetation system only.

## P0 gates

The runner writes a `gates` object into `summary.json` and a `P0 gates` table into `summary.md`.

Current gates are evidence gates, not FPS gates:

```text
required-cases-present
cases-passed
p0-dirty-atlas-exercise-completed
terrain-material-cache-evidence
vegetation-early-reject-evidence
far-summary-source-evidence
far-summary-atlas-packing-evidence
far-summary-atlas-dirty-upload-evidence
```

These gates fail if the report is missing required cases, any case failed, the P0 dirty-atlas exercise did not complete after warmup, terrain cache evidence is missing, vegetation early rejection did not reduce candidate budget or reject clusters, far-summary source usage is missing in early-reject cases, atlas packing savings are missing, or the atlas never shows a dirty upload with `dirtyPixels < totalPixels` and upload mode `dirty`.

Use `--failOnGateFailure` to make failed evidence gates return a non-zero process exit code.

Atlas upload mode is numeric:

```text
0 = none
1 = dirty
2 = full
```

Atlas full-upload fallback reason is numeric:

```text
0 = none
1 = initial
2 = explicit
3 = disabled
4 = too_many_rects
5 = threshold
6 = invalid_atlas
7 = partial_ranges_unsupported
8 = full_invalidation
```

A generated report with exit code `1` is expected when `--failOnCaseFailure` or `--failOnGateFailure` is enabled and at least one case/gate fails. The fix target is the failed row in the report, not the existence of the report files.
