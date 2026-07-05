# CLOD-POC Procedural World Save And Modification Plan

Rebased 2026-07-05 after code review. This revision replaces the earlier draft. The earlier
draft invented new edit/prop/persistence systems; the codebase already contains most of them.
This plan reuses them. If an implementation step contradicts the Locked Decisions table below,
the table wins.

## Scope

This plan is only for `tools/clod-poc`.

The goal is to support a huge playable world that starts from deterministic procedural
generation and then becomes personalized through saved changes:

```text
procedural base world
+ saved voxel deltas
+ saved prop / prefab instances
+ saved city, road, cave, and critical-path metadata
+ rebuildable derived caches
```

The core rule is:

```text
Do not save the whole huge world as raw voxels.
```

A huge world is regenerated from seed and patched with saved deltas. Full raw voxel storage is
only acceptable for tiny debug fixtures or explicitly baked authored areas.

Companion plan: `docs/plans/hybrid-streaming-terrain-architecture.md`. Its WP-3 (real
`FarSummaryCache.markStale(bounds)`) is a hard dependency of SV-7 in this plan.

## Implementation Status As Of 2026-07-05

Implemented in `tools/clod-poc`:

```text
- Region keys, save ids, v1 schemas, IndexedDB stores, and region-partitioned voxel deltas.
- Bootstrap save load with seed mismatch rejection before voxel replacement.
- Save runtime with autosave batching and final manifest/metadata write after dirty regions flush.
- Saved props as save-side authority, projected into runtime custom props.
- One world-level metadata record with derived region membership and schema/link validation.
- Save dirty bounds fan-out through `src/save/save_far_summary_bridge.ts` to
  `FarSummaryCache.markStale(bounds)` and far-shell height refresh.
- Critical-path validation for data/link/status integrity with structured errors/warnings.
- `bin1` voxel-delta payload decoding/encoding support. JSON remains the default write format.
- Save diagnostics counters in the existing `window.__drusnielClod.stats.counters` map.
```

Not implemented:

```text
- Runtime streaming save/load. v1 still loads the save at bootstrap and writes back by dirty region.
- Operation-log replay or DigEdit-history persistence.
- A second voxel authority. `VoxelDelta` / `voxelEditStore` remain the only saved voxel authority.
- Far-shell or far-summary persistence. They are derived data refreshed by invalidation.
- NAADF far-summary/atlas invalidation. SV-7 currently targets the classic
  `FarSummaryCache` path only.
- Full gameplay passability proof. Critical-path validation does not run navmesh/pathfinding.
```

## Target Result

The player should be able to:

```text
- explore a huge procedural island/biome world
- modify terrain near them
- place props, buildings, roads, walls, bridges, and city objects
- save those changes
- return later and see the same modified terrain and props
- keep critical paths stable for RPG progression
- rebuild live meshes, CLOD pages, and far summaries from the saved authority
```

The saved authority is:

```text
world seed + voxel deltas + prop instances + gameplay metadata
```

The saved authority is not:

```text
full raw voxel dump of the whole world
far summary tiles
CLOD page meshes
far shell geometry
render-only caches
```

Derived data can be cached for faster reloads, but it must always be rebuildable from the
saved authority.

## Existing Code This Plan Builds On

The save layer reuses these systems. It never duplicates them.

| Concern | Existing implementation |
|---|---|
| Brush edit ops (transient input) | `DigEdit` + `addDigEdit`/`getDigEditsSnapshot`/`replaceDigEdits` in `src/terrain/terrain_edits.ts` |
| Per-voxel deltas (canonical) | `VoxelDelta`/`VoxelEditSnapshot` + `voxelEditStore` in `src/terrain/voxel_edits/` |
| Density sampling with edits | `voxelEditStore.sampleDensity` via `src/terrain/terrain_density.ts` |
| Edit dirty AABB events | `TerrainEditDirtyQueue` in `src/terrain/editing/terrain_edit_dirty_queue.ts` |
| Live/CLOD invalidation on edit | `rebuildAfterDig` + `markEditedAncestorsStale` in `src/terrain/editing/terrain_edit_service.ts` |
| Prop instance schema + conversion | `ProjectPropInstance` in `src/project/project_props.ts` |
| Schema-versioned archive + validation style | `src/project/voxel_project_archive.ts` |
| IndexedDB patterns (transactions, records) | `src/project/voxel_project_archive.ts` helpers, `src/cache/indexedDbStore.ts` |
| Bootstrap restore-before-world-build | staged project import path in `src/app/bootstrap/clod_poc_bootstrap.ts` |

## Locked Decisions (2026-07-05 Review Rebase)

| # | Problem in earlier draft | Locked resolution |
|---|---|---|
| L1 | New `VoxelEditOperation` type created a second voxel authority parallel to `DigEdit`/`VoxelDelta`. | The saved voxel authority is `VoxelEditSnapshot` (per-voxel deltas), reused verbatim. No new op type exists. |
| L2 | Operation-log replay is not order-independent (overlapping add/remove with strength/falloff do not commute). | Per-voxel deltas are last-write-wins by `revision`; each voxel lives in exactly one region. The `DigEdit` log is transient UX input and is not saved in v1. |
| L3 | Loading both an op log and a delta snapshot double-applies (`replaceDigEdits` re-runs voxel transactions). | Load calls only `replaceVoxelEdits(snapshot)`. Nothing else mutates the voxel store during load. |
| L4 | Runtime per-region streaming load was assumed; no runtime authority streaming exists. | v1 = region-keyed STORAGE, whole-save LOAD at bootstrap (same lifecycle as staged project import). Runtime streaming is out of v1. |
| L5 | Save pipeline re-marked live chunks and CLOD pages dirty, duplicating what the edit service already does synchronously. | The invalidation bridge handles only far-summary tiles and the far shell. It never re-marks live/CLOD. |
| L6 | Stored `regionKeys` arrays on metadata desync from geometry. | Region membership is always derived from geometry at load; never stored. |
| L7 | Per-region metadata files added cross-region membership complexity for hundreds of small objects. | All city/road/cave/critical-path metadata is ONE world-level record per save. Only voxel deltas and props are region-partitioned. |
| L8 | "Temp file -> rename" atomicity language does not apply to IndexedDB. | One region write = one IndexedDB transaction covering all its records + its manifest. The transaction is the atomicity mechanism. |
| L9 | Prop id `${sceneId}:${index}:${assetId}` is unstable under insertion/deletion. | All saved ids come from `createSaveIdFactory(seed)`; legacy ids migrate to factory ids on first save. |
| L10 | Plan listed `world_source` as owner of terrain density. | Density lives in `src/terrain/terrain_density.ts` + `src/gpu/terrain_field_core.ts`. The save layer queries those, never a parallel path. |
| L11 | Prop examples included scatter vegetation. | GPU-scattered vegetation (grass/tree/pebble rings) is never saved as instances. Only authored placements are. |
| L12 | `derivedCacheRevision` in region manifest duplicated the cache service's own manifests. | Removed. The region manifest carries `authorityRevision` only. |
| L13 | `entities.json` and an entity system were referenced; none exists. | Removed from v1 entirely. |
| L14 | YAML config "later" left constants floating. | v1 constants live in `src/save/save_config.ts` as exported consts. YAML migration is out of v1. |

## Non-Goals For v1

```text
- No runtime region streaming of authority data (load is bootstrap-only).
- No save-driven eviction of loaded voxel deltas during a session.
- No cross-session undo history (DigEdit history is not persisted).
- No entity system.
- No city/road/cave GENERATION (schemas ship; producers are test fixtures or editor JSON).
- No export/import save bundles.
- No native filesystem storage.
- No YAML save config.
- No new voxel edit op types, no new replay engine, no compaction module
  (the voxel store already applies and compacts at edit time).
```

## Data Ownership Model

### Procedural base

Owned by `src/world_source/world_source.ts`, `island_shape.ts`, `biome_region_field.ts` for
height/biome/ocean, and by `src/terrain/terrain_density.ts` + `src/gpu/terrain_field_core.ts`
for density. Cave entrance hints do not exist yet and are not promised by this plan.

### Voxel deltas (canonical terrain-change authority)

`VoxelEditSnapshot` from `getVoxelEditSnapshot()`. Deltas are integer voxel coordinates with
density and optional material slot, last-write-wins by `revision`. Brush operations
(`DigEdit`) convert to voxel transactions at edit time and are not part of the saved
authority.

### Prop and prefab instances

`SavedPropInstance` (extension of the existing `ProjectPropInstance`, schema below). Sourced
from the same placement-scene path the project archive uses
(`propPlacementSceneToProjectProps` / `projectPropsToPropPlacementScene`).

Rules:

```text
- buildings are prefab instances unless destructible terrain is required
- bridges are props unless they need voxel destruction
- walls are props unless they must be mined/damaged as terrain
- doors/gates are out of v1 (no entity system)
- decorations are props
- quest objects have stable factory ids
- procedural scatter vegetation is never saved as instances
```

### World metadata

One `WorldMetadataRecord` per save (cities, districts, roads, cave entrances, cave systems,
critical paths). Metadata gives meaning to terrain and props; without it the engine renders
objects but cannot understand cities, roads, critical paths, or RPG rules. City terrain
changes (foundation flattening, road cuts, harbor cuts, entrances) are voxel deltas; city
objects are prop instances; city meaning is metadata.

## Region And Key Rules

```ts
// src/save/region_key.ts
export const REGION_SIZE_M = 512;   // = 32 live chunks (16m) = 8 L0 pages (64m) = 1 L3 page (512m)
export function regionCoord(v: number): number { return Math.floor(v / REGION_SIZE_M); }
export function regionKeyOf(rx: number, rz: number): string { return `r_${rx}_${rz}`; }
export function regionKeyForWorld(x: number, z: number): string {
  return regionKeyOf(regionCoord(x), regionCoord(z));
}
```

Mandatory rules:

```text
- Math.floor only. Never >>, |0, Math.trunc, or Math.round: world coordinates are floats and
  truncation breaks negatives (-0.5 must map to region -1, not 0).
- Half-open boundaries: x = 512 -> rx 1; x = 511.999 -> rx 0; x = -512 -> rx -1; x = -512.001 -> rx -2.
- A VoxelDelta belongs to exactly one region: regionKeyForWorld(delta.x, delta.z); y is ignored.
- A prop belongs to exactly one region: regionKeyForWorld(position[0], position[2]).
- Live chunk and CLOD page keys are the existing liveChunkKey/pageKey. The save layer never
  invents parallel chunk keys.
- Region -> L0 page mapping for the invalidation bridge: px in [rx*8, rx*8+7], pz in [rz*8, rz*8+7].
```

## Final v1 Schemas

`schemaVersion` is `1` everywhere; bump only with a migration function. Validators follow the
`assert*` style of `voxel_project_archive.ts` and fail loud.

```ts
// src/save/save_schema.ts
export interface SaveWorldManifest {
  schemaVersion: 1;
  saveId: string;
  worldId: string;
  seed: number;
  proceduralProfile: "infinite-islands-v1";
  regionSizeM: 512;          // literal; validated against REGION_SIZE_M
  chunkSizeM: 16;            // literal; validated against cfg.page.chunk_size
  regionKeys: string[];      // index of regions with any authority data
  createdAt: string;         // ISO-8601 UTC
  updatedAt: string;
}

export interface RegionManifest {
  schemaVersion: 1;
  regionKey: string;         // "r_<rx>_<rz>"
  rx: number;
  rz: number;
  revision: number;          // increments on every region write
  authorityRevision: number; // max VoxelDelta.revision in this region at write time
  voxelDeltaCount: number;
  propCount: number;
  updatedAt: string;
}

export interface RegionVoxelDeltas {
  schemaVersion: 1;
  regionKey: string;
  format: "json";            // default v1 write format
  deltas: VoxelDelta[];      // EXISTING type from terrain/voxel_edits/voxel_edit_types.ts, verbatim
}

export interface BinaryRegionVoxelDeltas {
  schemaVersion: 1;
  regionKey: string;
  format: "bin1";            // optional accepted read format
  payload: ArrayBuffer | Uint8Array;
}

export interface SavedPropInstance extends ProjectPropInstance { // EXISTING base, verbatim
  regionKey: string;
  state: "active" | "hidden" | "destroyed";
  tags: string[];            // empty array, never undefined
  cityId?: string;
  roadId?: string;
  criticalPathId?: string;
  ownerFactionId?: string;
}
// id rule: ids come ONLY from createSaveIdFactory; legacy "<sceneId>:<index>:<assetId>" ids
// migrate to factory ids on first save.

export interface SavedBounds2D { minX: number; minZ: number; maxX: number; maxZ: number; }
export interface SavedBounds3D extends SavedBounds2D { minY: number; maxY: number; }

export interface WorldMetadataRecord {   // ONE record per save — not per region
  schemaVersion: 1;
  cities: SavedCity[];
  districts: SavedCityDistrict[];
  roads: SavedRoad[];
  caveEntrances: SavedCaveEntrance[];
  caveSystems: SavedCaveSystem[];
  criticalPaths: SavedCriticalPath[];
  revision: number;
}

export interface SavedCity {
  id: string; name: string;
  center: [number, number, number]; radiusM: number;
  districtIds: string[]; roadIds: string[]; criticalPathIds: string[];
  factionId?: string; revision: number;
}                                        // NO regionKeys — always derived
export interface SavedCityDistrict { id: string; cityId: string; name: string; bounds: SavedBounds2D; tags: string[]; }
export interface SavedRoad {
  id: string; name?: string;
  points: Array<[number, number, number]>; widthM: number; materialId: number;
  roadType: "dirt" | "stone" | "bridge" | "city" | "trail";
  connectedCityIds: string[]; criticalPathId?: string; revision: number;
}
export interface SavedCaveEntrance {
  id: string; position: [number, number, number]; facing: [number, number, number];
  caveSystemId: string; linkedCriticalPathId?: string; farMaskRadiusM: number; revision: number;
}
export interface SavedCaveSystem {
  id: string; entranceIds: string[]; proceduralSeed: number; authored: boolean;
  criticalPathIds: string[]; revision: number;
}
export interface SavedCriticalPath {
  id: string; name: string;
  purpose: "mainQuest" | "cityAccess" | "dungeonAccess" | "bossRoute" | "tutorial";
  points: Array<[number, number, number]>;            // validation needs geometry, not just links
  linkedRoadIds: string[]; linkedPropIds: string[];
  mustRemainPassable: boolean;
  status: "valid" | "warning" | "blocked" | "dirty";  // persisted validation state
  revision: number;
}
```

Removed relative to the earlier draft: `VoxelEditOperation`, `ChunkVoxelDelta`,
`variantId`/`materialOverrideId` on props (existing `variationId`/`flags` cover), all
`regionKeys` fields, `requiredRegionKeys`, `linkedVoxelEditIds` (voxel deltas have no stable
per-edit ids in v1 — critical paths link to geometry instead), `derivedCacheRevision`,
`notes`, everything entity-related. Cave schemas ship, but no producer exists yet: they are
populated only by test fixtures or editor JSON in v1.

## Storage Layout

IndexedDB database `drusniel-clod-saves`, version 1. Reuse the `requestResult` /
`transactionDone` helper pattern from `voxel_project_archive.ts`.

```text
object store "manifests":
  key `${saveId}`                          -> SaveWorldManifest
  key `${saveId}/${regionKey}`             -> RegionManifest
object store "regions":
  key `${saveId}/${regionKey}/voxel_deltas` -> RegionVoxelDeltas
  key `${saveId}/${regionKey}/props`        -> SavedPropInstance[]
object store "metadata":
  key `${saveId}`                          -> WorldMetadataRecord
```

Atomicity rule: one region write = one transaction covering the region's delta record, prop
record, and its RegionManifest with `revision + 1`. Dirty flags clear only in the transaction
success callback. There are no temp/rename steps.

## Load Order (Bootstrap Only, Exact)

1. Parse `save=<saveId>` from the URL. Absent -> skip all remaining steps.
2. Open `drusniel-clod-saves`; read `SaveWorldManifest`. Missing manifest -> fail-loud boot
   error (`window.__drusnielClod.error`), never silently start fresh.
3. Validate: `schemaVersion === 1`, `seed` equals the resolved world seed,
   `chunkSizeM === cfg.page.chunk_size`, `regionSizeM === REGION_SIZE_M`. Any mismatch ->
   fail-loud.
4. For every key in `manifest.regionKeys` (sorted lexicographically): read `RegionManifest`,
   `RegionVoxelDeltas`, and props. Validate counts against the manifest; mismatch -> fail-loud.
5. `merged = mergeVoxelSnapshots(all region delta records)`. Regions are voxel-disjoint by
   construction, so merge is concat with `revision = max`.
6. `replaceVoxelEdits(merged)` — the only voxel-store mutation during load. `replaceDigEdits`
   is never called on load.
7. Read `WorldMetadataRecord`; run schema/link validation and critical-path data validation
   (non-empty points, linked roads, required linked props, cave links). Hard corruption ->
   fail-loud. Warning statuses do not block load unless explicitly configured.
8. Proceed with `runWorldBuildStartup` unchanged — the terrain field reads `voxelEditStore`
   globally, so near meshes and pages build already-patched.
9. After renderer startup, convert `SavedPropInstance[]` via the existing
   `projectPropsToPropPlacementScene` and register the placement scene.
10. After far-summary integration is registered, replay loaded region bounds through
    `save_far_summary_bridge.ts` so derived far-summary/far-shell data refreshes.
11. Publish save counters including loaded flag, save id hash, dirty region count, metadata
    revision, prop count, voxel delta count, flush timing, far invalidation count/bounds, and
    far invalidation errors.

## Save Order (Runtime, Exact)

1. Edits mark regions dirty at commit time from dirty world bounds. Voxel and construction
   conform edits publish through `SaveTrackingDirtyQueue`; saved prop add/remove/state-change
   and metadata changes call save-runtime APIs with the affected bounds.
2. Autosave tick (every `SAVE_AUTOSAVE_INTERVAL_S = 30`, and on explicit save request):
   snapshot `getVoxelEditSnapshot()` once; `partitionVoxelSnapshot` once; enqueue dirty
   regions.
3. Per frame, write at most `SAVE_MAX_REGION_WRITES_PER_FRAME = 1` region, one transaction per
   region as defined in Storage Layout.
4. After all dirty regions flush, write `SaveWorldManifest` (updated `regionKeys`,
   `updatedAt`) and the metadata record in one final transaction.
5. Clear dirty flags only on transaction success; publish save dirty/flush counters.

## Derived Invalidation Flow (Exact)

1. Edit commit (existing, unchanged): `addDigEdit` -> `voxelEditStore.apply` ->
   `clodWorker.rebuildAfterDig` -> `applyLod0Result` patches live meshes and CLOD ancestors
   synchronously. The save layer never re-triggers any of this.
2. Dirty publication (existing, unchanged): `publishDirtyEdit` enqueues an AABB event on
   `TerrainEditDirtyQueue`.
3. Bridge (`src/save/save_far_summary_bridge.ts`): save runtime publishes
   `bounds2D = {minX, minZ, maxX, maxZ}` and the bridge fans out to registered targets. The
   bridge does not know about IndexedDB and does not own terrain edits.
4. Far-summary target: bootstrap registers `farSummaryCache.markStale(bounds2D)` for the
   classic `FarSummaryCache` path. WP-3 keeps old samples live until replacement commits when
   configured and prevents invalidated active builds/pending commits from overwriting edited
   data. NAADF far-summary/atlas invalidation is not wired in v1.
5. Far shell: bootstrap requests `infiniteFarShell.requestHeightRefresh()` after stale marking.
6. Load-time: loaded region bounds are replayed through the same bridge after far-summary
   integration is registered. Far-shell/far-summary data is never persisted.

## Critical Path Validation (v1 Semantics)

`src/save/critical_path_validation.ts` validates data integrity and reports structured
results:

```text
- errors
- warnings
- touchedCriticalPathIds
- durationMs
```

It checks non-empty path points, linked roads, required linked props, cave entrance/system
links, and persisted path status. Missing roads/props/cave links are hard errors. Existing
`status: "warning" | "blocked" | "dirty"` values are warnings by default and do not block
load unless configured. This layer does not prove navmesh reachability, water safety, slope
traversal, or full gameplay passability.

## Configuration

```ts
// src/save/save_config.ts — v1 constants; YAML migration is out of v1 (L14)
export const SAVE_AUTOSAVE_INTERVAL_S = 30;
export const SAVE_MAX_REGION_WRITES_PER_FRAME = 1;
export const SAVE_VOXEL_DELTA_WARN_TOTAL = 250_000;  // warn counter threshold, not a hard cap
export const SAVE_VOXEL_DELTA_BINARY_MAGIC = "DVXB";
export const SAVE_VOXEL_DELTA_BINARY_VERSION = 1;
```

## Module Map

New files:

```text
src/save/save_schema.ts                    # schemas above + assert* validators
src/save/save_ids.ts                       # createSaveIdFactory(seed): () => string ("p_000001_ab12")
src/save/save_config.ts                    # constants above
src/save/region_key.ts                     # key rules above, no deps
src/save/voxel_partition.ts                # partitionVoxelSnapshot / merge helpers
src/save/region_store.ts                   # in-memory SaveWorldStore
src/save/save_db.ts                        # IndexedDB "drusniel-clod-saves" v1
src/save/save_service.ts                   # loadSavedWorld, saveDirtyRegions result, markRegionDirtyFromDirtyChunks
src/save/save_far_summary_bridge.ts        # save dirty bounds -> far-summary/far-shell targets
src/save/critical_path_validation.ts       # critical-path data/link/status validation
src/save/voxel_delta_binary.ts             # optional bin1 payload encode/decode
src/save/world_metadata/metadata_schema.ts
src/save/world_metadata/metadata_store.ts  # world-level store + bounds/id queries + linkage validation
```

Changes to existing files:

```text
src/terrain/terrain_edits.ts               # export mergeVoxelSnapshots(parts): VoxelEditSnapshot
src/app/bootstrap/clod_poc_bootstrap.ts    # save=<saveId> load before runWorldBuildStartup; bridge + autosave registration
src/app/bootstrap/ui/terrain_edit_startup.ts # SaveTrackingDirtyQueue publishes dirty bounds
src/app/bootstrap/diagnostics_startup.ts    # seeds save_* counters
```

Explicitly NOT created (earlier draft, now superseded): `save/voxel/voxel_edit_operation.ts`,
`voxel_delta_apply.ts`, `voxel_delta_compaction.ts`, a new prop schema module, an entities
module, `atomic_region_write.ts`.

## Counters

```text
save_loaded
save_id_hash
save_dirty_region_count
save_dirty_revision
save_last_flush_written_regions
save_last_flush_pending_regions
save_last_flush_ms
save_last_error
save_metadata_revision
save_prop_count
save_voxel_delta_count
save_far_invalidation_count
save_far_invalidation_last_min_x
save_far_invalidation_last_min_z
save_far_invalidation_last_max_x
save_far_invalidation_last_max_z
save_far_invalidation_errors
```

Dropped from the earlier draft: `save_voxel_edit_operations`, `save_voxel_compacted_chunks`
(no op authority), `save_derived_invalidations_live_chunks/clod_pages` (live/CLOD
invalidation is not the save layer's job; counting it there invites re-triggering it).

## Tests

```text
src/save/__tests__/region_key.test.ts
  region_key_floor_semantics_for_negative_coordinates      (-0.5, -512, -512.001, 511.999, 512)
  region_key_matches_l3_page_grid_alignment
src/save/__tests__/voxel_partition.test.ts
  partition_assigns_each_delta_to_exactly_one_region
  partition_then_merge_roundtrips_snapshot_bytes_equal
  merge_revision_is_max_of_parts
src/save/__tests__/save_schema.test.ts
  world_manifest_roundtrips_and_rejects_wrong_chunk_size
  region_manifest_rejects_count_mismatch
  prop_instance_roundtrips_with_factory_id
  metadata_record_rejects_dangling_city_road_links
src/save/__tests__/save_db.test.ts                          (fake-indexeddb, same harness as cache tests)
  region_write_is_single_transaction_and_survives_reopen
  interrupted_write_leaves_previous_revision_intact
  autosave_budget_writes_at_most_one_region_per_tick
src/save/__tests__/save_service.test.ts
  load_calls_replaceVoxelEdits_exactly_once_and_never_replaceDigEdits
  dirty_region_tracking_from_dirty_chunks_marks_expected_regions
  edit_after_save_marks_only_touched_region_dirty
src/save/__tests__/save_far_summary_bridge.test.ts
  dirty_bounds_fan_out_to_targets
  target_throw_does_not_stop_fanout_and_increments_error_counter
  dirty_save_bounds_mark_intersecting_far_summary_tiles_stale
src/save/__tests__/critical_path_validation.test.ts
  valid_path_passes
  missing_road_or_required_prop_fails_hard
  warning_status_does_not_block_load_by_default
src/save/__tests__/voxel_delta_binary.test.ts
  json_still_passes
  bin1_roundtrip_exactly
  corrupt_or_unsupported_header_fails
src/save/__tests__/save_ids.test.ts
  id_factory_is_deterministic_per_seed_and_collision_free_for_1e5
```

## Acceptance Gates

`tools/save-roundtrip-acceptance.ts`, npm script `save:accept`, deterministic URL
`?scene=infinite-islands&seed=1&save=qa-roundtrip&acceptance=1`:

```text
1. Session A: boot fresh, run 8 scripted edits (reuse the long_view_edit_stress scripted-edit
   mechanism) + place 4 props, trigger save, wait save_regions_pending_write == 0.
2. Session B: reload the same URL. Gates:
   - load fails loudly on schema/link corruption
   - save_loaded == 1 and save_voxel_delta_count equals the expected fixture count
   - height probe at each edit center: |sessionB - sessionA| == 0 (existing pose/stats hooks)
   - save_roundtrip_prop_mismatch == 0 (ids, positions, states equal)
   - far tiles over edited bounds reach ready after convergence with
     far_summary_tiles_stale == 0 and the hybrid plan's split fallback counters == 0
   - screenshot at a fixed pose over an edited area passes image sanity; stored as artifact
3. Critical-path scene: author one path + one blocking edit via fixture ->
   critical_paths_blocked == 1; revert -> == 0.
4. frame_ms gates do NOT apply to these runs (coverage runs, per the hybrid plan's rule-set
   split).
```

## Deterministic Backlog (Execute Strictly In Order)

Each step ends with `rtk npm --prefix tools/clod-poc run typecheck`,
`npm --prefix tools/clod-poc test`, and `npm --prefix tools/clod-poc run build` green
(vitest/vite never under rtk). No step leaves a design decision open.

### SV-1: Keys, ids, schemas

Create `save/region_key.ts` (rules above, verbatim), `save/save_ids.ts`, `save/save_config.ts`,
`save/save_schema.ts` (schemas above, verbatim, with `assert*` validators in the
`voxel_project_archive.ts` style). Tests: `region_key.test.ts`, `save_schema.test.ts`,
`save_ids.test.ts`.

Exit: all listed tests for these files green.

### SV-2: Partition/merge over the existing store

Create `save/voxel_partition.ts`; add `mergeVoxelSnapshots` to `terrain_edits.ts`. No new
apply/replay code anywhere. Tests: `voxel_partition.test.ts`.

Exit: partition -> merge byte-equal round trip.

### SV-3: In-memory store + IndexedDB

Create `save/region_store.ts`, `save/save_db.ts` (layout above; one transaction per region
write). Tests: `save_db.test.ts` with fake-indexeddb.

Exit: interrupted-write test proves the previous revision stays intact.

### SV-4: Bootstrap load + autosave

Create `save/save_service.ts`; wire `clod_poc_bootstrap.ts` per Load Order (load before
`runWorldBuildStartup`, only `replaceVoxelEdits`); wire dirty-region tracking into
`terrain_edit_service.ts` after `publishDirtyEdit`; autosave per Save Order. Publish counters.
Tests: `save_service.test.ts`.

Exit: unit tests green; manual dev-server check that `?save=x` with no stored save fails loud.

### SV-5: Props

Extend `SavedPropInstance` per schema; source instances from the same placement-scene path the
project archive uses; migrate legacy ids to factory ids on first save; exclude scatter
vegetation. Tests: prop round-trip + id migration.

Exit: props reload into the placement scene with equal ids/positions/states.

### SV-6: World metadata

Create `world_metadata/metadata_schema.ts`, `metadata_store.ts` (single world-level record,
bounds/id queries, linkage validation, region membership derived). Tests: linkage + query
tests.

Exit: dangling links fail loud.

### SV-7: Derived invalidation bridge

WP-3 (`markStale(bounds)`) is available. Create `save/save_far_summary_bridge.ts` per the
invalidation flow; register in bootstrap. Tests: `save_far_summary_bridge.test.ts`.

Exit: one edit stales expected classic far-summary tiles, triggers shell refresh, and never
re-marks live/CLOD. NAADF far-summary invalidation remains documented as out of v1.

### SV-8: Critical-path validation

Create `save/critical_path_validation.ts` per the v1 semantics above. It is an honest
data/link/status validator, not a pathfinder. Tests per the test list.

Exit: hard data corruption fails clearly; warning statuses remain non-blocking by default.

### SV-9: Two-session service acceptance

Use fake-indexeddb/service-level tests for the v1 acceptance workflow: write Session A data,
reload Session B by save id, reject explicit seed mismatch before voxel replacement, restore
props/metadata/voxel deltas, and prove dirty-region batches finalize the manifest only after
all dirty regions flush. Browser smoke instructions may be documented separately.

Exit: tests prove the workflow without manual browser dependence.

### SV-10: Binary delta records (storage only)

Add optional `bin1` payload support with a clear header/version. JSON remains the default
write format unless explicitly changed later; both `"json"` and `"bin1"` are accepted on
read.

Exit: exact round trip, negative coordinates/material slots survive, and corrupt or
unsupported headers fail.

## Done Criteria

This plan is done when:

```text
1. A world seed creates the procedural base.
2. Voxel edits persist as the existing VoxelEditSnapshot deltas, region-partitioned;
   no new edit representation exists anywhere.
3. Props and buildings persist as SavedPropInstance extensions of ProjectPropInstance with
   factory ids; scatter vegetation is never saved.
4. Cities, roads, caves, and critical paths persist as one world-level metadata record with
   derived region membership.
5. Loading at bootstrap replays deltas via replaceVoxelEdits before world build; loaded
   region bounds are later pushed through far-summary invalidation after the target exists.
6. Runtime edits invalidate far-summary tiles by bounds and request far-shell refresh through
   the bridge; live/CLOD invalidation stays with the edit service.
7. Critical-path metadata validation detects hard data/link corruption and reports warnings
   honestly without claiming full passability.
8. The two-session service round trip passes all acceptance gates.
9. Derived render caches remain rebuildable and are never the gameplay authority.
```

## False-Confidence Guards

Reintroducing any of these is a regression against this plan:

```text
- A second voxel edit representation or replay engine ("deterministic replay" tests that the
  renderer never uses).
- Round-trip tests for metadata no system produces or consumes, presented as feature proof.
- Multi-record region writes outside a single IndexedDB transaction.
- Save-layer code that re-marks live chunks or CLOD pages dirty.
- Stored region-membership arrays on metadata.
- Critical-path full-passability claims without a real pathfinder/navmesh.
- Op-log persistence as authority (order-dependence) instead of per-voxel deltas.
- Runtime world-streaming save/load claims.
- DigEdit history persistence claims.
- Far-shell or far-summary persistence claims; those remain derived/invalidation-driven.
- NAADF far-summary invalidation claims until a NAADF target is wired and tested.
```
