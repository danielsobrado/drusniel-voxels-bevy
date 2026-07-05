# CLOD-POC Hybrid Streaming Terrain Core Engine Plan

## Scope

`tools/clod-poc` is the active core engine target for the time being.

This document is no longer a disposable concept probe for a later Bevy/Rust port. It is the
implementation plan for proving and hardening the hybrid terrain stack inside `tools/clod-poc`
itself.

The plan answers this question:

```text
Can clod-poc become the core long-distance terrain engine with camera-following live visual
chunks, CLOD pages, and a far shell out to 8km, while keeping ownership deterministic,
frame-time measurable, and future gameplay systems possible?
```

For this plan, do not modify production Bevy/Rust terrain modules. Do not add new Bevy module
layouts, Cargo acceptance gates, or Rust streaming architecture tasks here. If native Rust/Bevy
work resumes later, it must be planned separately from measured clod-poc behavior.

## Current Engine Direction

The core clod-poc terrain stack is:

```text
near field:      live visual chunks, highest-priority terrain owner
mid field:       CLOD visual pages, clipped by live ownership
far field:       analytic/summary far shell, clipped by live and CLOD ownership
very far field:  cheap canopy, ocean, mountain, shadow, and atmosphere proxies
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
| Far shell runtime | `tools/clod-poc/src/systems/far_shell_controller.ts`, `tools/clod-poc/src/gpu/far_terrain_shell.ts` |
| Far terrain materials | `tools/clod-poc/src/farTerrain/` |
| Canopy proxy | `tools/clod-poc/src/canopy/`, `tools/clod-poc/src/gpu/far_canopy_shell.ts` |
| NAADF summary query experiments | `tools/clod-poc/src/naadf/` |

## Hard Invariants

```text
I1. The active engine target is TypeScript/WebGPU/Three under tools/clod-poc.
I2. clod-poc has one terrain source: ProceduralWorldSource.
I3. Every sampled visible footprint has exactly one resolved owner: live, CLOD, or far.
I4. Raw overlap is allowed only when the priority resolver clips it before rendering.
I5. Missing CLOD does not create a hole; ownership falls back to far shell outside live range.
I6. Far shell is visual-only for now: no interaction, collision, or edit authority in terrain rendering passes.
I7. Far shell follows the camera and uses snapped/grid-stable centers.
I8. Per-frame work is budgeted and measured by the clod-poc perf harness.
I9. Acceptance is deterministic: same URL, seed, pose, warmup, and frame count.
I10. Gameplay systems must be staged on top of the terrain ownership model, not bypass it.
I11. No Bevy/Rust module layouts or Cargo acceptance gates belong in this clod-poc plan.
```

## Initial Constants

Use these constants first. Do not tune them in the same change as the architecture work.

| Layer | First value |
|---|---:|
| Live visual radius | `128m` |
| CLOD outer radius | `1536m` |
| Far shell inner radius | `1536m`, page-grid aligned |
| Far shell outer radius | `8192m` |
| CLOD page size | existing clod-poc config: `chunks_per_page * chunk_size` |
| Far shell grid | existing `128` grid in `createFarShellController` |
| Coverage oracle cell size | CLOD page size unless a test overrides it |
| Far shell recenter threshold | one far-shell cell, snapped to the active ring spacing |

## Phase 1: Source Parity

Goal:

```text
live visual chunks, CLOD summaries, far shell, biome, ocean, canopy, and shadow proxies
sample the same ProceduralWorldSource
```

Tasks:

- [ ] Keep `ProceduralWorldSource` as the only source for clod-poc terrain.
- [ ] Add a `sampleFarSummary(x, z, footprintM)` helper in `tools/clod-poc/src/world_source/world_source.ts`.
- [ ] The far summary returns height, normal, biome, ocean mask, coast distance, roughness, and canopy density.
- [ ] Route far terrain height provider through `ProceduralWorldSource.createFarHeightProvider()` or the new far-summary helper.
- [ ] Route canopy and shadow proxy terrain queries through the same source or through a summary generated from it.
- [ ] Add parity tests for height, biome, ocean mask, and canopy summary at fixed sample points from `-8192m` to `8192m`.

Required tests:

```text
tools/clod-poc/src/world_source/world_source.test.ts
tools/clod-poc/src/world_source/biome_region_field_parity.test.ts
```

Acceptance:

```text
source parity tests pass and no far-shell path samples a separate terrain function
```

## Phase 2: Deterministic Ownership Runtime

Goal:

```text
clod-poc can explain which layer owns every visible terrain footprint
```

Tasks:

- [ ] Keep ownership state in `TerrainOwnershipRuntime`.
- [ ] Extend `TerrainOwnershipRuntimeSnapshot` with resolved far-shell owner stats.
- [ ] Make `visualPageKeys` page-grid aligned with the far-shell inner boundary.
- [ ] Keep live ownership highest priority, CLOD second, far shell third.
- [ ] Add an explicit fallback rule: outside live radius, missing CLOD is counted and far owns the footprint if the far shell covers it.
- [ ] Keep raw overlap counters for diagnostics, but gate on priority-resolved counters.
- [ ] Add a deterministic walk battery over centers: origin, page edge, page corner, negative coordinates, large positive coordinates, and diagonal movement.

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
priority_owner_overlap_cells = 0
priority_unowned_cells = 0
missing_live_chunks_in_required_radius = 0
horizon_hole_ratio = 0
camera_to_clod_center_m <= chunk_size_m
camera_to_far_shell_center_m <= far_shell_recenter_threshold_m
```

## Phase 3: Live And CLOD Stream Core

Goal:

```text
simulate camera-centered live chunk and CLOD page residency as the core terrain engine path
```

Tasks:

- [ ] Keep live chunk planning in `LiveVoxelChunkStreamer`.
- [ ] Keep CLOD visual page planning in `VisualClodPageStreamer`.
- [ ] Add per-frame load budgets to the streamers instead of instantly loading every required item.
- [ ] Add deterministic pending, loaded, and evictable lists to both snapshots.
- [ ] Add hysteresis tests for slow movement, fast movement, and returning to a previous area.
- [ ] Add a no-hole rule after stream-ready: once required live and required visual pages have had enough budgeted frames to load, ownership counters must be green.
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
missing_required_after_ready = 0
```

## Phase 4: Camera-Following Far Shell

Goal:

```text
far terrain provides an 8km visual horizon and follows the camera without center drift
```

Tasks:

- [ ] Keep far shell creation in `createFarShellController`.
- [ ] Make `moveTo(x, z)` update the far shell center and material center deterministically.
- [ ] Add snapped recentering rather than continuously rebuilding geometry.
- [ ] Keep build-relative geometry for long-distance precision.
- [ ] Add `farShellCenter`, `farShellRecenterCount`, and `farShellLastRecenterFrame` to runtime diagnostics.
- [ ] Make the far shell inner exclusion radius equal to the resolved CLOD outer radius, rounded up to the page grid.
- [ ] Keep the far shell visual-only; do not add interaction, edit, or collision concepts in this phase.

Required files:

```text
tools/clod-poc/src/systems/far_shell_controller.ts
tools/clod-poc/src/systems/far_shell_controller.test.ts
tools/clod-poc/src/gpu/far_terrain_shell.ts
tools/clod-poc/src/farTerrain/
```

Acceptance counters:

```text
far_shell_inner_minus_clod_radius_m >= 0
camera_to_far_shell_center_m <= far_shell_recenter_threshold_m
far_shell_recenter_count increases only after threshold crossing
far_shell_tris stays stable during camera movement
```

## Phase 5: Visual Integration

Goal:

```text
the browser scene proves live, CLOD, far shell, ocean, canopy, and shadows can coexist
```

Tasks:

- [ ] Add or keep a deterministic URL for the core terrain scene, for example:
  `?scene=infinite-islands&seed=1&world=16&clodPerf=1&webgpuSelection=1`.
- [ ] Expose all ownership and stream counters through `window.__drusnielClod.stats`.
- [ ] Show debug HUD counters only when HUD/debug flags are enabled.
- [ ] Keep terrain ownership debug separate from normal material rendering.
- [ ] Ensure ocean and far shell agree on sea level from `ProceduralWorldSource.metadata.seaLevel`.
- [ ] Ensure canopy proxy samples the same terrain source and follows far-shell center.
- [ ] Ensure shadow proxy uses the same ownership/far-summary source when enabled.

Required files:

```text
tools/clod-poc/src/app/
tools/clod-poc/src/ui/overlay_panel.ts
tools/clod-poc/src/systems/far_shell_controller.ts
tools/clod-poc/src/canopy/
tools/clod-poc/src/naadf/
```

Acceptance:

```text
the deterministic core scene reaches ready state, reports green ownership counters,
and renders nonblank terrain/far-shell output
```

## Phase 6: Performance Core Gate

Goal:

```text
prove the core clod-poc terrain path by timing it, not by estimating from FPS
```

Tasks:

- [ ] Use the clod-poc perf harness with identical world, scene, warmup, and frame count.
- [ ] Record `frameMs` p50/p95, `renderMs` p95, draw calls, triangles, visible page count, far shell triangles, and ownership counters.
- [ ] Add perf counters for stream planning time, ownership oracle time, far-shell recenter/rebuild time, and source-summary sampling time.
- [ ] Keep first-run WebGPU pipeline compilation out of the sample window with adequate warmup.
- [ ] Do not make Bevy performance claims from clod-poc results.

Commands:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 16 --warmup 600 --frames 300 --case infinite-islands --params scene=infinite-islands,clodPerf=1,webgpuSelection=1 --out perf-runs/infinite-islands"
```

Acceptance:

```text
frameMs p95 and renderMs p95 are reported with ownership counters from the same run
```

## Phase 7: Gameplay-Ready Terrain Contracts Inside clod-poc

Goal:

```text
prepare clod-poc terrain for gameplay experiments without breaking render ownership
```

This phase does not need full RPG gameplay. It defines safe contracts so future clod-poc gameplay
work has a clean place to attach.

Tasks:

- [ ] Add terrain query helpers for gameplay-style systems: height at point, owner at footprint, biome at point, water at point, cave entrance mask at point.
- [ ] Add a read-only terrain collision query experiment for the live visual radius only.
- [ ] Add a future edit-invalidation contract: live edits invalidate live visual chunks, CLOD pages, and far summaries in that order.
- [ ] Add tests proving gameplay queries use `ProceduralWorldSource` and the ownership runtime, not separate ad hoc terrain math.
- [ ] Keep cave interiors and persistent edits out of this phase unless a separate clod-poc gameplay plan is written.

Required files:

```text
tools/clod-poc/src/gameplay/terrain_queries.ts
tools/clod-poc/src/gameplay/terrain_queries.test.ts
tools/clod-poc/src/stream/terrain_ownership_runtime.ts
tools/clod-poc/src/world_source/world_source.ts
```

Acceptance:

```text
gameplay terrain queries are deterministic and agree with the visual terrain owner/source at fixed sample points
```

## Deterministic Task Backlog

Implement in this order:

1. Add `sampleFarSummary` to `ProceduralWorldSource`.
2. Add source parity tests for height, biome, ocean, canopy, and far summary.
3. Extend `TerrainOwnershipRuntimeSnapshot` with far owner diagnostics.
4. Extend `computeOwnershipCoverageCounters` to report priority-resolved far fallback.
5. Add deterministic ownership walk tests across origin, negative, positive, edge, and corner centers.
6. Add budgeted pending lists to live and visual page streamers.
7. Add stream-ready counters and tests.
8. Snap far-shell inner radius to the CLOD page grid.
9. Add far-shell recenter threshold counters.
10. Wire ownership counters into `window.__drusnielClod.stats`.
11. Add deterministic shot/perf URL for the infinite-islands core scene.
12. Add read-only gameplay terrain query helpers.
13. Run typecheck, tests, build, shot, and perf harness.

No task in this backlog requires a design decision. If a test reveals a bad constant, keep the
constant and record the failure first; tuning is a follow-up change.

## Performance Risks And Mitigations

| Risk | Why it matters in clod-poc | Required mitigation |
|---|---|---|
| Huge live visual radius | It hides the real need for CLOD/far shell and inflates triangles. | Keep live radius at `128m`. |
| CLOD treated as far horizon | Existing page levels are mid-field, not an 8km solution. | Stop CLOD at `1536m`; far shell owns beyond it. |
| Far shell center drift | Camera moves but shell/source/material center disagree. | Track center distance and recenter threshold counters. |
| Raw overlap mistaken for failure | Square pages and circular rings naturally overlap at boundaries. | Gate on priority-resolved counters, keep raw counters diagnostic. |
| Missing CLOD creates holes | Stream budgets can delay pages. | Far owns outside live range when CLOD is missing. |
| Far shell rebuild every frame | Full geometry rebuilds can dominate frame time. | Move/recenter snapped shell; rebuild only after threshold crossing. |
| Multiple terrain sources | Coast, biome, and height seams appear between layers. | Route all terrain summaries through `ProceduralWorldSource`. |
| FPS-only conclusions | Browser FPS hides render and update costs. | Use perf harness summaries and report p50/p95 timing plus counters. |
| Gameplay bypasses terrain ownership | Future systems can disagree with the rendered world. | Gameplay queries must go through source and ownership helpers. |

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
1. One ProceduralWorldSource feeds live, CLOD summary, far shell, ocean, canopy, shadow proxy, and gameplay terrain queries.
2. Deterministic ownership tests pass for origin, negative, far positive, edge, and diagonal movement.
3. Priority-resolved overlap and unowned counters are zero after stream-ready.
4. Missing CLOD outside live range falls back to far shell instead of producing holes.
5. Far shell center drift stays under the configured recenter threshold.
6. The deterministic browser core scene reaches ready state and renders nonblank terrain.
7. Perf output reports frameMs p50/p95, renderMs p95, triangles, draw calls, and ownership counters.
8. Read-only gameplay terrain queries agree with the rendered terrain source and resolved owner.
9. No Bevy/Rust implementation work is required by this document.
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
