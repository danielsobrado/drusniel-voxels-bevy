# Continent Phase 3 — Continental Hydrology and the Authority Switch

Parent: `continent-plan-overview-2026-07-12.md`. Requires Phases 1–2.

## Status

Updated 2026-07-13.

- [x] C3.1 pure macro field and hydrology graph builder.
  - Deterministic priority-flood, D8 drainage, exact flow accumulation, lake extraction,
    connected headwater-to-terminal river records, stable world/cell IDs and monotone discharge
    profiles live under `src/world/hydrology_graph/`.
  - Synthetic bowl/plane/saddle, bit-determinism and reduced 4 km real-field tests pass.
  - `npm run water:graph -- 32768 19`: 2049×2049 / 4,198,401 cells in 12,067.17 ms,
    13,979 rivers, 30,155 lakes, zero unresolved terminals (within the 20 s cold-build budget).
- [x] C3.2 worker hosting, checkpointing, persistence and manifest artifact.
  - Dedicated worker samples the 16 m macro field in resumable 32-row bands, publishes progress,
    extracts/compacts the graph, hashes it, and transfers only canonical runtime fields.
  - IndexedDB is namespaced by terrain-source + graph-params hashes; the manifest is immutably
    updated with the graph artifact. `?scene=continent&continentHydrology=1` is default-off.
  - Native-Windows browser cold/warm evidence:
    `perf-runs/continent-phase3-c32/startup-cold-warm-json-store.json`. Cold graph build/load/save
    10,554.10 ms; warm store load 183.50 ms; artifact
    `cfe5407017c7e4e2e4958113b2f3e5e1730a8152e5903afcee44c146c4763ae1`.
  - Flag-on shot/stats smoke:
    `shots/continent/phase3-c32-cold.png`, `shots/continent/phase3-c32-cold-stats.json`.
- [x] C3.3 graph-backed hydrology sampling and validator parity.
  - Spatially bucketed river segments + macro lake index implement the existing
    `HydrologySample` contract. The unchanged tile cache accepts a pluggable world sampler while
    graph mode rejects the traced worker backend to prevent mixed authority.
  - `water:graph-semantics`: 326 rivers / 812 lakes on the reduced real field; zero broken
    terminals, width regressions, or invalid outlets; hydrology invariants PASS.
  - Existing `water:hydrology`, `water:streaming`, `water:seam`, and `water:ownership` all pass;
    streaming remains deterministic with zero field/probe/eviction deltas and ownership reports
    zero missing/double owners.
  - Native-Windows graph shot/stats:
    `shots/continent/phase3-c33-graph.png`, `shots/continent/phase3-c33-graph-stats.json`;
    graph startup-grid rasterization 120.90 ms, hydrology atlas active with 13 uploads.
- [ ] C3.4 carved canonical tiles and CPU authority switch.
  - Implementation in progress: graph/carve payload reaches the CLOD worker; authoritative tiles
    are f32; the startup raster is rebuilt from the identical f32 carve; continent tiles default
    on only when the manifest carries a hydrology graph; fractional CPU samples bilerp resident
    tiles; `TERRAIN_SOURCE_VERSION` is `world-modes-v7` and hashes graph + carve inputs.
  - Focused tile/raster/CPU authority tests pass. `water:tile-carve-perf` measures base tile p95
    131.58 ms, carved p95 140.34 ms, carve overhead p95 8.76 ms (≤ 15 ms budget).
  - Remaining gate: repeat native-Windows startup/movement evidence. The first long capture reached
    ready but the shared WebGPU device then exhausted memory allocating pre-existing tree-impostor
    textures; no successful C3.4 stats artifact is claimed from that run.
- [ ] C3.5 GPU tile-atlas streamed-root authority.
- [ ] C3.6 water/vegetation consumer integration.
- [ ] C3.7 acceptance, soak and default flip.

Next action: implement C3.3 graph-backed `HydrologySample` and the tile-cache backend switch, then
run the hydrology/streaming/seam/ownership and graph-semantics validators.

## Goal

Replace per-basin local river/lake decisions with a **global watershed graph computed once per
world**, carve that graph into the canonical heightfield tiles, and switch runtime terrain
authority (CPU **and** GPU) to the carved tiles. Water rendering, terrain carving, flow, wetness
and vegetation exclusion all derive from the same graph records.

This is the phase where `generated tiles become the authority`. Everything before it is
preparation; everything after it consumes tiles.

## Non-goals

Erosion beyond drainage carving (thermal/hydraulic erosion of the macro field is a future
generator upgrade — the manifest/versioning built here is what makes that upgrade safe later).
No far-summary unification (Phase 4). No cave/voxel work (Phase 5).

## Current code this replaces or extends (verified 2026-07-12)

| Concern | Today | Anchor |
| --- | --- | --- |
| Infinite rivers | per-768 m-basin channels traced downhill with inertia, memoized polylines, deterministic; no accumulation between basins | `src/water/infinite_hydrology.ts:19-35` |
| Lakes | per-basin depression validation (descent to local low + 8-point rim check) | `src/water/infinite_hydrology.ts:104-135` |
| Startup grid | raster **view** of traced/tile authority; `carvedBed === originalBed` (uncarved) | `src/water/hydrologySystem.ts` (`buildUnifiedStartupGrid`), `docs/rendering/hydrology-authority.md` |
| Sample contract | `HydrologySample` (terrainY, waterY, depth, bodyMask, flow, bodyKind, bodyId, shoreDistance) + invariants | `src/water/hydrologyGrid.ts`, `hydrologyInvariants.ts` |
| Tile cache | deterministic `HydrologyTileCache`, 256 m / 64-res tiles, LRU 96 | `src/water/hydrologyTileSource.ts`, `config/water.yaml` |
| GPU consumers | Layout A/B packing, streaming atlas (6 tiles/side), toroidal water clipmap, body presets | `src/water/hydrologyGpuPacking.ts`, `hydrologyAtlas.ts`, `waterClipmap.ts` |
| Cache identity | `hydrologyTerrain` hash in terrain-source key (currently null in unified mode) | `src/cache/terrainSource.ts:98,150-160` |
| Legacy finite sim (reference algorithms) | priority-fill, particle accumulation, river carve params | `config/water.yaml water.hydrology.*`, `buildLegacyHydrologyGrid` |
| Validators | `water:hydrology`, `water:seam`, `water:streaming`, `water:ownership` | `package.json` scripts, `hydrology-authority.md` Validation |

Key insight: the **finite legacy sim already contains the algorithms** (depression fill, flow
accumulation, carve profiles) — Phase 3 re-hosts them at continent scale on the 16 m macro grid
instead of the 256-res startup grid, then rasterizes results per tile, rather than inventing new
hydrology math.

## Design

### Stage A — global graph (one-time, worker, persisted)

```text
macro sample pass (16 m grid over manifest.sizeM; 2049² for 32 km)
  → priority-flood depression fill                (fill levels, lake basins)
  → flow directions (D8 + existing inertia bias)  (deterministic tie-breaking)
  → flow accumulation                             (discharge proxy)
  → channel extraction (accumulation threshold)   (river polylines, width/discharge per vertex)
  → lake bodies (fill level, rim/spill, outlet)   (stable ids)
  → downstream water profile (non-increasing; bed profile from carve params)
  → HydrologyGraph { rivers[], lakes[], version, hash }
```

- Stable IDs: `riverId = hash(worldId, sourceCellX, sourceCellZ)`, `lakeId = hash(worldId,
  spillCellX, spillCellZ)` — survives regeneration under the same manifest.
- Persisted as an artifact (IndexedDB + downloadable JSON/binary for QA), referenced from
  `WorldManifest.artifacts.hydrologyGraph = { id, hash }`.
- Runs in a dedicated worker with chunk checkpointing (row bands), progress counters, and a
  hard "never on the frame path" rule; for the startup world it runs during world build (before
  first render) — budget below.

### Stage B — graph-backed sampling and carving

- `sampleGraphHydrology(x, z)` implements the existing `HydrologySample` contract from graph
  records (nearest channel segment / containing lake), preserving every invariant
  (`hydrologyInvariants.ts` suite runs unchanged against it).
- `HydrologyTileCache` gets a second backend: `graph` (new) vs `traced` (current), selected by
  `water.yaml hydrology.infinite.source: traced | graph`. Tile keys/res/LRU unchanged, so the
  GPU atlas, packing and clipmap need **no changes**.
- Heightfield tile builder (Phase 2) gains a carve stage: `carveTileWithGraph(tile, graph)` —
  channel cross-section (existing `carve_depth_m`/`carve_power` params), lake beds, bank
  clamping (reuse the bank-clamp semantics from traced channels). Carve happens at tile build
  time; carved tiles are the canonical surface.

### Stage C — authority switch

Order matters; each step is a separate commit with parity evidence:

1. CPU consumers sample carved tiles (meshing, props, colliders) — `heightTiles` flag flips to
   default-on for continent mode, raster is rebuilt **from tiles** for the spawn area (or
   retired if numbers allow).
2. GPU streamed-root mesher samples an uploaded **R32F tile atlas** instead of evaluating
   procedural WGSL, in continent mode only. Pages are only scheduled when their tiles are
   resident (the streamed-root scheduler already has pending/ready machinery — reuse it, no new
   states). Non-continent scenes keep procedural WGSL (perf scenes stay valid).
3. Water renders from the same graph-backed tiles (no change needed beyond the backend switch —
   this is the payoff of keeping `HydrologySample` stable).

`TERRAIN_SOURCE_VERSION` bumps to `world-modes-v7` when carving lands (geometry changes), and
the terrain-source hash gains `hydrologyGraph.hash` + tile-carve params. The existing key
machinery already invalidates cached pages on such changes (`terrainSource.ts` v4 precedent).

## Commit sequence

### C3.1 — Macro field + graph builder (pure, offline-testable)

- `src/world/hydrology_graph/` : macro grid sampler (16 m over bounds), priority-flood, D8+
  inertia flow, accumulation, channel/lake extraction, profile assignment. Pure functions on
  typed arrays; no workers yet.
- Tests: small synthetic fields (bowl → one lake; tilted plane → parallel channels; saddle →
  two watersheds) with exact expectations; determinism (two runs bit-equal); a reduced 4 km
  real-field run asserting channels are connected, monotonic, and every lake has an outlet or
  is terminal.
- Node harness: `npm run water:graph -- <sizeM>` (new script following `water:hydrology`
  conventions) printing counts, longest river, basin stats, build ms.

### C3.2 — Worker hosting + persistence + manifest artifact

- Dedicated `hydrology_graph_worker.ts` with band checkpointing + progress counters
  (`hydrology_graph_build_pct`); IndexedDB artifact store keyed by
  `(terrainSourceHash, graphParamsHash)`; `WorldManifest.artifacts.hydrologyGraph` filled.
- Startup integration behind `?continentHydrology=1`: load-or-build during world build (blocking
  boot like hydrology does today, with counter `startup.hydrology_graph_ms`), warm path is a
  store read.
- Tests: worker protocol round-trip; checkpoint resume; artifact hash stability.

### C3.3 — Graph-backed `HydrologySample` + validator parity

- `sampleGraphHydrology` + `HydrologyTileCache` backend switch
  (`hydrology.infinite.source: graph`).
- All four validators must pass on the graph backend: `water:hydrology` (invariants),
  `water:streaming` (determinism + eviction), `water:seam` (unified continuity), plus a new
  `water:graph-semantics` check: every river reaches a lake/ocean/terminal lake (no
  starts-nowhere), width monotone along discharge, neighboring lakes' levels consistent with
  the spill graph — the semantic properties per-basin tracing cannot give.
- Visual QA: shot battery at 2–3 river/lake poses, traced vs graph, documented differences.

### C3.4 — Carve into canonical tiles + CPU authority switch

- `carveTileWithGraph` in the Phase 2 tile builder; `TERRAIN_SOURCE_VERSION → world-modes-v7`;
  hash gains graph artifact hash + carve params; `heightTiles` defaults on for continent mode.
- The spawn raster: rebuild `startup_heightfield_raster` content from carved tiles (same
  budget/descriptor machinery) so startup meshing sees carved terrain without waiting on the
  tile ring. `hydrologyTerrain` stays null (the carve lives in tiles now — one authority).
- Storage decision executes here: carved tiles move to f32 + documented quantization (they are
  now the definition of truth; nothing needs f64 parity anymore). Halves Phase 2 memory.
- Tests: carved-tile determinism; CPU mesh through tiles == CPU mesh through a directly-carved
  reference sampler; collider/prop heights match carved surface at rivers.
- **This commit must include Evidence**: startup cold/warm build ms, movement route perf.

### C3.5 — GPU streamed roots sample tile atlas

- New WGSL path: R32F atlas (toroidal, tile-granular uploads via the Phase 2 cache; reuse the
  hydrology-atlas GPU upload pattern `src/gpu/hydrology_atlas_gpu.ts`), exact `textureLoad`
  lattice fetches for density corners — same integer-lattice-only policy as the CPU raster
  (world-modes-v6 lesson: no filtered reads for geometry).
- Streamed-root scheduling: a page is buildable only when its 1–4 covering tiles are resident;
  wire as a predicate into the existing planner (pending stays pending, counters
  `live_clod_stream_waiting_on_tiles`).
- Parity: extend `startup_heightfield_gpu_parity.test.ts` pattern — CPU carved sampler vs
  GPU-shaped TS field-core-with-atlas at and across tile borders, multiple seeds.
- Fallback: if WebGPU atlas upload fails → `failLoud()` in gated scenes (existing policy);
  non-continent scenes untouched.
- **Longest-risk commit; keep it flag-gated (`gpuTileMesh=1`) until the perf evidence below is
  recorded, then default-on for continent mode in a follow-up one-liner.**

### C3.6 — Water/vegetation consumers + seam retirement

- Water clipmap, hydrology GPU atlas, moisture, wetness mask, vegetation water-reject now see
  carved `terrainY` == rendered terrain (depth/shoreline correctness at carved banks). Run
  `water:ownership` + shore-foam/wetness shot QA.
- Remove the traced-channel backend? **No** — keep `source: traced` for A/B and small demo
  scenes for one release; mark deprecated in `water.yaml` comments.

### C3.7 — Acceptance + soak + default flip

- Acceptance: new gates — `hydrology_graph_present === 1`,
  `live_clod_stream_waiting_on_tiles` bounded, `frame_ms_p95 <= 8` unchanged, fallback counters
  zero. Walk route must cross a carved river (update route config; the movement-probe
  infrastructure already exists).
- Flip `continentHydrology` + `gpuTileMesh` defaults for the continent scene; record Evidence.

## Performance budget and measurement

- **Global graph build**: budget ≤ 20 s cold in-worker for 2049² (fill+accumulation are
  O(n log n)/O(n)); warm = store read ≤ 200 ms. It is a world-creation cost, surfaced with a
  progress UI counter; it must not run for existing non-continent scenes.
- **Tile carve**: ≤ 15 ms per tile added to Phase 2 build cost (polyline rasterization over
  ≤ 66 K samples with segment bucketing); gate via `heightfield_tiles_build_ms_p95`.
- **GPU atlas**: uploads are tile-granular (≤ 264 KB f32 per tile), ≤ 1 tile upload per frame
  budget; gate `frameMs p95` and `renderMs p95` in perf:main current-textured world=8 and a
  movement route — before/after within noise.
- **Startup**: cold `startup.build_world_ms` at world=8 must stay ≤ 110% of the pre-phase
  baseline *excluding* the one-time graph build (reported separately); warm within noise.
- Use `--warmup 600` for any run where the new WGSL path compiles (async pipeline pollution).

## Risks

- *Graph scale on low-end machines* → band checkpointing + resumable builds; artifact download
  path for QA; if 16 m proves too slow, drop to 24 m (param, hash-keyed) rather than shrinking
  the continent.
- *Carve vs collider/prop drift* → single carve implementation used by tile builder only;
  everything samples tiles (that is the point); parity tests in C3.4 are the tripwire.
- *GPU atlas residency misses at high speed* → pages wait on tiles (never mesh from stale
  procedural in continent mode — visible divergence); prefetch radius sized by max fly speed;
  counter-gated.
- *Cache invalidation storm on flip* → expected and correct (v7 bump); document that first boot
  after upgrade is cold.

## Evidence (fill before merging final commit)

- [ ] graph build ms (cold/warm), macro grid stats, artifact hash
- [ ] validator suite results (hydrology/streaming/seam/ownership/graph-semantics)
- [ ] carved tile build ms p95; startup cold/warm build ms vs baseline
- [ ] GPU parity test run; perf:main + movement route before/after (frameMs, renderMs, top bucket)
- [ ] acceptance --reuse full gate summary with route crossing a carved river
- [ ] river/lake shot paths + stats JSONs
