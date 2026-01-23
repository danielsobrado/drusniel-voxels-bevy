pub mod billboard;
pub mod decimation;
pub mod foliage;
pub mod instancing;
pub mod loader;
pub mod materials;
pub mod merging;
pub mod persistence;
pub mod placement;
pub mod spawner;

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    PROP_CHUNK_VISIBILITY_UPDATE_INTERVAL, PROP_VIEW_DISTANCE_BASE,
    PROP_VIEW_DISTANCE_BUSH_MULT, PROP_VIEW_DISTANCE_FLOWER_MULT,
    PROP_VIEW_DISTANCE_HYSTERESIS, PROP_VIEW_DISTANCE_ROCK_MULT, PROP_VIEW_DISTANCE_TREE_MULT,
};
use crate::performance::{AreaTimingRecorder, area_timer};
use persistence::{
    delete_all_props, save_chunk_and_update_manifest, PropEditState, PropPersistenceState,
};
use placement::TerrainAnalyzer;

pub struct PropsPlugin;

impl Plugin for PropsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PropAssets>()
            .init_resource::<PropConfig>()
            .init_resource::<spawner::PropsSpawned>()
            .init_resource::<spawner::PropsDebugSpawned>()
            .init_resource::<spawner::PropsLandmarksSpawned>()
            .init_resource::<LandmarkLocations>()
            .init_resource::<foliage::FoliageFadeSettings>()
            .init_resource::<foliage::FoliageSpatialIndex>()
            .init_resource::<foliage::FoliageFadeActive>()
            .init_resource::<foliage::FoliageFadeCandidates>()
            .init_resource::<foliage::GrassPropWindSettings>()
            .init_resource::<foliage::GrassPropWindActive>()
            // Persistence resources
            .init_resource::<PropPersistenceState>()
            .init_resource::<PropEditState>()
            // Culling resources
            .init_resource::<PropViewDistanceConfig>()
            .init_resource::<PropChunkCullState>()
            // Merging resources
            .init_resource::<merging::PropMergeState>()
            // Instancing resources
            .init_resource::<instancing::PropMeshCache>()
            .init_resource::<instancing::InstancingStats>()
            // Billboard LOD resources
            .init_resource::<billboard::BillboardLodSettings>()
            .init_resource::<billboard::BillboardCache>()
            .init_resource::<billboard::BillboardStats>()
            // Mesh decimation resources
            .init_resource::<decimation::PropDecimationConfig>()
            .init_resource::<decimation::DecimatedMeshCache>()
            .init_resource::<decimation::DecimationStats>()
            .init_resource::<decimation::MeshLodDistances>()
            .add_message::<RegenerateDirtyChunksEvent>()
            .add_message::<ClearPropCacheEvent>()
            .add_systems(Startup, (loader::load_prop_config, billboard::initialize_billboard_cache))
            .add_systems(
                Update,
                (
                    loader::track_asset_loading,
                    // Mesh extraction must run before spawning so cache is ready
                    instancing::extract_prop_meshes,
                    spawner::spawn_props_on_terrain,
                    spawner::spawn_debug_custom_props_near_player,
                    spawner::spawn_landmark_buildings,
                    materials::apply_style_overrides,
                )
                    .chain(),
            )
            .add_systems(
                Update,
                (
                    foliage::index_foliage_fade_entities
                        .after(materials::apply_style_overrides),
                    foliage::index_grass_prop_wind_entities
                        .after(materials::apply_style_overrides),
                    foliage::update_foliage_fade
                        .after(foliage::index_foliage_fade_entities),
                    foliage::update_grass_prop_wind
                        .after(foliage::index_grass_prop_wind_entities),
                ),
            )
            // Persistence systems
            .add_systems(
                Update,
                (
                    regenerate_dirty_chunks,
                    handle_clear_prop_cache,
                ),
            )
            // Culling system
            .add_systems(
                Update,
                update_prop_chunk_visibility.after(spawner::spawn_props_on_terrain),
            )
            // Billboard LOD systems
            .add_systems(
                Update,
                (
                    billboard::update_billboard_lod
                        .after(update_prop_chunk_visibility),
                    billboard::sync_billboard_time,
                ),
            )
            // Mesh decimation system (runs once after extraction)
            .add_systems(
                Update,
                decimation::create_decimated_meshes
                    .after(instancing::extract_prop_meshes),
            )
            // Merging systems (run after spawning and materials)
            .add_systems(
                Update,
                (
                    merging::mark_merge_candidates
                        .after(materials::apply_style_overrides),
                    merging::check_scene_ready
                        .after(merging::mark_merge_candidates),
                    merging::process_chunk_merges
                        .after(merging::check_scene_ready),
                    merging::cleanup_merged_meshes,
                ),
            )
;
    }
}

/// Marker component for prop entities
#[derive(Component)]
pub struct Prop {
    pub id: String,
    pub prop_type: PropType,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum PropType {
    Tree,
    Rock,
    Bush,
    Flower,
}

impl PropType {
    /// Get the view distance multiplier for this prop type.
    pub fn view_distance_multiplier(&self) -> f32 {
        match self {
            PropType::Tree => PROP_VIEW_DISTANCE_TREE_MULT,
            PropType::Rock => PROP_VIEW_DISTANCE_ROCK_MULT,
            PropType::Bush => PROP_VIEW_DISTANCE_BUSH_MULT,
            PropType::Flower => PROP_VIEW_DISTANCE_FLOWER_MULT,
        }
    }
}

// =============================================================================
// Prop Chunk Culling
// =============================================================================

/// Configuration for prop view distance culling.
#[derive(Resource)]
pub struct PropViewDistanceConfig {
    pub base_distance: f32,
    pub tree_mult: f32,
    pub rock_mult: f32,
    pub bush_mult: f32,
    pub flower_mult: f32,
    pub hysteresis: f32,
    pub update_interval: f32,
}

impl Default for PropViewDistanceConfig {
    fn default() -> Self {
        Self {
            base_distance: PROP_VIEW_DISTANCE_BASE,
            tree_mult: PROP_VIEW_DISTANCE_TREE_MULT,
            rock_mult: PROP_VIEW_DISTANCE_ROCK_MULT,
            bush_mult: PROP_VIEW_DISTANCE_BUSH_MULT,
            flower_mult: PROP_VIEW_DISTANCE_FLOWER_MULT,
            hysteresis: PROP_VIEW_DISTANCE_HYSTERESIS,
            update_interval: PROP_CHUNK_VISIBILITY_UPDATE_INTERVAL,
        }
    }
}

/// State tracking for prop chunk visibility culling.
#[derive(Resource)]
pub struct PropChunkCullState {
    /// Chunks that are currently visible (have visible entities).
    pub visible_chunks: HashSet<IVec2>,
    /// Last known camera chunk position (for change detection).
    pub last_camera_chunk: IVec2,
    /// Timer for update throttling.
    pub update_timer: f32,
    /// Number of props culled this frame (for debug display).
    pub culled_count: usize,
    /// Number of props visible this frame (for debug display).
    pub visible_count: usize,
}

impl Default for PropChunkCullState {
    fn default() -> Self {
        Self {
            visible_chunks: HashSet::new(),
            last_camera_chunk: IVec2::new(i32::MIN, i32::MIN),
            update_timer: 0.0,
            culled_count: 0,
            visible_count: 0,
        }
    }
}

/// Cached scene handles for all props
#[derive(Resource, Default)]
pub struct PropAssets {
    pub scenes: HashMap<String, Handle<Scene>>,
    pub loaded: bool,
}

/// Cached landmark building positions for minimap markers.
#[derive(Resource, Default, Clone)]
pub struct LandmarkLocations {
    pub positions: Vec<Vec3>,
}

/// Root configuration loaded from YAML
#[derive(Resource, Default, Deserialize, Clone)]
pub struct PropConfig {
    #[serde(default)]
    pub props: PropCategories,
    #[serde(default)]
    pub style: StyleConfig,
    #[serde(default)]
    pub persistence: PersistenceConfig,
}

/// Configuration for prop persistence
#[derive(Deserialize, Clone, Debug)]
pub struct PersistenceConfig {
    /// Whether persistence is enabled
    #[serde(default = "default_persistence_enabled")]
    pub enabled: bool,
    /// Directory for save files
    #[serde(default = "default_save_directory")]
    pub save_directory: String,
    /// Whether to use pretty-printed JSON
    #[serde(default = "default_pretty_json")]
    pub pretty_json: bool,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            save_directory: "saves/props".to_string(),
            pretty_json: true,
        }
    }
}

fn default_persistence_enabled() -> bool {
    true
}

fn default_save_directory() -> String {
    "saves/props".to_string()
}

fn default_pretty_json() -> bool {
    true
}

#[derive(Default, Deserialize, Clone)]
pub struct PropCategories {
    #[serde(default)]
    pub trees: Vec<PropDefinition>,
    #[serde(default)]
    pub rocks: Vec<PropDefinition>,
    #[serde(default)]
    pub bushes: Vec<PropDefinition>,
    #[serde(default)]
    pub flowers: Vec<PropDefinition>,
}

#[derive(Deserialize, Clone)]
pub struct PropDefinition {
    pub id: String,
    pub path: String,
    #[serde(default = "default_scale_range")]
    pub scale_range: [f32; 2],
    #[serde(default = "default_scale_jitter")]
    pub scale_jitter: f32,
    #[serde(default)]
    pub y_offset: f32,
    #[serde(default)]
    pub spawn_on: Vec<String>,
    #[serde(default = "default_density")]
    pub density: f32,
    #[serde(default)]
    pub min_slope: f32,
    #[serde(default = "default_max_slope")]
    pub max_slope: f32,
    #[serde(default)]
    pub max_count: Option<u32>,
}

fn default_scale_range() -> [f32; 2] {
    [0.8, 1.2]
}

fn default_scale_jitter() -> f32 {
    0.0
}

fn default_density() -> f32 {
    0.01
}

fn default_max_slope() -> f32 {
    0.5
}

#[derive(Deserialize, Clone)]
pub struct StyleConfig {
    #[serde(default = "default_saturation_boost")]
    pub saturation_boost: f32,
    #[serde(default = "default_roughness_min")]
    pub roughness_min: f32,
    #[serde(default = "default_metallic_max")]
    pub metallic_max: f32,
    #[serde(default = "default_foliage_brightness_max")]
    pub foliage_brightness_max: f32,
    #[serde(default = "default_rock_tint")]
    pub rock_tint: [f32; 3],
    #[serde(default)]
    pub custom: CustomStyleConfig,
}

impl Default for StyleConfig {
    fn default() -> Self {
        Self {
            saturation_boost: 0.1,
            roughness_min: 0.7,
            metallic_max: 0.1,
            foliage_brightness_max: 0.7,
            rock_tint: default_rock_tint(),
            custom: CustomStyleConfig::default(),
        }
    }
}

fn default_saturation_boost() -> f32 {
    0.1
}

fn default_roughness_min() -> f32 {
    0.7
}

fn default_metallic_max() -> f32 {
    0.1
}

fn default_foliage_brightness_max() -> f32 {
    0.7
}

fn default_rock_tint() -> [f32; 3] {
    [0.45, 0.43, 0.4]
}

#[derive(Deserialize, Clone)]
pub struct CustomStyleConfig {
    #[serde(default = "default_custom_saturation_boost")]
    pub saturation_boost: f32,
    #[serde(default = "default_custom_brightness_boost")]
    pub brightness_boost: f32,
    #[serde(default = "default_custom_roughness_min")]
    pub roughness_min: f32,
    #[serde(default = "default_custom_metallic_max")]
    pub metallic_max: f32,
    #[serde(default = "default_custom_disable_normal_maps")]
    pub disable_normal_maps: bool,
    #[serde(default = "default_custom_disable_occlusion_maps")]
    pub disable_occlusion_maps: bool,
}

impl Default for CustomStyleConfig {
    fn default() -> Self {
        Self {
            saturation_boost: 0.15,
            brightness_boost: 0.05,
            roughness_min: 0.85,
            metallic_max: 0.0,
            disable_normal_maps: true,
            disable_occlusion_maps: true,
        }
    }
}

fn default_custom_saturation_boost() -> f32 {
    0.15
}

fn default_custom_brightness_boost() -> f32 {
    0.05
}

fn default_custom_roughness_min() -> f32 {
    0.85
}

fn default_custom_metallic_max() -> f32 {
    0.0
}

fn default_custom_disable_normal_maps() -> bool {
    true
}

fn default_custom_disable_occlusion_maps() -> bool {
    true
}

// Messages for prop persistence

/// Message to trigger regeneration of dirty chunks
#[derive(bevy::ecs::message::Message)]
pub struct RegenerateDirtyChunksEvent;

/// Message to clear all persisted prop data
#[derive(bevy::ecs::message::Message)]
pub struct ClearPropCacheEvent;

/// System to regenerate props in dirty chunks
fn regenerate_dirty_chunks(
    mut commands: Commands,
    mut events: MessageReader<RegenerateDirtyChunksEvent>,
    mut state: ResMut<PropPersistenceState>,
    mut edit_state: ResMut<PropEditState>,
    world: Res<crate::voxel::world::VoxelWorld>,
    config: Res<PropConfig>,
    assets: Res<PropAssets>,
    mesh_cache: Res<instancing::PropMeshCache>,
    mut instancing_stats: ResMut<instancing::InstancingStats>,
) {
    // Check if we have any events
    if events.read().next().is_none() {
        return;
    }

    if !assets.loaded {
        return;
    }

    // Merge terrain-modified chunks into dirty set
    for chunk_pos in edit_state.terrain_modified_chunks.drain() {
        state.mark_dirty_with_neighbors(chunk_pos);
    }

    if state.dirty_chunks.is_empty() {
        return;
    }

    let dirty: Vec<IVec2> = state.take_dirty_chunks();
    info!("Regenerating {} dirty prop chunks", dirty.len());

    let generator = crate::voxel::terrain::TerrainGenerator::<crate::voxel::terrain::ValueNoise>::default();
    let placement_config = placement::PlacementConfig::default();

    for chunk_pos in dirty {
        // Despawn existing props in this chunk
        if let Some(entities) = state.loaded_chunks.remove(&chunk_pos) {
            for entity in entities {
                commands.entity(entity).despawn();
            }
        }

        // Regenerate props for this chunk
        let props = regenerate_chunk_props(
            chunk_pos,
            &world,
            &generator,
            &config,
            &placement_config,
        );

        // Save to disk
        if let Some(ref mut manifest) = state.manifest {
            if let Err(e) = save_chunk_and_update_manifest(chunk_pos, &props, manifest) {
                warn!("Failed to save regenerated chunk {:?}: {}", chunk_pos, e);
            }
        }

        // Spawn new entities
        let entities = spawn_props_from_placement_data(
            &mut commands,
            &props,
            &assets,
            &mesh_cache,
            &mut instancing_stats,
            chunk_pos,
        );
        state.loaded_chunks.insert(chunk_pos, entities);
        state.chunk_prop_data.insert(chunk_pos, props);
    }
}

/// Regenerate props for a chunk (used by dirty chunk system)
fn regenerate_chunk_props(
    chunk_pos: IVec2,
    world: &crate::voxel::world::VoxelWorld,
    _generator: &crate::voxel::terrain::TerrainGenerator<crate::voxel::terrain::ValueNoise>,
    config: &PropConfig,
    placement_config: &placement::PlacementConfig,
) -> Vec<persistence::PropPlacementData> {
    use crate::constants::WATER_LEVEL;

    const PROP_CHUNK_SIZE: i32 = 64;
    const WORLD_SCAN_SIZE: i32 = 512;
    const DEFAULT_MAX_PER_TYPE: u32 = 500;

    let mut props = Vec::new();
    let analyzer = TerrainAnalyzer::new(world);

    let chunk_min_x = chunk_pos.x * PROP_CHUNK_SIZE;
    let chunk_min_z = chunk_pos.y * PROP_CHUNK_SIZE;
    let chunk_max_x = (chunk_min_x + PROP_CHUNK_SIZE).min(WORLD_SCAN_SIZE);
    let chunk_max_z = (chunk_min_z + PROP_CHUNK_SIZE).min(WORLD_SCAN_SIZE);

    let mut counts: HashMap<String, u32> = HashMap::new();

    // Helper to check spawn conditions
    let mut try_spawn = |def: &PropDefinition, prop_type: PropType, x: i32, z: i32| -> Option<persistence::PropPlacementData> {
        let count = counts.get(&def.id).copied().unwrap_or(0);
        let max_count = def.max_count.unwrap_or(DEFAULT_MAX_PER_TYPE);
        if count >= max_count {
            return None;
        }

        let hash = deterministic_hash(x, z, &def.id);
        let offset_x = fract(hash * 17.0) - 0.5;
        let offset_z = fract(hash * 23.0) - 0.5;
        let world_xf = x as f32 + 0.5 + offset_x * 0.8;
        let world_zf = z as f32 + 0.5 + offset_z * 0.8;

        let footprint = match prop_type {
            PropType::Tree => bevy::math::Vec2::new(1.5, 1.5),
            PropType::Rock => bevy::math::Vec2::new(1.0, 1.0),
            PropType::Bush => bevy::math::Vec2::new(0.8, 0.8),
            PropType::Flower => bevy::math::Vec2::new(0.4, 0.4),
        };

        let sample_result = analyzer.multi_sample_placement(
            world_xf,
            world_zf,
            footprint.x * placement_config.footprint_scale,
            footprint.y * placement_config.footprint_scale,
        )?;

        if sample_result.position.y <= WATER_LEVEL as f32 {
            return None;
        }

        if !can_spawn_on(sample_result.voxel_type, &def.spawn_on) {
            return None;
        }

        let slope = sample_result.normal.y.acos();
        if slope < def.min_slope || slope > def.max_slope {
            return None;
        }

        if sample_result.height_variance > placement_config.max_height_variance {
            return None;
        }

        let placement_seed = hash_to_seed(x, z, &def.id);
        let scale = lerp(def.scale_range[0], def.scale_range[1], fract(hash * 7.0));
        let yaw = fract(hash * 13.0) * std::f32::consts::TAU;

        let slope_strength = match prop_type {
            PropType::Tree => 0.0,
            PropType::Rock => 0.7,
            PropType::Bush => 0.3,
            PropType::Flower => 0.2,
        };

        let tilt_x = (placement::seeded_random(placement_seed, 1) - 0.5) * placement_config.max_random_tilt.to_radians();
        let tilt_z = (placement::seeded_random(placement_seed, 2) - 0.5) * placement_config.max_random_tilt.to_radians();

        let rotation = placement::calculate_prop_rotation(
            sample_result.normal,
            slope_strength,
            yaw,
            tilt_x,
            tilt_z,
        );

        let sink = scale * 0.15; // Default sink factor
        let position = Vec3::new(
            sample_result.position.x,
            // Removed arbitrary max(y-0.4) clamp that prevented proper sinking
            sample_result.position.y + def.y_offset - sink,
            sample_result.position.z,
        );

        let mut placement = persistence::PropPlacementData::new(
            def.id.clone(),
            prop_type,
            position,
            placement::quat_to_euler_degrees(rotation),
            Vec3::splat(scale),
            placement_seed,
        );
        placement.ground_contact = persistence::GroundContactData::new(
            sample_result.voxel_type,
            sample_result.normal.y.acos().to_degrees(),
            sample_result.normal,
        );
        placement.validated = true;

        *counts.entry(def.id.clone()).or_insert(0) += 1;
        Some(placement)
    };

    // Process each position in the chunk
    for x in chunk_min_x..chunk_max_x {
        for z in chunk_min_z..chunk_max_z {
            // Check each category
            for def in &config.props.trees {
                let hash = deterministic_hash(x, z, &def.id);
                if hash <= def.density {
                    if let Some(p) = try_spawn(def, PropType::Tree, x, z) {
                        props.push(p);
                    }
                }
            }
            for def in &config.props.rocks {
                let hash = deterministic_hash(x, z, &def.id);
                if hash <= def.density {
                    if let Some(p) = try_spawn(def, PropType::Rock, x, z) {
                        props.push(p);
                    }
                }
            }
            for def in &config.props.bushes {
                let hash = deterministic_hash(x, z, &def.id);
                if hash <= def.density {
                    if let Some(p) = try_spawn(def, PropType::Bush, x, z) {
                        props.push(p);
                    }
                }
            }
            for def in &config.props.flowers {
                let hash = deterministic_hash(x, z, &def.id);
                if hash <= def.density {
                    if let Some(p) = try_spawn(def, PropType::Flower, x, z) {
                        props.push(p);
                    }
                }
            }
        }
    }

    props
}

/// Spawn entities from placement data.
/// Uses instanced rendering when the mesh cache is ready, otherwise falls back to SceneRoot.
fn spawn_props_from_placement_data(
    commands: &mut Commands,
    props: &[persistence::PropPlacementData],
    assets: &PropAssets,
    mesh_cache: &instancing::PropMeshCache,
    stats: &mut instancing::InstancingStats,
    chunk_pos: IVec2,
) -> Vec<Entity> {
    props
        .iter()
        .filter_map(|prop| {
            let transform = prop.to_transform();
            let prop_type: PropType = prop.prop_type.into();

            // Try instanced spawning first (uses cached mesh handles for GPU batching)
            if let Some(entity) = instancing::spawn_instanced_prop(
                commands,
                mesh_cache,
                &prop.id,
                transform.clone(),
                prop_type,
            ) {
                // Add common components
                commands.entity(entity).insert((
                    Prop {
                        id: prop.id.clone(),
                        prop_type,
                    },
                    persistence::PersistedProp {
                        chunk_pos,
                        placement_seed: prop.placement_seed,
                    },
                ));

                if prop_type == PropType::Bush && prop.id.to_lowercase().contains("grass") {
                    let hash = (prop.placement_seed as f32) / (u64::MAX as f32);
                    commands.entity(entity).insert(foliage::GrassPropWind::new(&transform, hash));
                }

                stats.instanced_spawns += 1;
                return Some(entity);
            }

            // Fallback to SceneRoot spawning
            let scene_handle = assets.scenes.get(&prop.id)?;

            let mut entity = commands.spawn((
                SceneRoot(scene_handle.clone()),
                transform.clone(),
                Prop {
                    id: prop.id.clone(),
                    prop_type,
                },
                persistence::PersistedProp {
                    chunk_pos,
                    placement_seed: prop.placement_seed,
                },
            ));

            if prop_type == PropType::Bush && prop.id.to_lowercase().contains("grass") {
                let hash = (prop.placement_seed as f32) / (u64::MAX as f32);
                entity.insert(foliage::GrassPropWind::new(&transform, hash));
            }

            stats.scene_spawns += 1;
            Some(entity.id())
        })
        .collect()
}

/// Handle clearing the prop cache
fn handle_clear_prop_cache(
    mut events: MessageReader<ClearPropCacheEvent>,
    mut state: ResMut<PropPersistenceState>,
    mut spawned: ResMut<spawner::PropsSpawned>,
) {
    if events.read().next().is_none() {
        return;
    }

    info!("Clearing prop cache...");

    if let Err(e) = delete_all_props() {
        warn!("Failed to delete prop cache: {}", e);
        return;
    }

    // Reset state to trigger regeneration
    state.manifest = None;
    state.loaded_chunks.clear();
    state.chunk_prop_data.clear();
    state.dirty_chunks.clear();
    spawned.0 = false;

    info!("Prop cache cleared. Props will regenerate on next frame.");
}

// =============================================================================
// Prop Chunk Visibility Culling System
// =============================================================================

/// Size of a "prop chunk" for culling purposes (matches persistence chunk size).
const PROP_CHUNK_SIZE_CULL: f32 = 64.0;

/// Update prop visibility based on camera distance.
/// Props beyond their type's view distance are hidden to reduce draw calls.
fn update_prop_chunk_visibility(
    time: Res<Time>,
    config: Res<PropViewDistanceConfig>,
    mut cull_state: ResMut<PropChunkCullState>,
    persistence_state: Res<PropPersistenceState>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut prop_query: Query<(&Prop, &GlobalTransform, &mut Visibility, &persistence::PersistedProp)>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Prop Culling");
    // Throttle updates
    cull_state.update_timer += time.delta_secs();
    if cull_state.update_timer < config.update_interval {
        return;
    }
    cull_state.update_timer = 0.0;

    // Get camera position
    let camera_pos = match camera_query.iter().next() {
        Some(transform) => transform.translation(),
        None => return,
    };
    let camera_pos_2d = Vec2::new(camera_pos.x, camera_pos.z);

    // Calculate current camera chunk
    let camera_chunk = IVec2::new(
        (camera_pos.x / PROP_CHUNK_SIZE_CULL).floor() as i32,
        (camera_pos.z / PROP_CHUNK_SIZE_CULL).floor() as i32,
    );

    // Determine which chunks should be visible based on max view distance
    let max_view_dist = config.base_distance * config.tree_mult; // Trees have furthest view
    let chunk_radius = ((max_view_dist / PROP_CHUNK_SIZE_CULL).ceil() as i32) + 1;

    let mut new_visible_chunks = HashSet::new();
    for dx in -chunk_radius..=chunk_radius {
        for dz in -chunk_radius..=chunk_radius {
            let chunk = IVec2::new(camera_chunk.x + dx, camera_chunk.y + dz);
            // Check if this chunk has any loaded props
            if persistence_state.loaded_chunks.contains_key(&chunk) {
                // Calculate chunk center distance
                let chunk_center = Vec2::new(
                    (chunk.x as f32 + 0.5) * PROP_CHUNK_SIZE_CULL,
                    (chunk.y as f32 + 0.5) * PROP_CHUNK_SIZE_CULL,
                );
                let dist = camera_pos_2d.distance(chunk_center);

                // Use hysteresis: if already visible, use larger threshold to hide
                let threshold = if cull_state.visible_chunks.contains(&chunk) {
                    max_view_dist + config.hysteresis
                } else {
                    max_view_dist
                };

                if dist <= threshold {
                    new_visible_chunks.insert(chunk);
                }
            }
        }
    }

    // Now update individual prop visibility based on their type-specific distances
    let mut visible_count = 0usize;
    let mut culled_count = 0usize;

    for (prop, transform, mut visibility, persisted) in prop_query.iter_mut() {
        let prop_pos = transform.translation();
        let prop_pos_2d = Vec2::new(prop_pos.x, prop_pos.z);
        let dist = camera_pos_2d.distance(prop_pos_2d);

        // Get type-specific view distance
        let type_mult = prop.prop_type.view_distance_multiplier();
        let view_dist = config.base_distance * type_mult;

        // Check if chunk is in potentially visible set
        let chunk_visible = new_visible_chunks.contains(&persisted.chunk_pos);

        // Determine if this specific prop should be visible
        // Use hysteresis based on current visibility state
        let currently_visible = *visibility != Visibility::Hidden;
        let threshold = if currently_visible {
            view_dist + config.hysteresis
        } else {
            view_dist
        };

        let should_be_visible = chunk_visible && dist <= threshold;

        if should_be_visible {
            if *visibility == Visibility::Hidden {
                *visibility = Visibility::Inherited;
            }
            visible_count += 1;
        } else {
            if *visibility != Visibility::Hidden {
                *visibility = Visibility::Hidden;
            }
            culled_count += 1;
        }
    }

    // Update state
    cull_state.visible_chunks = new_visible_chunks;
    cull_state.last_camera_chunk = camera_chunk;
    cull_state.visible_count = visible_count;
    cull_state.culled_count = culled_count;
}

// Helper functions for regeneration

fn deterministic_hash(x: i32, z: i32, id: &str) -> f32 {
    let id_hash: i32 = id.bytes().fold(0i32, |acc, b| acc.wrapping_add(b as i32));
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263))
        .wrapping_add(id_hash.wrapping_mul(1274126177));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    let n = n ^ (n >> 16);
    (n as u32 as f32) / (u32::MAX as f32)
}

fn hash_to_seed(x: i32, z: i32, id: &str) -> u64 {
    let id_hash: i32 = id.bytes().fold(0i32, |acc, b| acc.wrapping_add(b as i32));
    let n = (x as i64)
        .wrapping_mul(374761393)
        .wrapping_add((z as i64).wrapping_mul(668265263))
        .wrapping_add((id_hash as i64).wrapping_mul(1274126177));
    n as u64
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn fract(x: f32) -> f32 {
    x - x.floor()
}

fn can_spawn_on(voxel: crate::voxel::types::VoxelType, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true;
    }
    let voxel_name = format!("{:?}", voxel);
    allowed.iter().any(|a| a.eq_ignore_ascii_case(&voxel_name))
}
