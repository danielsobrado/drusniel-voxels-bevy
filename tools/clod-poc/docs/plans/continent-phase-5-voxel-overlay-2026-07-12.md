# Continent Phase 5 — Voxel Overlay, Caves and Complex Regions

Parent: `continent-plan-overview-2026-07-12.md`. Requires Phase 3 (tiles are authority).

## Goal

Voxels become a formal **overlay on the canonical heightfield**: near-field density derives from
carved tiles plus authored volumes plus player deltas; cave/overhang regions are flagged per
tile; complex regions get voxel-derived CLOD proxy pages at medium distance; out-of-world edits
become supported.

```text
density(x,y,z) = (y - canonicalTileHeight(x,z))            ordinary terrain
              + cave/overhang volume ops                    flagged regions
              + authored volume stamps                      dungeons, cliffs
              + player voxel deltas                          persisted edits
```

## Current code this builds on (verified 2026-07-12)

| Concern | Today | Anchor |
| --- | --- | --- |
| Density | procedural `y - surfaceHeight` shape via terrain density/SDF | `src/terrain/terrain_density.ts`, `terrain/sdf/` |
| Live bubble | Surface Nets chunk groups, 96 m radius, MeshBVH colliders, eviction | `near_field_bubble_controller`, `config/clod_pages.yaml near_field` |
| Player edits | `DigEdit`/`VoxelDelta` snapshots, hashed into cache identity, dig index in worker | `src/terrain/voxel_edits/`, `src/cache/terrainSource.ts:55-83` |
| Out-of-world edits | explicitly unsupported today (`OUT_OF_WORLD_EDITS_SUPPORTED = 0` counter) | `src/terrain/streaming/clod_streaming_roots.ts:191` |
| Cave persistence schema | `SavedCaveEntrance` (position, facing, farMaskRadiusM), `SavedCaveSystem` (proceduralSeed, authored, criticalPathIds) | `src/save/save_schema.ts:70-71` |
| Streamed proxy transport | worker `buildStreamRoots` builds pages from SDF with `{finite:false}` bounds | `src/clod_worker.ts` (`handleBuildStreamRoots`) |
| Construction/voxel proxies | construction runtime + reuse audit docs | `docs/construction-runtime.md`, `src/construction/` |
| NAADF | terrain-query backend (sun visibility, AO, occupancy) — stays a backend, not a renderer | `src/naadf/`, `docs/naadf-poc.md` |

## Design

### Tile complexity contract (extends `HeightfieldTile`)

```ts
interface HeightfieldTileComplexity {
  complexVolumeMask: Uint8Array | null;   // 64×64 (4 m cells): 0 = pure heightfield
  entranceMask: Uint8Array | null;        // cave entrances for far shadow/summary
  voxelRegionRefs: string[];              // authored volume / cave-system ids
}
```

- `null` masks (the overwhelmingly common case) cost nothing and skip every special path.
- Producers: authored volume stamps (editor/authoring data), cave systems from
  `SavedCaveSystem.proceduralSeed`, and — later — any generator feature that needs volume.
- Consumers: near-field density (adds volume ops inside masked cells), streamed-root builder
  (chooses voxel-proxy build for pages intersecting masked cells), far summary
  (`caveEntranceCoverage` channel reserved in Phase 4).

### Density composition order (deterministic)

`tileHeight → cave ops (by region ref, seeded) → authored stamps (by ref order) → player deltas
(by revision)`. Same order on main thread, worker, and any future GPU voxel path; locked by a
composition test. Player deltas keep their existing snapshot/hash machinery — no change to save
format.

### Medium-distance proxies

Pages whose footprint intersects `complexVolumeMask` are built by the worker from the composed
SDF (existing Surface Nets path) instead of the heightfield mesher — reusing the
`buildStreamRoots` transport and the same scheduler/budgets. Far distance renders only the top
envelope (summary tiles ignore interior volume except the entrance/occluder channels).

## Commit sequence

### C5.1 — Near-field density from canonical tiles

- In continent mode the bubble's density base samples carved tiles (through the Phase 1 sampler
  chain) instead of `baseSurfaceHeight`. Because Phase 3 already made tiles the meshing
  authority, this is an equivalence refactor for ordinary terrain — parity test: bubble chunk
  meshes bit-equal before/after on a route with rivers.
- Colliders/raycasts already follow the sampler chain from Phase 3; assert with the existing
  collider tests plus one carved-bank capsule test.

### C5.2 — Complexity masks + composition pipeline (schema + plumbing, no content)

- Tile complexity fields, `null` fast path, composition order + tests; worker protocol carries
  region refs/stamps with the tile payload; cache identity: region refs + stamp hashes join the
  voxel-snapshot hash in the terrain-source inputs (they change geometry).
- No visible change (no content yet) — geometry hash must be stable when masks are null
  (fixture test).

### C5.3 — Cave volume ops from `SavedCaveSystem`

- Deterministic cave generator seeded by `proceduralSeed` (start simple: entrance tube +
  chamber SDF ops; authored=true systems read stamp data instead), applied inside masked
  cells in the bubble; entrance mask written into tiles at build time.
- Gameplay checks: walk into a cave on a test scene (new deterministic scene param
  `scene=cave-test`), colliders correct, no fall-through, `water:ownership` unaffected.
- Shot battery: entrance from outside (shadowed hole), interior with headroom.

### C5.4 — Voxel-derived proxy pages for complex regions

- Streamed-root planner routes masked pages to the SDF build path (worker); non-masked pages
  keep the (cheaper) heightfield path from Phase 3. Both produce `ClodPageNode`s — the
  scheduler, transitions, eviction and counters are untouched.
- Perf gate: SDF page build ms vs heightfield page build ms recorded per level; masked-page
  share on the acceptance route must be small (<5%) — masks are sparse by design.

### C5.5 — Out-of-world edits supported

- Dig index extends to streamed pages via region-keyed deltas (save schema already regionalizes
  them); `OUT_OF_WORLD_EDITS_SUPPORTED → 1`; invalidation flows: edit → mark page dirty →
  streamed-root `invalidateBounds` (exists, `clod_streaming_roots.ts:75`) → rebuild → far
  summary dirty via `save_far_summary_bridge` (exists).
- Acceptance: dig outside the startup world on the movement route; edited page rebuilds; gate
  `live_clod_stream_out_of_world_edits_supported === 1` plus a dig-persistence reload check.

### C5.6 — NAADF hookup for cave lighting (bounded)

- NAADF ingests bubble occupancy for cave sun-visibility/AO only (it remains a query backend —
  the overview invariant). Budgeted update; skip entirely when no masked cells are resident.

## Performance budget and measurement

- Bubble rebuild cost with tile-based density within noise of Phase 3 baseline (perf:move
  route with digs).
- SDF proxy pages: worker build ms per level recorded; apply cost stays inside existing apply
  budget (1 page/frame, `applyMs` gate).
- Cave scene: perf:main on `scene=cave-test` — record numbers as the first cave baseline.
- Frame gates unchanged: `frame_ms_p95 <= 8` acceptance.

## Risks

- *Density composition drift between main/worker* → single composition module imported by both;
  order test; the dig-parity tests already guard the delta layer.
- *Mask granularity too coarse (4 m)* → acceptable for routing decisions (it only chooses the
  build path and volume-op activation); geometry fidelity comes from the SDF itself.
- *Scope creep into cave content generation* → this phase ships the pipeline + one simple
  deterministic cave type; richer cave gen is content work, not architecture.

## Evidence (fill before merging final commit)

- [x] Bubble parity + collider tests on carved route: `heightfield_tile_carve.test.ts`
  locks empty-overlay bubble positions, normals, and indices bit-equal through the canonical tile
  sampler; `terrain_collider_fallback.test.ts` covers capsule grounding on a carved bank. Full suite:
  535 files / 2,903 tests passed in the final full suite. The near-field regression also proves a
  sparse overlay leaves non-intersecting pages on the GPU/heightfield fast path.
- [x] SDF vs heightfield page build ms by level; masked-page share on route: native-Windows
  `cave-test` exterior capture requested 2 complex and 86 ordinary pages (2.27% complex).
  L1 p95 was 1,166.2 ms for SDF pages versus 252.3 ms for heightfield pages; GPU failures and
  worker fallbacks were both zero. Evidence: `shots/phase-5/cave-outside-stats.json`.
- [x] Cave-test scene shots + stats; perf:main baseline: exterior and interior captures are
  `shots/phase-5/cave-outside.png` and `shots/phase-5/cave-interior.png`, with adjacent stats and
  QA-summary JSON. The final `perf-runs/phase5-cave-final` run recorded frame p50/p95
  3.70/5.70 ms, render p95 1.00 ms, top phase `selectionUpdateMs` 2.70 ms, and top prop bucket
  `propsRestMs` 2.20 ms. The same world-4 heightfield control recorded frame p50/p95 2.00/2.90 ms in
  `perf-runs/phase5-heightfield-control`.
- [x] Cave gameplay acceptance: `acceptance-runs/phase5-voxel-overlay/report.json` records a
  29.97 m first-person approach into the cave, two streamed collider pages before and after the
  route, no failed bubble pages, and no fall-through (camera height rose from 51.97 m to 70.53 m).
- [x] Out-of-world dig acceptance (edit, rebuild, reload persistence): the same report edits
  streamed root `L1:4,2` at x=576 beyond the configured world-8 boundary (512 m), commits 80 voxel
  deltas, records one invalidation and one completed streamed-root rebuild, then reloads the save
  with all 80 deltas and no save error. Native-Windows full reuse acceptance also passed at
  `acceptance-runs/infinite-islands/2026-07-13T22-00-57/report.json` with configured/startup worlds
  16/2 and no gate failures.
- [x] Bounded NAADF hookup: `cave_occupancy.test.ts` proves the query returns immediately while no
  complex bubble page is resident, then performs a bounded march only after resident complex-page
  bounds are published.

Phase 5 implementation completed 2026-07-14. The ordinary-tile fast path retains null masks;
complex tiles carry 4 m masks and region refs, deterministic cave/stamp/player composition is
shared by main and worker density, masked streamed roots use the CPU SDF builder, ordinary roots
retain GPU heightfield meshing, and NAADF cave occupancy is bounded and skips work until complex
bubble pages are resident.
