# Drusniel Hybrid Streaming Terrain Architecture

## Verdict

Drusniel should stay voxel-authoritative for gameplay terrain and use derived layers for scale.

The target game is a single-player RPG, with possible two-player co-op, caves, massive maps, and streamed biomes. A global heightfield terrain model is the wrong foundation for that target because it cannot represent caves, tunnels, undercuts, arches, vertical cuts, or multi-surface terrain at one `(x, z)` coordinate.

The correct architecture is:

```text
near field:      editable voxel chunks, Surface Nets, colliders, gameplay authority
mid field:       voxel-derived CLOD pages, no colliders, no edit authority
far field:       analytic/summary terrain shell, no colliders, no edit authority
very far field:  cheap biome, ocean, mountain, canopy, shadow, and atmosphere proxies
```

Heightfield-like data is still useful, but only as a far visual and summary layer. The authoritative world remains voxel-capable.

## Current problems to fix

### 1. Runtime generation is bounded, not a resident window

The current runtime still queues `world.all_chunk_positions()` during startup generation. That means the world is configured, generated, and loaded as a bounded chunk set. It is not yet a camera-centered streaming world.

This must not be solved by increasing `assets/config/world.yaml` to a huge size. That would increase startup work, memory pressure, meshing pressure, collider work, page export work, and save/load cost. It also would not create a real massive world.

Required change:

```text
replace whole-world generation with player-centered resident streaming
```

### 2. There are two terrain/world-shape authorities

The live voxel runtime uses `src/world/source/world_source.rs` and `assets/config/world_source.yaml` with sea level and island shape logic.

The far-field path uses `src/terrain/generation/world_shape.rs` and `src/terrain/generation/world_shape_far_field.rs`, with a different config model and different default sea level.

That creates a future bug factory: the far shell can show a beach, mountain, ocean, or island that does not match the live voxel chunks when the player reaches it.

Required change:

```text
make one WorldSource authority feed live chunks, CLOD summaries, far shell, biomes, water, cave entrances, and lighting summaries
```

### 3. CLOD pages are the mid ring, not the far ring

Current CLOD config uses `4 x 4` chunks per page, `16m` chunks, and `4` quadtree levels. The coarsest page footprint is around `512m`. That is useful for mid-field terrain, but not enough for `4km` to `8km` island views.

Required change:

```text
finish CLOD pages as a stable mid-distance layer, then add a separate far summary shell beyond them
```

### 4. Ownership is not yet formal enough

Long-distance streaming needs strict draw ownership. A terrain footprint must be owned by exactly one visible layer:

```text
live voxel > CLOD page > far shell
```

There must be no gaps and no double owners. Double owners create z-fighting and overdraw. Gaps create holes and pop.

## Hard invariants

```text
I1. VoxelWorld stays authoritative for gameplay terrain.
I2. Heightfield/far-shell data is derived, never authoritative for caves or edits.
I3. CLOD pages are derived caches, not edit sources.
I4. Far shell is visual/summary only: no colliders, no edits, no gameplay authority.
I5. Live voxel chunks own colliders and real cave interiors.
I6. CLOD pages and live chunks must never draw the same terrain footprint at the same time.
I7. Far shell and CLOD pages must never draw the same terrain footprint at the same time.
I8. One WorldSource authority feeds all terrain rings.
I9. Missing derived data falls back inward: far -> CLOD -> live chunks.
I10. No page or far-shell build runs on the frame hot path.
```

## Target rings

| Ring | Distance target | Data | Collision | Editable | Purpose |
|---|---:|---|---|---|---|
| Live voxel | 0-96m first target, maybe 128-160m later | Voxel chunks + Surface Nets | Yes | Yes | player gameplay, caves, digging, building, physics |
| CLOD pages | ~96m to 1km/1.5km | Decimated meshes derived from live LOD0 chunk exports | No | No | mid-distance terrain continuity |
| Far shell | ~1km/1.5km to 8km | WorldSource analytic samples + cached summaries | No | No | islands, mountains, coast, ocean, biome silhouettes |
| Very far | 8km+ | impostor/proxy/atmosphere | No | No | horizon, sky, large landmass feeling |

These distances are targets, not hard constants. They must live in YAML config and be tuned with benches.

## Proposed config files

### `assets/config/streaming.yaml`

```yaml
streaming:
  enabled: true
  chunk_size: 16
  live_radius_chunks: 8
  collider_radius_chunks: 6
  edit_keepalive_radius_chunks: 10
  unload_hysteresis_chunks: 3
  max_chunk_loads_per_frame: 8
  max_chunk_generations_per_frame: 4
  max_chunk_mesh_commits_per_frame: 6
  max_chunk_evictions_per_frame: 16
  co_op:
    max_players: 2
    union_resident_windows: true
  persistence:
    save_deltas: true
    delta_flush_interval_seconds: 10
    keep_dirty_chunks_resident_until_saved: true
```

### `assets/config/far_shell.yaml`

```yaml
far_shell:
  enabled: true
  inner_radius_m: 1280.0
  outer_radius_m: 8192.0
  clipmap_rings: 4
  grid_size: 129
  update_budget_cells_per_frame: 4096
  height_sample_spacing_m:
    ring0: 16.0
    ring1: 32.0
    ring2: 64.0
    ring3: 128.0
  material:
    near_far_blend_m: 96.0
    triplanar_until_m: 2048.0
    single_projection_after_m: 2048.0
  water:
    ocean_plane_enabled: true
    lake_summary_enabled: true
  debug:
    show_rings: false
    show_owner_map: false
    show_missing_cells: false
```

### `assets/config/terrain_ownership.yaml`

```yaml
terrain_ownership:
  live_priority: 3
  clod_priority: 2
  far_priority: 1
  validate_every_frame_in_debug: true
  fail_on_double_owner_in_debug: true
  fail_on_gap_inside_visible_range: true
```

## Code architecture

### World source unification

Create one authority that can serve all terrain consumers.

Target module layout:

```text
src/world/source/
  mod.rs
  config.rs
  world_source.rs
  surface_sample.rs
  voxel_chunk_source.rs
  far_summary.rs
  biome_source.rs
  cave_field.rs
  water_source.rs
  tests.rs
```

Core types:

```rust
pub struct SurfaceSample {
    pub height: f32,
    pub normal: Vec3,
    pub slope: f32,
    pub material_hint: TerrainMaterialHint,
    pub biome_id: BiomeId,
    pub water: WaterSample,
    pub cave: CaveEntranceSample,
}

pub struct FarSummarySample {
    pub height: f32,
    pub min_height: f32,
    pub max_height: f32,
    pub dominant_material: TerrainMaterialHint,
    pub biome_id: BiomeId,
    pub water_surface_y: Option<f32>,
    pub coast_distance_m: f32,
    pub cave_entrance_mask: f32,
    pub canopy_density: f32,
    pub roughness: f32,
}

pub trait WorldSource {
    fn metadata(&self) -> &WorldSourceMetadata;
    fn sample_surface(&self, x: f32, z: f32) -> SurfaceSample;
    fn sample_far_summary(&self, x: f32, z: f32, footprint_m: f32) -> FarSummarySample;
    fn sample_biome(&self, x: f32, z: f32) -> BiomeId;
    fn sample_water(&self, x: f32, z: f32) -> WaterSample;
    fn sample_cave_entrance(&self, x: f32, z: f32) -> CaveEntranceSample;
    fn generate_voxel_chunk(&self, chunk_pos: IVec3, chunk_size: i32) -> GeneratedVoxelChunk;
}
```

Rules:

- `world_source.yaml` becomes the single config source for island shape, sea level, biome noise, coast, ocean, and cave entrance distribution.
- `world_shape.rs` can be kept temporarily as an adapter, but it must not own separate defaults.
- `world_shape_far_field.rs` must sample `WorldSource::sample_far_summary`, not a separate sampler.
- Sea level must exist in one place only.
- Biome classification must exist in one place only.
- Coast/ocean classification must exist in one place only.

Migration steps:

1. Add `SurfaceSample`, `FarSummarySample`, `WaterSample`, and `CaveEntranceSample` types.
2. Extend `WorldSource` trait with far summary, water, and cave methods.
3. Move or wrap `WorldShapeSampler` logic behind `ProceduralWorldSource`.
4. Replace direct calls to `sample_far_field_terrain` with `WorldSource::sample_far_summary`.
5. Add tests comparing old far-field outputs to new outputs where compatibility is expected.
6. Remove duplicated default sea level from far-field-only config.
7. Add a debug command that samples live chunk terrain and far shell terrain at the same `(x, z)` and logs drift.

Acceptance tests:

```text
cargo test world_source
cargo test far_summary
cargo test cave_entrance
cargo test water_source
```

Required debug counter:

```text
world_source_far_live_height_delta_p95
```

Target:

```text
p95 delta <= 0.5m at CLOD/far seam for terrain that has not been edited
```

## Resident chunk streaming

Replace whole-world startup generation with a resident chunk window.

Target module layout:

```text
src/voxel/runtime/streaming/
  mod.rs
  config.rs
  player_sources.rs
  resident_set.rs
  desired_set.rs
  priority.rs
  load_queue.rs
  generation_queue.rs
  mesh_queue.rs
  eviction.rs
  persistence.rs
  stats.rs
  tests.rs
```

Core state:

```rust
pub enum ChunkResidenceState {
    Missing,
    Requested,
    LoadingFromDisk,
    Generating,
    ResidentUnmeshed,
    ResidentMeshing,
    ResidentVisible,
    EvictionPending,
}

pub struct ResidentChunkSet {
    pub states: HashMap<IVec3, ChunkResidenceState>,
    pub last_touched_frame: HashMap<IVec3, u64>,
}

pub struct DesiredChunkSet {
    pub live_chunks: HashSet<IVec3>,
    pub collider_chunks: HashSet<IVec3>,
    pub keepalive_chunks: HashSet<IVec3>,
}

pub struct ChunkPriority {
    pub chunk_pos: IVec3,
    pub distance_chunks: i32,
    pub player_count: u8,
    pub needs_collider: bool,
    pub has_recent_edit: bool,
    pub priority_score: i32,
}
```

System order:

```text
1. collect_player_chunk_sources_system
2. compute_desired_chunk_set_system
3. enqueue_missing_chunks_system
4. poll_disk_load_tasks_system
5. enqueue_generation_tasks_system
6. poll_generation_tasks_system
7. enqueue_meshing_tasks_system
8. commit_meshes_under_budget_system
9. update_colliders_under_budget_system
10. evict_chunks_outside_hysteresis_system
11. update_streaming_stats_system
```

Two-player co-op rule:

```text
desired live set = union(player_0_window, player_1_window)
priority increases when both players need the same chunk
colliders only required inside each player's collider radius
```

Implementation steps:

1. Add `assets/config/streaming.yaml` and loader.
2. Add `StreamingPlugin` with default-off feature flag until stable.
3. Split current generation startup into two paths:
   - legacy bounded mode for fallback and benches
   - streaming mode for the new architecture
4. Replace `begin_world_generation` behavior in streaming mode so it does not call `world.all_chunk_positions()`.
5. Add `DesiredChunkSet` calculation from player camera/player transforms.
6. Add async disk load before procedural generation.
7. Add procedural chunk generation only for missing chunks not found on disk.
8. Add budgeted mesh/collider commit.
9. Add hysteresis eviction.
10. Add save-delta pinning: dirty chunks cannot evict until their voxel delta is saved.

Do not delete legacy bounded generation until streaming benches pass.

Required tests:

```text
streaming_desired_set_single_player_is_deterministic
streaming_desired_set_two_players_is_union
streaming_eviction_respects_hysteresis
streaming_dirty_chunk_not_evicted_before_save
streaming_priority_orders_near_before_far
```

Required counters:

```text
streaming_resident_chunks
streaming_requested_chunks
streaming_loading_chunks
streaming_generating_chunks
streaming_meshing_chunks
streaming_visible_chunks
streaming_eviction_pending_chunks
streaming_loads_per_frame
streaming_generations_per_frame
streaming_mesh_commits_per_frame
streaming_evictions_per_frame
streaming_missing_visible_chunks
```

Hard acceptance gate:

```text
No visible hole inside live_radius_chunks after stream-ready signal.
No collider missing inside collider_radius_chunks after stream-ready signal.
No frame-path generation of a full configured world in streaming mode.
```

## CLOD pages as mid field

CLOD pages should stay derived from live LOD0 chunk exports.

Target module layout can remain near the existing `src/voxel/pages` path, but ownership and streaming integration should be made explicit:

```text
src/voxel/pages/
  config.rs
  export.rs
  runtime.rs
  source_mesh.rs
  build_queue.rs
  ownership.rs
  selection.rs
  entity_commit.rs
  invalidation.rs
  stats.rs
  tests.rs
```

Required changes:

1. Keep `CLOD_PAGES=1` default-off until ownership and benches pass.
2. Feed CLOD page source exports from streaming resident chunks, not from an assumed complete world.
3. Build LOD0 page source only when all required chunk exports exist.
4. When chunks unload, retain built page meshes if still valid and useful.
5. Dirty voxel edits invalidate owning LOD0 page and all ancestors.
6. Rebuild pages in background only.
7. Missing or stale page falls back inward to live chunks if available.
8. Pages get no colliders.
9. No page may draw inside the live voxel ownership region.

CLOD is not the far solution. Keep it focused:

```text
first goal: stable 1km to 1.5km mid terrain
later goal: tune page size and quadtree depth after benchmarks
```

Required tests:

```text
clod_page_never_draws_inside_live_owner
clod_page_missing_falls_back_to_live_chunks
clod_page_dirty_edit_invalidates_ancestors
clod_page_build_not_on_frame_path
clod_page_source_requires_complete_exports
```

Required counters:

```text
clod_pages_visible
clod_pages_missing
clod_pages_stale
clod_pages_rebuilding
clod_pages_fallback_to_live
clod_pages_double_owner_violations
clod_pages_gap_violations
```

## Far shell

The far shell is a visual shell generated from `WorldSource::sample_far_summary`.

Target module layout:

```text
src/terrain/far_shell/
  mod.rs
  config.rs
  sample.rs
  clipmap.rs
  mesh_builder.rs
  material.rs
  ownership.rs
  streaming.rs
  debug.rs
  stats.rs
  tests.rs
```

Data model:

```rust
pub struct FarShellCell {
    pub world_xz: Vec2,
    pub height: f32,
    pub min_height: f32,
    pub max_height: f32,
    pub normal: Vec3,
    pub dominant_material: TerrainMaterialHint,
    pub biome_id: BiomeId,
    pub water_surface_y: Option<f32>,
    pub coast_distance_m: f32,
    pub cave_entrance_mask: f32,
    pub canopy_density: f32,
    pub roughness: f32,
}

pub struct FarShellRing {
    pub ring_index: u8,
    pub cell_spacing_m: f32,
    pub origin_xz: IVec2,
    pub cells: Vec<FarShellCell>,
    pub revision: u64,
}
```

Rules:

- Far shell starts outside CLOD ownership.
- Far shell samples the same `WorldSource` as live chunks.
- Far shell does not represent caves internally.
- Far shell may show cave entrances as dark masks or landmark openings.
- Far shell never creates colliders.
- Far shell never stores gameplay edits as authority.
- Far shell may consume projected edit summaries for distant visuals.

Implementation steps:

1. Add `assets/config/far_shell.yaml`.
2. Add `FarShellPlugin`, default-off.
3. Build 4 clipmap rings around the camera.
4. Sample `WorldSource::sample_far_summary` into ring cells.
5. Build far shell mesh per ring with skirts or overlap guards.
6. Add simple material path first: material ID color/debug, then terrain atlas/triplanar later.
7. Add water summary support for ocean and large lakes.
8. Add cave entrance mask support for cliff/cave silhouettes.
9. Add far canopy density support for distant forest color/proxy.
10. Add ownership clipping against CLOD pages.
11. Add debug owner map overlay.

Required tests:

```text
far_shell_samples_world_source_only
far_shell_no_cells_inside_clod_owner
far_shell_rebuild_is_deterministic
far_shell_ring_origin_snaps_to_grid
far_shell_cave_mask_does_not_create_collision
```

Required counters:

```text
far_shell_visible_rings
far_shell_cells_sampled_per_frame
far_shell_mesh_rebuilds_per_frame
far_shell_missing_cells
far_shell_clipped_by_clod_cells
far_shell_double_owner_violations
far_shell_gap_violations
```

## Terrain ownership system

Create a single ownership map for visible terrain footprints.

Target module layout:

```text
src/terrain/ownership/
  mod.rs
  config.rs
  footprint.rs
  owner_map.rs
  validation.rs
  debug.rs
  stats.rs
  tests.rs
```

Core types:

```rust
pub enum TerrainOwnerKind {
    LiveVoxel,
    ClodPage,
    FarShell,
}

pub struct TerrainFootprint {
    pub min_x: i32,
    pub min_z: i32,
    pub max_x: i32,
    pub max_z: i32,
    pub cell_size_m: f32,
}

pub struct TerrainOwnerClaim {
    pub owner: TerrainOwnerKind,
    pub footprint: TerrainFootprint,
    pub priority: u8,
    pub revision: u64,
}
```

Rules:

```text
live voxel claims beat CLOD claims
CLOD claims beat far shell claims
higher priority clips lower priority
same-priority overlap is a debug error
visible-range gaps are debug errors unless explicitly ocean-only
```

Implementation steps:

1. Live chunks submit ownership claims each frame.
2. CLOD pages submit ownership claims for selected visible nodes.
3. Far shell submits ownership claims for ring cells/tiles.
4. Ownership resolver clips lower-priority claims.
5. Render systems read resolved claims before drawing.
6. Debug mode renders an owner map.
7. Bench mode records gap and double-owner counters.

Required tests:

```text
ownership_live_beats_clod
ownership_clod_beats_far
ownership_same_priority_overlap_errors
ownership_gap_inside_visible_range_errors
ownership_ocean_gap_can_be_allowed_when_configured
```

## Edit persistence and derived summaries

Actual edits must be stored as voxel deltas or operation logs, not as heightfield edits.

Target module layout:

```text
src/voxel/persistence/
  mod.rs
  chunk_delta.rs
  edit_log.rs
  save_queue.rs
  load_queue.rs
  compaction.rs
  tests.rs

src/terrain/derived_summary/
  mod.rs
  chunk_summary.rs
  page_summary.rs
  far_projection.rs
  invalidation.rs
  tests.rs
```

Rules:

- Digging is voxel delta authority.
- Building placement is prop/building authority, optionally with terrain conformance deltas.
- Far shell receives projected summaries only.
- A tunnel does not become a heightfield trench unless explicitly projected as an entrance/open cut.
- Caves are streamed as voxel volumes near the player.

Implementation steps:

1. Ensure every terrain mutation writes a chunk-local voxel delta.
2. Save deltas before evicting dirty chunks.
3. Add edit-log replay tests.
4. Add summary invalidation for edited chunks.
5. Project top-surface edits into far summaries only when useful.
6. Project cave entrances into far summary masks.
7. Never project full cave interiors into far heightfield.

Required tests:

```text
edit_log_replay_restores_voxel_chunk
edited_dirty_chunk_not_evicted_before_save
far_projection_keeps_tunnel_as_cave_mask_not_heightfield_trench
surface_raise_projects_to_far_summary_height
```

## Caves

Caves should be voxel features, not heightfield features.

Far view behavior:

```text
show cave mouth silhouette
show dark entrance mask
show landmark hint if needed
optionally affect far AO/fog summary
```

Near view behavior:

```text
stream real voxel chunks
enable colliders
render cave interior with normal terrain renderer
use NAADF/summary data for fog, shafts, AO, GI
```

Code tasks:

1. Add `CaveEntranceSample` to `WorldSource`.
2. Add cave entrance masks to `FarSummarySample`.
3. Add deterministic cave-field generation from world seed.
4. Add cave chunk generation to `generate_voxel_chunk`.
5. Add cave streaming priority boost near cave entrances.
6. Add cave shaft/fog hooks later via NAADF summaries.

Required tests:

```text
cave_entrance_sampling_is_deterministic
cave_near_chunks_stream_when_player_approaches
far_shell_cave_mask_matches_live_cave_entrance_position
```

## Biomes

Biomes must stream from the same world source.

Code tasks:

1. Move biome sampling behind `WorldSource::sample_biome`.
2. Use biome ID in live chunk generation.
3. Use biome ID in CLOD page material summaries.
4. Use biome ID in far shell material and canopy summaries.
5. Add biome transition smoothing at all rings.

Required tests:

```text
biome_sample_same_for_live_clod_far
biome_transition_does_not_shift_between_rings
```

## Water and ocean

Water must also come from the same source.

Code tasks:

1. Move sea level into one config path.
2. Add `WorldSource::sample_water`.
3. Live chunks use water source for voxel/water placement.
4. Far shell uses water source for ocean/lake summary.
5. CLOD pages do not own water rendering unless explicitly implemented later.
6. Ocean beyond far terrain can be a separate cheap plane, but it must align with the same sea level.

Required tests:

```text
water_sea_level_single_authority
far_ocean_matches_live_coastline_within_tolerance
far_lake_summary_matches_live_lake_presence
```

## NAADF relationship

NAADF should be a terrain query backend, not the main visible terrain renderer at first.

Use NAADF for:

```text
sun visibility
ambient occlusion
cave shafts
fog occlusion
GI/probe terrain queries
far summary acceleration later
```

Do not block streaming terrain on full NAADF rendering. The order should be:

```text
1. resident chunk streaming
2. world source unification
3. CLOD mid-field ownership
4. far shell
5. NAADF query backend integration for lighting/fog/visibility
```

If NAADF work continues in parallel, it must consume the same `WorldSource`, chunk residency state, and terrain ownership data.

## Bench and validation plan

Add bench scenes:

```text
bench/scenes/streaming-single-player.toml
bench/scenes/streaming-two-player-separated.toml
bench/scenes/clod-midfield-streaming.toml
bench/scenes/far-shell-8km.toml
bench/scenes/cave-entrance-streaming.toml
bench/scenes/ownership-debug.toml
```

Each bench should record:

```text
__frame_total
streaming_resident_chunks
streaming_missing_visible_chunks
clod_pages_visible
clod_pages_fallback_to_live
far_shell_visible_rings
terrain_owner_gap_violations
terrain_owner_double_owner_violations
world_source_far_live_height_delta_p95
```

Manual commands:

```powershell
cargo test world_source
cargo test streaming
cargo test clod_page
cargo test far_shell
cargo test terrain_ownership
cargo run --release -- --bench bench/scenes/streaming-single-player.toml
cargo run --release -- --bench bench/scenes/clod-midfield-streaming.toml
cargo run --release -- --bench bench/scenes/far-shell-8km.toml
cargo run --bin bench_guard -- bench-runs/<run>/summary.json
```

Do not run visual benches from WSL. Use native Windows for visual/perf validation.

## Implementation order

### Phase 1: One world source

Goal:

```text
all live, CLOD, far, biome, cave, and water sampling uses one authority
```

Tasks:

- [ ] Add `SurfaceSample` and `FarSummarySample`.
- [ ] Extend `WorldSource` trait.
- [ ] Route far-field sampling through `WorldSource`.
- [ ] Remove duplicate sea-level defaults from far-only code.
- [ ] Add far/live parity tests.
- [ ] Add debug sampling drift counter.

Exit gate:

```text
far shell samples and live chunk source agree at the seam for unedited terrain
```

### Phase 2: Resident chunk streaming

Goal:

```text
stop generating the whole configured world in streaming mode
```

Tasks:

- [ ] Add `StreamingPlugin`.
- [ ] Add streaming config.
- [ ] Add desired set calculation.
- [ ] Add load/generate/mesh/evict queues.
- [ ] Keep dirty edited chunks until saved.
- [ ] Support two-player union windows.
- [ ] Keep legacy bounded mode as fallback.

Exit gate:

```text
player can move across generated terrain without startup generating the entire world
```

### Phase 3: Ownership resolver

Goal:

```text
exactly one terrain layer owns each visible footprint
```

Tasks:

- [ ] Add terrain ownership module.
- [ ] Live chunks submit claims.
- [ ] CLOD pages submit claims.
- [ ] Far shell submits claims later.
- [ ] Add debug owner map.
- [ ] Add gap/double-owner counters.

Exit gate:

```text
zero double owners and zero visible gaps in debug benches
```

### Phase 4: CLOD as mid field

Goal:

```text
CLOD pages work with streaming chunks and ownership
```

Tasks:

- [ ] Connect CLOD source exports to resident chunks.
- [ ] Retain page meshes after live chunks unload when valid.
- [ ] Invalidate pages on edits.
- [ ] Add fallback to live chunks for missing/stale pages.
- [ ] Prove page builds stay off frame path.

Exit gate:

```text
stable mid-field terrain to 1km/1.5km without expanding live voxel radius
```

### Phase 5: Far shell

Goal:

```text
long-distance islands, ocean, mountains, and biomes to 4km/8km
```

Tasks:

- [ ] Add far shell plugin and config.
- [ ] Add clipmap rings.
- [ ] Sample `WorldSource::sample_far_summary`.
- [ ] Build far mesh rings.
- [ ] Clip far shell by ownership resolver.
- [ ] Add water/ocean summary.
- [ ] Add cave entrance masks.
- [ ] Add far biome/canopy material.

Exit gate:

```text
8km visual horizon without live voxel chunks beyond the near field
```

### Phase 6: Edits and summaries

Goal:

```text
real edits persist as voxel deltas and derived layers update safely
```

Tasks:

- [ ] Save voxel edit deltas before eviction.
- [ ] Replay deltas after reload.
- [ ] Invalidate CLOD pages on edited chunks.
- [ ] Project surface edits to far summaries.
- [ ] Project cave entrances to far masks.
- [ ] Do not project cave interiors to heightfield.

Exit gate:

```text
editing near terrain updates live chunks immediately and derived layers eventually, with no lost edits
```

### Phase 7: NAADF query integration

Goal:

```text
better lighting/fog/visibility over the streamed terrain stack
```

Tasks:

- [ ] Feed NAADF from resident voxel chunks.
- [ ] Feed far summaries into NAADF far clipmap summaries.
- [ ] Use NAADF for sun visibility.
- [ ] Use NAADF for fog/cave shafts.
- [ ] Use NAADF for AO/GI terrain queries.

Exit gate:

```text
lighting/fog improves without replacing the visible terrain renderer
```

## Definition of done

This architecture is done when:

```text
1. Streaming mode no longer queues all configured world chunks at startup.
2. WorldSource is the only terrain shape authority.
3. Live chunks, CLOD pages, and far shell use one ownership resolver.
4. Live voxel chunks own gameplay and caves near players.
5. CLOD pages provide stable mid-distance terrain.
6. Far shell provides 4km/8km views without live voxel radius expansion.
7. Edits persist as voxel deltas.
8. Derived summaries rebuild in the background.
9. Debug counters show zero double-owner violations and zero visible ownership gaps.
10. Native Windows benches prove frame time and streaming stability.
```

## Blunt risk assessment

The main risk is not that voxels are too slow. The main risk is accidentally keeping three terrain systems alive that disagree with each other.

The second risk is trying to solve distance by increasing live chunk radius. That will fail.

The third risk is making the far shell too smart. It should be cheap, derived, and visual. Caves and gameplay stay voxel.

The correct next engineering move is:

```text
unify WorldSource first, then build resident chunk streaming, then finish ownership-aware CLOD, then add far shell
```
