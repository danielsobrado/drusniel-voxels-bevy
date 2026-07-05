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
- No far-shell underlay inside the CLOD radius (rejected with rationale in WP-6).
- No new far-summary ring below 1536m.
- No per-page placeholder patch meshes for missing CLOD pages.
- No dynamic far-shell inner radius.
- No partial far-shell height refresh; the full sliced refresh stays until measurements demand otherwise.
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
I7. Missing CLOD does not create a hole: CLOD loads coarse-to-fine and the nearest resident
    ancestor page renders until a required page is ready. The far shell owns only footprints
    beyond the page-grid-aligned CLOD radius and is never an inside-radius fallback.
I8. Far shell is visual-only for now: no interaction, collision, or edit authority in terrain rendering passes.
I9. Far shell follows the camera and uses snapped/grid-stable centers.
I10. Per-frame work is budgeted and measured by the clod-poc perf harness.
I11. Acceptance is deterministic: same URL, seed, pose, warmup, and frame count.
I12. Gameplay systems must be staged on top of the terrain ownership model, not bypass it.
I13. No Bevy/Rust module layouts or Cargo acceptance gates belong in this clod-poc plan.
I14. A CLOD page may be evicted only if it is outside the eviction radius and no required
     not-ready descendant depends on it for coverage (parent retention).
I15. A rendered mesh (CLOD page or far-shell height set) is never removed before its
     replacement is committed (swap-not-pop).
I16. The grid coverage oracle runs only in acceptance/debug runs; gameplay frames publish
     O(1) residency aggregates from the real streamers instead.
```

## Current Constants To Treat As Truth First

Do not tune constants in the same change as architecture work. The plan should first align with the
current runtime/acceptance config, measure it, then tune in a separate change.

| Layer | Current value |
|---|---:|
| Live visual radius | `200m` from `tools/clod-poc/config/infinite_streaming_phase0.yaml` |
| CLOD outer radius | `2048m` from `tools/clod-poc/config/infinite_streaming_phase0.yaml` |
| Far shell inner radius | page-grid aligned CLOD radius via `resolveStreamingOwnership` |
| Far ownership/visibility target | `8192m` target future visible distance for infinite-islands scenes |
| Far summary near ring | `1536m-4096m`, `32m` cells, `32` cells/tile |
| Far summary mid ring | `4096m-8192m`, `64m` cells, `32` cells/tile |
| Far summary horizon ring | `8192m-16384m`, `128m` cells, `32` cells/tile |
| InfiniteFarShell default shell | `4096m-16384m`, `96` radial segments, `192` angular segments |
| InfiniteFarShell snap | `64m` rebase snap by default |
| Far summary build budget | `2ms/frame` by default |

Current bootstrap wiring applies ownership to the far shell with `applyOwnershipToFarShellRange`.
That raises the shell start to the page-grid-aligned CLOD radius for streaming scenes, but it does
not shrink the default shell end. The acceptance target is 8km visible coverage; the mesh can still
extend to 16km for horizon fade and macro terrain.

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
far_summary_tiles_building
far_summary_tiles_stale
far_summary_tiles_built_this_frame
far_summary_cache_size
far_summary_fallback_samples
far_summary_procedural_fallback_samples
far_summary_lower_ring_fallback_samples
far_summary_conservative_fallback_samples
far_summary_stale_restores
far_summary_builds_discarded
far_summary_probe_fallbacks
far_summary_probe_height_error_max_m
far_shell_rebuild_pending
far_shell_rebuild_cursor
far_shell_last_rebuild_ms
far_shell_rebuild_restarts
ownership_oracle_ms
residency_missing_live
residency_missing_clod
clod_parent_coverage_violations
stream_ready_frame
terrainTextureWindowCacheSize
terrainTextureWindowSwaps
```

For validation scenes, the acceptance rules are:

```text
far_summary_procedural_fallback_samples = 0 at settled acceptance sample points
far_summary_conservative_fallback_samples = 0 at settled acceptance sample points
far_summary_lower_ring_fallback_samples = 0 at settled acceptance sample points
far_summary_tiles_missing = 0 (set-based accounting over the current request list)
```

`far_summary_fallback_samples` remains published as the sum of the three split counters for
continuity, but gates use only the split counters. These gates are only achievable after WP-1:
today every ring-1/2 sample is miscounted as a lower-ring fallback because callers never pass
`preferredRing` (`tools/clod-poc/src/far-summary/clipmap-sampler.ts`), and ring-edge tiles are
never requested because tile inclusion tests tile-center distance instead of tile-bounds
overlap (`tools/clod-poc/src/far-summary/clipmap-rings.ts`). Procedural fallback stays as a
safety net, but it must not hide missing far-summary coverage in acceptance runs.

## 2026-07-05 Code Review: Defects And Locked Decisions

Code-grounded defects found in review, each with its locked resolution. The work packages in
the execution-order section implement them. Nothing in this table is open for debate; if an
implementation step contradicts this table, the table wins.

| # | Defect (file) | Locked resolution |
|---|---|---|
| D1 | Callers never pass `preferredRing`, so `sampleFull` defaults to ring 0 and every legitimate ring-1/2 sample is counted as a lower-ring fallback (`src/far-summary/clipmap-sampler.ts`). The zero-fallback gate is unachievable today. | WP-1: required `preferredRing` derived from `ringIndexForDistance`; fallback counted only on a true miss of the preferred ring. |
| D2 | Tile requests test tile-center distance, so ring-edge tiles that overlap the annulus are never requested (`src/far-summary/clipmap-rings.ts`); predicted-center drift (64m snap + 4s preload prediction, ~160m at 24m/s) misaligns the request annulus and the shell's sampling annulus. | WP-1: AABB-vs-annulus inclusion with a fixed `ringCoverageMarginM = 256`. |
| D3 | `farSummaryTilesMissing` is derived from global ready counts, so cached out-of-view ready tiles can mask missing required tiles (`src/far-summary/integration.ts`). | WP-1: set-based accounting over the frame's request list. |
| D4 | The shell vertex loop performs three separate clipmap resolutions per vertex and allocates a `THREE.Vector3` per call (`src/long-view/farSummarySampler.ts`, `clipmap-sampler.ts`). | WP-1: single `sampleSummaryInto` per vertex writing into a scratch object. |
| D5 | The canonical integration still drives the disabled legacy controller (`src/far-summary/integration.ts:174-186`) with its own commit revision, duplicating the bootstrap refresh driver. | WP-2: delete the wiring; the bootstrap closure is the only shell refresh driver. |
| D6 | Stale tiles re-entering the required set are fully rebuilt though content is unchanged; commit-budget overflow discards completed builds; `markStale` ignores its argument; `keepStaleUntilReplacement` is dead config (`src/far-summary/summary-cache.ts`). | WP-3: epoch restore, bounds-based `markStale`, pending-commit queue, wired flag. |
| D7 | Nearest-cell tile sampling plus a 64m snap against 128m horizon cells re-quantizes every vertex on each recenter — visible popping (`summary-cache.ts` `sampleFromTile`, snap in long-view config). | WP-4: edge-clamped bilinear sampling + `rebaseSnapMeters` 128. |
| D8 | Rebuild restarts on snap change are invisible; a fast camera can starve the shell into permanent staleness (`src/long-view/infiniteFarShell.ts` `requestSlicedHeightRebuild`). | WP-4: `far_shell_rebuild_restarts` counter, gated to zero growth in the settled window. |
| D9 | `TerrainOwnershipRuntime` lives inside the diagnostics closure and its streamers insta-load (`src/phase0/long_view_frame_diagnostics.ts:72`, `src/stream/live_voxel_chunk_streamer.ts`, `src/stream/page_plan.ts`), so ownership gates validate a bookkeeping model and can never fail regardless of what renders. | WP-5: hoist to bootstrap; the oracle reads real residency feeds. |
| D10 | The coverage oracle runs every frame with string-key set lookups over a multi-thousand-cell grid — a multi-ms diagnostics cost inside gameplay frame time and inside the frame-time gate. | WP-5: oracle only under `acceptance=1`/`ownershipOracle=1`; packed integer keys; the perf gate is measured with the oracle off. |
| D11 | The old invariant I7 (far shell as fallback for missing CLOD) was geometrically unimplementable: the shell has no triangles inside `farShellInnerM` and the oracle only credits far ownership beyond it (`src/stream/ownership_coverage_oracle.ts:105`). | WP-6: I7 reworded to parent coverage; underlay explicitly rejected (rationale recorded in WP-6). |
| D12 | Tiles store 1024 plain JS sample objects each (>120k heap objects at steady state) and all builds run on the main thread while a worker pattern already exists elsewhere. | WP-7: SoA typed-array tiles + worker builds, only after WP-1..WP-6 gates are green. |
| D13 | The GPU summary atlas path is gated to `infinite-naadf-*` scenes only (`src/app/bootstrap/clod_poc_bootstrap.ts`), while earlier plan text implied general availability. | WP-8: flagged un-gating with hard ship criteria; plan text corrected. |

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
- [ ] WP-1: replace global-arithmetic missing-tile accounting with set-based accounting over the frame's request list (`countRequestStates`).
- [ ] WP-3: epoch-based invalidation; stale tiles with unchanged epoch and existing samples restore to ready without a rebuild.
- [ ] WP-3: implement `markStale(bounds)` for real (bounds intersection, or global epoch bump for `null`); remove the per-frame `markStale(null)` call from `integration.update`.
- [ ] WP-3: commit-budget overflow queues built tiles for next-frame commit instead of discarding the build.
- [ ] WP-3: wire `keepStaleUntilReplacement` into `sampleExactRing` (currently dead config).

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
far_summary_tiles_ready counts ready tiles among the current request list (set-based)
far_summary_tiles_missing = 0 after stream-ready (set-based)
far_summary_procedural_fallback_samples = 0 after stream-ready in validation mode
far_summary_conservative_fallback_samples = 0 after stream-ready in validation mode
far_summary_lower_ring_fallback_samples = 0 at settled acceptance sample points
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
- [ ] WP-2: remove the legacy `farShellController` wiring from `initFarSummaryIntegration`; the bootstrap refresh closure is the single shell refresh driver.
- [ ] WP-1: shell vertex sampling uses one summary lookup per vertex (`sampleSummaryInto`), not three, with no per-vertex `THREE.Vector3` allocation.
- [ ] WP-4: bilinear tile sampling (edge-clamped) replaces nearest-cell sampling.
- [ ] WP-4: `rebaseSnapMeters` becomes 128 (coarsest ring cell) in a separate, screenshot-verified commit.
- [ ] WP-4: publish `far_shell_rebuild_restarts`; gate zero restart growth during the settled sampling window.
- [ ] Note: the GPU summary atlas mode is currently reachable only in `infinite-naadf-*` scenes; general availability arrives with WP-8, not before.

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
camera_to_far_shell_center_m <= 1 in the current acceptance gate
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
- [ ] WP-6: load order is coarse-to-fine — all root-level pages inside the CLOD radius first, then level descending, distance ascending.
- [ ] WP-6: parent retention — a loaded page is evictable only when no required not-ready descendant depends on it.
- [ ] WP-6: swap-not-pop — never remove an old page mesh before its replacement is committed.
- [ ] WP-6: `stream_ready_frame` = first frame where required live chunks, all root CLOD pages in radius, and required far-summary tiles are ready.

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
- [ ] Fallback rule (WP-6): a required CLOD page that is not ready is covered by its nearest resident ancestor; the far shell owns only footprints beyond the page-grid-aligned CLOD radius.
- [ ] Keep raw overlap counters for diagnostics, but gate acceptance on priority-resolved counters.
- [ ] Add a deterministic walk battery over centers: origin, page edge, page corner, negative coordinates, large positive coordinates, and diagonal movement.
- [ ] WP-5: run the grid coverage oracle only when `acceptance=1` (and `ownershipOracle` is not `0`) or `ownershipOracle=1`; gameplay frames publish O(1) residency aggregates (`residency_missing_live`, `residency_missing_clod`) from the real streamers.
- [ ] WP-5: hoist `TerrainOwnershipRuntime` out of `long_view_frame_diagnostics` into bootstrap; diagnostics receives it as a dependency.
- [ ] WP-5: the oracle's loaded sets come from real residency feeds (live-bubble pages, streamed CLOD roots), not the insta-load planning model.
- [ ] WP-5: oracle hot loops use packed integer keys, not string keys; publish `ownership_oracle_ms` when the oracle runs.
- [ ] WP-6: publish and gate `clod_parent_coverage_violations = 0` in oracle runs.

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
camera_to_far_shell_center_m <= 1 in the current acceptance gate
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
- [ ] WP-5: perf-gate runs execute with the coverage oracle OFF; coverage acceptance runs execute with it ON and are exempt from the frame-time gate. Never tune frame time against a diagnostics cost that ships disabled.

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

## Deterministic Execution Order: Corrective Work Packages

Execute WP-0 through WP-8 strictly in order. Every step names its files and its acceptance
check. No step leaves a design decision open. If a step fails its acceptance check, stop and
record the failure; do not reorder or skip ahead. Each WP ends with
`rtk npm --prefix tools/clod-poc run typecheck`, `npm --prefix tools/clod-poc test`, and
`npm --prefix tools/clod-poc run build` green.

### WP-0: Source Parity And Canonical Marking

1. Mark `InfiniteFarShell` as the canonical far shell in docs/tests/bootstrap comments.
2. Add `sampleMaterial(x, z)` to `ProceduralWorldSource`
   (`tools/clod-poc/src/world_source/world_source.ts`): return the biome-derived material id
   from `BiomeRegionField.sample`, using the same id space `writeBiomeRgb` consumes.
3. Wire it into the far-summary terrain sampler literal in
   `tools/clod-poc/src/app/bootstrap/clod_poc_bootstrap.ts` (the `initFarSummaryIntegration`
   options object).
4. Add parity tests at fixed sample points every 512m from -8192 to 8192 on both axes
   comparing `sampleHeight`, `sampleMaterial`, and ocean mask between direct source calls and
   built far-summary tiles (`world_source.test.ts`, `summary-cache.test.ts`).

Acceptance: a built far tile over land reports at least two distinct `dominantMaterial`
values in `summary-cache.test.ts`.

### WP-1: Truthful Far-Summary Counters

Files: `src/far-summary/config.ts`, `clipmap-rings.ts`, `clipmap-sampler.ts`,
`summary-cache.ts`, `integration.ts`, `src/long-view/farSummarySampler.ts`,
`farShellMetrics.ts`, `tools/infinite_acceptance/thresholds.ts`,
`config/infinite_streaming_phase0.yaml`, plus their test files.

1. `config.ts`: add `ringCoverageMarginM: 256` to `FarSummaryStreamConfig` defaults. This
   covers snapped-center drift (64-128m) plus preload prediction (4s x 24m/s = 96m) between
   the request center and the shell's sampling center.
2. `clipmap-rings.ts` `computeRequiredFarSummaryTiles`: replace the tile-center distance test
   with tile-AABB vs annulus overlap: `nearest` = distance from predicted center to the
   nearest point of the tile bounds, `farthest` = distance to the farthest corner; skip only
   when `nearest > ring.endM + ringCoverageMarginM || farthest < ring.startM - ringCoverageMarginM`.
   Priority math is unchanged.
3. `summary-cache.ts`: add module function `readTileSample(tile, cellX, cellZ, out): boolean`
   and route `sampleFromTile` through it. After this step no other file may read
   `tile.samples` directly — this is the single consumer touchpoint WP-7 retargets at typed
   arrays.
4. `clipmap-sampler.ts`: export `ringIndexForDistance(distanceM, config)` (first ring with
   `startM <= d < endM`; clamp below to 0 and above to the last ring). `sampleFull` takes a
   required `preferredRing`. `FarSummaryClipmapSampler` gains `setSampleCenter(x, z)`, called
   from `integration.update` every frame; the public convenience methods
   (`sampleHeight`/`sampleNormal`/`sampleMaterial`/...) compute `preferredRing` from that
   center when the caller omits it. Count `lowerRingFallback` only when the preferred ring
   missed and a coarser ring served the sample.
5. `clipmap-sampler.ts` + `farSummarySampler.ts`: add optional
   `sampleSummaryInto(x, z, distanceM, out): boolean` to `FarHeightProvider`;
   `FarSummaryClipmapSampler` implements it with one `sampleFull`; the shell vertex loop uses
   it with a caller-owned scratch object and no `THREE.Vector3` allocation. Providers without
   the method (NAADF) keep the existing three-call path.
6. Set-based missing accounting: `summary-cache.ts` gains
   `countRequestStates(requests): { ready, building, staleWithSamples, missing }` by direct
   key lookup; `integration.ts` uses it for `farSummaryTilesReady/Building/Missing/Stale`
   instead of subtracting global `getStats()` totals. `getStats()` remains for cache-size and
   global stats only.
7. Split fallback counters end to end: stats already track procedural/lowerRing/conservative
   separately — add the three fields to `FarShellMetrics`, publish
   `far_summary_procedural_fallback_samples`, `far_summary_lower_ring_fallback_samples`, and
   `far_summary_conservative_fallback_samples` in `publishFarShellMetricsToCounters`, and keep
   `far_summary_fallback_samples` as their sum.
8. `thresholds.ts`: add the three split counters to `REQUIRED_COUNTERS` with `= 0` rules
   (acceptance samples settled states, so lower-ring must also be zero). Append the same
   names to `metrics.required_counters` in `infinite_streaming_phase0.yaml`.
9. Tests: a vertex at `r = ring.endM - 1` and at `r = ring.endM + 1` resolves in the correct
   ring with zero fallback once tiles are built; a position within `ringCoverageMarginM`
   behind the movement direction at the outer edge is covered by a requested tile.

Acceptance: infinite-islands acceptance run reports all three split counters = 0 at settled
sample points and `far_summary_tiles_missing = 0` under set-based accounting.

### WP-2: Single Shell Refresh Driver

1. `src/far-summary/integration.ts`: delete the `farShellController` option, its import, the
   `moveTo`/`setHeightProvider` block, `shellRebuildIntervalFrames`, and the
   `farSummaryShellRebuildInterval` query parameter. The tile-build interval logic stays.
2. `src/app/bootstrap/clod_poc_bootstrap.ts`: stop passing `farShellController` into
   `initFarSummaryIntegration`. Add a comment at `terrainView.farShellController.setEnabled(false)`
   stating `InfiniteFarShell` is canonical and the legacy controller stays disabled in
   long-view scenes. The bootstrap `onFarSummaryUpdate` closure (120-frame commit-gated
   `requestHeightRefresh`) is the only shell refresh driver.
3. Update any tests referencing the removed option.

Acceptance: acceptance-run `far_shell_*` counters unchanged apart from removed legacy churn.

### WP-3: Cache Lifecycle Waste Removal

All in `src/far-summary/summary-cache.ts` + `integration.ts` + tests.

1. Epoch invalidation: the cache gains `invalidationEpoch = 0`; tiles gain `builtEpoch`
   stamped at commit. In `requestTiles`, a `stale` or `cooling` tile with
   `samples.length > 0` and `builtEpoch === invalidationEpoch` restores to `ready` without a
   rebuild and increments a new `staleRestores` stat. Only epoch-mismatched or sample-less
   tiles re-enter the build queue.
2. `markStale(bounds: TileBounds | null)` becomes real: `null` increments
   `invalidationEpoch` and marks all non-building tiles stale; a bounds argument marks only
   intersecting tiles stale with `builtEpoch = -1`. Remove the per-frame
   `cache.markStale(null)` call from `integration.update` — freshness transitions belong to
   `evictColdTiles` alone.
3. Commit-budget overflow must never discard a completed build: add a `pendingCommits`
   array; overflow builds land there and are drained (up to the commit budget) at the start
   of the next `buildSomeTiles`. Publish `far_summary_builds_discarded`, 0 by construction,
   gated at 0 as a regression sentinel.
4. Wire `keepStaleUntilReplacement`: when false, `sampleExactRing` treats `stale` tiles as a
   miss. Test both settings.
5. Publish `far_summary_stale_restores` (diagnostic, no gate).

Acceptance: a leave-and-return camera path test performs zero rebuilds for unchanged tiles;
`markStale(bounds)` rebuilds only intersecting tiles.

### WP-4: Shell Sampling And Rebuild Integrity

1. Bilinear sampling: `readTileSample`-based bilinear filter of `heightAvg` (lerped and
   renormalized normal; nearest-cell for material) with clamp at tile edges, used by
   `sampleFull` (`summary-cache.ts`, `clipmap-sampler.ts`). The residual half-cell seam at
   tile borders is accepted and documented here; it is removed by the GPU atlas in WP-8.
2. `src/long-view/longViewConfig.ts`: `rebaseSnapMeters` 64 -> 128 so recenter snaps align
   with the coarsest ring cell. Separate commit with before/after `final-horizon`
   screenshots. This is the one authorized constant change in this plan.
3. `src/long-view/infiniteFarShell.ts`: count `farShellRebuildRestarts` whenever
   `requestSlicedHeightRebuild(true)` replaces a pending rebuild whose `cursor > 0`. Publish
   `far_shell_rebuild_restarts`; acceptance gates zero restart growth during the settled
   sampling window.
4. Fixed-point probes in the diagnostics path (oracle/acceptance mode only): 16 points per
   ring at fixed azimuths and mid-ring radii; publish `far_summary_probe_fallbacks`
   (gate = 0 settled) and `far_summary_probe_height_error_max_m` = max of
   |clipmap height - `worldSource.sampleHeight`| (diagnostic only — slope-dependent, no gate).
5. Locked out of scope: no partial shell refresh, no dynamic shell inner radius, no shell
   tessellation change.

Acceptance: `final-horizon` screenshots show no far-terrain popping across a 128m recenter;
probe fallbacks 0.

### WP-5: Ownership Promotion, Real Residency, Oracle Scoping

1. Hoist: construct `resolveStreamingOwnership` + `TerrainOwnershipRuntime` once in
   `clod_poc_bootstrap.ts` (an ownership resolution already exists there — reuse it) and pass
   both into `createLongViewFrameDiagnostics` via deps. Delete the duplicate construction in
   `src/phase0/long_view_frame_diagnostics.ts`.
2. Packed keys: add `packLiveKey(x, z)` and `packPageKey(level, x, z)` returning numbers
   (offset-shift packing, well inside 2^53) beside the existing string key functions. The
   oracle's `liveOwns`/`clodOwns` and its loaded sets use packed keys only; string keys stay
   as the snapshot/report format.
3. Residency feeds: new `src/stream/ownership_residency.ts` with
   `interface OwnershipResidencyFeeds { liveReady(): ReadonlySet<number>; clodReady(): ReadonlySet<number>; }`.
   Implement adapters at the same places the `live_bubble_ready_pages` and
   `live_clod_stream_ready_pages` counters are computed, with unit tests proving both sides
   produce identical packed keys for the same chunk/page. The oracle consumes the feeds; the
   insta-load planning streamers keep producing required lists only and no longer feed it.
4. Oracle gating: run `computeOwnershipCoverageCounters` only when (`acceptance=1` and
   `ownershipOracle` is not `0`) or `ownershipOracle=1`. Every frame regardless, publish O(1)
   aggregates from the feeds: `residency_missing_live`, `residency_missing_clod`
   (required-minus-ready counts). Publish `ownership_oracle_ms` when the oracle runs.
5. Rule-set split in `tools/infinite_acceptance/thresholds.ts` + runner: export
   `COVERAGE_RULES` (current rules minus frame-time gates) and `PERF_RULES`
   (`frame_ms_p95 <= 8`, `frame_ms_p99 >= 0`, finite draw calls/tris). The acceptance runner
   gains a `perf` scene with `ownershipOracle=0` evaluated against `PERF_RULES` only;
   coverage scenes run oracle-on against `COVERAGE_RULES` only. Frame time is never gated on
   a run that carries oracle cost.

Acceptance: coverage scenes still pass; the perf scene passes oracle-off; a deliberate
residency-feed hole (test hook) trips `priority_unowned_cells > 0` in oracle mode — proving
the oracle now watches real renderer state.

### WP-6: CLOD Hole-Freedom By Parent Coverage (Underlay Rejected)

Locked decision: the far shell is NOT extended inward as an underlay. Rationale, recorded so
it is not relitigated: (a) there are no summary rings below 1536m, so an underlay band from
the live radius would either sample procedural fallback forever (breaking the WP-1 gates) or
require a new near ring — a duplicate data system for space CLOD already owns, violating this
plan's own cache rules; (b) the polar shell's resolution near its inner edge is useless as a
visible hole-filler at a few hundred meters; (c) permanent overdraw plus depth-bias
interaction with CLOD is a standing z-artifact risk. Hole-freedom is quadtree-native:

1. Coarse-to-fine loading in the real CLOD streamer: order by level descending, distance
   ascending — all root-level pages inside the CLOD radius load first.
2. Parent retention: a page is evictable only when it is outside radius + hysteresis AND no
   required not-ready descendant depends on it. Mirror the rule in `src/stream/page_plan.ts`
   so it is unit-testable.
3. Swap-not-pop: an old page mesh is removed only after its replacement mesh is committed;
   assert the far-shell sliced rebuild also satisfies this (it writes into live buffers).
4. Oracle-mode counter `clod_parent_coverage_violations`: for each required-but-missing page,
   a violation if no resident ancestor covers its footprint. Gate = 0.
5. `stream_ready_frame`: first frame where required live chunks are ready AND all root CLOD
   pages in radius are ready AND required far-summary tiles are ready. Every "after
   stream-ready" gate in this plan references this counter.

Acceptance: with artificially throttled CLOD budgets (test hook), zero
`priority_unowned_cells` and zero `clod_parent_coverage_violations` while pages stream in.

### WP-7: SoA Tiles And Worker Builds (Only After WP-1..WP-6 Are Accepted)

1. Tile storage becomes typed arrays: per tile `Float32Array(cells * 8)` laid out
   `[heightAvg, heightMin, heightMax, normalX, normalY, normalZ, slope, roughness]` plus
   `Uint8Array(cells * 3)` laid out `[materialId, canopyQ255, waterQ255]`. Only
   `summary-tile-builder.ts` and the WP-1 `readTileSample` accessor change; every other
   consumer already reads through the accessor.
2. Worker builds: `src/far-summary/far_summary_worker.ts` mirroring the existing
   `live_clod_stream` worker pattern. The worker constructs its own `ProceduralWorldSource`
   from the serialized `TerrainFieldConfig` (plain data). Protocol:
   `{ keyStr, key, ringConfig, epoch } -> { keyStr, buffers (transferred), epoch }`; the main
   thread keeps the full lifecycle/commit path and discards results whose epoch is stale.
   Max in-flight = 2. Publish `far_summary_worker_build_ms`, `far_summary_tiles_inflight`.
3. Sampler scope lock: worker builds sample height/material/water from pure config only.
   Canopy in worker builds is 0 — identical to today's non-NAADF behavior, where the
   bootstrap canopy sampler closes over the main-thread NAADF object and returns 0 without
   it. For `infinite-naadf-*` scenes the worker is auto-disabled and builds stay on the main
   thread. `farSummaryWorker=0` forces the main-thread path everywhere (kept for vitest
   determinism).
4. Perf proof: perf-harness A/B (`--case infinite-islands`, identical world/warmup/frames)
   before and after; report `frameMs` p50/p95 and the `farSumTilesMs` subphase. The change
   ships only if main-thread `farSumTilesMs` drops and p95 does not regress.

Acceptance: worker-built tile buffers are byte-equal to main-thread-built buffers for the
same key/seed/epoch; the perf A/B is recorded in the change description.

### WP-8: GPU Summary Atlas For Shell Heights (Flagged, Last)

1. Un-gate the atlas from NAADF: `farSummaryAtlas=1` enables GPU height sampling mode on
   streaming scenes, requiring the parity far terrain material with the same hard errors as
   the NAADF path in `clod_poc_bootstrap.ts`. CPU sliced rebuilds remain the default.
2. Ship criteria (both required, no judgment call): `final-horizon` shot diff within the
   existing image-sanity thresholds against the CPU path, and a perf A/B showing
   `farSumShellMs` reduced with no p95 regression.
3. Until both criteria are met the flag stays off by default and this WP stays open.

No work package requires a design decision. If a step's acceptance check reveals a bad
constant, keep the constant, record the failure, and continue only within the same WP.

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
| Diagnostics cost inside frame gates | The grid oracle and per-frame planning/string churn are multi-ms and gate-visible. | Oracle acceptance-only (WP-5); packed keys; perf scenes measured oracle-off. |
| Allocation churn in hot loops | Per-vertex Vector3s, per-sample JS objects, and string keys pressure GC every frame. | WP-1 scratch sampling, WP-5 packed keys, WP-7 SoA tiles. |
| Snap/cell misalignment popping | A 64m snap re-quantizes 128m nearest-cell samples on every recenter. | WP-4 bilinear + 128m snap. |

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
6. Missing CLOD does not produce holes: coarse-to-fine loading plus parent retention keeps a resident ancestor rendered until each required page is ready; the far shell owns only beyond the CLOD radius.
7. Far summary has zero missing required tiles (set-based) and zero procedural, conservative, and lower-ring fallback samples at settled acceptance sample points.
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
