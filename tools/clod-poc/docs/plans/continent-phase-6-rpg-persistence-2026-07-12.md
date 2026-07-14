# Continent Phase 6 — RPG Feature Layers and Persistence Hardening

Parent: `continent-plan-overview-2026-07-12.md`. Requires Phases 1–3; runs partly parallel to 4–5.

## Status

Implementation complete on 2026-07-14. Runtime contract: `../editor/world-persistence-contract-2026-07-14.md`.

- [x] C6.1 stable prop identity and interaction/debug lookup
- [x] C6.2 durable environmental deltas, sparse exclusions, reload counters, GPU upload contract
- [x] C6.3 deterministic road/settlement stamps, scatter exclusions, source hash, far coverage
- [x] C6.4 schema v2 manifest pinning, v1 fixture migration, regeneration reconciliation
- [x] C6.5 `world:verify` and persistence documentation

## Goal

Make the three prop/feature layers real and durable on the continent:

```text
1. deterministic environmental layer   stable per-candidate ids, reproducible from (manifest, tile)
2. authored world-feature layer        stamps/records that shape tiles BEFORE scatter runs
3. persistent RPG delta layer          what changed vs the deterministic baseline
```

…and pin worlds to manifests so generator upgrades never silently rewrite a saved world.

## Current code this builds on (verified 2026-07-12)

The save layer is **already designed for this** — this phase wires it to the world pipeline:

| Concern | Today | Anchor |
| --- | --- | --- |
| Save manifest | `SaveWorldManifest` (worldId, seed, proceduralProfile "infinite-islands-v1", 512 m regions) | `src/save/save_schema.ts:14-25` |
| Regions | `RegionManifest` with revision + authorityRevision; region/prop/voxel stores; binary deltas | `src/save/region_store.ts`, `voxel_delta_binary.ts` |
| Prop deltas | `SavedPropInstance` state `active|hidden|destroyed`, tags, city/road/criticalPath/faction refs | `src/save/save_schema.ts:55-63` |
| World features | cities, districts, roads, cave entrances, cave systems, critical paths (+ validation) | `save_schema.ts:67-73`, `critical_path_validation.ts` |
| Edit→far invalidation | dirty-bounds broadcast bridge with counters | `src/save/save_far_summary_bridge.ts` |
| Env scatter today | deterministic per-world-cell hashes (trees `hash01(wx,wz,seed)`; stones/grass GPU rings) — **no exported per-candidate identity** | `src/canopy/deterministic_tree_distribution.ts:76-89`, `src/grass/grass_gpu_ring.ts`, `src/gpu/stone_scatter_compute.ts` |
| Authored placements | `custom_prop_placements*.yaml` + external prop catalog + prop system | `config/custom_prop_placements*.yaml`, `src/props/prop_system.ts` |

## Design

### Stable environmental prop identity

```text
propId = hash64(manifest.worldId, tileKey, layer, candidateIndex)
```

- `candidateIndex` is the deterministic enumeration order the scatter already produces per tile
  (tree candidates per world cell; stone/grass per ring cell). The id is **derived at
  interaction time** — the GPU scatter path does not carry ids per instance; only when a player
  harvests/destroys/queries a candidate does the CPU recompute its id from the same inputs.
- Delta application to GPU rings: per-tile exclusion bitset (candidateIndex-indexed) uploaded as
  a small texture/buffer the placement compute consults — the hydrology-atlas "no data
  self-corrects" upload pattern. Bitsets exist only for tiles with deltas (sparse).

### Authored features shape tiles, then scatter respects them

- Feature records (`SavedRoad`, `SavedCity`, districts) compile to **terrain stamps** (flatten,
  road bed, embankment) consumed by the Phase 2/3 tile builder *before* carve finalization, and
  to **exclusion/attraction fields** consumed by scatter (vegetation clears roads/settlements).
- Stamp compilation is deterministic from the records; records live in the world metadata store
  (exists) and their hash joins the terrain-source inputs (geometry-affecting, like voxel
  snapshots today).

### Manifest pinning and migration

- A save pins `WorldManifest` (Phase 1) including `generatorVersion` + artifact hashes. Loading
  with a newer generator: world keeps generating with pinned inputs when compatible, else an
  explicit migration path (regenerate tiles, keep deltas — deltas are world-space and survive;
  props re-anchor by id recomputation, with a reconciliation report for candidates that no
  longer exist).
- `proceduralProfile` gains `"continent-v1"`; schema version bump with a fixture-based
  migration test (`infinite-islands-v1` fixtures must load).

## Commit sequence

### C6.1 — Prop identity module + interaction lookup

- `src/world/prop_identity.ts`: id derivation + per-tile candidate enumeration adapters for
  trees (from `deterministic_tree_distribution`) and stones; tests: stability across runs/seeds,
  uniqueness within tile, re-derivation after eviction.
- Interaction path (raycast hit on instanced prop → candidate → id) for the tree/stone rings;
  debug overlay showing hovered propId.

### C6.2 — Delta layer end-to-end (harvest/destroy round trip)

- Write `SavedPropInstance` deltas through the existing prop store; per-tile exclusion bitsets
  uploaded to the scatter computes; reload applies deltas (destroyed tree absent) — acceptance:
  destroy → reload → still absent, counters `prop_delta_count`, `prop_exclusion_tiles`.
- Perf gate: exclusion lookup adds no measurable cost to placement compute (perf:main trees
  case, `--warmup 600`).

### C6.3 — Feature stamps into tile builds

- Stamp compiler (roads flatten/bed; settlement pads) + tile-builder hook (Phase 2 API) +
  terrain-source hash inclusion + `TERRAIN_SOURCE_VERSION` bump; scatter exclusion fields from
  the same records.
- QA: authored test road across a hill — terrain flattens, grass/trees clear, far summary shows
  it (structureCoverage channel), critical-path validation passes over it.

### C6.4 — Manifest pinning + save profile migration

- Save schema v2: embed `WorldManifest`, profile `continent-v1`, migration loader for v1
  fixtures; reconciliation report for prop deltas on regeneration.
- Tests: load v1 fixture; pin/upgrade scenarios (same generator → identical tiles; changed
  generator → migration path exercised).

### C6.5 — Consistency sweeps + docs

- A `world:verify` node script: samples N random tiles, asserts tile hash determinism, prop id
  stability, delta application, stamp presence — the standing regression net for future
  generator work.
- Update `docs/editor/world-persistence-contract.md` cross-references; close the plan set.

## Performance budget and measurement

- Placement compute with exclusion bitsets: trees A/B (`scene=trees-perf`, CPU + GPU cases per
  the CLAUDE.md tree regression procedure) — within noise.
- Save IO stays off frame path (existing async store patterns); delta write burst on
  harvest ≤ existing dig-edit cost envelope.
- Standard battery + acceptance --reuse before each commit lands.

## Risks

- *Candidate enumeration drift breaks ids* → enumeration order becomes a tested contract
  (fixture per seed/tile); any intentional change is a generator-version bump handled by
  manifest pinning + reconciliation.
- *Stamp/carve ordering ambiguity* → fixed order: macro → carve → stamps → (voxels later);
  documented in the tile builder; composition test from Phase 5 extends to stamps.
- *Editor integration scope* → out of scope here; the editor sprints own authoring UX. This
  phase only guarantees the runtime contracts they write into.

## Evidence (fill before merging final commit)

- [x] prop id stability/uniqueness test run
- [ ] destroy→reload acceptance; exclusion perf A/B numbers
- [ ] road stamp QA shots + critical-path validation output
- [x] v1 fixture migration test run
- [ ] world:verify sweep output on a fresh continent
