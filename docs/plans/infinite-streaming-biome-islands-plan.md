# Infinite Streaming + Multi-Biome Islands Plan

## Context

This plan covers ISLE-1 through ISLE-15 from `docs/plans/infinite-streaming-biome-islands-jiras.md` for `tools/clod-poc`.

The reference under `docs/reference/fable5-world-demo` is a bounded 4096 m world, not an infinite streaming world. Its far shell is a static origin-centered ring. `clod-poc` already has the right foundation for an infinite-feeling world: `scene=infinite-*` enables streaming ownership with live chunks, CLOD pages, and a camera-relative far-shell annulus. The missing pieces are island shaping, biome regions, material/content wiring, and deterministic measurement.

## Locked Decisions

- ISLE-4/ISLE-5 use a `WorldSource` abstraction. Procedural terrain is the current source; streamed voxel maps can implement the same contract later.
- ISLE-8 through ISLE-10 use discrete region biomes: island-distance, elevation bands, and low-frequency deterministic noise break up perfect rings.
- ISLE-11/ISLE-12 use authored/generated PBR texture-array splat layers per biome. Texture array layer indices must be rounded when they come from interpolated attributes.
- Bounded ocean rim is a config toggle. Unbounded mode stays available for future precision work in ISLE-16.

## Height Parity Constraint

Terrain height is parity locked across:

- `tools/clod-poc/src/terrain/terrain_surface.ts`
- `tools/clod-poc/src/gpu/terrain_field_core.ts`
- `tools/clod-poc/src/gpu/shaders/terrain_field_common.wgsl`

CPU and GPU-shaped TypeScript parity is guarded by `tools/clod-poc/src/gpu/terrain_field_core.test.ts`. Any height change must be mirrored and tested. Biome IDs, splat weights, debug colors, and summary material IDs live above the SDF and are additive.

## Phase Design

ISLE-1 through ISLE-3 establish measurement: this document, an `infinite-islands` scene, and a battery shot that records frame timing plus streaming ownership counters.

ISLE-4 and ISLE-5 introduce `WorldSource`, seed, sea level, and world metadata. Default `seed=0` and `seaLevel=18` preserve existing terrain.

ISLE-6 and ISLE-7 add low-frequency island masks, beach/cliff shore shaping, and an optional ocean rim. The infinite-islands scene opts into this. Other scenes stay on default terrain unless URL/config parameters enable islands.

ISLE-8 through ISLE-10 add `BiomeRegionField`, a WGSL mirror include, content schema texture-slot sets, and a biome debug overlay.

ISLE-11 and ISLE-12 reuse the existing generated PBR texture-array path. Per-biome content maps to existing terrain slots, keeping texture memory bounded by the current generated arrays.

ISLE-13 through ISLE-15 keep the streaming ownership invariant: live chunks and CLOD pages follow the camera, the far shell starts at or beyond the CLOD radius, and the battery asserts `streamer_far_shell_ownership_ok == 1` with zero ring-boundary holes. The gate uses priority ownership (`live > CLOD > far`): raw square-page/circular-shell overlap and horizon spill are diagnostics, not failures, because that overlap is geometrically unavoidable at a circular boundary between square page grids.

ISLE-16 is conditional for unbounded worlds that travel far enough from the origin to show precision artifacts. ISLE-17 is the later Bevy port and is out of the first clod-poc milestone.

## Status Update - 2026-06-30

Prompt 1's ownership-gate increment is implemented in `tools/clod-poc`:

- `ownership_coverage_oracle.ts` publishes `priority_owner_overlap_cells` and `priority_unowned_cells`; raw `live_clod_overlap_cells`, `clod_far_overlap_cells`, and `horizon_hole_ratio` remain in reports as spill-band diagnostics.
- `streaming_ownership.ts` page-grid-aligns the far-shell inner radius while keeping the current `2048 m` config unchanged because it already aligns to the `64 m` CLOD page grid.
- `InfiniteFarShell` now renders underneath CLOD with negative render order, positive polygon offset, and a small height offset so the spill band cannot z-fight.
- Phase 0, infinite-islands acceptance, and battery gates now assert priority ownership (`priority_owner_overlap_cells == 0`, `priority_unowned_cells == 0`) plus zero gap/missing counters, rather than requiring raw overlap/horizon spill to be zero.

Latest native Windows acceptance run:

- Command: `rtk cmd /c "set CLOD_POC_BASE_URL=http://127.0.0.1:5180/&& npm --prefix tools/clod-poc run accept:infinite-islands"`
- Artifact: `tools/clod-poc/acceptance-runs/infinite-islands/2026-06-30T14-31-28/report.json`
- Result: all five scenes passed (`walk`, `biome-near`, `biome-horizon`, `final-near`, `final-horizon`).
- Priority gates: `priority_owner_overlap_cells=0`, `priority_unowned_cells=0`, `ring_boundary_holes=0`, `far_summary_tiles_missing=0` for every scene.
- Raw diagnostics remain non-zero as expected: `live_clod_overlap_cells` was `12` for `walk` and `36` for frozen scenes; `clod_far_overlap_cells` was `1198` for `walk` and `1012` for frozen scenes; `horizon_hole_ratio` was about `0.50`.
- Frame timing: `frame_ms_p95` ranged from `2.0` to `2.6`, under the `8 ms` budget.

## Critical Files

- `tools/clod-poc/config/infinite_streaming_phase0.yaml`
- `tools/clod-poc/tools/shoot.ts`
- `tools/clod-poc/tools/battery.ts`
- `tools/clod-poc/src/world_source/*`
- `tools/clod-poc/src/terrain/terrain_surface.ts`
- `tools/clod-poc/src/gpu/terrain_field_core.ts`
- `tools/clod-poc/src/gpu/shaders/terrain_field_common.wgsl`
- `tools/clod-poc/src/clod/terrain_summary.ts`
- `tools/clod-poc/src/gpu/terrain_node_material.ts`
- `tools/clod-poc/src/content/*`

## Verification

Run:

```powershell
rtk npm --prefix tools/clod-poc run typecheck
npm --prefix tools/clod-poc test
npm --prefix tools/clod-poc run build
```

For visual/frame verification, start Vite without `rtk`:

```powershell
npm --prefix tools/clod-poc run dev -- --host 127.0.0.1
npm --prefix tools/clod-poc run shoot -- --scene infinite-islands --seed 1 --world 16 --hud 1 --clodPerf 1 --webgpuSelection 1 --out shots/infinite-islands/walk.png --stats shots/infinite-islands/walk-stats.json
```

Acceptance counters: `frame_ms_p95 <= 8`, `streamer_far_shell_ownership_ok == 1`, `ring_boundary_holes == 0`, `priority_owner_overlap_cells == 0`, `priority_unowned_cells == 0`, and far-shell inner radius `>=` CLOD radius. Keep raw `*_overlap_cells` and `horizon_hole_ratio` in artifacts, but do not gate them to zero.

## Risks

- Height changes can silently diverge between CPU and GPU-shaped paths. Keep parity tests pinned.
- Vite commands fail under `rtk`; use direct `npm` for tests/build/harness.
- A stale CLOD cache can hide seed/island changes. Terrain source hashing includes the world-source config.
- The far shell uses priority ownership, not impossible geometry. Keep the ownership inner radius tied to the CLOD radius and page-grid aligned; resolve the unavoidable raw spill band by render order/depth bias (`live > CLOD > far`), not by pushing radii until gaps appear.
