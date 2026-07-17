# Water / Rivers — GPU-Driven Fable5-Parity Plan (2026-07-17)

Diagnosis and execution plan for making clod-poc water and rivers visible, fast, and at
the level of the Braffolk `fable5-world-demo`, while staying compatible with continents,
infinite streaming, and the existing CLOD ownership rules (water never feeds CLOD page
sources). Supersedes the visual-tuning scope of
`drusniel-water-fable5-alignment-jira-plan.md`; that doc's ownership/QA rules stay valid.

## Evidence Base (live runs, 2026-07-17)

All runs against the local dev server (`http://127.0.0.1:5180/`), Playwright + WebGPU,
seed 1. Artifacts under `qa-runs/water-live-probe/` and `perf-runs/water-ab-{on,off}/`.

1. `scene=continent`: hydrology graph present (store hit), field sweep near spawn found
   3720/9216 wet samples, river flow up to 0.70. Aerial shot shows carved channels but
   water renders as flat cyan sheets with staircase edges and torn shoreline triangles.
2. `scene=infinite-islands`: at a traced river spot (1638, 493) the field reports
   529/1089 wet samples at 1.5 m spacing (max depth 5.4 m, max flow 2.34) **inside the
   L0 clipmap rect**, yet the close-up render shows no water; the aerial view shows a
   chain of disconnected pixelated puddles. Traced channels do not carve terrain, so on
   slopes "rivers" degenerate into pothole chains only wet where terrain dips under the
   bank-clamped channel level.
3. WebGPU error storm every frame from the uncommitted stone-view WIP: "stone scatter
   params" buffer bound at 640 B vs 656 B required (working tree `PARAM_BYTES = 16*41`,
   HEAD `16*21`, served page had a stale in-between module). Dawn uncaptured errors then
   poison unrelated **async render pipeline creation** — observed failures include
   `MeshBasicNodeMaterial` (the default water perf material's class) and spell
   materials. Water levels whose pipeline creation races the error storm silently never
   draw. This alone can make water "not happen" nondeterministically.
4. Perf A/B (`perf:move`, infinite-islands, stones=0, 420 moving frames):
   - water on:  moving frame p50 11.0 ms, p95 17.5 ms, fpsP5 57.8, `waterMs` p50 0.3 /
     p95 0.5 / **max 15.2 ms** (single-frame clipmap ring refills)
   - water off: moving frame p50 10.4 ms, p95 14.9 ms, fpsP5 68.0
5. Continent water runtime uses `worldCells = 1024` (the startup square) because
   `waterRuntimeWorldCells` special-cases only `infinite-islands`, and water startup
   receives the **raw** `borderCoastOceanConfig` rather than `effectiveBorderCoast`
   (`world_build_startup.ts` result exports the raw config). Result: a phantom
   shore-surf "ocean" band at y=18 and a 256 m forced-dry exclusion frame inside a 1 km²
   square in the middle of the continent landmass.
6. `dressing_river_cobbles_generated=2304, accepted=0, visible=0` — river dressing
   dead-ends before placement.
7. No water counters exist in `__drusnielClod.stats.counters` (WATER-702 gap); water
   state is only visible via the dev-only `waterDebugInfo()` hook.

## Architecture Findings (readbacks question)

- **There are no GPU→CPU readbacks anywhere in the water path.** The hydrology
  streaming atlas (`hydrology_atlas_gpu.ts`) is upload-only (`writeTexture`), consumed
  by vegetation placement compute. Stone telemetry readbacks exist but are outside
  water and already decoupled from rendering.
- The problem is the opposite of readbacks: **everything is CPU-produced.** The water
  clipmap samples `WaterField → HydrologySystem → tile cache / traced / graph sampler`
  per vertex on the CPU during ring refills, then uploads texels (static topology) or
  vertex buffers (WebGL legacy). GPU is a pure consumer. Worst-case refill is a full
  129×129 level in one frame (teleport/large snap) with per-sample channel tracing —
  the measured 15 ms `waterMs` spikes.
- The GPU-resident hydrology atlas already contains Layout A (waterY, wetMask,
  carvedBedY, shoreDistance) in a camera-following rgba32float window of
  6×6 tiles × 256 m = **1536 m**, which exactly covers water rings L0–L3
  (12 m × 128 = 1536 m). Rings L4/L5 are far/ocean scale and already have
  far-summary/deep-ocean representations.

## Phase W0 — Unbreak and Guard (P0) — IMPLEMENTED 2026-07-17

1. ~~Land or fix the stone-view WIP~~ **DONE** (landed upstream via PR merges the same
   day; fresh pages verified with zero stone-scatter errors and zero uncaptured
   errors).
2. ~~Add `webgpu_uncaptured_errors`~~ **DONE**: `diagnostics/webgpu_uncaptured_errors.ts`
   counts device uncaptured errors; mirrored into `__drusnielClod.stats.counters` from
   the vegetation frame phase. Fail-loud gate wiring into acceptance remains open.
3. ~~effectiveBorderCoast + streamed worldCells~~ **DONE**: `WorldBuildResult` now
   exports the world-mode-resolved coast config, and `waterRuntimeWorldCells` returns
   the unbounded sentinel whenever `hydrologySystem.supportsInfiniteWorldSamples()`.
   Live-verified on continent: `worldCells 1e9`, `shoreSurf.enabled false`,
   `clipmapExclusionBand.enabled false`; the deep-ocean surface is camera-relative on
   all streamed worlds.
4. ~~WATER-702 counters~~ **DONE**: `water_clipmap_{enabled,visible_levels,level_count,
   snaps,full_refills,partial_refills,field_samples,static_snaps,index_rebuilds}` are
   live (continent verified: 6/6 visible levels, ~100k startup field samples).
   Acceptance-battery assertions remain open.

Bonus fix (W1 adjacent): river cobbles / driftwood bank acceptance was structurally
impossible (dry cells carry zero flow; `deposition` is always 1 on dry banks). The
dressing environment now probes a 4 m neighbourhood for `bankFlow` on dry near-shore
samples, and the cobble bed check treats a fast adjacent river as a scoured bank.
Unit-tested; live counts stay near zero until W3 density tuning because the per-cell
acceptance roll (~0.3%) dominates.

## Phase W1 — Rivers That Read as Rivers (P0/P1) — IMPLEMENTED 2026-07-18

Continent (graph) rivers already carve; streamed/traced rivers do not.

1. ~~Route traced channels through the carve path~~ **DONE**:
   `carveInfiniteHydrologyHeight` / `createTracedHydrologyCarver` in
   `infinite_hydrology.ts` carve river channels (edge-faded, bed pinned under the
   bank-clamped level in the wet core) and lake/pond beds (spill level −
   `lakeBedDepthM`), tracing always against the *base* field (no feedback). Wired into
   every terrain authority: CLOD worker override + stream roots + worker heightfield
   tiles (`clod_worker.ts`), main-thread tile fallback sampler
   (`heightfield_tile_client_runtime.ts`), startup raster (carve baked, carved
   fallback), and the water side itself (samples report the carved bed as `terrainY`;
   tile build worker applies the same carve). Config = the existing
   `rivers.carveDepthM/carvePower/visibleDepthM` knobs; `terrainSource.hydrologyCarve`
   is now set on unified traced worlds, so caches rebuild. Lake basin resolution is
   memoized per sampler (was re-descended per sample).
2. ~~Continuity gate~~ **DONE**: `measureTracedRiverContinuity` +
   `river_continuity_pct` / `river_continuity_channels` in startup timings (probe
   depth floor 1.5 m > the 1.25 m level offset so an uncarved bed cannot pass).
   Live on infinite-islands seed 1 world 8: **100% over 15 channels**, 28/28 wet
   downstream+upstream walk, cross-channel transect bank 39.3 m → bed 21.3 m.
   Runner: `npx tsx tools/verify-traced-carve.ts --url "...scene=infinite-islands..."`
   (artifacts in `qa-runs/traced-carve-verify/`).
3. Re-check `dressing_river_cobbles_accepted=0` once beds exist (acceptance gates
   probably reject on depth/slope today) — still open, W3 density tuning.

## Phase W2 — GPU-Driven Surface (perf + "all GPU") — IMPLEMENTED 2026-07-18

Status: items 1–2 landed with a water-owned atlas window (7 tiles = 1792 m, sized from
the ring spans with tile-snap margin) instead of reusing the vegetation window — one
writer per atlas, no recenter flip-flop, no init-order coupling. Layout B
(flow x/z, strength, bodyKind) added to `HydrologyStreamingAtlas`; rings L0–L3 fetch
Layout A+B in the vertex stage (`water_node_atlas_grid.ts`) with validity-weighted
4-tap bilinear, vertex-stage drop estimation, and the `shapeRiverSurfaceY` river
shaping reproduced in TSL. A snap on those levels is one origin uniform; startup
`water_clipmap_field_samples` dropped from ~100k to 33,282 (exactly the two coarse
rings). L4/L5 keep the CPU texel path for now (item 3 still open). WebGL untouched
(item 4). Kill switch: `waterAtlasClipmap=0`. Perf budgets (item 5): see
`perf-runs/water-atlas-after/`.

Keep the CPU hydrology authority for gameplay queries (no readbacks needed because the
CPU is the producer); move per-frame surface data production to the GPU:

1. Extend the streaming atlas with Layout B (flow x/z, flow strength, bodyKind) as a
   second texture behind the same window/update.
2. Water rings L0–L3 (TSL materials) fetch waterY/bed/wet/flow directly from the atlas
   in the vertex stage (manual 4-tap bilinear via `textureLoad`, wet-mask-aware
   interpolation) instead of per-level CPU texel stores. A snap then costs two origin
   uniforms — no CPU sampling at all. This removes the 15 ms refill spikes and the 4 m
   staircase edges in one move.
3. Rings L4/L5 become far/ocean-only: deep-ocean surface + far-summary water own
   beyond-atlas distance (they already exist); drop their per-vertex hydrology
   sampling.
4. WebGL keeps the legacy CPU path unchanged (same debug contract, degraded quality).
5. Budgets (perf:move A/B, moving window): `waterMs` p95 ≤ 0.3 ms, max ≤ 2 ms; frame
   p95 delta water-on vs water-off ≤ 1 ms; no fpsP5 regression > 3.

## Phase W3 — Fable5-Level Shading (P1/P2)

Target set from the demo: SSR with terrain-aware fallback, analytic caustics, obstacle
and shore foam, wet margins, flow-aligned animation.

1. Promote the HQ TSL material to the WebGPU default with a quality tier switch
   (perf material stays as the low tier; `waterHq` becomes `waterQuality=low|high`).
2. Enable SSR via the existing `waterReflectionPolicy` (ssr optional today, fake-sky
   fallback default) — misses fall back to the current fake reflection.
3. Enable/finish analytic caustics (config exists, disabled) gated on quality tier.
4. Wire `riverTerrainWetnessMask` into the terrain material near water (wet margins).
5. Replace the `wallDiscard` shoreline tears with a depth-based alpha fade once beds
   are carved (no more vertical wet walls to hide).
6. Flow animation: advect ripple/foam phase along atlas Layout B flow vectors so rivers
   visibly move downstream; cascade particle overlay stays as the whitewater accent.
7. Every step lands with a `water:shot` battery scene + stats JSON (existing harness).

## Phase W4 — Acceptance Integration

1. Add a water gate to the infinite-islands and continent walk acceptances: aerial
   channel shot, close river shot, lake shot, shore shot; counters asserted:
   `webgpu_uncaptured_errors == 0`, `river_continuity_pct ≥ 95`, water clipmap visible
   levels > 0 near wet terrain, `waterMs` budget, wet-margin mask built.
2. Keep `perf:move` water A/B as the standing perf evidence (documented commands in
   CLAUDE.md pattern).

## Non-Goals

- No physics/buoyancy; water stays a visual/runtime layer (rule G1/G2 unchanged).
- No GPU→CPU readbacks anywhere in the water path.
- No change to CLOD page source meshes, borders, LOD selection, or colliders from the
  water layer itself (carve goes through the terrain authority, as with graph carve).
