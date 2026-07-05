# CLOD-POC Hybrid Streaming Terrain Core Engine Plan

## Scope

`tools/clod-poc` is the active core engine target for the time being.

This document is the implementation plan for hardening the hybrid terrain stack inside
`tools/clod-poc`. It is not a disposable concept probe and it is not a Bevy/Rust porting plan.

The plan answers this question:

```text
Can clod-poc become the core long-distance terrain engine with camera-following live visual
chunks, CLOD pages, cached far summaries, and InfiniteFarShell out to 8km, while keeping
ownership deterministic, frame-time measurable, and future gameplay systems possible?
```

For this plan, do not modify production Bevy/Rust terrain modules. Do not add new Bevy module
layouts, Cargo acceptance gates, or Rust streaming architecture tasks here. If native Rust/Bevy
work resumes later, it must be planned separately from measured clod-poc behavior.

## Current Engine Direction

The canonical clod-poc terrain stack is:

```text
near field:      live visual chunks, highest-priority terrain owner
mid field:       CLOD visual pages, clipped by live ownership
far data:        FarSummaryCache + FarSummaryClipmapSampler
far rendering:   InfiniteFarShell, clipped by live and CLOD ownership
very far field:  cheap canopy, ocean, mountain, shadow, and atmosphere proxies
```

The older path below is compatibility/debug only for this plan:

```text
createFarShellController -> buildFarTerrainShell
```

Do not build new core work around the legacy far shell path. New far-view work should use:

```text
FarSummaryCache -> FarSummaryClipmapSampler -> InfiniteFarShell
```

The first responsibility is visual terrain scale and correctness. The next responsibility is making
this stack a solid core engine foundation for gameplay systems: streamed biomes, caves, edits,
placement, collision experiments, persistence experiments, and performance diagnostics.

## Non-Goals For This Plan

```text
- No Bevy/Rust implementation work.
- No Cargo acceptance gates.
- No direct changes to src/voxel, src/world/source, src/terrain, or Bevy benches.
- No global heightfield rewrite.
- No second far-summary cache.
- No new core work built on createFarShellController unless it is compatibility glue.
- No pretending clod-poc perf proves Bevy perf.
- No future-port language in task acceptance. This plan is for clod-poc.
```

## Existing clod-poc Surfaces

Use the current TypeScript modules as the engine foundation:

| Concern | Existing files |
|---|---|
| Active terrain source | `tools/clod-poc/src/world_source/world_source.ts` |
| Island mask and biome parity | `tools/clod-poc/src/world_source/island_shape.ts`, `tools/clod-poc/src/world_source/biome_region_field.ts` |
| Live visual chunk planning | `tools/clod-poc/src/stream/live_voxel_chunk_streamer.ts` |
| Visual CLOD page planning | `tools/clod-poc/src/stream/page_plan.ts`, `tools/clod-poc/src/stream/page_filter.ts`, `tools/clod-poc/src/stream/page_range.ts` |
| Ring ownership runtime | `tools/clod-poc/src/stream/terrain_ownership_runtime.ts` |
| Ownership counters | `tools/clod-poc/src/stream/ownership_coverage_oracle.ts`, `tools/clod-poc/src/stream/ownership_counters.ts` |
| Stream diagnostics | `tools/clod-poc/src/stream/stream_diagnostics.ts` |
| Canonical far summary cache | `tools/clod-poc/src/far-summary/summary-cache.ts` |
| Canonical far summary builder | `tools/clod-poc/src/far-summary/summary-tile-builder.ts` |
| Canonical far summary sampler | `tools/clod-poc/src/far-summary/clipmap-sampler.ts` |
| Far summary integration | `tools/clod-poc/src/far-summary/integration.ts` |
| Canonical far shell | `tools/clod-poc/src/long-view/infiniteFarShell.ts` |
| Far shell metrics | `tools/clod-poc/src/long-view/farShellMetrics.ts` |
| Long-view config | `tools/clod-poc/src/long-view/longViewConfig.ts` |
| Legacy far shell path | `tools/clod-poc/src/systems/far_shell_controller.ts`, `tools/clod-poc/src/gpu/far_terrain_shell.ts` |
| Far terrain materials | `tools/clod-poc/src/farTerrain/` |
| Canopy proxy | `tools/clod-poc/src/canopy/`, `tools/clod-poc/src/gpu/far_canopy_shell.ts` |
| NAADF summary query experiments | `tools/clod-poc/src/naadf/` |
| Bootstrap wiring | `tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts` |
| Phase/perf config | `tools/clod-poc/config/infinite_streaming_phase0.yaml` |

## Hard Invariants

```text
I1. The active engine target is TypeScript/WebGPU/Three under tools/clod-poc.
I2. clod-poc has one terrain source: ProceduralWorldSource.
I3. FarSummaryCache is the canonical cache for far height, normal, material, canopy, water, slope, and roughness.
I4. InfiniteFarShell is the canonical far terrain renderer.
I5. Every sampled visible footprint has exactly one resolved owner: live, CLOD, or far.
I6. Raw overlap is allowed only when the priority resolver clips it before rendering.
I7. Missing CLOD does not create a hole; ownership falls back to far shell outside live range.
I8. Far shell is visual-only for now: no interaction, collision, or edit authority in terrain rendering passes.
I9. Far shell follows the camera and uses snapped/grid-stable centers.
I10. Per-frame work is budgeted and measured by the clod-poc perf harness.
I11. Acceptance is deterministic: same URL, seed, pose, warmup, and frame count.
I12. Gameplay systems must be staged on top of the terrain ownership model, not bypass it.
I13. No Bevy/Rust module layouts or Cargo acceptance gates belong in this clod-poc plan.
```

## Current Constants To Treat As Truth First

Do not tune constants in the same change as architecture work. The plan should first align with the
current runtime/acceptance config, measure it, then tune in a separate change.

| Layer | Current value |
|---|---:|
| Live visual radius | `200m` from `tools/clod-poc/config/infinite_streaming_phase0.yaml` |
| CLOD outer radius | `2048m` from `tools/clod-poc/config/infinite_streaming_phase0.yaml` |
| Far shell inner radius | page-grid aligned CLOD radius via `resolveStreamingOwnership` |
| Far shell outer radius | `8192m` target future visible distance for infinite-islands scenes |
| Far summary near ring | `1536m-4096m`, `32m` cells, `32` cells/tile |
| Far summary mid ring | `4096m-8192m`, `64m` cells, `32` cells/tile |
| Far summary horizon ring | `8192m-16384m`, `128m` cells, `32` cells/tile |
| InfiniteFarShell default shell | `4096m-16384m`, `96` radial segments, `192` angular segments |
| InfiniteFarShell snap | `64m` rebase snap by default |
| Far summary build budget | `2ms/frame` by default |

If a test or perf run proves these are wrong, record the failure first. Tune later.

## Cache And Precalculation Strategy

Use the caches and precomputed data already present before adding new systems.

### Canonical caches

```text
FarSummaryCache:
  owns far summary tile lifecycle: requested, building, ready, stale, cooling, evicted
  builds tiles under maxBuildMsPerFrame and maxTileBuildsPerFrame
  stores height min/max/avg, normal, material, canopy, water, slope, roughness

FarSummaryClipmapSampler:
  provides height, normal, material, canopy, and water samples from FarSummaryCache
  falls back to lower rings or procedural only when configured

InfiniteFarShell:
  keeps reusable geometry buffers
  rebuilds heights and colors in sliced CPU steps when needed
  can use GPU summary atlas when NAADF GPU mode is active

Terrain texture window cache:
  reuses procedural terrain texture windows by biome-material signature
```

### Do not add yet

```text
- no separate far-summary cache in ProceduralWorldSource
- no second cache inside InfiniteFarShell beyond its geometry/color buffers
- no independent canopy height cache if FarSummaryCache can provide the same data
- no gameplay terrain cache that bypasses ProceduralWorldSource or TerrainOwnershipRuntime
```

### Cache acceptance counters

Add or enforce these counters before calling the path ready:

```text
far_summary_tiles_required
far_summary_tiles_ready
far_summary_tiles_missing
far_summary_tiles_stale
far_summary_tiles_built_this_frame
far_summary_cache_size
far_summary_fallback_samples
far_shell_rebuild_pending
far_shell_rebuild_cursor
far_shell_last_rebuild_ms
terrainTextureWindowCacheSize
terrainTextureWindowSwaps
```

For validation scenes, the important acceptance rule is:

```text
far_summary_fallback_samples = 0 after stream-ready
```

Procedural fallback is useful for safety, but it must not hide missing far-summary coverage in
acceptance runs.

## Phase 0: Align Plan, Config, And Canonical Path

Goal:

```text
the plan, config, diagnostics, and implementation all agree on the active far-shell path
```

Tasks:

- [ ] Treat `InfiniteFarShell` as the canonical far shell in docs, tests, diagnostics, and backlog.
- [ ] Treat `createFarShellController` and `buildFarTerrainShell` as legacy compatibility/debug paths.
- [ ] Align this document with `tools/clod-poc/config/infinite_streaming_phase0.yaml` constants first.
- [ ] Add a short code comment near bootstrap wiring clarifying why `terrainView.farShellController.setEnabled(false)` is expected when `InfiniteFarShell` is active.
- [ ] Ensure deterministic infinite-islands URLs exercise `InfiniteFarShell`, not the legacy shell.

Required files:

```text
tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts
tools/clod-poc/src/app/bootstrap/bootstrap_long_view.ts
tools/clod-poc/src/long-view/infiniteFarShell.ts
tools/clod-poc/config/infinite_streaming_phase0.yaml
```

Acceptance:

```text
infinite-islands and long-view scenes use InfiniteFarShell as the active far renderer
legacy far shell remains disabled when InfiniteFarShell is active
```

## Phase 1: Source And Sampler Parity

Goal:

```text
live visual chunks, CLOD summaries, far summary cache, InfiniteFarShell, biome, ocean, canopy,
and shadow proxies sample one terrain authority or an explicitly derived cache from that authority
```

Tasks:

- [ ] Keep `ProceduralWorldSource` as the only procedural source for clod-poc terrain.
- [ ] Add `sampleMaterial(x, z)` to `ProceduralWorldSource` and route it into far-summary terrain sampling.
- [ ] Add `sampleWaterCoverage(x, z)` or keep `sampleWaterCoverageForHeight(x, z, height)` but document the sea-level path.
- [ ] Add `sampleCanopyCoverage(x, z)` only if it can be derived deterministically without duplicating NAADF/canopy logic; otherwise keep canopy as an injected derived sampler.
- [ ] Add `sampleFarSummary(x, z, footprintM)` only as a thin convenience/facade, not as a new cache.
- [ ] Route far-summary `terrainSampler.sampleMaterial` through `ProceduralWorldSource` instead of defaulting to material `0`.
- [ ] Route canopy and shadow proxy terrain queries through `ProceduralWorldSource`, `FarSummaryCache`, NAADF summaries, or documented derived samplers. Do not use ad hoc terrain math.
- [ ] Add parity tests for height, biome/material, ocean/water, canopy summary, and far summary at fixed sample points from `-8192m` to `8192m`.

Required tests:

```text
tools/clod-poc/src/world_source/world_source.test.ts
tools/clod-poc/src/world_source/biome_region_field_parity.test.ts
tools/clod-poc/src/far-summary/summary-cache.test.ts
tools/clod-poc/src/far-summary/clipmap-sampler.test.ts
```

Acceptance:

```text
source parity tests pass
far-summary material samples are not all default 0 unless the sampled terrain really is material 0
no far-shell path samples a separate terrain function during acceptance runs
```

## Phase 2: Canonical Far Summary Cache

Goal:

```text
FarSummaryCache is the only far data cache used by the core far terrain path
```

Tasks:

- [ ] Keep `FarSummaryCache` as the owner of far-summary tile lifecycle.
- [ ] Keep tile builds sliced by `maxBuildMsPerFrame`.
- [ ] Keep stale tiles visible until replacement when configured.
- [ ] Add stricter ready-state counters: required, ready, missing, stale, building, cache size, fallback samples.
- [ ] Add acceptance support for `disableProceduralFallback` or equivalent validation mode.
- [ ] Add stream-ready logic: only check zero fallback/zero holes after far-summary tiles had enough budgeted frames to load.
- [ ] Add tests proving lower-ring fallback is counted separately from procedural fallback.
- [ ] Add tests proving stale tiles are not silently treated as fresh during acceptance.

Required files:

```text
tools/clod-poc/src/far-summary/config.ts
tools/clod-poc/src/far-summary/summary-cache.ts
tools/clod-poc/src/far-summary/clipmap-sampler.ts
tools/clod-poc/src/far-summary/integration.ts
tools/clod-poc/src/long-view/farShellMetrics.ts
```

Acceptance counters:

```text
far_summary_tiles_required > 0
far_summary_tiles_ready >= far_summary_tiles_required after stream-ready
far_summary_tiles_missing = 0 after stream-ready
far_summary_fallback_samples = 0 after stream-ready in validation mode
far_summary_cache_size >= far_summary_tiles_ready
```

## Phase 3: InfiniteFarShell As Canonical Far Renderer

Goal:

```text
InfiniteFarShell provides the 8km visual horizon and follows the camera without center drift or
full-frame rebuild spikes
```

Tasks:

- [ ] Keep far rendering for long-view/infinite scenes on `InfiniteFarShell`.
- [ ] Keep reusable geometry buffers in `InfiniteFarShell`.
- [ ] Keep sliced CPU height/color rebuilds under the configured budget.
- [ ] Keep snapped center/rebase behavior using `rebaseSnapMeters`.
- [ ] Ensure `farShellCenter`, `farShellSnappedX`, `farShellSnappedZ`, `farShellRebuilds`, `farShellLastRebuildMs`, `farShellRebuildPending`, and `farShellRebuildCursor` are published.
- [ ] Ensure the far shell material center tracks the snapped center.
- [ ] Ensure GPU summary atlas mode remains gated behind the parity far terrain material.
- [ ] Keep the legacy `FarShellController` disabled when `InfiniteFarShell` is active.

Required files:

```text
tools/clod-poc/src/long-view/infiniteFarShell.ts
tools/clod-poc/src/long-view/farSummarySampler.ts
tools/clod-poc/src/long-view/farShellMetrics.ts
tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts
tools/clod-poc/src/farTerrain/
```

Acceptance counters:

```text
far_shell_inner_minus_clod_radius_m >= 0
camera_to_far_shell_center_m <= far_shell_recenter_threshold_m
far_shell_recenter_count increases only after snapped-center changes
far_shell_rebuild_pending eventually returns to 0 after stream-ready
far_shell_tris stays stable during camera movement
far_shell_last_rebuild_ms is reported
```

## Phase 4: Budgeted Live And CLOD Stream Core

Goal:

```text
live visual chunks and CLOD visual pages behave like real budgeted streamers, not instant-loaded sets
```

Current code immediately adds all required live chunks and visual pages to `loaded`. That is useful
for early ownership tests, but it does not prove streaming cost.

Tasks:

- [ ] Add per-frame load budgets to `LiveVoxelChunkStreamer`.
- [ ] Add per-frame load budgets to `VisualClodPageStreamer`.
- [ ] Add deterministic `pending`, `loaded`, and `evictable` lists to both snapshots.
- [ ] Add `streamReadyFrame` based on required live chunks, required visual pages, and required far-summary tiles.
- [ ] Add `missingRequiredAfterReady` counters for live and CLOD separately.
- [ ] Add priority ordering: nearest live chunks first, nearest/lowest-level visual pages first.
- [ ] Add hysteresis tests for slow movement, fast movement, and returning to a previous area.
- [ ] Do not model disk I/O or permanent persistence in this phase.

Required files:

```text
tools/clod-poc/src/stream/live_voxel_chunk_streamer.ts
tools/clod-poc/src/stream/live_chunk_eviction.ts
tools/clod-poc/src/stream/page_plan.ts
tools/clod-poc/src/stream/stream_diagnostics.ts
tools/clod-poc/src/stream/live_voxel_chunk_streamer.test.ts
tools/clod-poc/src/stream/page_plan.test.ts
tools/clod-poc/src/stream/stream_diagnostics.test.ts
```

Acceptance counters:

```text
live_required_count
live_loaded_count
live_pending_count
live_evictable_count
clod_required_count
clod_loaded_count
clod_pending_count
clod_evictable_count
stream_ready_frame
live_missing_required_after_ready = 0
clod_missing_required_after_ready = 0
```

## Phase 5: Deterministic Ownership Runtime

Goal:

```text
clod-poc can explain which layer owns every visible terrain footprint after live/CLOD/far fallback
```

Tasks:

- [ ] Keep ownership state in `TerrainOwnershipRuntime`.
- [ ] Extend `TerrainOwnershipRuntimeSnapshot` with pending/loaded state and resolved far-shell owner stats.
- [ ] Make `visualPageKeys` page-grid aligned with the far-shell inner boundary.
- [ ] Keep live ownership highest priority, CLOD second, far shell third.
- [ ] Add explicit fallback rule: outside live radius, missing CLOD is counted and far owns the footprint if the far shell covers it.
- [ ] Keep raw overlap counters for diagnostics, but gate acceptance on priority-resolved counters.
- [ ] Add a deterministic walk battery over centers: origin, page edge, page corner, negative coordinates, large positive coordinates, and diagonal movement.
- [ ] Keep ownership oracle enabled in acceptance/perf runs, but avoid treating it as free for normal gameplay.

Required files:

```text
tools/clod-poc/src/stream/terrain_ownership_runtime.ts
tools/clod-poc/src/stream/ownership_coverage_oracle.ts
tools/clod-poc/src/stream/page_plan.ts
tools/clod-poc/src/stream/page_filter.ts
tools/clod-poc/src/stream/terrain_ownership_runtime.test.ts
tools/clod-poc/src/stream/ownership_coverage_oracle.test.ts
```

Acceptance counters:

```text
priority_owner_overlap_cells = 0 after stream-ready
priority_unowned_cells = 0 after stream-ready
missing_live_chunks_in_required_radius = 0 after stream-ready
missing_clod_pages_in_required_radius = 0 after stream-ready unless far fallback is explicitly accepted
horizon_hole_ratio = 0 after stream-ready
camera_to_clod_center_m <= chunk_size_m
camera_to_far_shell_center_m <= far_shell_recenter_threshold_m
```

## Phase 6: Visual Integration

Goal:

```text
the browser scene proves live, CLOD, InfiniteFarShell, far summaries, ocean, canopy, and shadows can coexist
```

Tasks:

- [ ] Add or keep a deterministic URL for the core terrain scene, for example:
  `?scene=infinite-islands&seed=1&world=16&clodPerf=1&webgpuSelection=1`.
- [ ] Expose all ownership, stream, far-summary, and far-shell counters through the existing long-view/phase report path.
- [ ] Show debug HUD counters only when HUD/debug flags are enabled.
- [ ] Keep terrain ownership debug separate from normal material rendering.
- [ ] Ensure ocean and far shell agree on sea level from `ProceduralWorldSource.metadata.seaLevel`.
- [ ] Ensure canopy proxy samples the same terrain source, far summary, or documented derived canopy sampler.
- [ ] Ensure shadow proxy uses the same ownership/far-summary source when enabled.
- [ ] Ensure material/biome color for far shell uses far-summary material data, not all-default material unless expected.

Required files:

```text
tools/clod-poc/src/app/
tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts
tools/clod-poc/src/ui/overlay_panel.ts
tools/clod-poc/src/long-view/
tools/clod-poc/src/far-summary/
tools/clod-poc/src/canopy/
tools/clod-poc/src/naadf/
```

Acceptance:

```text
the deterministic core scene reaches ready state, reports green ownership/far-summary counters,
and renders nonblank terrain/far-shell output
```

## Phase 7: Performance Core Gate

Goal:

```text
prove the core clod-poc terrain path by timing it, not by estimating from FPS
```

Tasks:

- [ ] Use the clod-poc perf harness with identical world, scene, warmup, and frame count.
- [ ] Record `frameMs` p50/p95, `renderMs` p95, draw calls, triangles, visible page count, far shell triangles, and ownership counters.
- [ ] Add or verify perf counters for stream planning time, ownership oracle time, far-summary build time, far-shell rebuild time, and source-summary sampling time.
- [ ] Keep first-run WebGPU pipeline compilation out of the sample window with adequate warmup.
- [ ] Record fallback samples from the same run as frame-time numbers.
- [ ] Do not make Bevy performance claims from clod-poc results.

Commands:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 16 --warmup 600 --frames 300 --case infinite-islands --params scene=infinite-islands,clodPerf=1,webgpuSelection=1 --out perf-runs/infinite-islands"
```

Acceptance:

```text
frameMs p95 and renderMs p95 are reported with ownership, far-summary, far-shell rebuild,
and fallback counters from the same run
```

## Phase 8: Gameplay-Ready Terrain Contracts Inside clod-poc

Goal:

```text
prepare clod-poc terrain for gameplay experiments without breaking render ownership
```

This phase does not need full RPG gameplay. It defines safe contracts so future clod-poc gameplay
work has a clean place to attach.

Tasks:

- [ ] Add terrain query helpers for gameplay-style systems: height at point, owner at footprint, biome/material at point, water at point, cave entrance mask at point.
- [ ] Add a read-only terrain collision query experiment for the live visual radius only.
- [ ] Add a future edit-invalidation contract: live edits invalidate live visual chunks, CLOD pages, far-summary tiles, and InfiniteFarShell rebuilds in that order.
- [ ] Add tests proving gameplay queries use `ProceduralWorldSource`, `FarSummaryCache`, and `TerrainOwnershipRuntime`, not separate ad hoc terrain math.
- [ ] Keep cave interiors and persistent edits out of this phase unless a separate clod-poc gameplay plan is written.

Required files:

```text
tools/clod-poc/src/gameplay/terrain_queries.ts
tools/clod-poc/src/gameplay/terrain_queries.test.ts
tools/clod-poc/src/stream/terrain_ownership_runtime.ts
tools/clod-poc/src/far-summary/
tools/clod-poc/src/world_source/world_source.ts
```

Acceptance:

```text
gameplay terrain queries are deterministic and agree with the visual terrain owner/source at fixed sample points
```

## Deterministic Task Backlog

Implement in this order:

1. Mark `InfiniteFarShell` as the canonical far shell in docs/tests/bootstrap comments.
2. Align this plan and acceptance constants with `infinite_streaming_phase0.yaml` before tuning anything.
3. Add `sampleMaterial` to `ProceduralWorldSource` and wire it into the far-summary terrain sampler.
4. Add source parity tests for height, biome/material, ocean/water, canopy, and far summary.
5. Add validation mode where far-summary procedural fallback is disabled or fails acceptance after ready.
6. Extend far-summary acceptance counters with `far_summary_fallback_samples = 0 after stream-ready`.
7. Ensure `InfiniteFarShell` reports rebuild progress, snapped center, and last rebuild time in the same perf run.
8. Add budgeted pending lists to live and visual page streamers.
9. Add stream-ready counters and tests for live, CLOD, and far-summary readiness.
10. Extend `TerrainOwnershipRuntimeSnapshot` with pending/loaded state and resolved far owner diagnostics.
11. Extend `computeOwnershipCoverageCounters` to report priority-resolved far fallback after stream-ready.
12. Add deterministic ownership walk tests across origin, negative, positive, edge, and corner centers.
13. Wire ownership/far-summary/far-shell counters into the existing phase report path.
14. Add deterministic shot/perf URL for the infinite-islands core scene.
15. Add read-only gameplay terrain query helpers.
16. Run typecheck, tests, build, shot, and perf harness.

No task in this backlog requires a design decision. If a test reveals a bad constant, keep the
constant and record the failure first; tuning is a follow-up change.

## Performance Risks And Mitigations

| Risk | Why it matters in clod-poc | Required mitigation |
|---|---|---|
| Huge live visual radius | It hides the real need for CLOD/far shell and inflates triangles. | Start from current `200m`, measure, then tune separately. |
| CLOD treated as far horizon | CLOD is mid-field, not an 8km solution. | Let far shell own beyond the resolved CLOD radius. |
| Plan targets legacy shell | The old shell path can cause duplicate work and stale decisions. | Make `InfiniteFarShell` canonical. Keep legacy shell compatibility only. |
| Duplicate far-summary cache | Two far-data systems will diverge and waste memory. | Use `FarSummaryCache` only. Add facades, not caches. |
| Far shell center drift | Camera moves but shell/source/material center disagree. | Track center distance, snapped center, and rebuild counters. |
| Raw overlap mistaken for failure | Square pages and circular rings naturally overlap at boundaries. | Gate on priority-resolved counters, keep raw counters diagnostic. |
| Missing CLOD creates holes | Stream budgets can delay pages. | Far owns outside live range when CLOD is missing. |
| Procedural fallback hides cache misses | Visuals may look fine while far-summary cache is missing. | Require zero fallback samples after stream-ready in validation scenes. |
| Far shell rebuild every frame | Full geometry rebuilds can dominate frame time. | Use `InfiniteFarShell` sliced rebuilds and snapped rebasing. |
| Multiple terrain sources | Coast, biome, and height seams appear between layers. | Route all terrain summaries through `ProceduralWorldSource` or derived far-summary tiles. |
| Material always default 0 | Far terrain can pass height tests but fail visual biome/material parity. | Wire `sampleMaterial` into far-summary terrain sampler. |
| FPS-only conclusions | Browser FPS hides render and update costs. | Use perf harness summaries and report p50/p95 timing plus counters. |
| Gameplay bypasses terrain ownership | Future systems can disagree with the rendered world. | Gameplay queries must go through source, far summary, and ownership helpers. |

## Verification Commands

Follow the repo rule for clod-poc Vite commands: `typecheck` may use `rtk`, but Vite-based
`test`, `build`, `qa`, and dev server commands run directly.

```powershell
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene infinite-islands --seed 1 --world 16 --freeze 1 --hud 1 --framealign 0 --out shots/infinite-islands/core.png --stats shots/infinite-islands/core-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 16 --warmup 600 --frames 300 --case infinite-islands --params scene=infinite-islands,clodPerf=1,webgpuSelection=1 --out perf-runs/infinite-islands"
```

## Done Criteria

The clod-poc core terrain path is ready when:

```text
1. One ProceduralWorldSource feeds live, CLOD summary, far-summary tiles, InfiniteFarShell, ocean, canopy, shadow proxy, and gameplay terrain queries.
2. FarSummaryCache is the only canonical far data cache.
3. InfiniteFarShell is the canonical far renderer for long-view/infinite scenes.
4. Deterministic ownership tests pass for origin, negative, far positive, edge, and diagonal movement.
5. Priority-resolved overlap and unowned counters are zero after stream-ready.
6. Missing CLOD outside live range falls back to far shell instead of producing holes.
7. Far summary has zero missing tiles and zero fallback samples after stream-ready in validation mode.
8. Far shell center drift stays under the configured recenter threshold.
9. Far shell rebuild work is sliced and reports pending/cursor/last rebuild metrics.
10. The deterministic browser core scene reaches ready state and renders nonblank terrain.
11. Perf output reports frameMs p50/p95, renderMs p95, triangles, draw calls, ownership counters, far-summary counters, and fallback counters.
12. Read-only gameplay terrain queries agree with the rendered terrain source and resolved owner.
13. No Bevy/Rust implementation work is required by this document.
```

## Future Work Inside clod-poc

After the core terrain path is green, write separate clod-poc plans for:

```text
- cave interiors and cave streaming
- real collision/physics over live terrain
- terrain edits and derived-layer invalidation
- persistence/save-load experiments
- RPG traversal and interaction systems
- multiplayer/co-op ownership windows
```

These are clod-poc plans first. Do not turn them into Bevy/Rust plans unless the project direction changes again.
