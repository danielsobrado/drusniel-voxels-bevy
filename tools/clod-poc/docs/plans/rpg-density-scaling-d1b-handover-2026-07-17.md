# Plan 2 (RPG Content Density Scaling) — D1b/D1c handover

Created 2026-07-17. Companion to `rpg-content-density-scaling-2026-07-16.md` (the plan
of record — its checkboxes carry the authoritative done/pending state). This file
captures the working-tree state and the D1b reconnaissance so a fresh session can
continue without re-deriving it.

## State at handover

Uncommitted plan-2 work (verified: typecheck clean, full vitest 3,398 green, vite build
green as of 2026-07-17):

- **D0 done**: `src/world/prop_exclusion.ts` incremental contract
  (`applyDelta`/`setExcluded`/`consumeDirtyTileLayers`/`contentEquals`, refcounted
  duplicates, empty-tile pruning) + tests; `src/save/save_runtime.ts` on incremental
  APIs with dev equivalence guard (`prop_exclusion_guard_mismatches`);
  `SavedPropStore.count()`; bench `npm run bench:prop-edits`
  (`tools/benchmark-prop-edit-path.ts`) — 406.6 → 0.017 ms mean/edit @50k props,
  curves in `perf-runs/prop-edit-bench/{baseline-rebuild,incremental-after-d0}.json`.
- **D1a done**: `config/benchmark_content_profiles.yaml` + strict loader
  `src/qa/benchmark_content_profiles.ts` (+tests);
  `src/diagnostics/workload_descriptors.ts` (+tests) publishing `wd_<key>` /
  `wd_measured_<key>` / `wd_unmeasured_count` from `clod_frame_loop.ts`'s 250 ms
  debug-mirror block. Unmeasured gaps D1b owns: `construction_pieces_visible`,
  `interactive_props`; `colliders` counts `props.colliders_active` only.
- A parallel session works plans 1/3 in the same tree (commits `5591d7b8`, `c04d9755`);
  expect concurrent edits to player/bootstrap files. Re-run typecheck before assuming
  breakage is yours.

## D1b reconnaissance (verified in source 2026-07-17)

**Village site**: the coast-to-coast route
(`tools/infinite_acceptance/movement_route_profile.ts`) starts at `[-8000, 96, 0]`;
cumulative segment deltas put the `village-site` landmark (end of
`river-to-village-site`) at **world (1600, 500)**. Player base: nearby, e.g. ~(1900,
650), same streaming context. If you mirror these constants into `src/`, add a
cross-check test under `tools/` (tools may import src; not vice versa).

**Scene registry**: `src/scenes/scene_registry.ts` — add `rpg-village` and
`rpg-player-base` as `longView: true` entries with `phase0ConfigKey:
"infinite_islands"` (the `continent` scene uses the same key). Gated scenes get
`__drusnielClod` hooks via the long-view path automatically.

**Construction seeding**: runtime piece catalog is `config/construction.yaml`
(`wood-floor-2x2`, `wood-wall-2x2`, `wood-fence-2x1`, `wood-pillar-2m` — **no roof
piece**; use elevated floor pieces as flat roofs). Controller is created in
`src/app/bootstrap/runtime/runtime_systems_startup.ts:324-382`; bulk placement
precedent is `construction_persistence.ts` `loadConstructionPieces` → `addPiece:
(piece) => this.pieceStore.add(piece, false)` with `grounded`/`parentIds` support
metadata. Add a seeding entry point on `ConstructionController` mirroring that path.
CAREFUL: `placement.storageKey` (`drusniel.clod-poc.construction.v1`) is
localStorage-persisted — seeded scenes must NOT write thousands of pieces into the
user's default storage key (use a scene-scoped key or skip persistence for seeded
scenes). `construction_placed_meshes` counter exists; one mesh per piece (2,500 pieces
≈ 2,500 draws — that is the intended measured workload).

**Placed props**: custom-props layer, `resolvePropPlacementScene`
(`src/props/prop_placements.ts`, `?customPropScene=` param) over
`propPlacementScenes` built in `src/app/bootstrap/world_build_startup.ts`
(`createLazyPropPlacementScenes`). `config/custom_props.yaml` has `enabled: false` —
rpg scenes must force-enable (URL param `customProps=1` or scene-driven). Real asset
ids with GLBs under `public/assets/` (quaternius sets): `crate_a`, `rock_large_01`,
`stone_ruin_wall`, chests/barrels etc. — see `config/custom_prop_placements*.yaml`.
`props.colliders_active` counter exists.

**Stamps (road/plaza)**: compiled from world metadata (`src/world/feature_stamps.ts`,
cities/districts/roads); the application mechanism used by
`accept:phase6-road-stamp` was NOT yet investigated — do that before wiring, or
record the composition without road stamps and log the gap in the plan doc.

**Descriptor gaps to close while wiring scenes**: publish
`construction_pieces_visible` (visibility split from the piece store) and an
`interactive_props` counter (define it: placed props with colliders/interaction
tags), then remove them from the unmeasured list expectations in
`src/diagnostics/workload_descriptors.ts` sources + its test.

## D1b remaining work (from the plan)

1. Deterministic composition module (seeded RNG from `?seed=`): village = 30–80
   buildings (floor grids + perimeter walls 1–2 stories + flat roofs + fenced yards,
   target order 1,500–4,000 total pieces) around (1600, 500) with plaza/road axes kept
   clear; player base = one 200–600-piece modular base; props scattered per profile.
   Heights via injected `surfaceHeightAt` callback (pure + testable; terrain conform
   stays off). Unit tests: same seed → identical layout; piece/building counts within
   profile ranges; support metadata coherent.
2. Boot wiring for `scene=rpg-village|rpg-player-base` (piece seeding + prop scene +
   composition counters), booting under the reuse profile.
3. Composition tables recorded from measured `wd_*`/composition counters (building
   count, total/visible pieces, avg/max per building, unique meshes/materials,
   colliders, shadow casters) — measured in-browser, not estimated; shot + stats JSON
   per the shot harness.

## D1c (after D1b boots)

5-run protocol per the plan: `perf:main` settled at village + base centers,
`perf:move` village → forest → meadow; frame p50/p95/p99/p99.9/max, >16.7/33.3/50 ms
counts, long tasks, renderMs p95, top buckets, queue depth, resource churn, full
descriptors; median/worst/spread under `perf-runs/rpg-dense-baseline/`. Start the dev
server yourself — **do not reuse port 5180 if occupied; it is the user's own server**
— e.g. `npm --prefix tools/clod-poc run dev -- --host 127.0.0.1 --port 5181
--strictPort` and pass `CLOD_POC_BASE_URL` accordingly. Use `--warmup 600` (WebGPU
paths). Update the plan doc per commit-sized chunk; do not commit unless asked.
