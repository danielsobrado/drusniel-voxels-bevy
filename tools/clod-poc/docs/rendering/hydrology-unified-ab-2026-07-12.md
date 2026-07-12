# Hydrology unified vs legacy: controlled browser A/B (2026-07-12)

Follow-up to [hydrology-phase3b-unified-startup.md](hydrology-phase3b-unified-startup.md).
All runs on a controlled Vite dev server (port 5183, not the interactive 5180), fresh
Playwright profile per run (all caches cold), seed 1.

## Toggle

`hydroUnified=0|1` URL param (added to `applyWaterQueryOverrides`) overrides
`hydrology.infinite.unified_startup` per page load. `tools/shoot.ts` now includes
`startupTimings` in its `--stats` dump.

## Cold startup (world=8, `shots/hydro-ab/*-stats.json`)

| metric | legacy (2 runs) | unified (2 runs) |
| --- | ---: | ---: |
| `startup.hydrology_ms` | 2568 / 2577 | 448 / 460 |
| `startup.build_world_ms` | 6751 / 6612 | 17361 / 16933 |
| `startup.first_render_ready_ms` | 22451 / 21706 | 32099 / 32410 |

- Unified builds the hydrology raster ~5.6x faster (no particle sim).
- **Unified cold world build is ~10.5 s slower.** Cause: the legacy carved grid was
  installed as the terrain surface override (main thread and `installHydrologyTerrain`
  in workers), so mesher/prop/live-chunk sampling was a bilinear array fetch. Unified
  sets the override to null and every sample pays the full procedural noise field.
  Corroborating counter: `live_bubble_avg_chunk_ms` 92 (legacy) vs 127 (unified).
- This only affects cold builds; acceptance/world-cache hits skip the page build.
  The earlier "3.46x faster startup" claim is the hydrology build itself, not
  `build_world_ms`.

## Traverse (perf:move, world=16, acceptance profile, 300 static + 900 moving frames)

`perf-runs/hydro-ab-unified/summary.json` vs `perf-runs/hydro-ab-legacy/summary.json`:

| window / metric | unified | legacy |
| --- | ---: | ---: |
| static frameMs p50 / p95 | 4.80 / 10.10 | 5.30 / 9.20 |
| moving frameMs p50 / p95 | 6.10 / 19.80 | 6.70 / 20.20 |
| moving frameMs p99 / max | 70.4 / 744.6 | 67.8 / 756.6 |
| moving renderMs p99 / max | 58.9 / 734.8 | 58.8 / 746.7 |

Statistically identical; the ~750 ms max burst appears in both modes (known generic
streaming/pipeline burst, see the 90fps effort notes). **Decision: the deferred
async-tile-build + neighbour-prefetch work is not justified by traverse profiling.**

## Visual boundary check (world=8, cam `400,96,256,-1.5708,-0.43,55`)

`shots/hydro-ab/boundary-{unified,legacy}-warm.png`: near pixel-identical at the same
pose; no seam, tint, or moisture discontinuity at the old `worldCells` edge.
**Decision: Phase 4b GPU-consumer work (TSL vegetation tint, froxel moisture) stays
deferred — no visible discontinuity to fix.**

## Default flip

`DEFAULT_HYDROLOGY_CONFIG.infinite.unifiedStartup` is now `true`, matching the shipped
`config/water.yaml`. Legacy remains available via config or `hydroUnified=0`.
`hydrology_boundary_blend.test.ts` pins `unifiedStartup = false` (it tests the legacy
blend). Full suite (2754 tests), typecheck, and production build pass.

## Open item

Cold-start regression: restore a cheap sampled-heightfield path for the startup world
build (an explicit raster cache, not the hydrology carve side effect) if cold-boot time
matters. Tracked as a follow-up, not part of Phase 3b.
