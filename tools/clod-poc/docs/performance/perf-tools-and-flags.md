# CLOD-POC performance tools and flags

This is the permanent reference for performance probes, browser query flags, console hooks, and the current healthy baseline for `tools/clod-poc`.

## Rules before measuring

- Use a headed browser for real GPU numbers. Headless Playwright can use SwiftShader and produce misleading zero-vegetation or fake GPU results.
- Do not trust the HUD average FPS for diagnosis. Use `window.__drusnielPerf.snapshot()` or one of the probe tools.
- Do not optimize a broad bucket blind. For example, `farSummaryMs` is a composite bracket; always inspect the `farSum*Ms` sub-buckets first.
- Use one change and one measurement at a time. Keep the query string, scene, camera mode, and warmup/sample frame counts stable when comparing before/after.
- After any git rewind or branch switch, confirm known budgeted builders still exist before trusting performance numbers. For the sun-light cache, grep for `stepLightTileBuild`.

## Start the dev server

From the repository root:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Or from `tools/clod-poc`:

```powershell
npm run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

Confirm the page responds before running probes. A dead dev server makes the smoke/perf output useless.

## Query flags

Use these in the browser URL, for example:

```text
http://127.0.0.1:5180/?perfProbe=1&perfWarmup=60&perfFrames=120
```

| Flag | Purpose | Typical value |
| --- | --- | --- |
| `perfProbe=1` | Enables the browser-side perf collector and `window.__drusnielPerf`. | `1` |
| `perfWarmup=<frames>` | Frames to ignore before collecting samples. Use enough warmup for startup streaming. | `60`, `120` |
| `perfFrames=<frames>` | Number of measured frames. More frames give better p95 data. | `120`, `300` |
| `sunLightDebug=1` | Shows the sun-light debug overlay for visual sanity checks. | `1` |

## Browser console hooks

### Main perf snapshot

```js
window.__drusnielPerf.snapshot()
```

Use this for broad and sub-bucket attribution. Important top-level fields:

- `ready`: probe completion state.
- `sampleCount`: measured frame count.
- `metrics`: avg/min/max/p50/p95 for each metric.
- `broadBucketsByP95`: broad frame buckets sorted by p95 cost.
- `propBucketsByP95`: prop/vegetation bucket breakdown sorted by p95 cost.
- `counters`: aggregated counters such as visible counts, GPU candidate counts, stats sync counts, and GPU pass summaries.

### Sun-light cache stats

```js
window.__drusnielSunLightStats()
```

Use this after walking, teleporting, or digging. Healthy behavior:

- `buildMsLastFrame` stays near the configured budget, usually about `2–3 ms`.
- `pendingTiles` can spike after teleport/dig, then drains over seconds.
- Visual sun shading may warm in over several frames after a large move; that is expected after making the build truly budgeted.

## Far-summary sub-buckets

`farSummaryMs` is not one system. It includes multiple subphases. Always check these before deciding what to fix:

| Metric | Meaning |
| --- | --- |
| `farSumTilesMs` | Legacy far-summary tile cache work. |
| `farSumNaadfMs` | NAADF summary/streaming work. |
| `farSumShellMs` | Infinite far shell and streaming shell movement. |
| `farSumShadowProxyMs` | Shadow proxy update work. |
| `farSumBiomeStreamMs` | Biome streaming work inside the far-summary phase. |
| `farSumSunLightMs` | Sun-visibility terrain light cache work. |
| `farSumStatsDomMs` | Stats DOM/debug display work inside the far-summary phase. |

Recent verified sunlight-fix baseline from a headed browser:

```text
sampleCount: 120
frameMs: avg 3.70, p50 3.50, p95 4.40, max 7.50
farSummaryMs: avg 2.28, p50 2.30, p95 2.50, max 2.70
farSumSunLightMs: avg 2.25, p50 2.20, p95 2.50, max 2.60
farSumTilesMs: 0.00
farSumNaadfMs: 0.00
farSumShellMs: 0.00
farSumShadowProxyMs: 0.00
farSumBiomeStreamMs: 0.00
farSumStatsDomMs: 0.00
vegetationTotalMs: avg 0.23, p95 0.30, max 3.60
renderMs: avg 0.99, p95 1.40, max 1.70
```

If `farSummaryMs` regresses again, the first question is which `farSum*Ms` bucket moved.

## Tools

### `tools/farsum-probe.ts`

Runs a headed browser probe and prints only the far-summary attribution metrics plus vegetation/render summary.

From `tools/clod-poc`:

```powershell
npx tsx tools/farsum-probe.ts "?perfProbe=1&perfWarmup=60&perfFrames=120"
```

With an explicit dev-server URL:

```powershell
$env:CLOD_POC_BASE_URL = 'http://127.0.0.1:5180/'
npx tsx tools/farsum-probe.ts "?perfProbe=1&perfWarmup=60&perfFrames=120"
```

Expected healthy sunlight-cache result:

```text
frameMs.p95 <= ~10 ms
farSummaryMs.avg ~= 2–3 ms
farSumSunLightMs.avg ~= 2–2.6 ms
all other farSum* buckets ~= 0 ms in the default static scene
```

If this tool fails waiting for readiness, verify that the dev server is reachable and that the query includes `perfProbe=1`.

## Diagnostic workflow

1. Run a stable baseline with `?perfProbe=1&perfWarmup=60&perfFrames=120`.
2. Sort by `broadBucketsByP95`.
3. If `farSummaryMs` is high, inspect every `farSum*Ms` sub-bucket.
4. If `propsMs` or `vegetationTotalMs` is high, inspect `propBucketsByP95` and the tree/grass/understory counters.
5. If the issue happens only while walking or teleporting, rerun in player mode and watch the relevant runtime stats in the console.
6. After a fix, keep the same scene/query and compare avg, p50, p95, and max.

## Current known-good sunlight behavior

The sun-light cache is intentionally incremental now. A large movement or terrain edit can enqueue many light tiles. That should no longer hitch the frame. The correct behavior is:

- work is spread across frames;
- stale or missing light data is tolerated temporarily;
- `pendingTiles` drains gradually;
- `buildMsLastFrame` stays near budget;
- visual light/shade catches up over seconds.

If faster warmup is needed, tune the sun-light YAML budget and measure the tradeoff immediately:

```text
tools/clod-poc/src/app/config/sun_light.yaml
build.max_build_ms_per_frame
build.max_tiles_per_frame
```

Do not raise budgets without measuring `frameMs.p95` and `farSumSunLightMs.p95` before and after.

## Useful references

- `tools/clod-poc/docs/performance/farsummary-sunlight-regression-2026-07-04.md` — root cause and verified fix for the `farSummaryMs ~346 ms` sunlight regression.
- `tools/clod-poc/docs/performance/session-prompt-2026-07-04-verify.md` — handoff checklist for real-play verification and remaining performance backlog.
