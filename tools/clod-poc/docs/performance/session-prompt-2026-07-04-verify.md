# Prompt: verify the farSummary sun-light fix + finish the perf backlog

Paste this file's content (or reference its path) as the opening prompt of a fresh conversation.

---

You are continuing a performance session in `tools/clod-poc` (browser WebGPU three.js prototype, Vite + vitest + TSL node materials) of `danielsobrado/drusniel-voxels-bevy`. Read `tools/clod-poc/docs/performance/farsummary-sunlight-regression-2026-07-04.md` first — it documents what was just found and fixed. Your job: verify the fix in real play, then work the remaining backlog. Work solo, evidence-first, one change at a time.

## Hard rules

- NEVER run vitest / vite build / dev server / perf tooling through `rtk`; only `rtk npm --prefix tools/clod-poc run typecheck` is rtk-safe. Native Windows shell, not WSL.
- Headed browser = real GPU; headless Playwright = SwiftShader (fake numbers, 0 trees).
- Don't trust the HUD "avg FPS"; use `window.__drusnielPerf.snapshot()`.
- `farSummaryMs` is a composite bracket. NEVER optimize it blind — read the `farSum*Ms` sub-buckets first (they exist again as of 2026-07-04): `farSumSunLightMs`, `farSumNaadfMs`, `farSumTilesMs`, `farSumShellMs`, `farSumShadowProxyMs`, `farSumBiomeStreamMs`, `farSumStatsDomMs`.
- Typecheck + affected suites after each change; full suite before finishing. Current state: 397 files / 2161 tests green, typecheck clean, all work uncommitted.

## What was found (context you must not re-derive)

The constant `farSummaryMs ≈ 335–346 ms` was **the sun-visibility light cache**, not NAADF: a working-tree rewind had restored the old monolithic `buildLightTile` (one ~335 ms 32×32-texel ray-march tile per frame, budget checked only *between* tiles, per-sample allocations in `readHeight`). NAADF and the far-summary tile cache were already properly budgeted and measured 0.0 ms. The fix re-applied the resumable pattern: allocation-free `heightAt`, `createLightTileBuild`/`stepLightTileBuild(deadline)`/`finalizeLightTile`, real per-frame deadline (`src/app/config/sun_light.yaml: build.max_build_ms_per_frame: 2.0`), nearest-first pending with out-of-ring + stale-sun-bin pruning, and a duplicate-pending guard for cross-frame builds. Verified in-browser: frameMs avg 339 → 3.9, farSumSunLightMs 335.5 → 2.31.

Files changed (all under `tools/clod-poc/`): `src/terrain/sun_visibility/{far_light_height,light_builder,far_light_cache_runtime,light_update}.ts`, `src/app/config/sun_light.yaml`, `src/app/frame_loop/{far_summary_subphase_timing,perf_probe_constants,render_phase}.ts`, `src/app/bootstrap/ui/frame_loop_startup.ts`, `src/app/bootstrap/clod_poc_bootstrap.ts`, tests in `src/terrain/sun_visibility/__tests__/` and `perf_probe.test.ts`, plus the temporary probe `tools/farsum-probe.ts` (tagged `[DEBUG-fs42]`).

## Task 1 — verify in real play mode (do first, ~10 minutes)

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # no rtk; confirm http 200 before testing
```

1. Automated check (headed browser, real GPU):
   ```powershell
   $env:CLOD_POC_BASE_URL = 'http://127.0.0.1:5180/'
   npm --prefix tools/clod-poc exec -- tsx tools/clod-poc/tools/farsum-probe.ts "?perfProbe=1&perfWarmup=60&perfFrames=120"
   ```
   Expect: `frameMs` avg ≤ ~10, `farSummaryMs` avg ≤ ~3, `farSumSunLightMs` ≈ 2–2.6, all other `farSum*` ≈ 0.
2. Interactive play-mode check (ask the user to do this, or drive a headed Playwright session): enter player mode, WALK and TELEPORT around, DIG (terrain edits bump the revision → `markAllStale` → the whole sun ring rebuilds budgeted). Watch `window.__drusnielSunLightStats()`: `buildMsLastFrame` must stay ≤ ~2–3 ms even right after digging/teleporting; `pendingTiles` should drain over a few seconds (289-tile ring at ~2 ms/frame budget). Frame should stay smooth (no 300 ms hitches).
3. Visual sanity: sun shading (terrain light/shade patterns) still updates after digging — the fix is math-identical to the monolithic build (unit test enforces it), so any visual difference means something else changed. Check `?sunLightDebug=1` overlay if in doubt.
4. Sun-light warmup lag is EXPECTED behavior now (tiles fill in over seconds after teleport). If the user finds that too slow: raise `max_build_ms_per_frame` (e.g. 3–4) or `max_tiles_per_frame` — measure the frame cost tradeoff with the probe before/after.
5. When satisfied, delete `tools/clod-poc/tools/farsum-probe.ts` (grep `DEBUG-fs42`) or keep it deliberately; update the report doc with the play-mode numbers.

## Task 2 — regressions the tree rewind also removed (re-apply on demand)

A rewind of the working tree removed two other landed fixes. Re-apply them if their symptoms show:

1. **Player-mode forest stutter** — `props → vegTotal → forest` bucket spikes to ~110+ ms every ~8 m walked or on sun drift. Cause: `generateTreeRingLightingProxies` scans all 61,504 tree-ring slots (`trees.yaml distance_m: 420`, cell 3.4 m) with terrain height + normal + occlusion samples, monolithically, and `ForestLightingSystem.update` rebuilds the whole 128² field + texture in one frame. Fix design (implemented once, proven, then lost): resumable slot-cursor proxy build + `getBudgeted` cache in `tree_system_gpu_lighting_proxy_cache.ts` that returns the previous proxy set until the new one completes (never restart on key drift); double-buffered field build in `ForestLightingSystem` (`beginBuild`/`stepBuild(deadline)`, row-sliced blur/finalize, swap + single texture upload at completion); controller orchestrates within `forest_lighting.yaml: field.max_build_ms_per_frame: 2.0`; `vegetation_frame_phase.updateForestLighting` drives it and re-applies prop material state only on completion. Verify with the vegTotal profile line (`forest` ≤ ~3 ms while walking).
2. **P0 dirty-atlas exercise** — `p0_dirty_atlas_exercise.ts` is back to moving the camera, which dirties 36–40% of the atlas ⇒ `fallback=threshold` full upload ⇒ the `far-summary-atlas-dirty-upload-evidence` gate can never pass. Fix design: bump revisions of up to `dirtyAtlasTiles` (1–8, default 4) ready far tiles already placed in the ring-0 atlas window via `window.__drusnielNaadf.state.farTiles.set(key, { ...tile, revision: state.revision++ })`, tiles picked from a single tile row (merged rects ≤ 4·32² px = 5.3% < 35% threshold) ⇒ `mode=dirty`, `fallbackReason=none`; counters `requestedTiles`/`bumpedTiles`; update `tools/perf-p0*.ts` consumers + gates accordingly. Then re-run:
   ```powershell
   $env:CLOD_POC_BASE_URL = 'http://127.0.0.1:5180/'
   npm --prefix tools/clod-poc run perf:p0 -- --renderer webgpu --out ../../validation-artifacts/clod-poc-p0-smoke-6 --world 8 --seed 1 --warmup 30 --frames 60 --timeout 90000 --failOnGateFailure
   ```
   Do NOT edit the repo while the run is in progress.

## Task 3 — next real bottlenecks (evidence first, in this order)

1. Re-probe after Task 1 in the scenes the user plays. If `farSummaryMs` is quiet, profile the next-worst broad bucket from `snapshot().broadBucketsByP95` — don't assume.
2. NAADF steady-state (`farSumNaadfMs`) measured 0.0 in the default scene; in NAADF scenes (`?scene=infinite-naadf-far`) re-check with the probe. The streamer already has budgeted resumable far-tile builds and a 2 ms default (`resolveBuildBudgetMs` in `summaryStreamer.ts`); the per-frame job-queue rebuild enumerates (2·32+1)² = 4,225 chunks twice (`near_page_table.radius_chunks_xz: 32` in `config/naadf_poc.yaml`) — only worth touching if `farSumNaadfMs` actually shows up.
3. Sun-light warmup follow-ups if the user wants faster fill: worker offload of tile builds, hierarchical/max-mip ray march, shorter `ray.max_distance_world`.

## Measurement hooks

- `?perfProbe=1` + `window.__drusnielPerf.snapshot()` → `metrics.farSum*Ms` (p50/p95/avg/max), broad buckets, `lastSample` for per-frame values.
- `window.__drusnielSunLightStats()` → buildMsLastFrame/avg, pendingTiles, entries, refreshes. `window.__drusnielSunLightRefresh()` forces a full rebuild (good for stress-testing the budget).
- `tools/farsum-probe.ts` — one-shot headed attribution (see Task 1).
- Kill switches: `&sunLightCache=0`; forest lighting GUI toggle; `?p0DirtyAtlasExercise=0`.

## Commands

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # dev server (no rtk)
rtk npm --prefix tools/clod-poc run typecheck                                      # tsc only — rtk OK
npm --prefix tools/clod-poc test -- <path-filter>                                  # vitest — NO rtk
npm --prefix tools/clod-poc test                                                   # full suite before finishing
```

Report findings in `tools/clod-poc/docs/performance/farsummary-sunlight-regression-2026-07-04.md` (append a "Play-mode verification" section) so progress survives token limits.
