# Prompt: clod-poc performance session, continuation (P0 re-run / NAADF / browser verify)

Paste this file's content (or reference its path) as the opening prompt of a fresh conversation.

---

You are continuing a performance session in `tools/clod-poc` (browser WebGPU three.js prototype, Vite + vitest + TSL node materials) of `danielsobrado/drusniel-voxels-bevy`. Work solo, evidence-first, one change at a time, and keep updating `tools/clod-poc/docs/performance/live-frame-cost-fix-report.md` as you go so progress survives token limits. Read that report first — it has verified numbers for everything below.

## Hard rules (violating these produces phantom failures)

- NEVER run vitest / vite build / dev server / perf tooling through `rtk`. Only `rtk npm --prefix tools/clod-poc run typecheck` is rtk-safe. Native Windows shell, not WSL.
- Headed browser = real GPU; headless Playwright = SwiftShader (fake numbers, 0 trees).
- Don't trust the HUD "avg FPS" (since-startup average); use `window.__drusnielPerf.snapshot()`.
- One change at a time; typecheck + affected vitest suites after each; full suite before finishing.
- Do NOT edit the repo while a perf:p0 run is in progress (dev-server HMR contaminates runs; the runner records git state and marks cases contaminated).
- Evidence before optimization: name the counter that justifies each change, re-measure after.

## State as of end of 2026-07-03 session (all verified unless marked pending)

- Full suite: **381 files / 2111 tests green**; `tsc --noEmit` clean. All work below is uncommitted in the working tree.
- Default scene ~127 fps (sun-light cache fix, earlier today — see report §1–2).
- **Forest lighting stutter FIXED (code-verified, browser re-verify pending)**: player-mode `props → vegTotal → forest` was 112–116 ms per update — root cause: `generateTreeRingLightingProxies` walks all 61,504 tree-ring slots (`trees.yaml distance_m: 420`, ring cell 3.4 m) doing `surfaceHeight` + `surfaceNormal` + 3-sample occlusion march per slot (~779 ms Node bench / ~100 ms browser), retriggered every 8 m of movement or 0.025 sun drift, monolithically. Now fully resumable + double-buffered with a 2 ms/frame budget (`config/forest_lighting.yaml: field.max_build_ms_per_frame`), same pattern as the sun-light cache. Bench: worst per-frame step 3.27 ms (proxy) / 2.42 ms (field); lighting refresh completes over ~50 frames in-browser. Old field/texture stay live until swap — no visual pop. Files: `trees/tree_ring_lighting_proxies.ts` (create/step/finish build), `trees/tree_system_gpu_lighting_proxy_cache.ts` (`getBudgeted`, never restarts on key drift, converges after completion), `trees/tree_system_runtime.ts` (`getLightingProxiesBudgeted`), `forest_lighting/forest_lighting_fields.ts` (finalize split into row-sliced phases; monolithic `finalizeForestLightingField` wrapper preserved), `forest_lighting/forest_lighting_system.ts` (`beginBuild`/`stepBuild`/`hasBuildInProgress`, double buffer; sync `update()` = begin+step(∞); `updateSettings` cancels builds), `runtime/forest_lighting/forest_lighting_controller.ts` (`updateBudgeted(center, sun)` orchestrates), `app/frame_loop/vegetation_frame_phase.ts` (drives budgeted path, re-applies prop material state only on completion).
- **P0 dirty-atlas exercise REWORKED (code done, P0 re-run pending)**: `app/frame_loop/p0_dirty_atlas_exercise.ts` no longer moves the camera (window shifts dirty 36–40% of the atlas ⇒ threshold full upload, structurally unpassable). It now bumps revisions of up to `dirtyAtlasTiles` (1–8, default 4) ready far tiles already placed in the ring-0 atlas window, picked from one tile row (merged rects ≤ 4·32²=4,096 px = 5.3% of 76,800) ⇒ expect `mode=1 dirty`, `fallbackReason=0 none`. Mechanism: `window.__drusnielNaadf.state.farTiles.set(key, { ...tile, revision: state.revision++ })` — revision is in the atlas ring signature and placement diff, so same-slot+new-revision = blit-only dirty rects. Counters renamed `moveM/requestedMoveM/tileSpanM/boundaryEpsilonM` → `requestedTiles/bumpedTiles`; consumers updated: `tools/perf-p0.ts` (passes `dirtyAtlasTiles=4`), `tools/perf-p0-gates.ts` (completion gate checks `bumpedTiles`), `tools/perf-p0-extract.ts`, `tools/perf-p0-atlas-diagnostics.ts`, `tools/perf-p0-gates.test.ts`, `docs/performance/p0-performance-validation.md`.
- **smoke-5 failed ENVIRONMENTALLY, not from code**: the dev server on 127.0.0.1:5180 died mid-session; every case shows `error: "CLOD-POC dev server is not reachable"`, 0 page navigations, empty counters (`validation-artifacts/clod-poc-p0-smoke-5/summary.json`). Nothing to debug there — just re-run with a live server.
- Black tree impostors: fixed earlier today in `trees/tree_impostor_baker.ts` (WebGPU node-material albedo bake); **browser re-verify still pending** (reload → impostors colored; trees panel "debug color by LOD" shows purple impostor tier).

## Task 1 — Re-run P0 smoke (cheap, do first)

```powershell
# 1. start the dev server (NO rtk), leave it running:
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
# 2. verify it responds before launching the runner (it died silently last time):
#    curl http://127.0.0.1:5180/  → 200
# 3. from a second shell (NO rtk):
$env:CLOD_POC_BASE_URL = 'http://127.0.0.1:5180/'
npm --prefix tools/clod-poc run perf:p0 -- --renderer webgpu --out ../../validation-artifacts/clod-poc-p0-smoke-5 --world 8 --seed 1 --warmup 30 --frames 60 --timeout 90000 --failOnGateFailure
# 4. diagnostics table:
npm --prefix tools/clod-poc run perf:p0:atlas-diagnostics -- --summary ../../validation-artifacts/clod-poc-p0-smoke-5/summary.json
```

Success criteria in `summary.md` / `atlas-diagnostics.md`:
- `p0-dirty-atlas-exercise-completed` gate passes with `bestBumpedTiles=4`, exercise status 3 (done).
- `far-summary-atlas-dirty-upload-evidence` gate passes: `modeCode=1`, `fallbackReasonCode=0`, `dirtyPixels ≈ ≤4,096 / 76,800`, `dirtyUploads ≥ 1`.
- All 5 cases passed, no contamination.

If the exercise stays `pending` (status 1) and never bumps: the atlas window wasn't ready before perf-probe readiness — raise `--warmup` (e.g. 120) or check `window.__drusnielNaadf.getFarSummaryGpuAtlasView().valid` and ring-0 `valid` in a manual browser session with the same URL as the failing case (URL is in summary.json). If tiles bump but upload falls back with reason 5 (threshold), print the exercise's chosen tiles: they must be in ONE row (`bumpPlacedFarSummaryTiles` in `p0_dirty_atlas_exercise.ts` — `placedByRow` logic).

Then update `live-frame-cost-fix-report.md` §6c with the numbers. If a longer canonical run is wanted afterwards: same command with `--warmup 120 --frames 300 --timeout 240000 --out ../../validation-artifacts/clod-poc-p0-post-fixes`.

## Task 2 — Browser re-verify the forest-lighting fix + impostor colors (cheap)

Open `http://127.0.0.1:5180/?perfProbe=1`, enter player mode, walk continuously through forest:
- `window.__drusnielPerf.snapshot()` → `forestLightingMs` (vegTotal profile `forest` bucket) must stay ≤ ~3 ms every frame (was 112–116 ms); `frameMs` smooth while walking.
- Stop walking: canopy shadow/AO under trees refreshes within ~a second (the amortized rebuild completing) with no visible pop (double buffer swaps atomically).
- Tree impostors (far trees) must be colored, not black; trees panel "debug color by LOD" → near=green, mid=orange, far=blue, impostor=purple bands.
- If forest cost is still high: check `forest_lighting.yaml → field.max_build_ms_per_frame` is being read (`parseForestLightingConfig`), and that `TreeSystem.getLightingProxiesBudgeted` hits the GPU-ring branch (`treeReportsGpuRingStats`) — the CPU-patch branch is synchronous but cheap.
Record results in the report §6b.

## Task 3 — NAADF update cost (the real farSummary bottleneck; main perf work)

Evidence so far: with sun-light fixed, `farSummaryMs` is almost entirely `farSumNaadfMs`: p95 ≈ 28.8–49.7 ms in the smoke runs (p50 much lower — spiky). Older bench finalCounters showed `naadf_queued_jobs` 4,252 vs `naadf_committed_jobs` 8 with ~4,100 resident chunks — suspicion: the job queue is scanned/rebuilt per frame or never drains.

Entry points:
- `naadfIntegration.update(...)` called from `clod_poc_bootstrap.ts` (~line 422); implementation `src/naadf/integration.ts` → `updateSummaryStreaming` in `src/naadf/summaryStreamer.ts` (this is the `farSumNaadfMs` bracket).
- `state.pendingJobs: Map<string, StreamJob>`, `queueJob`, the per-frame ring scan that enqueues far-tile jobs (`worldToSummaryTileKey` loop ~line 212), chunk-brick rebuilds (`buildChunkBrick`, `state.revision++`), far-tile builds (`buildFarSummaryTile` ~line 292), eviction sweep over `farTileLastTouched` (~line 326).

Approach (evidence first):
1. In the browser with `?perfProbe=1` on a NAADF scene (`scene=infinite-naadf-far`, the P0 case URL works), sample `window.__drusnielPerf.snapshot()` repeatedly: is `farSumNaadfMs` a steady cost or spikes? Correlate with `naadf.*` counters (`metrics.toCounters()` names, e.g. queued vs committed jobs, residentFarTiles).
2. Instrument INSIDE `updateSummaryStreaming` only if needed (sub-brackets: ring scan, job build, eviction) — module-level store pattern like `far_summary_subphase_timing.ts`, or temporary tagged counters. Suspect list, in order: (a) per-frame full scan of `state.farTiles`/`pendingJobs` maps (`[...state.farTiles.values()]` allocations — the atlas does this too in `updateFromState` but only on signature change), (b) `buildFarSummaryTile`/`buildChunkBrick` doing monolithic tile builds per frame without a ms budget (same disease as the sun-light cache — same resumable-deadline fix applies), (c) the queue never draining (jobs re-queued every frame ⇒ queued 4,252 vs committed 8), (d) eviction sweep over all touched tiles per frame.
3. Fix with the established patterns: budget/deadline per frame, dirty-tracking instead of rescans, drain the queue with nearest-first priority + out-of-ring pruning (exact precedent: `far_light_cache_runtime.ts` second pass, report §7 last bullet).
4. Re-measure `farSumNaadfMs` p50/p95 with the same scene and report before/after in the report doc. Do not sum brackets; `farSummaryMs` is a composite.

## Task 4 — remaining ranked leads (from the original session prompt, untouched)

1. **Grass renders 0 blades** in the default scene (`grassGpuCandidateCountBeforePrefilter: 0`, HUD "0 blades patches=4/4") — correctness first; re-baseline GPU cost after fixing (adds real pixels).
2. **Latent far-summary tile-cache churn**: `src/far-summary/summary-cache.ts` marks ready tiles stale after 1 untouched frame; `integration.ts` calls `buildSomeTiles` with an UNBOUNDED default budget every frame. Counters were 0 in tested scenes (inactive) — fix before any scene activates it (resumable-deadline pattern).
3. **Shadow proxy builds**: `shadow_proxy_build_ms` 2.0–3.2 s cumulative (bench scene), grid 512 / 263k verts, inside `farSumShadowProxyMs` — budget/chunk or skip-when-unchanged if it shows in profiles.
4. **18 full far-summary-atlas uploads** per frozen bench case with `fallbackReasonCode=0` — find what forces full invalidation (`invalidateFarSummaryAtlasSignature` on material-cache content revision changes in `integration.ts` is a suspect: any bake completion nukes the whole signature ⇒ `forceBlitAll`).
5. **Sun-light follow-ups**: per-tile cost still ~20–30 ms amortized; ring warmup ~30 s+ (worker offload / hierarchical march / shorter `max_distance_world`; config `src/app/config/sun_light.yaml`).
6. **Forest-lighting proxy follow-up (optional)**: the proxy cache key quantizes the ring center at 3.4 m (`treeRingLightingProxyKey`) — coarser quantization (e.g. 8 m to match `updateDistanceM`) would halve rebuild frequency while walking; low risk, measure lighting shift visually first.

## Measurement hooks

- `?perfProbe=1` + `window.__drusnielPerf.snapshot()` → frameMs, all phase brackets incl. `farSum*Ms` + `forestLightingMs` (in vegTotal), veg counters, `gpuPasses` (per-pass GPU ms; `render` is the TOTAL).
- `window.__drusnielSunLightStats()` → sun-light cache build stats.
- `window.__drusnielNaadf` → `state` (farTiles, pendingJobs, revision), `config`, `getFarSummaryGpuAtlasView()` (uploadStats, rings), `getMetricsSnapshot()`.
- Trees panel "debug color by LOD": near=green, mid=orange, far=blue, impostor=purple.
- Vegetation timing line in profile log: `vegTotal … grass … trees … under … forest … stones …` (`render_phase.ts: formatVegetationTiming`).

## Commands

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # dev server (no rtk)
rtk npm --prefix tools/clod-poc run typecheck                                      # tsc only — rtk OK
npm --prefix tools/clod-poc test -- <path-filter>                                  # vitest — NO rtk
npm --prefix tools/clod-poc test                                                   # full suite before finishing
```

## Key docs

- `tools/clod-poc/docs/performance/live-frame-cost-fix-report.md` — everything verified this session (§6b forest lighting, §6c dirty-atlas exercise); KEEP UPDATING IT.
- `tools/clod-poc/docs/performance/p0-performance-validation.md` — P0 runner/gates reference (dirty-atlas section already rewritten for the tile-revision exercise).
- `tools/clod-poc/docs/performance/clod-poc-critical-path-fix-plan.md` — older P0 analysis and phased fixes.

Start with Task 1 (needs only a dev server, decides the gate story), then Task 2 (5 minutes in a browser), then Task 3 (the real optimization work).
