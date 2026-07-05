# Hybrid Streaming Terrain Concept Probe

## Scope

This document is only for proving the hybrid long-distance terrain concept in
`tools/clod-poc`.

Do not implement the Bevy/Rust streaming architecture from this document. The probe must
answer one question:

```text
Can we render and validate a camera-following terrain stack with live visual chunks,
CLOD pages, and a far shell out to 8km without gaps, double owners, or unacceptable
frame-time cost?
```

The production Bevy runtime remains voxel-authoritative later, but this plan does not
modify `src/voxel`, `src/world/source`, `src/terrain`, `assets/config`, or Bevy benches.

## Verdict To Probe

Keep the conceptual architecture:

```text
near field:      live visual chunks, highest-priority owner
mid field:       CLOD visual pages, clipped by live ownership
far field:       analytic/summary far shell, clipped by live and CLOD ownership
very far field:  cheap canopy, ocean, mountain, shadow, and atmosphere proxies
```

The clod-poc must prove the visual and performance side only. Gameplay authority,
colliders, voxel edit persistence, caves as true volumes, and chunk disk I/O are future
Bevy work and are intentionally out of scope here.

## Existing clod-poc Surfaces

Use the current TypeScript modules as the probe foundation:

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
I1. The probe is TypeScript/WebGPU/Three-only under tools/clod-poc.
I2. The probe has one terrain source: ProceduralWorldSource.
I3. Every sampled visible footprint has exactly one resolved owner: live, CLOD, or far.
I4. Raw overlap is allowed only when the priority resolver clips it before rendering.
I5. Missing CLOD does not create a hole; ownership falls back to far shell outside live range.
I6. Far shell is visual-only: no gameplay, colliders, or edit authority.
I7. Far shell follows the camera and uses snapped/grid-stable centers.
I8. Per-frame work is budgeted and measured by the clod-poc perf harness.
I9. Acceptance is deterministic: same URL, seed, pose, warmup, and frame count.
I10. No Bevy/Rust module layouts or Cargo acceptance gates belong in this probe plan.
```

## Initial Constants

Use these constants for the probe. Do not tune them in the same change as the architecture
work.

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

## Probe Phases

### Phase 1: Source Parity

Goal:

```text
live visual chunks, CLOD summaries, far shell, biome, ocean, canopy, and shadow proxies
sample the same ProceduralWorldSource
```

Tasks:

- [ ] Keep `ProceduralWorldSource` as the only source for the probe.
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

### Phase 2: Deterministic Ownership Runtime

Goal:

```text
the probe can explain which layer owns every visible terrain footprint
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

### Phase 3: Live And CLOD Stream Probe

Goal:

```text
simulate camera-centered live chunk and CLOD page residency without implementing disk I/O
```

Tasks:

- [ ] Keep live chunk planning in `LiveVoxelChunkStreamer`.
- [ ] Keep CLOD visual page planning in `VisualClodPageStreamer`.
- [ ] Add per-frame load budgets to the streamers instead of instantly loading every required item.
- [ ] Add deterministic pending, loaded, and evictable lists to both snapshots.
- [ ] Add hysteresis tests for slow movement, fast movement, and returning to a previous area.
- [ ] Add a no-hole rule after stream-ready: once required live and required visual pages have had enough budgeted frames to load, ownership counters must be green.
- [ ] Do not model chunk mesh generation, colliders, disk load, or voxel persistence in this phase.

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

### Phase 4: Camera-Following Far Shell

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
- [ ] Keep the far shell visual-only; do not add interaction, edit, or collision concepts.

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

### Phase 5: Visual Integration

Goal:

```text
the browser scene proves live, CLOD, far shell, ocean, canopy, and shadows can coexist
```

Tasks:

- [ ] Add or keep a deterministic URL for the probe, for example:
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
the deterministic probe URL reaches ready state, reports green ownership counters,
and renders nonblank terrain/far-shell output
```

### Phase 6: Performance Probe

Goal:

```text
prove the concept by timing the browser path, not by estimating from FPS
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
11. Add deterministic shot/perf URL for the infinite-islands probe.
12. Run typecheck, tests, build, shot, and perf harness.

No task in this backlog requires a design decision. If a test reveals a bad constant, keep
the constant and record the failure first; tuning is a follow-up change.

## Performance Risks And Probe Mitigations

| Risk | Why it matters in clod-poc | Required mitigation |
|---|---|---|
| Huge live visual radius | It hides the real need for CLOD/far shell and inflates triangles. | Keep live radius at `128m`. |
| CLOD treated as far horizon | Existing page levels are mid-field, not an 8km solution. | Stop CLOD at `1536m`; far shell owns beyond it. |
| Far shell center drift | Camera moves but shell/source/material center disagree. | Track center distance and recenter threshold counters. |
| Raw overlap mistaken for failure | Square pages and circular rings naturally overlap at boundaries. | Gate on priority-resolved counters, keep raw counters diagnostic. |
| Missing CLOD creates holes | Stream budgets can delay pages. | Far owns outside live range when CLOD is missing. |
| Far shell rebuild every frame | Full geometry rebuilds can dominate frame time. | Move/recenter snapped shell; rebuild only after threshold crossing. |
| Multiple terrain sources | Coast, biome, and height seams appear between layers. | Route all probe terrain summaries through `ProceduralWorldSource`. |
| FPS-only conclusions | Browser FPS hides render and update costs. | Use perf harness summaries and report p50/p95 timing plus counters. |

## Verification Commands

Follow the repo rule for clod-poc Vite commands: `typecheck` may use `rtk`, but Vite-based
`test`, `build`, `qa`, and dev server commands run directly.

```powershell
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5180 --strictPort
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run shoot -- --scene infinite-islands --seed 1 --world 16 --freeze 1 --hud 1 --framealign 0 --out shots/infinite-islands/probe.png --stats shots/infinite-islands/probe-stats.json"
rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run perf:main -- --world 16 --warmup 600 --frames 300 --case infinite-islands --params scene=infinite-islands,clodPerf=1,webgpuSelection=1 --out perf-runs/infinite-islands"
```

## Done Criteria

The concept probe is done when:

```text
1. One ProceduralWorldSource feeds live, CLOD summary, far shell, ocean, canopy, and shadow proxy queries.
2. Deterministic ownership tests pass for origin, negative, far positive, edge, and diagonal movement.
3. Priority-resolved overlap and unowned counters are zero after stream-ready.
4. Missing CLOD outside live range falls back to far shell instead of producing holes.
5. Far shell center drift stays under the configured recenter threshold.
6. The deterministic browser URL reaches ready state and renders nonblank terrain.
7. Perf output reports frameMs p50/p95, renderMs p95, triangles, draw calls, and ownership counters.
8. No Bevy/Rust implementation work is required by this document.
```

## Future Bevy Translation

After the clod-poc probe is green, write a separate Bevy implementation plan. That future
plan must translate only the proven behaviors and measured constraints from this probe:

```text
ownership rules
radius constants
far-shell recenter policy
source-summary fields
stream-ready counters
performance budgets
```

Do not copy TypeScript visual shortcuts into Bevy as gameplay authority.
