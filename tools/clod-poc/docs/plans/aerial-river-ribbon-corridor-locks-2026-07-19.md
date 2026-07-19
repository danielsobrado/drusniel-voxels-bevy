# Aerial River Ribbon: Corridor-Locked Simplification

Status: PROPOSED (design pass, not yet accepted)
Date: 2026-07-19
Owner: water/rivers workstream (follows W1–W1.6 in `water-rivers-gpu-fable5-parity-plan-2026-07-17.md`)

## Problem

Traced river channels (10–56 m wide, up to 7.5 m deep) are carved correctly in the
terrain authority, near CPU pages, and the imprinted far summary/shell — but from an
aerial camera the mid-band CLOD annulus still shows disconnected water pockets instead
of a continuous ribbon (`qa-runs/traced-carve-verify-cpu-roots/river-aerial.png`).

## Root cause (verified in code, corrects an earlier assumption)

Coarse LOD terrain is **not** built by sampling the field at coarse spacing. Both root
paths build the full LOD0 lattice and simplify bottom-up:

- CPU standalone roots: `buildStandaloneClodRootNode` (`src/clod/quadtree.ts:497`)
  builds every LOD0 page under the root, then `createParentNode` per level.
- GPU roots: `buildParentNode` (`src/terrain/streaming/gpu_clod_root_mesher_single.ts:1049`)
  merges + welds the four children, then simplifies.

Both call `simplifyPage(mesh, locks, cfg)` (`src/clod/simplify.ts:36`) =
meshoptimizer `simplifyWithAttributes` with **binary per-vertex locks**, currently set
to the page's outer border only (`buildOuterBorderLocks`, `src/lock.ts`). Locked
borders survive every level — which is why cross-LOD borders are crack-free by
construction (border geometry is level-invariant).

So the channel *is* present in every level's input geometry and is **collapsed by the
simplifier's error budget** (`target_ratio_per_level` + `target_error`). A 7.5 m trench
is within budget at deep levels, so it dies.

Consequences for the design space:

- A **level-scaled carve width floor** (the far-summary trick applied to meshes) is the
  wrong tool here: it would make the sampled field level-dependent, which fights the
  simplification-hierarchy invariant (children ARE the parent's input) and is unsound.
  Rejected.
- **Selection-side corridor refinement** (force finer LOD near channels) would work but
  costs streaming budget proportional to visible river area and touches the selection
  cut. Held as fallback.
- **Corridor-aware simplification locks** ride the exact mechanism that already keeps
  borders alive across levels. Chosen.

## Design: lock channel-corridor vertices during parent simplification

When a traced carve is active, extend the lock array passed to `simplifyPage`:

```
locks = buildOuterBorderLocks(welded)  OR  isNearTracedChannel(vertex.xz)
```

- `isNearTracedChannel(x, z, sampler, marginM)` — new pure export from
  `src/water/infinite_hydrology.ts`, implemented on the existing memoized channel
  hoods + per-channel AABBs (same machinery as `collectChannelHits`, distance test
  against `halfWidth + marginM`, no carve evaluation). Margin ~4 m so trench walls and
  the immediate bank crest are kept, giving the ribbon a silhouette.
- Locked vertices survive every simplification level, exactly like border vertices do
  today → the trench (and therefore the water ribbon above it) persists to root LODs.
- Field unchanged, borders unchanged → **no cracks, no seam work, no selection change,
  colliders and authority untouched.**

### Wiring (traced worlds only)

The worker already knows whether the world is traced (`tracedCarver` in
`src/clod_worker.ts`). Add a settable module hook (mirroring
`setTerrainSurfaceOverride`) e.g. `setParentSimplifyCorridorLocks(query | null)`,
consumed by both `createParentNode` (CPU) and `buildParentNode` (GPU mesher path — its
weld+simplify runs on the CPU side, so the same hook covers it). Install it beside the
terrain override in `clod_worker.ts` build/init; never installed for graph/continent
or non-hydrology worlds.

Note: GPU roots remain disabled on traced worlds (W1.6) because the GPU *chunk field*
is uncarved. Corridor locks are orthogonal — if/when the WGSL carve lands, the same
locks apply unchanged.

### Cache identity

Parent/root geometry changes on traced worlds → bump `TERRAIN_SOURCE_VERSION` to
`world-modes-v11-corridor-locks` (`src/cache/terrainSource.ts`). Expect one slow cold
boot per client (same as v10; first boot after bust can exceed the water-harness 180 s
wait — rerun warm).

### Cost model and the level-cap question

Locking retains LOD0 vertex density inside corridors at every level. Bounding math:
corridor ≈ (2·halfWidth + 2·margin) ≤ ~70 m wide; channels ≤ ~1.8 km per spawning
basin (768 m grid, ~15% spawn after validity). Corridor area is a low single-digit
percent of world area, but retained triangles at an L5 root are LOD0-density there —
the terrain-tris counter in acceptance and `perf:main` triangles must arbitrate.

If retention is too hot, mitigations in order of preference:
1. **Level cap**: apply corridor locks only for parent levels ≤ K (start K = 4). Above
   K the channel may collapse — acceptable if the far shell/clipmap (which carries the
   imprinted carve) owns those distances in practice (`farClipmapInnerRadius` 384 m in
   acceptance; measure which levels are actually visible in the aerial band first).
2. **Corridor decimation**: lock only vertices within the wet core
   (`distance ≤ 0.7·halfWidth`), letting banks simplify.

Do not pre-implement either; measure first (Simplicity First).

## Phases

- **P1 — corridor query**: `isNearTracedChannel` export + vitest (purity across memo
  eviction, inside/outside/margin cases, AABB fast-reject). Verify: unit tests.
- **P2 — lock wiring**: hook + worker install + both parent builders + v11 bump.
  Unit test: synthetic hilly sampler, build a standalone root at L3–L4 over a known
  channel, assert ≥N% of channel-polyline points have interpolated mesh bed ≤
  `level − 1.5 m` (the same invariant as the continuity gate, applied to the *mesh*).
  Verify: vitest + typecheck.
- **P3 — root-mesh gate in verify-traced-carve**: use the existing diagnostic
  `compareStreamRootBuilds` (`src/clod_worker_client.ts:309`, cache-bypassed CPU leg)
  from the page context to build the root(s) covering the probed channel at an aerial
  level, triangle-interpolate bed heights along the walked polyline, and gate on wet
  fraction — closing the verification hole where the render gate only covers the far
  summary (W1.6 lesson: the aerial band had no gate at all).
- **P4 — browser + perf validation** (delegated): verify tool PASS + aerial screenshot
  showing a connected ribbon; `perf:main` A/B (triangles, frameMs p50/p95, root build
  ms); warm acceptance unchanged outside terrain-tris; cold-boot time note.

## Risks

- Triangle retention along long rivers at deep roots (mitigations above; measured in P4).
- Many locks reduce simplifier freedom near corridors → slightly larger parent meshes
  and possible thin triangles at corridor edges; existing `validateFinalPageMesh` +
  zero-area stripping already guard this.
- Corridor query cost during parent builds: per welded vertex, AABB-first memoized
  lookup; only on traced worlds. Root build ms is a P4 gate.
- Concurrent sessions: `quadtree.ts` / worker files are shared surfaces — land P2 in
  one commit with explicit staging.

## Explicitly out of scope

- WGSL traced carve for GPU chunk meshing (would re-enable GPU roots on traced worlds).
- Selection-side corridor refinement (fallback if lock retention costs too much).
- Graph/continent far-field carve parity, walk recenter transient, shader look.
