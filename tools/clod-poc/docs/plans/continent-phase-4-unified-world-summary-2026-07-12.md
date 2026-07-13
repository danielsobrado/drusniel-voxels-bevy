# Continent Phase 4 — Unified World Summary (Far Terrain, Water, Canopy, Shadow)

Parent: `continent-plan-overview-2026-07-12.md`. Requires Phase 3 (graph + carved tiles) for
water channels; the canopy work (C4.3–C4.4) can start after Phase 1 if needed earlier.

## Status

Updated 2026-07-13.

- [x] C4.1 extended sample layout and builder channels.
  - `FAR_SUMMARY_LAYOUT_VERSION = 2` adds graph water, deterministic canopy, and reserved
    structure/cave/occluder channels without increasing the 128-byte GPU record.
  - GPU descriptors carry the layout version; CPU/GPU record decoding, cache commit, exact reads,
    bilinear interpolation, and strict parity cover every v2 field. Categorical `bodyKind` uses
    nearest-cell selection rather than interpolation.
  - `?farSummaryLayout=2` attaches the active hydrology authority and the same deterministic tree
    distribution used by near canopy. The flag defaults off, so existing consumers and visuals are
    unchanged until C4.2/C4.3 are ready.
  - Review fixed two silent-data hazards before handoff: v2 fields were initially omitted from the
    cache hot read/interpolation paths, and aggregate body kind initially allowed dry cells to hide
    a present water-body kind.
  - Verification: typecheck, full Vitest suite, production build, sample QA, and 138 focused
    far-summary tests pass. Sample QA reports its expected `baseline_missing` status.
  - Controlled native-Windows A/B (`scene=continent`, `continentHydrology=0`, 120 warmup / 300
    frames): layout v1 `frameMs` p50/p95 5.20/6.30 ms, `farSummaryMs` p95 2.30 ms,
    `renderMs` p95 1.10 ms; layout v2 5.10/6.20 ms, 2.40 ms, 1.20 ms respectively. The far-summary
    p95 increase is 4.3%, below the 20% split threshold. Runs:
    `perf-runs/continent-phase4-c41-layout-v{1,2}/summary.json`.
  - The standard flag-off run measured 2.50/3.50 ms baseline versus 2.70/4.10 ms after for frame
    p50/p95, with render p95 2.10 versus 2.20 ms. Since layout v2 was disabled in both runs, record
    this as a regression/noise signal, not a C4.1 win. Runs:
    `perf-runs/continent-phase4-c41-{baseline,after}/summary.json`.
  - Remaining evidence gap: steady-state `farSumTilesMs` was zero after warmup, so these runs do
    not establish tile-build p95. A graph-enabled cold browser run also remained in world creation
    without publishing frame hooks and was stopped; do not treat the graph-disabled A/B as graph
    startup evidence.
- [ ] C4.2 far clipmap and far water consume unified channels.
- [ ] C4.3 canopy summary re-source.
- [ ] C4.4 persistent shell, incremental textures, and crossfade.
- [ ] C4.5 GPU-authoritative far summary for continent.
- [ ] C4.6 shadow/occlusion proxy and old controller decision.

**Next action:** C4.2 — expose the v2 water fields through `sampleSummaryInto`, route far water and
shore tinting through them behind the same flag, and capture graph-warm horizon-water shots plus
fallback counters.

## Goal

One streamed **world summary tile** lifecycle feeds the far terrain clipmap, far water, far
canopy shell and shadow/occlusion proxies — instead of the current one-and-a-half authorities
(far-summary tiles + a separate canopy summary tiling + synthetic fallbacks). Far canopy becomes
world-anchored and representation-lagged: persistent shell geometry, incremental texture
updates, no rebuild-on-revision.

## Current code this consolidates (verified 2026-07-12)

| Concern | Today | Anchor |
| --- | --- | --- |
| Far summary tiles | rings 32/64/128 m cells to 16 384 m; states + budgeted builds; CPU builder | `src/far-summary/summary-cache.ts`, `config.ts` |
| Sample layout | `FarSummarySample`: heightMin/Max/Avg, normal, dominantMaterial+variance, canopyCoverage, waterCoverage, slope, roughness | `src/far-summary/types.ts:10-23` |
| GPU builds | `FarSummaryGpuRuntime` behind params; `authoritative` mode suppresses CPU builds; parity module exists | `src/far-summary/integration.ts:114-192`, `gpu-runtime.ts`, `gpu-parity.ts` |
| Far terrain renderer | far clipmap (shader-displaced grid) sourced from `FarHeightProvider` via `__drusnielFarSummary` bridge; `sampleSummaryInto` fast path | `src/terrain/far_clipmap/far_clipmap_source.ts:26-48` |
| Canopy summary | separate 512 m tiling + per-cell deterministic tree accumulation; worker client + parity tests | `src/canopy/canopy_summary_builder.ts`, `deterministic_tree_distribution.ts:103` |
| Canopy textures | whole-texture rebuild per revision (4 new DataTextures) | `src/canopy/canopy_texture.ts:122-197` |
| Canopy shell | dispose+rebuild on revision change; `updateFarCanopyShellTextures` is a no-op | `src/canopy/canopy_system.ts:227-246`, `src/gpu/far_canopy_shell.ts:294-299` |
| Edit invalidation | save→far bridge broadcasting dirty bounds | `src/save/save_far_summary_bridge.ts` |
| Old finite path | `far_shell_controller` builds canopy shell from `TerrainSummaryField` (long_view scenes) | `src/systems/far_shell_controller.ts:170` |

## Design

### Extended sample (versioned layout)

Extend `FarSummarySample` — additive, with a layout version constant consumed by GPU packing:

```text
existing: heightMin/Max/Avg, normal, dominantMaterial, materialVariance,
          canopyCoverage, waterCoverage, slope, roughness
add:      waterLevel, bodyKind, shoreDistance, flowX, flowZ          (from hydrology graph)
add:      canopyHeightAvg, speciesPine/Broadleaf/Deadwood            (from tree distribution)
add:      structureCoverage, caveEntranceCoverage, occluderHeight    (reserved, zero until P5/P6)
```

Rule: **the tile builder is the only producer**; consumers read channels, never re-derive.
Terrain channels sample carved heightfield tiles (fallback procedural), water channels sample
the hydrology graph, canopy channels reuse `accumulateCanopyCell` — the same deterministic
distribution the near trees use, satisfying "far canopy is the same forest, lower cadence".

### Canopy consumes summary tiles

`canopy_summary_builder`'s own tiling is retired; `CanopySummaryCell` values come from world
summary tiles (the cell math in `deterministic_tree_distribution.accumulateCanopyCell` moves
into/behind the summary tile builder unchanged). The canopy worker client then has nothing
canopy-specific to build — deleted after parity. One lifecycle, one prediction, one budget.

### Persistent canopy shell

- Shell geometry: build once per config (grid + index), never rebuilt for content. Position
  follows snapped center (already positional, `canopy_system.ts:204`).
- Textures: two fixed texture sets (front/back). Tile-completion writes dirty rects into the
  back set (`copyTextureToTexture`/partial `writeTexture` region uploads — same mechanism the
  hydrology atlas uses); when a coherent update (all dirty tiles of one recenter/invalidate
  batch) is ready, swap uniforms and crossfade 1–3 s (material already supports opacity-style
  blending via impostor fade params).
- `updateFarCanopyShellTextures` becomes real (rebind + uniform swap) or is deleted in favor of
  the double-buffer swap on the impostor material — decide at implementation by which material
  path (`canopy_gpu_impostors`) is cheaper to parameterize; either way
  `canopy_shell_rebuilds_total` must be ~0 in steady state (counter + acceptance gate).
- Cadence: recenter snap 128–256 m (config); content dirty → debounce 0.5–2 s → rebuild only
  dirty summary tiles → batch-upload → crossfade. Camera motion updates only newly exposed
  strips (toroidal addressing, same policy as the water clipmap).

### GPU-authoritative builds

`FarSummaryGpuRuntime` becomes default-authoritative for the continent scene once
`gpu-parity.ts` checks pass on the extended layout; CPU builder remains the fallback and the
test oracle (the Bevy-port "no second truth" rule: same inputs, parity-tested outputs).

## Commit sequence

### C4.1 — Extended sample layout + builder channels (flagged layout v2)

- Add fields + `FAR_SUMMARY_LAYOUT_VERSION`; builder fills water channels from the hydrology
  graph backend and canopy channels via `accumulateCanopyCell`; GPU packing/records updated;
  parity tests extended. Old consumers read old channels — zero visual change.
- Perf gate: tile build ms p95 before/after (channel adds must stay within budget; the canopy
  accumulation is 4 stratified samples/cell — measure, and if >20% regression, split canopy
  channels to coarse rings only).

### C4.2 — Far clipmap + far water consume unified channels

- `far_clipmap_source.sampleSummaryInto` exposes the new channels; far water/shore tinting and
  the far clipmap material read waterLevel/bodyKind instead of the separate waterCoverage-only
  path; `far_clipmap_fallback_samples_*` gates stay zero.
- Shot QA: horizon water bodies at 2–6 km match near-field hydrology positions.

### C4.3 — Canopy summary re-source (parity, then delete duplicate)

- Canopy system reads summary tiles; `canopy_worker_parity.test.ts` becomes the cross-check
  that old builder == new source for identical inputs, then the old tiling/worker path is
  removed (its tests retargeted). Counters: canopy tile hits/misses via far-summary stats.

### C4.4 — Persistent shell + incremental textures + crossfade

- Double-buffered texture sets, dirty-rect uploads, snap cadence, debounce, crossfade;
  `canopy_shell_rebuilds_total` + `canopy_texture_upload_bytes_total` counters; kill switch
  `?canopyShellRebuild=legacy`.
- Perf evidence: worst-case forest flythrough — before: rebuild spikes (measure and record the
  current spike ms); after: p95 unchanged frame time, upload bytes bounded, zero rebuilds.

### C4.5 — GPU-authoritative far summary for continent scene

- Enable `authoritative` by default for the continent scene after extending `gpu-parity` to
  layout v2; CPU fallback frames counter must be zero in steady state; `--warmup 600` rule for
  the perf runs (compute pipelines).

### C4.6 — Shadow/occlusion proxy + far_shell_controller retirement decision

- Shadow proxy reads occluderHeight (terrain-only until P5 fills entrances/structures);
  `far_shell_controller`'s canopy path stays for long_view scenes or is retired if unused —
  audit call sites first, decide in-commit, do not leave both halves wired.

## Performance budget and measurement

- Steady-state far systems (summary update + canopy + far clipmap refresh) combined ≤ 1.0 ms
  p95 main-thread (`long_view_frame_diagnostics` already tracks these buckets; the uncommitted
  refresh-interval work shows this budget is actively contended — coordinate with it).
- Texture uploads ≤ 1 MB/frame worst case, amortized near zero stationary.
- Standard battery: perf:main world=8 current-textured; a 4 km flythrough route (perf:move)
  with canopy-heavy biome; acceptance --reuse. Record before/after in Evidence.

## Risks

- *Layout version churn on GPU packing* → single `FAR_SUMMARY_LAYOUT_VERSION` constant consumed
  by CPU+GPU+tests; parity suite is the tripwire.
- *Crossfade doubles canopy draw cost briefly* → cap concurrent fades (the streamed-root
  transition `maxExtraRoots` pattern); hard-switch fallback.
- *Deleting the canopy worker path too early* → keep behind `?canopySource=legacy` for one soak
  cycle, then delete.

## Evidence (fill before merging final commit)

- [ ] tile build ms p95 (layout v1 vs v2), CPU and GPU
- [ ] canopy rebuild spike before (ms) vs after (0 rebuilds, upload bytes)
- [ ] flythrough perf route numbers; far bucket ms from diagnostics
- [ ] gpu-parity run on layout v2; authoritative-mode CPU-fallback counter = 0
- [ ] horizon water/canopy shot paths + stats
