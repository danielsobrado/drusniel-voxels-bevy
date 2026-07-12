# Hydrology Authority (clod-poc)

Status of the internal-water hydrology data model for `scene=infinite-islands`. This
covers the CPU-side canonical field only; the GPU atlas, clipmap topology and visual
upgrades are tracked as later phases below.

## Canonical sample

`HydrologySample` (`src/water/hydrologyGrid.ts`) is the single result shape every consumer
reads. Fields:

| Field | Meaning | Units |
| --- | --- | --- |
| `terrainY` | Carved bed height at the world position | metres |
| `waterY` | Water surface height | metres |
| `depth` | `max(0, waterY - terrainY)`; `0` when dry | metres |
| `bodyMask` | Water coverage weight `[0,1]` | – |
| `flowX`,`flowZ` | Flow direction (scaled by strength) | – |
| `flowStrength` | Flow speed | – |
| `bodyKind` | dry/ocean/lake/river/pond/marsh enum | – |
| `bodyId` | Connected-component id (`0` = dry), constant across a body | – |
| `shoreDistance` | Distance to the nearest wet↔dry boundary | metres |

### Invariants (`src/water/hydrologyInvariants.ts`)

Enforced by construction and checked by `npm run water:hydrology` / `water:streaming`:

- **Lake flatness** — every still-water body (lake/pond/marsh) has a single constant
  surface (`flattenStillBodies`). Deviation ≈ 0.
- **River monotonicity, bed-aware** — a river surface is non-increasing downstream *except
  where the carved bed itself rises*, and never drops below the bed
  (`enforceRiverDownstreamMonotonic`, `waterY = max(carvedBed, min(waterY, upstreamWaterY))`).
- **Depth ≥ 0** — no wet cell sits below its carved bed.
- **Identity** — every wet cell has a non-zero `bodyId`; smoothing only averages within a
  single body, so a lake surface is never blended with a river/ocean/disjoint pond.
- **No phantom water** — dry cells never carry a water surface above the bed.

### Body identity (`src/water/bodyIdentity.ts`)

`computeBodyIds` flood-fills the *final* wet mask into connected components. Connectivity is
gated by hydrological class (flowing river vs still lake/pond/marsh vs ocean) so a river
feeding a lake keeps a distinct id from the lake. `computeShoreDistance` is a chamfer
distance transform giving per-cell metres-to-shore.

## Canonical GPU packing (Phase 4)

`src/water/hydrologyGpuPacking.ts` is the only definition of the hydrology→GPU texel
layout; `HydrologySystem.waterSurfaceTexture()`, `hydrologyFieldsTexture()` and the
understory ring upload (`src/systems/hydrology_packing.ts`) all build from it.

| Layout | R | G | B | A |
| --- | --- | --- | --- | --- |
| A "water surface" | waterY (m) | wetMask (0/1) | carvedBedY (m) | shoreDistance (m) |
| B "render fields" | flowX·speed | flowZ·speed | moisture [0,1] | bodyKind/255 |

Both are RGBA32F, res×res over the startup world, nearest-filtered (manual bilinear in
shader helpers), texel (ix,iz) ↔ world (ix/(res−1)·worldCells, iz/(res−1)·worldCells).
The former duplicated `waterY` in A.a and the unread `flowStrength/riverDepth` channels in
B are gone; flow *direction* and shore distance are now on the GPU. CPU↔GPU parity is
tested in `hydrologyGpuPacking.test.ts` (texels equal `sampleHydrologyGrid` at
texel-aligned coordinates). Clamp-to-edge applies only inside the startup world — the
streaming atlas (Phase 4b, below) covers vegetation placement beyond it.

### Streaming vegetation atlas (Phase 4b)

Outside `[0, worldCells]` the vegetation placement computes (grass/understory/stone/tree
rings) no longer clamp the startup texture: they sample a second, camera-following
Layout A texture — the streaming hydrology atlas.

- `src/water/hydrologyAtlas.ts` — `HydrologyStreamingAtlas`: a tile-aligned window of
  `atlas_tiles_per_side²` hydrology tiles (config `hydrology.infinite.atlas_tiles_per_side`,
  default 6 ⇒ 385×385 texels at 4 m, ±512 m worst-case coverage). Texels are copied
  verbatim from `HydrologyTile` vertex arrays, so the atlas is bit-identical to the CPU
  tile authority wherever it has data (`hydrologyAtlas.test.ts`). Texels without a
  resident tile carry `shoreDistance = −1` ("no data").
- `src/gpu/hydrology_atlas_gpu.ts` — one shared rgba32float texture, initialized in
  `runVegetationStartup` before any ring compute binds it, refreshed once per frame from
  the vegetation frame phase (prefetch → CPU refill → dirty-rect `writeTexture`). Tiles
  arrive through the existing build worker; while a tile is missing, GPU samples touching
  its texels report invalid and the shader keeps plain-terrain (hydro-disabled) semantics
  for that sample, self-correcting when the upload lands.
- `placement_height.wgsl` routes `placement_sample_hydro_bilinear` to the atlas only for
  outside-world coordinates; inside-world sampling is unchanged (bit-identical), and with
  the atlas off (finite worlds, `atlas_tiles_per_side: 0`) the legacy clamp behaviour
  remains as fallback. Stone/tree keep their nearest-filter inside-world paths and use
  the atlas outside only.
- Runtime counters: `hydrology_atlas_active/filled_tiles/total_tiles/recenters/uploads`
  (30-frame mirror cadence); browser gate: `npx tsx tools/probe-hydrology-atlas.ts`.

Not covered by the atlas (still clamp): the TSL vegetation node materials
(grass/stone tint via `sampleHydrologyBilinearTsl`) and the Layout B consumers
(froxel moisture) — visual-only, documented approximation. GPU sampling also does not
replicate the CPU boundary blend band: at the world edge the shader switches from pure
grid to pure tile data (the raw seam the blend band masks on the CPU side); vegetation
placement tolerates this until Phase 3b unifies the generators.

## Infinite-world tiles + boundary blend (Phase 3)

Outside the startup world the authority is `HydrologyTileCache`
(`src/water/hydrologyTileSource.ts`): a deterministic LRU tile cache over the world-space
procedural field. A tile is a pure function of `(tileX, tileZ, sampler, config)` —
rebuilding an evicted tile reproduces bit-identical data (verified by `water:streaming`
`evictionMaxDelta === 0`), and neighbour tiles agree exactly on shared edges because both
sample the same world coordinates. Config: `hydrology.infinite` in `config/water.yaml`
(`tile_size_m`, `tile_res`, `max_resident_tiles`, `boundary_blend_m`). Stats
(builds/hits/misses/evictions/build-ms) are exposed via
`HydrologySystem.tileCacheStats()`.

At the startup-world edge, `HydrologySystem.sample` blends the finite grid into the
infinite field across `boundary_blend_m` (smoothstep; pure infinite at the edge, matching
the outside limit exactly, pure grid deep inside). The *effective* authority every
consumer reads is therefore continuous across the boundary: `npm run water:seam` reports
`effectiveContinuity.maxWaterYStep ≈ 0.42 m` per 1 m step (no hard wall); the residual
`seam.*` fields still record the raw algorithm disagreement between grid and infinite —
that number only goes to ~0 when both sides share one generation algorithm (see deferred
work).

Physical validity of the infinite field itself: water can no longer float above terrain —
lakes/rivers are wet only where the basin/channel surface sits above local terrain. The
old `Math.max(terrainY + ε, …)` hill-climb is removed.

### Terrain-traced drainage (Phase 3b, infinite side)

Rivers in the infinite field are no longer hashed straight lines: each spawned basin
seeds one channel that is traced downhill along the terrain gradient with inertia
(`traceChannel` in `src/water/infinite_hydrology.ts`). The polyline is a pure function of
(basin coords, terrain sampler) — memoized per sampler in a bounded map, retraced
bit-identically after eviction — so tiles and direct samples agree exactly. The channel
carries a non-increasing downstream water profile (bank-clamped per vertex so cross-slope
water cannot overhang the low bank), width grows downstream as an accumulation proxy,
flow vectors come from the traced segment directions, and the whole channel shares one
`bodyId`. Where independent channels overlap, the deeper one owns the sample. Lakes
validate real depressions (deterministic descent to the local low + 8-point rim check;
level capped under the lowest rim; invalid basins are rejected, not forced).

Cold tile builds cost ~33 ms (64-res tile, reference sampler) including first-touch
channel traces; traces amortize across neighbouring tiles via the memo.

Tile builds are synchronous on first touch (~14 ms for a 64-res tile with the reference
terrain sampler). Movement into new regions pays one build per new tile; steady-state
sampling is cache hits. If browser profiling shows hitches at tile boundaries, add
neighbour prefetch/async builds (deferred).

## Toroidal water clipmap (Phase 5) + static topology (Phase 5b)

`WaterClipmap` (`src/water/waterClipmap.ts`) stores ring vertices toroidally: world column
`c` / row `r` lives at slot `(c mod verts, r mod verts)`, so an origin snap resamples only
the newly exposed columns/rows — the per-vertex `WaterField` sample is the dominant CPU
cost and is bounded by movement, not ring area (a one-snap eastward move samples
1 column instead of the full grid; verified bit-equal to a freshly built clipmap in
`waterClipmapToroidal.test.ts`). Cumulative counters (`WaterClipmap.updateCostStats`)
are exposed through `collectWaterClipmapRuntimeStats`.

Since Phase 5b the toroidal samples land in one of two per-level backends:

- **Static topology** (default, `water.static_topology`; `waterStaticClipmap=0` opts
  out) — used when the material consumes `params.staticGrid`, which both TSL WebGPU
  materials do. Samples go into two toroidal RGBA32F texel textures per level
  (`waterClipmapTexels.ts`: A = waterY/terrainY/bodyMask/bodyKind, B = flow); the grid
  geometry (positions = grid indices, full index buffer) is built once and never
  changes. A snap costs the dirty-row/column field samples, one texture upload, and two
  origin uniforms — **no index rebuild, no vertex-buffer re-upload**. The shared vertex
  stage (`water_node_static_grid.ts`) reconstructs world position and the legacy
  attribute values via `textureLoad`. Gold parity with the legacy path is tested in
  `waterClipmapStatic.test.ts` (moved texels bit-equal a fresh build and direct field
  samples), and static-vs-legacy browser shots at the spawn river are pixel-equivalent
  (lit + clipmapLevel tint).
- **Legacy buffers** (WebGL shader material): CPU vertex attributes; the index buffer is
  rebuilt per snap because slot connectivity crosses the wrap seam.

Quad emission on the legacy path is conservative (`waterQuadRenderable`): a quad renders
when ANY corner is wet; dry corners carry a below-terrain sentinel and every water
material discards `depth <= 0` fragments, so the interpolated surface clips against
terrain at the true waterline. This keeps thin rivers visible at coarse rings (the old
corner-AND rule eroded them) without shoreline artifacts. The static path renders every
quad and resolves dryness per fragment with the same sentinel + discard; the legacy
index-time height-discontinuity guard (skip quads whose wet corners span >0.45 m, 1.25 m
flowing) is replaced by an equivalent fragment-side slope discard
(`wallDiscard` in `water_node_static_grid.ts`), gated on `depth > 0.5 m` so shoreline
sentinel ramps stay intact.

## Ownership oracle (Phase 6)

`npm run water:ownership <worldCells>` runs a per-sample oracle in addition to the legacy
renderer-count summary: it wires a `WaterField` exactly like the runtime water controller
(shore-surf band + deep-ocean clipmap-exclusion band from `border_coast_ocean.yaml`) and
walks a world-space grid asserting every hydrology-wet sample has exactly one renderer
owner — clipmap outside the exclusion band, deep ocean inside it, with the shore-surf band
as the only intentional weighted overlap. Exit 1 on zero-owner (dry gap) or double-owner
(double render) samples.

## Body-driven visuals (Phase 7, first pass)

`WaterFieldResult.bodyKind` (HYDROLOGY_BODY_*) flows into the clipmap as the `aBodyKind`
vertex attribute. All three water materials (WebGPU perf, WebGPU hq, WebGL) share a
Beer–Lambert depth response (`1 - exp(-depth/depthScale)`) so water colour no longer
saturates to the deep tone within one depth-scale and does not depend on the material
path. The perf material additionally treats ponds/marshes (kind ≥ 4) as murkier standing
water: green sediment tint, extra turbidity, damped sky reflection. Rapid foam remains
flow-gated (calm lakes never show it). Full per-kind config presets (spec §M) are
deferred — current variation uses documented in-shader constants on top of the existing
`visual.*` config.

## Validation

```
npm run water:hydrology 2048   # invariants + body/flatness/monotonic report
npm run water:seam 1024        # raw seam magnitude + effective-authority continuity
npm run water:streaming 1024   # rebuild + tile-eviction determinism + invariants
npm run water:ownership 1024   # per-sample exactly-one-owner oracle
npm test -- src/water          # unit tests
```

## Deferred (later phases)

- **Phase 3b remainder** — the infinite side is now terrain-driven (traced drainage,
  above), but the startup world still uses the finite grid pipeline, so the raw `seam.*`
  disagreement at the boundary persists (masked by the blend band). Removing it means the
  startup world also generates through the traced/tile authority — which changes the
  inside-world terrain carve and therefore cascades into worker terrain parity and page
  caches. Also: async tile builds + neighbour prefetch if browser profiling shows
  boundary hitches (~33 ms cold builds).
- **Phase 4b remainder** — the placement-compute atlas is done (above); still clamping:
  TSL vegetation node materials (`sampleHydrologyBilinearTsl` tint) and Layout B
  consumers (froxel moisture). Terrain compute needs nothing: outside-world terrain is
  intentionally uncarved (the infinite field's `terrainY` *is* the base surface).
- **Phase 5b remainder** — static topology is done for the TSL WebGPU materials (above),
  but the per-vertex CPU field sampling on snaps intentionally remains (it is the
  authority — the Phase 4b atlas covers neither the effective inside-world blend nor
  flow/bodyKind, so the vertex stage samples per-level texel textures filled by the same
  CPU sampler instead). The WebGL shader material still uses the legacy index-rebuild
  path; texture uploads on snap are full-texture (partial writeTexture is a possible
  follow-up if profiling shows it matters).
- **Phase 7b** — config-driven per-body visual presets (shallow/deep/absorption/
  roughness per kind in `water.yaml`), shore-distance-driven foam and terrain wetness
  (the shoreDistance channel is already packed on the GPU), and RGB absorption instead of
  the scalar depth-scale.
