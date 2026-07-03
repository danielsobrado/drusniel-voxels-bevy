# Live Frame Cost Fix Report (default scene, ~3 fps investigation)

Date: 2026-07-03. Scene: default interactive scene, `http://127.0.0.1:5180/`, WebGPU, world 8×8 pages.
Status legend: [DONE] implemented in this session, [PENDING] identified but not yet fixed, [EVIDENCE] measured facts.

## 1. Root cause of the ~3 fps (CONFIRMED)

[EVIDENCE] Perf probe sample (moving orbit camera): `frameMs ≈ 333–360`, `farSummaryMs ≈ 330–357` (94–99% of frame), CPU-bound — GPU passes sum to only ~56 ms. All other CPU phases ≤ 4 ms.

[EVIDENCE] `window.__drusnielSunLightStats()`:

```json
{ "buildMsLastFrame": 334.6, "buildMsAvg": 335.9, "tilesBuiltThisFrame": 1,
  "entries": 182, "pendingTiles": 141, "refreshes": 0, "evictions": 0 }
```

One sun-visibility tile build = ~335 ms = the whole frame. Reloading with `&sunLightCache=0` restored fps (user-confirmed). Note: `refreshes: 0` — no revision churn; the queue (289 tiles from `material_tile_radius: 8`) simply drains at 1 tile/frame ≈ 335 ms/frame for ~5 minutes after load/teleport.

Mechanism (three stacked defects in `src/terrain/sun_visibility/`):

1. **Budget check before build** — `far_light_cache_runtime.ts` checked `maxBuildMsPerFrame` (1.0 ms) *before* each tile build, so one ~335 ms tile always completed "within" a 1 ms budget.
2. **Per-sample allocations in the ray march** — `far_light_height.ts:readHeight` allocated a result object + a closure and called `getDigEditRevision()` per height sample; a tile does up to 32×32×256 = 262,144 samples. `light_builder.ts` also recomputed sun-direction constants per texel.
3. **Monolithic tile build** — `buildLightTile` was all-or-nothing; there was no way to amortize a tile across frames.

Likely also the P0 bench connection: the bench's unexplained `farSummaryMs` p50 ≈ 30 ms and 375–620 ms p95 spikes are plausibly the same builder with cheaper/more expensive tiles. Re-run the bench after this fix to confirm.

## 2. Fixes implemented

### 2.1 Sun-light cache [DONE]

- `far_light_height.ts`: added allocation-free `heightAt(x, z) -> number` (NaN = missing); hoisted field/closure lookups; no per-sample revision call. `readHeight` kept for compatibility, now delegating to `heightAt`.
- `light_builder.ts`: tile builds are now resumable — `createLightTileBuild` / `stepLightTileBuild(build, provider, options, deadlineMs)` / `finalizeLightTile`. Per-tile constants (sun direction, tile bounds, cell size) computed once per tile. Deadline is checked after every texel; at least one texel of progress per call is guaranteed. `buildLightTile` remains as the run-to-completion wrapper (used by tests).
- `far_light_cache_runtime.ts`: `updateBudgeted` keeps an in-progress build across frames and honours `maxBuildMsPerFrame` as a real deadline; `maxTilesPerFrame` caps completions; `markAllStale()` cancels the in-progress build.
- `sun_light.yaml`: `max_build_ms_per_frame: 1.0 → 2.0` (real budget now that it is enforced).

**Verified in the live scene (user-run, post-fix):** `frameMs ≈ 6.2–8 ms` (was 333–360), HUD avg FPS **127.3** (was 2.8). `farSumSunLightMs ≈ 2.3–3.9 ms` — the budget is honoured (slight overshoot = the in-flight texel finishing + tile enqueue + GPU atlas upload, which share the bracket). `farSummaryMs ≈ farSumSunLightMs`, all other sub-buckets ~0, confirming the attribution fix works.

### 2.2 Far-summary sub-phase instrumentation un-gated [DONE]

[EVIDENCE] All `farSum*Ms` sample fields read 0 while `farSummaryMs` read 333 — the sub-phase timings were written into `longView.hooks.stats.counters`, which is `null` outside long-view scenes, so the default scene recorded nothing.

- `far_summary_subphase_timing.ts`: timings now accumulate in a module-level store (always), with the long-view counters as an optional mirror for the HUD; `readFarSummarySubphaseCounters()` reads the store.
- `frame_loop_startup.ts`: reset is no longer conditional on long-view counters. Also wrapped previously un-instrumented closure members.
- `render_phase.ts`: samples read from the store.

Note: the ~335 ms was inside `farSumSunLightMs`'s bracket all along — the bracket existed but recorded to a null store.

## 3. Trees (black cards + cost) [PENDING — see findings]

[EVIDENCE] Screenshot shows opaque black tree slabs; `treeGpuStatus: "ring"`, tree CPU stats all zero (GPU-ring path draws them).

Findings so far:

- `b46b64bb` (today) added a WebGPU try/catch fallback to the **classic** tree material, which is documented (header of `tree_node_material.ts`) to render **solid black** under WebGPURenderer. If the console shows `[trees] WebGPU tree node material failed; falling back to classic tree material`, fix the underlying throw — do not ship the black fallback.
- `f22a22dd` / `2eed8664` / `b82c74fc` (today) removed render-side LOD distance masks from impostor / cheap-far / ring materials; LOD exclusivity now depends on GPU compute selection. HUD shows `gpu-compute: webgpu=off` in this scene — if the CPU fallback path does not enforce hard LOD exclusivity, cards draw at all distances (overdraw + black slabs among full-geometry trees).
- Memory/QA note: the tree-grammar replacement landed without browser/WebGPU QA; black cards may predate today (missing vertex attributes on grammar geometry would also render black).

Additional static findings (this session):

- The far-ring card material multiplies everything by `attribute("color")` ([tree_ring_far_node_material.ts:105-113](../../src/trees/tree_ring_far_node_material.ts)) — a card geometry without vertex colors renders pure black. Tree geometry builders do set `color`/`treeVariant` (`tree_geometry.ts:214-218`, `tree_geometry_types.ts`), so the missing-attribute theory is unconfirmed; the failure may instead be in the impostor atlas sample or the crown proxy material.
- `treeGpuStatus: "ring"` — tree LOD exclusivity is owned by the tree GPU-ring compute, which is independent of the CLOD `webgpuSelection` flag; the LOD-mask removal is likely consistent with the ring compute. The black slabs are then a material/albedo bug, not necessarily LOD-overdraw.

**RESOLVED (root cause + fix):** the discriminator showed the slabs are the **impostor tier** (purple), with correct LOD ring exclusivity (green/orange/blue/purple bands, no overlap — the ring compute is fine). Root cause: `tree_impostor_baker.ts:createBakeMaterial` baked the albedo atlas with a classic `MeshBasicMaterial` + `onBeforeCompile` — WebGPURenderer silently drops `onBeforeCompile` (this repo's documented black-material pitfall), so all 6 atlases contained **black trees with correct alpha silhouettes**. The normal-depth bake material next to it already had a WebGPU node branch; the albedo one didn't. [DONE] Added a `MeshBasicNodeMaterial` branch gated on `options.webgpu`, encoding `sqrt(vertexColor)` to match the classic path (the impostor material decodes with `sample.xyz * sample.xyz`). Needs a browser reload to re-bake and verify colored impostors; if still black, check the `[trees]` console warn next.

## 4. Render / GPU cost [PENDING — evidence recorded]

[EVIDENCE] GPU pass timings per frame (renderScale 0.85, effective DPR 0.68, physical ~1832×454):

```
render:        ~28.0 ms   <- TOTAL (contains the passes below: 4.5 + 23.2 + 0.15 ≈ 28)
r.postfxScene: ~23.2 ms   <- main scene colour pass
r.shadow.c0-2:  ~4.5 ms combined
r.screen:       ~0.15 ms
compute (all):  ~0.6 ms
```

**Post-fix update:** with the CPU stall removed, GPU per frame dropped to `render ≈ 4.8–5.1 ms` (`r.postfxScene ≈ 4.5–4.9`, shadows ~0.2) — the earlier 28 ms reading was measured *during* the stall (per-frame GPU work batched behind 333 ms CPU frames, plus a heavier camera view) and no longer reproduces. GPU is not currently the bottleneck (~127 fps live). Keep an eye on `r.postfxScene` when the black tree cards are fixed and more real foliage draws.

## 5. Verification commands

```text
# live check (note: single '&', no stray '?')
http://127.0.0.1:5180/?perfProbe=1&sunLightCache=1
window.__drusnielSunLightStats()   // expect buildMsLastFrame ≤ ~2-3, pendingTiles draining
window.__drusnielPerf.snapshot()   // expect farSummaryMs ≈ farSumSunLightMs ≤ ~3 ms, frameMs ≈ GPU floor
```

```powershell
rtk npm --prefix tools/clod-poc run typecheck   # rtk OK for tsc only
npm --prefix tools/clod-poc test                # vitest — NO rtk
```

## 6. Test/typecheck status

- `tsc --noEmit`: clean. (Fixed two fallouts: `perf_probe.test.ts` sample helper was missing the new required `farSum*` fields — pre-existing break from the instrumentation commits; `light_cache.test.ts` provider mock needed the new `heightAt`.)
- Full vitest suite: **380 files / 2101 tests, all passed** (156 s). Includes 2 new tests in `light_builder.test.ts`: deterministic incremental build under an expired deadline matches the full build; `heightAt` fast path is used when present.

## 6b. Player-mode forest stutter (props → vegTotal → forest ≈ 112–116 ms) [DONE]

[EVIDENCE] User profile in player mode: frame 118–122 ms, `props` 115–119, `vegTotal` 113–117, `forest` 112–116, render only 2.4–2.8 ms, zero shader churn — pure CPU in the `forest` bracket (`updateForestLighting`).

Root cause (micro-bench, vitest, world=1024, trees.yaml settings): `generateTreeRingLightingProxies` walks all **61,504 ring slots** (`distance_m: 420`, cell 3.4 m ⇒ grid 248²) doing `surfaceHeight` + `surfaceNormal` + a 3-sample terrain-occlusion march per slot — **778.7 ms** in Node (~100 ms browser). The field rebuild is minor (splat 2.3 + finalize 11.3 + upload ≈ 25 ms total). The proxy cache key quantizes the center to one 3.4 m ring cell, so walking regenerates constantly; `ForestLightingSystem.shouldUpdate` re-triggers every 8 m or 0.025 sun drift, and the whole rebuild was monolithic inside one frame.

Fix (same resumable pattern as the sun-light cache, budget `forest_lighting.yaml: field.max_build_ms_per_frame: 2.0`):

- `tree_ring_lighting_proxies.ts`: `createTreeRingLightingProxyBuild` / `stepTreeRingLightingProxyBuild(deadline)` / `finishTreeRingLightingProxyBuild` (slot cursor, ≥16 slots progress per step); species weight table hoisted out of the slot loop (also in `generateTreeRingValidationCounts`); `generateTreeRingLightingProxies` kept as run-to-completion wrapper.
- `tree_system_gpu_lighting_proxy_cache.ts`: `getBudgeted(input, deadline)` steps the build across frames, returns the previous proxy set (`ready:false`) meanwhile, never restarts on key drift (converges after completion). `TreeSystem.getLightingProxiesBudgeted(deadline)` wraps it.
- `forest_lighting_fields.ts`: finalize split into row-sliceable phases (`createForestLightingFinalizeContext`, `blurForestLightingCanopyRows`, `finalizeForestLightingRows`, `finalizeForestLightingClampPass`); `finalizeForestLightingField` unchanged wrapper.
- `forest_lighting_system.ts`: double-buffered field + `beginBuild`/`stepBuild(deadline)`/`hasBuildInProgress`; live field/texture untouched until completion (no lighting pop), swap + one texture upload at the end; `update()` = begin+step(∞); `updateSettings` cancels in-flight builds.
- `forest_lighting_controller.ts`: `updateBudgeted(center, sun)` orchestrates proxy acquisition → field build within the ms budget; `vegetation_frame_phase.ts` drives it and re-applies prop material state only on completion.

[EVIDENCE] Same bench, budgeted at 2 ms: proxy build spread over 362 steps, **max step 3.27 ms**; field build 6 steps, max 2.42 ms (slot-check granularity causes the small overshoot; browser per-slot cost is ~8× lower). Total work unchanged — a lighting refresh now completes over ~50 frames in-browser instead of one 112–116 ms hitch.

Tests: +2 resumable-proxy tests, +2 cache budgeted tests (`tree_ring_lighting_proxies.test.ts`), +2 system build tests (`forest_lighting_system.test.ts`), new `forest_lighting_controller.test.ts` (orchestration), frame-phase mock updated. trees/forest/runtime/frame_loop suites: 72 files / 354 tests green; typecheck clean.

**Browser re-verify pending**: in player mode, walk continuously and confirm `forest` stays ≤ ~3 ms in the vegTotal profile line and lighting still refreshes (canopy shadows follow within ~a second after stopping).

## 6c. P0 dirty-atlas exercise → targeted tile revision invalidation [DONE, P0 re-run pending]

[EVIDENCE] smoke-4: camera-boundary move dirtied 27,648–30,720 of 76,800 px (36–40%) > 0.35 threshold ⇒ `fallback=threshold`, full upload — the camera-move exercise can never prove the dirty path.

Rework (`p0_dirty_atlas_exercise.ts`): instead of moving the camera, the exercise re-stamps up to `dirtyAtlasTiles` (1–8, default 4) **ready far tiles already placed in the ring-0 atlas window** with fresh revisions (`state.farTiles.set(key, { ...tile, revision: state.revision++ })` via `window.__drusnielNaadf`). Same slot + new revision ⇒ `diffAtlasTilePlacements` yields blit-only dirty rects; tiles are picked from a single tile row so merged rects stay a strip ≤ 4·32² = 4,096 px (5.3%) ⇒ `mode=dirty`, `fallbackReason=none`. Retries every frame after warmup until tiles are ready; camera/controls removed from the exercise input.

Counters renamed: `moveM`/`requestedMoveM`/`tileSpanM`/`boundaryEpsilonM` → `requestedTiles`/`bumpedTiles`. Updated consumers: `perf-p0.ts` (URL param `dirtyAtlasTiles=4`, counter list, summary row), `perf-p0-gates.ts` (completion gate now checks `bumpedTiles`), `perf-p0-extract.ts`, `perf-p0-atlas-diagnostics.ts`, `perf-p0-gates.test.ts`, `p0-performance-validation.md`.

smoke-5 attempt failed **environmentally**: the dev server on 127.0.0.1:5180 died between the pre-check and the run (`dev server is not reachable`, all cases failed with empty counters, 0 navigations). The rework itself is typecheck-clean and gate unit tests pass — re-run needed with a live server.

Full suite after both fixes: **381 files / 2111 tests green** (141 s).

## 7. Files changed in this session

- `src/terrain/sun_visibility/far_light_height.ts` — allocation-free `heightAt` fast path.
- `src/terrain/sun_visibility/light_builder.ts` — resumable tile builds (`createLightTileBuild`/`stepLightTileBuild`/`finalizeLightTile`), per-tile constants hoisted.
- `src/terrain/sun_visibility/far_light_cache_runtime.ts` — deadline-honouring `updateBudgeted` with cross-frame in-progress build; `markAllStale` cancels it.
- `src/app/config/sun_light.yaml` — `max_build_ms_per_frame: 1.0 → 2.0` (budget is now real).
- `src/app/frame_loop/far_summary_subphase_timing.ts` — module-level timing store (works in all scenes); long-view counters kept as optional HUD mirror.
- `src/app/bootstrap/ui/frame_loop_startup.ts` — subphase reset no longer gated on long-view counters.
- `src/app/frame_loop/render_phase.ts` — samples read subphase timings from the store.
- Tests: `__tests__/light_builder.test.ts` (+2 tests), `__tests__/light_cache.test.ts` (mock `heightAt`), `perf_probe.test.ts` (sample fields).
- `src/terrain/sun_visibility/far_light_cache_runtime.ts` + `light_update.ts` (second pass): `updateBudgeted` takes the camera center tile, prunes pending tiles beyond `materialTileRadius + 2`, and builds nearest-first (pending had grown to 340 > the 289-tile ring and drained FIFO, so stale far tiles built before fresh near ones). +2 tests in `light_cache.test.ts`.
- `src/trees/tree_impostor_baker.ts`: WebGPU node-material branch for the albedo bake (see §3). Trees+sun suites: 321 tests green; typecheck clean.
