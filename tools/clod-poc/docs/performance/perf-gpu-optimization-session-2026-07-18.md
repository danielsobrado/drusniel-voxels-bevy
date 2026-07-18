# clod-poc performance + GPU handling session — 2026-07-18

Created 2026-07-18. Solo optimization session on `main` (started at `1e616cfc`), focused on
infinite-islands frame-time tails, GPU handling health, and end-to-end feature verification
(long map, chunk streaming, rivers, lakes, grass, trees).

Measurement protocol: another session was live-editing water/hydrology files in the same
tree, so all A/B pairs ran against a frozen `vite build --base /` served by
`vite preview --port 5186` (no HMR; per-pair deltas valid). The concurrently edited files
(`environment_query/hydrology_adapter*`, `water_weather/water_controller.ts`) were verified
byte-identical across both sides of each pair.

## Landed: understory lighting-proxy budget fix (`826bd753`)

**Root cause:** the forest-lighting field rebuild (0.75 ms/frame budget,
`forest_lighting_controller.updateBudgeted`) collected understory GPU-ring lighting proxies
in one unbudgeted call at `beginBuild`. `UnderstorySystem.gpuRingLightingProxies()` walks a
sparse ecology grid over the full understory ring (`distanceM` 110 m, step = ringCell × 3)
sampling streamed-terrain `surfaceHeight` + `surfaceNormal` + ecology noise per point —
14–16 ms in one frame, re-triggered every 8 m of movement (`GPU_LIGHTING_PROXY_REFRESH_M`
aligns with the field's `updateDistanceM`). This was the dominant moving p99 source: 4 of
the 5 worst frames in the frozen baseline were forestLighting ~14 ms bursts.

**Fix:** mirrored the tree system's budgeted proxy cache (`TreeGpuLightingProxyCache`):
resumable dx/dz-cursor scan (`stepGpuLightingProxyBuild`, deadline check every 16 points),
`getLightingProxiesBudgeted(deadlineMs)` returning the stale set until complete, in-progress
builds never restarted on key drift. The controller now defers `beginBuild` until both tree
and understory proxy sets are ready.

**Evidence (perf:move, frozen build, moving window 900 frames,
`perf-runs/opt-frozen-baseline` → `perf-runs/opt-frozen-after1`):**

| metric | baseline | after |
| --- | ---: | ---: |
| frameMs p50 | 6.60 | 6.80 |
| frameMs p95 | 12.10 | **10.30** |
| frameMs p99 | 21.90 | **14.10** |
| fps p5 (slowest 5%) | 83.3 | **97.1** |
| forestLightingMs p99 / max | 14.30 / 15.20 | **1.50 / 3.10** |

Suite: 3888 tests green, typecheck green, build green. A dev-server baseline
(`perf-runs/opt-baseline`) matches the frozen baseline's burst structure.

## Remaining moving-tail sources (after fix, worst frames)

1. `renderMs` spikes (9–16 ms; the single 32 ms worst frame): driver-side, consistent with
   the long-standing first-use PSO compilation stalls (see fable90 notes). Not JS.
2. `farSumTilesMs` bursts to ~6–8 ms: this is the configured far-summary build budget
   (`farSummaryMaxBuildMsPerFrame=6` in the perf/acceptance URL) doing its job, not a defect.
3. `understoryMs` p99 2.1 / max 4.7: understory controller ring update; minor.

## Fixed: `far_clipmap_unowned_cells=80` acceptance failures (all coverage scenes)

Root cause: `fddb0d5c` (2026-07-16, per-cell seam ownership) widened
`farClipmapBandContainsCell` to start at the refined-CLOD inner radius, so seam cells whose
refined CLOD pages are **ready** (owned by CLOD, deliberately not by the clipmap) started
counting as "unowned" — while the acceptance gate still required the counter to be zero.
The true hole counters (`far_clipmap_ownership_holes`, `priority_unowned_cells`) were 0 in
every failing run, i.e. no actual coverage gap. Fix: the oracle now excludes seam cells
covered by ready refined-CLOD pages from `far_clipmap_unowned_cells`
(`ownership_coverage_oracle.ts`), with the semantics pinned in the seam-partition unit test.
A cell the clipmap dropped without a refined page taking over still counts, so the gate
still catches real regressions. Verified: focused `coverage/biome-near` acceptance run green
(`acceptance-runs/unowned-fix-check2`).

## Fixed: perf/water "could not find a strong traced river spot"

Two independent causes:

1. `window.waterProbe` (which the acceptance river/lake spot finder requires) is installed
   only in dev mode or with `waterDebug=1`/`debug=1` (`water_controller_debug.ts`). Every
   acceptance run against a production build (`vite preview`) silently lacked the probe and
   failed the water gate. The water scene now passes `waterDebug=1` explicitly.
2. In the reuse profile, scene presets (`clodPerf=1` → water off) apply at page boot only;
   a reused page that booted without `water=1` never enables water or prefetches hydrology
   tiles. `waterAcceptance` scenes now run on their own isolated page.

The app itself was healthy throughout: `verify-traced-carve` on the same frozen build
reports 100% river continuity over 15 channels, an 18 m carve transect, 4 visible water
clipmap levels, and `webgpu_uncaptured_errors=0` (`qa-runs/traced-carve-verify/`).
Verified: focused `perf/water` acceptance run green (`acceptance-runs/water-fix-check`) —
river and lake sub-scenes converge and sample.

## Acceptance walk-gate flakiness (long-map-full-proof-1..5, earlier 2026-07-18)

Five proof runs by a previous session: 2 PASS, 1 real perf FAIL (356 ms max frame, 401 ms
long task, `propsRestMs` max 349, `renderMs` max 60.7, 65 long tasks), 2 tooling FAILs
(`movement route requires __drusnielClod.getPose`). The getPose failures are page reloads
mid-sequence: the FAILED screenshot shows a fresh default boot stuck at "preparing 0%" with
a 2×2-page world — consistent with a GPU-process crash + Chrome auto-reload, not an app
logic bug (`initHooks()` leaves `getPose` null until bootstrap completes; a stuck reboot
never reaches installation). The movement JSON does not persist per-frame phase rows, so the
349 ms `propsRestMs` stall could not be sub-attributed offline; it did not reproduce in
this session's three full acceptance runs.

## Full acceptance state after fixes (`acceptance-runs/full-reuse-after-fixes-3`)

All scenes/gates green except one: `coverage/walk` had a single 103 ms frame during the
movement route ("expected zero over 100 ms"). This only occurs in coverage mode (ownership
oracle active; perf-mode walk maxed at 21.9 ms in the same run) and is intermittent —
the identical run one iteration earlier passed the same gate. Left as a known borderline
flake; candidates are oracle scan cost coinciding with a GC/driver hitch. perf/water now
produces the full river/lake evidence set on the isolated page; perf-walk movement:
818 frames, p99 15.4 ms, max 21.9 ms.
