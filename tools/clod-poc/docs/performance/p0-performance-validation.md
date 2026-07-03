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
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Run the default P0 suite:

```bash
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:p0
```

Short smoke run:

```bash
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:p0 -- --warmup 10 --frames 30 --timeout 60000
```

Run one case:

```bash
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:p0 -- --case terrain-material-cache-enabled
```

Force WebGL:

```bash
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:p0 -- --renderer webgl
```

Fail the process when any case fails:

```bash
CLOD_POC_BASE_URL=http://127.0.0.1:5180/ npm --prefix tools/clod-poc run perf:p0 -- --failOnCaseFailure
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
page geometry cache
render node cache
material churn
far-summary atlas memory estimate
far-summary atlas dirty/full upload state
```

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

A `-` value means the metric is not exposed by the current runtime path. Do not treat it as zero.

## Remaining P0 work after this runner

The runner records evidence. It does not prove browser/GPU behavior by itself.

Pending validation work:

```text
1. Run typecheck and targeted P0 tests locally.
2. Run the P0 perf suite on a browser/WebGPU machine.
3. Commit the generated summary.json and summary.md, or archive them as release/perf artifacts.
4. Confirm dirty upload mode appears after initial atlas population when the dirty area is below threshold.
5. Compare balanced vs packed memory estimates and visual output in a NAADF scene.
```
