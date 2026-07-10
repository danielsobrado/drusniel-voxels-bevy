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
texel-aligned coordinates). Clamp-to-edge applies only inside the startup world — see
deferred Phase 4b for streaming coverage beyond it.

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
lakes/rivers are wet only where the basin/channel surface sits above local terrain, and
river flow is oriented downhill (`src/water/infinite_hydrology.ts`). The old
`Math.max(terrainY + ε, …)` hill-climb is removed.

Tile builds are synchronous on first touch (~14 ms for a 64-res tile with the reference
terrain sampler). Movement into new regions pays one build per new tile; steady-state
sampling is cache hits. If browser profiling shows hitches at tile boundaries, add
neighbour prefetch/async builds (deferred).

## Toroidal water clipmap (Phase 5)

`WaterClipmap` (`src/water/waterClipmap.ts`) stores ring vertices toroidally: world column
`c` / row `r` lives at slot `(c mod verts, r mod verts)`, so an origin snap resamples only
the newly exposed columns/rows — the per-vertex `WaterField` sample is the dominant CPU
cost and is now bounded by movement, not ring area (a one-snap eastward move samples
1 column instead of the full grid; verified bit-equal to a freshly built clipmap in
`waterClipmapToroidal.test.ts`). The index buffer is rebuilt per snap (slot connectivity
crosses the wrap seam) but takes no field samples. Cumulative counters
(`WaterClipmap.updateCostStats`: snaps, full vs partial refills, columns/rows sampled,
field samples, index rebuilds) are exposed through `collectWaterClipmapRuntimeStats`.

Quad emission is conservative (`waterQuadRenderable`): a quad renders when ANY corner is
wet; dry corners carry a below-terrain sentinel and every water material discards
`depth <= 0` fragments, so the interpolated surface clips against terrain at the true
waterline. This keeps thin rivers visible at coarse rings (the old corner-AND rule eroded
them) without shoreline artifacts.

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

- **Phase 3b** — one generation algorithm on both sides of the startup boundary
  (tile-based terrain-driven drainage everywhere) so the raw `seam.*` disagreement goes to
  ~0 and the blend band becomes unnecessary. Requires making depression fill / flow
  accumulation tile-local with halos, or a macro drainage field. Also: async tile builds +
  neighbour prefetch if browser profiling shows boundary hitches.
- **Phase 4b** — streaming GPU atlas beyond the startup world, uploaded from
  `HydrologyTile` arrays, so vegetation/terrain compute reads correct hydrology outside
  `[0, worldCells]` (today those consumers clamp to the finite-grid edge — a documented
  approximation, not a solution).
- **Phase 5b** — fully static topology (vertex shader samples a hydrology atlas; no index
  rebuild per snap) once the Phase 4b atlas exists.
- **Phase 7b** — config-driven per-body visual presets (shallow/deep/absorption/
  roughness per kind in `water.yaml`), shore-distance-driven foam and terrain wetness
  (the shoreDistance channel is already packed on the GPU), and RGB absorption instead of
  the scalar depth-scale.
