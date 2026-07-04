# farSummaryMs ~346 ms regression — diagnosis + fix (2026-07-04)

Scene: default interactive scene, `http://127.0.0.1:5180/?perfProbe=1`, WebGPU, headed browser.

## Symptom

`farSummaryMs` avg ~346 ms / p50 ~342 / p95 ~355, constant every frame; vegetation p95 ~3.7 ms, render p95 ~2 ms. NAADF was suspected (jobs/commits, 32×32 far tiles) and budgeted — no change.

## Attribution (new instrumentation, decisive)

The `farSummaryMs` bracket is a composite (sun light, far-summary tile cache, NAADF, infinite far shell, shadow proxy updateFrame, biome streaming, stats DOM). Sub-phase attribution was re-added:

- `src/app/frame_loop/far_summary_subphase_timing.ts` — module store; `timeFarSummarySubphase(bucket, fn)`, drained once per frame by `render_phase.ts` into the perf-probe sample.
- Buckets (also the P0 tool metric names): `farSumTilesMs` (far-summary cache), `farSumNaadfMs`, `farSumShellMs` (infinite far shell + streaming moveTo), `farSumShadowProxyMs`, `farSumBiomeStreamMs`, `farSumSunLightMs`, `farSumStatsDomMs`.
- Wrapped call sites: `app/bootstrap/ui/frame_loop_startup.ts` (sun light, moveTo, stats DOM) and `app/bootstrap/clod_poc_bootstrap.ts` (tiles/NAADF/shell/shadowProxy/biomeStream).

Measured (120 samples): `farSummaryMs` avg 335.5 — **`farSumSunLightMs` avg 335.5, every other bucket 0.0**. The cost was the sun-visibility light cache, not NAADF.

## Root cause

A working-tree rewind restored the old monolithic sun-light build: `far_light_cache_runtime.updateBudgeted` checked `max_build_ms_per_frame` *between* tile builds, and `buildLightTile` was all-or-nothing — one 32×32-texel tile × ray march (2048 m at 8 m steps) ≈ ~335 ms per frame, with `readHeight` allocating a result object + consulting the dig revision per height sample. (Same defect documented before; the rewind also removed the previous fix and the farSum attribution.)

## Fix (re-applied)

- `far_light_height.ts`: allocation-free `heightAt(x, z) -> number` (NaN = missing), hoisted field lookups, no per-sample revision call; `readHeight` delegates.
- `light_builder.ts`: resumable builds — `createLightTileBuild` / `stepLightTileBuild(build, provider, options, deadlineMs)` / `finalizeLightTile`; per-tile constants (sun direction, bounds, cell size) hoisted; deadline checked per texel with ≥1 texel progress; `buildLightTile` kept as run-to-completion wrapper.
- `far_light_cache_runtime.ts`: `updateBudgeted(provider, frameIndex, nowMs, centerTile)` keeps an in-progress build across frames and honours the budget as a real deadline; nearest-first pending selection; prunes pending beyond `material_tile_radius + 2` and stale sun bins; drops duplicate pending keys re-enqueued while a tile was mid-build; `markAllStale()` cancels the in-progress build.
- `light_update.ts` passes the camera center tile; `sun_light.yaml: max_build_ms_per_frame 1.0 → 2.0` (budget is real now).

## Verified (same scene, same probe)

| metric | before | after |
|---|---|---|
| frameMs avg / p50 / p95 | 339.1 / 343.0 / 347.3 | 3.9 / 3.6 / 4.8 |
| farSummaryMs avg | 335.5 | 2.34 |
| farSumSunLightMs avg | 335.5 | 2.31 |

Full suite: **397 files / 2161 tests green**; typecheck clean. New tests: stepped-build-equals-monolithic + min-progress (`__tests__/light_builder.test.ts`), cross-frame in-progress build without duplicate rebuilds + nearest-first/pruning (`__tests__/light_cache.test.ts`).

## How to re-verify

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort   # no rtk
$env:CLOD_POC_BASE_URL = 'http://127.0.0.1:5180/'
npm --prefix tools/clod-poc exec -- tsx tools/clod-poc/tools/farsum-probe.ts "?perfProbe=1&perfWarmup=60&perfFrames=120"
```

Or in the browser console: `window.__drusnielPerf.snapshot().metrics` → read `farSum*Ms`; `window.__drusnielSunLightStats()` → `buildMsLastFrame ≤ ~2–3`, `pendingTiles` draining. Kill switch: `&sunLightCache=0`.

`tools/farsum-probe.ts` is tagged `[DEBUG-fs42]` — delete it once the play-mode verification is done, or keep it if it earns its place.

## Regression note (important for future sessions)

The rewind that restored the old sun-light code ALSO removed two other fixes that had landed earlier:

1. **Forest-lighting budgeted rebuild** (player-mode stutter: `props → vegTotal → forest` 112–116 ms per update; proxy scan over 61.5k tree-ring slots). No `stepTreeRingLightingProxyBuild`/`updateBudgeted` exists in the tree anymore.
2. **P0 dirty-atlas tile-revision exercise** (`bumpPlacedFarSummaryTiles`) — the camera-move version is presumably back, so the `far-summary-atlas-dirty-upload-evidence` gate will fail with `fallback=threshold` again.

If those symptoms reappear, the designs are documented in this folder's session prompts; re-apply rather than re-diagnose.
