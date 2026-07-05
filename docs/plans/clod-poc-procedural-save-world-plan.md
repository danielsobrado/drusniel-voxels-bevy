# CLOD-POC Procedural World Save And Modification Plan

## Scope

This plan is only for `tools/clod-poc`.

The goal is to support a huge playable world that starts from deterministic procedural generation
and then becomes personalized through saved changes:

```text
procedural base world
+ saved voxel deltas
+ saved prop / prefab instances
+ saved city, road, cave, quest, and critical-path metadata
+ rebuildable derived caches
```

The core rule is:

```text
Do not save the whole huge world as raw voxels.
```

A huge world should be regenerated from seed and then patched with saved deltas. Full raw voxel
storage is only acceptable for tiny debug fixtures or explicitly baked authored areas.

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

Derived data can be cached for faster reloads, but it must always be rebuildable from the saved
authority.

## Data Ownership Model

### Procedural base

The procedural base defines the unmodified world.

Owned by:

```text
tools/clod-poc/src/world_source/world_source.ts
tools/clod-poc/src/world_source/island_shape.ts
tools/clod-poc/src/world_source/biome_region_field.ts
```

It should provide:

```text
height
biome/material
water/ocean state
canopy/forest hints
cave entrance hints
base terrain density
```

### Voxel deltas

Voxel deltas define terrain changes on top of the procedural base.

Examples:

```text
digging
raising/lowering terrain
flattening city foundations
road cuts
cave entrance edits
terrain paint
blocked/unblocked critical-path terrain
```

Voxel deltas are authoritative for terrain edits. They are loaded per region/chunk and replayed over
the procedural base before live mesh generation.

### Prop and prefab instances

Props define authored objects that should not be stored as raw terrain voxels unless they are truly
voxel terrain.

Examples:

```text
houses
walls
bridges
city props
doors
market stalls
signs
rocks/trees placed by design
quest objects
landmark ruins
```

Props are saved as stable instances:

```text
prefab id
instance id
position
rotation
scale
variant/material
state
owner/faction tags
critical-path flags
```

### Metadata

Metadata gives meaning to terrain and props.

Examples:

```text
city id
road id
district id
quest area id
safe zone id
spawn zone id
dungeon entrance id
critical path id
nav hint id
faction ownership
```

Metadata is required. Without it, the engine can render objects but cannot understand cities, roads,
critical paths, progression, or RPG rules.

## Save File Shape

Use region-based saves. Do not store one massive world file.

Suggested layout:

```text
saves/<save_id>/
  world.json
  regions/
    r_<rx>_<rz>/
      region_manifest.json
      voxel_deltas.bin
      props.json
      entities.json
      roads.json
      cities.json
      caves.json
      critical_paths.json
      metadata.json
      cache_manifest.json
```

### `world.json`

Purpose:

```text
world-level seed and global save metadata
```

Fields:

```json
{
  "schemaVersion": 1,
  "worldId": "world_001",
  "saveId": "save_001",
  "seed": 1,
  "createdAt": "2026-07-05T00:00:00.000Z",
  "updatedAt": "2026-07-05T00:00:00.000Z",
  "proceduralProfile": "infinite-islands-v1",
  "regionSizeM": 512,
  "chunkSizeM": 16,
  "notes": "debug save"
}
```

### `region_manifest.json`

Purpose:

```text
describes which authority files exist for this region and their revisions
```

Fields:

```json
{
  "schemaVersion": 1,
  "regionX": 0,
  "regionZ": 0,
  "revision": 12,
  "hasVoxelDeltas": true,
  "hasProps": true,
  "hasRoads": true,
  "hasCities": true,
  "hasCaves": true,
  "hasCriticalPaths": true,
  "derivedCacheRevision": 8
}
```

## Voxel Delta Model

Do not store full voxel chunks unless necessary. Store compact operations or sparse modified cells.

### Recommended first format: operation log

Start with an operation log because it is simple, testable, and good for editor/gameplay iteration.

```ts
export type VoxelEditOperationKind =
  | "add"
  | "remove"
  | "paint"
  | "flatten"
  | "raise"
  | "lower";

export interface VoxelEditOperation {
  id: string;
  revision: number;
  kind: VoxelEditOperationKind;
  center: [number, number, number];
  radiusM: number;
  heightM?: number;
  materialId?: number;
  shape: "sphere" | "box" | "cylinder" | "splineBrush";
  createdBy: "player" | "editor" | "system";
  criticalPathId?: string;
}
```

Pros:

```text
simple to inspect
small files
easy undo/redo
easy editor integration
good for critical-path edits
```

Cons:

```text
replay cost grows over time
requires compaction later
```

### Later format: compacted chunk deltas

When operation logs get too large, compact them into chunk-local sparse voxel deltas.

```ts
export interface ChunkVoxelDelta {
  chunkKey: string;
  baseRevision: number;
  changedVoxels: Array<{
    localX: number;
    localY: number;
    localZ: number;
    densityDelta?: number;
    materialId?: number;
    flags?: number;
  }>;
}
```

Compaction rule:

```text
procedural base + operation log -> compacted chunk delta
```

The compacted delta becomes faster to load, but the original operation log can still be kept for
editor history if needed.

## Prop Instance Model

Props and buildings should be saved as instances, not baked into terrain.

```ts
export interface SavedPropInstance {
  id: string;
  prefabId: string;
  regionKey: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  variantId?: string;
  materialOverrideId?: string;
  state: "active" | "hidden" | "destroyed" | "disabled";
  tags: string[];
  ownerFactionId?: string;
  cityId?: string;
  roadId?: string;
  criticalPathId?: string;
  revision: number;
}
```

Rules:

```text
- buildings are prefab instances unless destructible terrain is required
- bridges are props unless they need voxel destruction
- walls are props unless they must be mined/damaged as terrain
- doors/gates are entities, not terrain
- decorations are props
- quest objects have stable IDs
```

## City Model

A city is metadata plus prop instances plus terrain deltas.

Do not save a city as one giant voxel object.

```ts
export interface SavedCity {
  id: string;
  name: string;
  regionKeys: string[];
  center: [number, number, number];
  radiusM: number;
  districtIds: string[];
  roadIds: string[];
  factionId?: string;
  criticalPathIds: string[];
  revision: number;
}

export interface SavedCityDistrict {
  id: string;
  cityId: string;
  name: string;
  bounds: SavedBounds2D;
  tags: string[];
}
```

City terrain uses voxel deltas for:

```text
foundation flattening
road cuts
stairs/ramps carved into terrain
harbor cuts
cave/dungeon entrances
blocked/unblocked critical terrain
```

City objects use prop instances for:

```text
houses
walls
bridges
towers
markets
docks
lamps
signs
furniture
NPC spawn markers
```

## Road And Critical Path Model

Roads should be saved as splines plus optional terrain deltas.

```ts
export interface SavedRoad {
  id: string;
  name?: string;
  regionKeys: string[];
  points: Array<[number, number, number]>;
  widthM: number;
  materialId: number;
  roadType: "dirt" | "stone" | "bridge" | "city" | "trail";
  connectedCityIds: string[];
  criticalPathId?: string;
  revision: number;
}
```

Critical paths are gameplay metadata. They should be separate from the visual road or terrain edit.

```ts
export interface SavedCriticalPath {
  id: string;
  name: string;
  purpose: "mainQuest" | "cityAccess" | "dungeonAccess" | "bossRoute" | "tutorial";
  requiredRegionKeys: string[];
  linkedRoadIds: string[];
  linkedPropIds: string[];
  linkedVoxelEditIds: string[];
  mustRemainPassable: boolean;
  revision: number;
}
```

Rules:

```text
- save road shape as spline metadata
- save actual terrain cut/paint as voxel deltas
- save bridge meshes as props
- save passability rules as critical-path metadata
- validate critical paths after edits
```

## Cave Model

Caves should be voxel terrain near the player, with metadata and far-visible entrance summaries.

```ts
export interface SavedCaveEntrance {
  id: string;
  regionKey: string;
  position: [number, number, number];
  facing: [number, number, number];
  caveSystemId: string;
  linkedCriticalPathId?: string;
  farMaskRadiusM: number;
  revision: number;
}

export interface SavedCaveSystem {
  id: string;
  regionKeys: string[];
  entranceIds: string[];
  proceduralSeed?: number;
  authored: boolean;
  criticalPathIds: string[];
  revision: number;
}
```

Rules:

```text
- cave interiors are voxel/generated/edited near the player
- far shell only sees cave entrance masks or dark silhouettes
- do not project full cave interiors into heightfield/far-summary terrain
- save cave edits as voxel deltas
- save cave meaning as metadata
```

## Load Pipeline

When a region or chunk becomes needed:

```text
1. Resolve region key from world position.
2. Load world seed and procedural profile.
3. Generate procedural base terrain for the needed chunk/page/sample.
4. Load region manifest.
5. Load voxel operation log and/or compacted voxel deltas.
6. Apply voxel deltas over procedural base.
7. Load prop instances for the region.
8. Load metadata: cities, roads, caves, critical paths.
9. Build live visual chunk mesh when inside live radius.
10. Invalidate or rebuild CLOD page when needed.
11. Invalidate or rebuild far-summary tile when needed.
12. Render using terrain ownership: live > CLOD > far.
```

## Save Pipeline

When the player or editor changes the world:

```text
1. Create a stable edit ID or prop instance ID.
2. Resolve affected region keys.
3. Write operation to in-memory region authority.
4. Mark affected live chunks dirty.
5. Mark affected CLOD pages stale.
6. Mark affected far-summary tiles stale by bounds.
7. Mark affected critical paths dirty if the edit overlaps them.
8. Queue save for affected region files.
9. Flush region files under a save budget.
10. After successful save, clear dirty-save flags.
```

Save must be atomic at region level:

```text
write temp file -> validate -> rename/swap manifest revision
```

If browser storage is used first, emulate atomicity with a manifest revision and complete/incomplete
write markers.

## Derived Cache Invalidation

Derived caches are not authority. They are rebuildable.

Affected derived layers:

```text
live chunk mesh
live collision experiment
CLOD page mesh
FarSummaryCache tile
InfiniteFarShell height/color rebuild
canopy proxy
shadow proxy
water/coast summary
```

Invalidation order:

```text
voxel/prop authority changes
-> live chunks dirty
-> CLOD pages stale
-> far-summary tiles stale
-> far shell requests refresh
-> proxies request refresh
```

Required bounds helpers:

```ts
export interface SavedBounds2D {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface SavedBounds3D extends SavedBounds2D {
  minY: number;
  maxY: number;
}
```

`FarSummaryCache.markStale(bounds)` must become real before terrain edits are considered reliable.
A no-op bounds parameter is not enough.

## Proposed clod-poc Modules

```text
tools/clod-poc/src/save/
  save_schema.ts
  save_paths.ts
  save_manifest.ts
  region_key.ts
  region_store.ts
  region_io.ts
  atomic_region_write.ts
  save_errors.ts
  save_stats.ts
  tests/

 tools/clod-poc/src/save/voxel/
  voxel_edit_operation.ts
  voxel_delta_apply.ts
  voxel_delta_compaction.ts
  voxel_delta_bounds.ts
  voxel_delta_serialization.ts
  tests/

 tools/clod-poc/src/save/props/
  prop_instance_schema.ts
  prop_instance_store.ts
  prop_instance_query.ts
  prop_instance_serialization.ts
  tests/

 tools/clod-poc/src/save/world_metadata/
  city_schema.ts
  road_schema.ts
  cave_schema.ts
  critical_path_schema.ts
  metadata_store.ts
  metadata_query.ts
  tests/

 tools/clod-poc/src/gameplay/terrain_queries.ts
 tools/clod-poc/src/gameplay/world_authority_queries.ts
```

Keep files small. Split serialization, validation, storage, and queries.

## Configuration

Add YAML config later, not hardcoded values in runtime logic.

Suggested file:

```text
tools/clod-poc/config/save_world.yaml
```

Suggested content:

```yaml
save_world:
  enabled: true
  region_size_m: 512
  chunk_size_m: 16
  autosave:
    enabled: true
    interval_seconds: 30
    max_region_writes_per_frame: 1
  voxel_deltas:
    format: operation_log
    compact_after_operations_per_region: 5000
    max_replay_operations_per_chunk: 256
  props:
    max_instances_per_region_warning: 5000
  critical_paths:
    validate_after_terrain_edits: true
  caches:
    save_derived_caches: false
    rebuild_derived_caches_on_load: true
```

## Browser Storage First Step

For clod-poc, start simple:

```text
first: in-memory save/load for tests
second: IndexedDB-backed region store
third: downloadable/importable save bundle
later: filesystem/native storage if needed
```

Do not start with complex binary persistence before the authority model is proven.

Recommended first implementation:

```text
RegionStore in memory
JSON serialization for metadata and props
JSON operation log for voxel edits
binary compacted voxel deltas later
```

## Critical Path Validation

Critical paths must not silently break.

After terrain or prop edits:

```text
1. Find overlapping critical paths by bounds.
2. Recompute simple passability samples along the path.
3. Check required linked props still exist and are active.
4. Check required cave/city/road entrances still have terrain access.
5. Mark path valid/warning/blocked.
6. Expose debug counters.
```

Counters:

```text
critical_paths_total
critical_paths_dirty
critical_paths_valid
critical_paths_blocked
critical_path_validation_ms
```

Start with simple sampled validation. Do not build full navigation yet.

## Tests

Required tests:

```text
save_region_key_is_stable_for_negative_coordinates
save_world_manifest_roundtrips
voxel_edit_operation_roundtrips
voxel_delta_replay_is_deterministic
voxel_delta_bounds_cover_edit_shape
prop_instance_roundtrips_with_stable_id
city_metadata_roundtrips
road_spline_roundtrips
critical_path_links_roundtrip
region_store_loads_procedural_base_then_applies_deltas
edited_region_marks_live_clod_far_dirty
far_summary_mark_stale_by_bounds_marks_expected_tiles
critical_path_overlap_detects_blocking_edit
```

## Metrics

Expose these counters during save/world-authority test scenes:

```text
save_regions_loaded
save_regions_dirty
save_regions_pending_write
save_region_write_ms
save_region_read_ms
save_voxel_edit_operations
save_voxel_compacted_chunks
save_prop_instances_loaded
save_city_count
save_road_count
save_cave_entrance_count
save_critical_path_count
save_derived_invalidations_live_chunks
save_derived_invalidations_clod_pages
save_derived_invalidations_far_tiles
```

## Implementation Order

### Phase 1: Schema and in-memory authority

Goal:

```text
save data can be represented, validated, and queried without file I/O
```

Tasks:

- [ ] Add schema types for world manifest, region manifest, voxel edit operations, prop instances, cities, roads, caves, and critical paths.
- [ ] Add stable region key calculation for positive and negative coordinates.
- [ ] Add in-memory `RegionStore`.
- [ ] Add roundtrip tests for all schemas.

Exit gate:

```text
all authority data roundtrips in tests with stable IDs and revisions
```

### Phase 2: Voxel delta replay

Goal:

```text
procedural base terrain can be patched by saved terrain edits
```

Tasks:

- [ ] Add voxel edit operation replay over a generated chunk/sample field.
- [ ] Add edit bounds calculation.
- [ ] Add deterministic replay tests.
- [ ] Add operation-log compaction design but do not implement compaction yet.

Exit gate:

```text
procedural chunk + saved operation log produces deterministic modified terrain
```

### Phase 3: Prop and metadata loading

Goal:

```text
saved cities, roads, props, caves, and critical paths can be loaded by region
```

Tasks:

- [ ] Add prop instance query by region and bounds.
- [ ] Add city/road/cave/critical-path metadata query by region and bounds.
- [ ] Add stable linkage validation between metadata and prop/edit IDs.
- [ ] Add debug counters.

Exit gate:

```text
region query returns terrain edits, props, and metadata needed for a city/road/cave area
```

### Phase 4: Derived invalidation

Goal:

```text
saved changes correctly invalidate live chunks, CLOD pages, and far-summary tiles
```

Tasks:

- [ ] Add dirty bounds events from voxel edit operations.
- [ ] Map dirty bounds to live chunk keys.
- [ ] Map dirty bounds to CLOD page keys.
- [ ] Implement real `FarSummaryCache.markStale(bounds)`.
- [ ] Request `InfiniteFarShell` refresh when far-summary tiles change.

Exit gate:

```text
one saved terrain edit marks exactly the expected live/CLOD/far derived data stale
```

### Phase 5: Region persistence

Goal:

```text
modified regions can be saved and loaded again
```

Tasks:

- [ ] Add JSON region serialization for manifests, props, cities, roads, caves, critical paths, and voxel operation logs.
- [ ] Add in-memory persistence tests.
- [ ] Add IndexedDB region store.
- [ ] Add save bundle export/import later.
- [ ] Add atomic write/revision semantics.

Exit gate:

```text
edit terrain + place props + save + reload reproduces the same region authority
```

### Phase 6: Critical path validation

Goal:

```text
critical routes can be protected from accidental breakage
```

Tasks:

- [ ] Add critical path bounds and linked object lookup.
- [ ] Add sampled passability validation along road/path splines.
- [ ] Add warnings for blocked paths.
- [ ] Add counters and tests.

Exit gate:

```text
blocking a critical path produces a deterministic validation warning
```

## Done Criteria

This plan is done when:

```text
1. A world seed creates the procedural base.
2. Voxel edits save as deltas or operations, not full-world raw voxels.
3. Props and buildings save as stable prefab instances.
4. Cities, roads, caves, and critical paths save as metadata.
5. Loading a region regenerates procedural terrain, applies voxel deltas, then loads props and metadata.
6. Edited regions invalidate live meshes, CLOD pages, far-summary tiles, and far-shell refreshes.
7. Critical path metadata can detect blocking edits.
8. Save/load roundtrip tests prove deterministic behavior.
9. Derived render caches remain rebuildable and are not the gameplay authority.
```

## Blunt Risk Assessment

The main risk is saving too much raw data.

The second risk is saving only visuals and forgetting gameplay metadata.

The third risk is allowing terrain edits to update live chunks but not invalidate CLOD/far-summary
layers, causing distant views to lie.

The scalable solution is:

```text
procedural base + saved deltas + saved props + saved metadata + rebuildable caches
```
