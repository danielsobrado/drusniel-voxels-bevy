use super::instancing::{PropMeshCache, spawn_instanced_prop, InstancingStats};
use super::persistence::{
    GroundContactData, PersistedProp, PropManifest, PropPersistenceState, PropPlacementData,
};
use super::placement::{
    calculate_prop_rotation, quat_to_euler_degrees, seeded_random, PlacementConfig,
    TerrainAnalyzer,
};
use super::{
    foliage::GrassPropWind, LandmarkLocations, Prop, PropAssets, PropConfig, PropDefinition,
    PropType,
};
use bevy::diagnostic::FrameCount;
use crate::constants::{CHUNK_SIZE_I32, WATER_LEVEL};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::player::Player;
use crate::props::persistence::{
    load_chunk_props_if_exists, load_manifest, save_chunk_and_update_manifest, save_manifest,
    saved_props_exist,
};
use crate::voxel::terrain::{Biome, TerrainGenerator, ValueNoise};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

const DEFAULT_MAX_PER_TYPE: u32 = 500;
const WORLD_SCAN_SIZE: i32 = 512;
const MAX_SCAN_HEIGHT: i32 = 64;
const TREE_CELL_SIZE: i32 = 10;
const ROCK_REGION_CELL_SIZE: i32 = 48;
const ROCK_CLUSTER_CELL_SIZE: i32 = 64;
const BUSH_CLUSTER_CELL_SIZE: i32 = 36;
const ROCK_CLUSTER_THRESHOLD: f32 = 0.4;
const BUSH_CLUSTER_THRESHOLD: f32 = 0.35;
const ROCK_CLUSTER_BASE: f32 = 0.25;
const ROCK_CLUSTER_PEAK: f32 = 2.6;
const BUSH_CLUSTER_BASE: f32 = 0.4;
const BUSH_CLUSTER_PEAK: f32 = 1.8;
const MAX_BUILDING_SLOPE: f32 = 0.45;
const BUILDING_SEARCH_RADIUS: i32 = 20;

/// Size of a "prop chunk" in world units (for persistence)
const PROP_CHUNK_SIZE: i32 = 64;

#[derive(Resource, Default)]
pub struct PropsSpawned(pub bool);

#[derive(Resource, Default)]
pub struct PropsDebugSpawned(pub bool);

#[derive(Resource, Default)]
pub struct PropsLandmarksSpawned(pub bool);

/// Spawn props on terrain based on configuration.
/// Uses persistence: loads from disk if available, otherwise generates and saves.
/// When mesh cache is ready, uses GPU instancing for better performance.
pub fn spawn_props_on_terrain(
    mut commands: Commands,
    prop_assets: Res<PropAssets>,
    config: Res<PropConfig>,
    world: Res<VoxelWorld>,
    mut spawned: ResMut<PropsSpawned>,
    mut persistence_state: ResMut<PropPersistenceState>,
    mesh_cache: Res<PropMeshCache>,
    mut instancing_stats: ResMut<InstancingStats>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Prop Spawn");
    if spawned.0 || !prop_assets.loaded {
        return;
    }

    // Wait for world to be populated
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    // Wait for mesh cache to be ready when instancing is enabled
    // This ensures GLTF mesh extraction completes before spawning
    if mesh_cache.enabled && !mesh_cache.is_ready() {
        // Log progress occasionally
        if frame.0 % 60 == 0 {
            info!(
                "Waiting for mesh cache: {} pending GLTFs, {} cached",
                mesh_cache.pending_gltfs.len(),
                mesh_cache.meshes.len()
            );
        }
        return;
    }

    spawned.0 = true;

    // Try to load manifest or create new one
    let manifest = if saved_props_exist() {
        match load_manifest() {
            Ok(m) => {
                info!("Loaded existing prop manifest");
                m
            }
            Err(e) => {
                warn!("Failed to load prop manifest: {}, regenerating props", e);
                PropManifest::new(0)
            }
        }
    } else {
        info!("No saved props found, will generate new placements");
        PropManifest::new(0)
    };
    persistence_state.manifest = Some(manifest);

    let generator = TerrainGenerator::<ValueNoise>::default();
    let placement_config = PlacementConfig::default();

    let mut total = 0u32;
    let start_time = std::time::Instant::now();

    // Check if instancing is ready
    let use_instancing = mesh_cache.is_ready();
    if use_instancing {
        info!("Using GPU instancing for prop spawning ({} cached types)", mesh_cache.meshes.len());
    } else {
        info!("Mesh cache not ready, using SceneRoot spawning (instancing will be used after cache is ready)");
    }

    // Calculate how many prop chunks cover the world
    let num_chunks_x = (WORLD_SCAN_SIZE + PROP_CHUNK_SIZE - 1) / PROP_CHUNK_SIZE;
    let num_chunks_z = (WORLD_SCAN_SIZE + PROP_CHUNK_SIZE - 1) / PROP_CHUNK_SIZE;

    // Process each prop chunk
    for chunk_x in 0..num_chunks_x {
        for chunk_z in 0..num_chunks_z {
            let chunk_pos = IVec2::new(chunk_x, chunk_z);

            // Try to load from persistence
            if let Some(props) = load_chunk_props_if_exists(chunk_pos) {
                let entities = spawn_props_from_data(
                    &mut commands,
                    &props,
                    &prop_assets,
                    &mesh_cache,
                    &mut instancing_stats,
                    chunk_pos,
                );
                total += entities.len() as u32;
                persistence_state.loaded_chunks.insert(chunk_pos, entities);
                persistence_state
                    .chunk_prop_data
                    .insert(chunk_pos, props);
            } else {
                // Generate props for this chunk
                let props = generate_chunk_props(
                    chunk_pos,
                    &world,
                    &generator,
                    &config,
                    &placement_config,
                );

                // Save to disk
                if let Some(ref mut manifest) = persistence_state.manifest {
                    if let Err(e) = save_chunk_and_update_manifest(chunk_pos, &props, manifest) {
                        warn!("Failed to save chunk {:?} props: {}", chunk_pos, e);
                    }
                }

                // Spawn entities
                let entities = spawn_props_from_data(
                    &mut commands,
                    &props,
                    &prop_assets,
                    &mesh_cache,
                    &mut instancing_stats,
                    chunk_pos,
                );
                total += entities.len() as u32;
                persistence_state.loaded_chunks.insert(chunk_pos, entities);
                persistence_state.chunk_prop_data.insert(chunk_pos, props);
            }
        }
    }

    // Update manifest metadata
    if let Some(ref mut manifest) = persistence_state.manifest {
        manifest.metadata.total_props = total as usize;
        manifest.metadata.placement_time_ms = start_time.elapsed().as_millis() as u64;

        if let Err(e) = save_manifest(manifest) {
            warn!("Failed to save prop manifest: {}", e);
        }
    }

    // Log instancing stats
    info!(
        "Spawned {} total props in {:?} ({} instanced, {} scene-based)",
        total,
        start_time.elapsed(),
        instancing_stats.instanced_spawns,
        instancing_stats.scene_spawns,
    );
}

/// Generate props for a specific chunk
fn generate_chunk_props(
    chunk_pos: IVec2,
    world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    config: &PropConfig,
    placement_config: &PlacementConfig,
) -> Vec<PropPlacementData> {
    let mut props = Vec::new();
    let analyzer = TerrainAnalyzer::new(world);

    let chunk_min_x = chunk_pos.x * PROP_CHUNK_SIZE;
    let chunk_min_z = chunk_pos.y * PROP_CHUNK_SIZE;
    let chunk_max_x = (chunk_min_x + PROP_CHUNK_SIZE).min(WORLD_SCAN_SIZE);
    let chunk_max_z = (chunk_min_z + PROP_CHUNK_SIZE).min(WORLD_SCAN_SIZE);

    // Track counts per prop type
    let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    // Generate each category
    for def in &config.props.trees {
        generate_category_props(
            &mut props,
            &mut counts,
            def,
            PropType::Tree,
            chunk_min_x,
            chunk_min_z,
            chunk_max_x,
            chunk_max_z,
            world,
            generator,
            &analyzer,
            placement_config,
        );
    }
    for def in &config.props.rocks {
        generate_category_props(
            &mut props,
            &mut counts,
            def,
            PropType::Rock,
            chunk_min_x,
            chunk_min_z,
            chunk_max_x,
            chunk_max_z,
            world,
            generator,
            &analyzer,
            placement_config,
        );
    }
    for def in &config.props.bushes {
        generate_category_props(
            &mut props,
            &mut counts,
            def,
            PropType::Bush,
            chunk_min_x,
            chunk_min_z,
            chunk_max_x,
            chunk_max_z,
            world,
            generator,
            &analyzer,
            placement_config,
        );
    }
    for def in &config.props.flowers {
        generate_category_props(
            &mut props,
            &mut counts,
            def,
            PropType::Flower,
            chunk_min_x,
            chunk_min_z,
            chunk_max_x,
            chunk_max_z,
            world,
            generator,
            &analyzer,
            placement_config,
        );
    }

    props
}

/// Generate props for a category within chunk bounds
#[allow(clippy::too_many_arguments)]
fn generate_category_props(
    props: &mut Vec<PropPlacementData>,
    counts: &mut std::collections::HashMap<String, u32>,
    def: &PropDefinition,
    prop_type: PropType,
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
    _world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    analyzer: &TerrainAnalyzer,
    placement_config: &PlacementConfig,
) {
    let max_count = def.max_count.unwrap_or(DEFAULT_MAX_PER_TYPE);
    let current_count = counts.get(&def.id).copied().unwrap_or(0);
    if current_count >= max_count {
        return;
    }

    let is_tree = prop_type == PropType::Tree;
    let cell_size = if is_tree { TREE_CELL_SIZE } else { 1 };

    for x in min_x..max_x {
        for z in min_z..max_z {
            let count = counts.get(&def.id).copied().unwrap_or(0);
            if count >= max_count {
                return;
            }

            let world_x = x;
            let world_z = z;

            // Tree grid-based placement
            if is_tree {
                let cell_x = world_x / cell_size;
                let cell_z = world_z / cell_size;
                let cell_hash = deterministic_hash(cell_x, cell_z, &def.id);
                if cell_hash > def.density {
                    continue;
                }
                let jitter_x = deterministic_hash(cell_x * 31, cell_z * 17, &def.id);
                let jitter_z = deterministic_hash(cell_x * 47, cell_z * 23, &def.id);
                let offset_x = (jitter_x * (cell_size as f32 * 0.9)) as i32;
                let offset_z = (jitter_z * (cell_size as f32 * 0.9)) as i32;
                let target_x = (cell_x * cell_size + offset_x).min(WORLD_SCAN_SIZE - 1);
                let target_z = (cell_z * cell_size + offset_z).min(WORLD_SCAN_SIZE - 1);
                if world_x != target_x || world_z != target_z {
                    continue;
                }
            } else {
                let mut density = def.density;
                if prop_type == PropType::Rock {
                    let biome = generator.get_biome(world_x, world_z);
                    let surface_hint = analyzer.find_column_height(world_x, world_z);
                    let near_water = surface_hint.map(|y| y <= WATER_LEVEL + 2).unwrap_or(false);
                    let (region_boost, palette_boost) =
                        rock_region_modifiers(world_x, world_z, biome, &def.id, near_water);
                    density *= region_boost * palette_boost;
                    density *= cluster_density_multiplier(
                        world_x,
                        world_z,
                        "rock_cluster",
                        ROCK_CLUSTER_CELL_SIZE,
                        ROCK_CLUSTER_THRESHOLD,
                        ROCK_CLUSTER_BASE,
                        ROCK_CLUSTER_PEAK,
                    );
                } else if prop_type == PropType::Bush {
                    density *= cluster_density_multiplier(
                        world_x,
                        world_z,
                        "bush_cluster",
                        BUSH_CLUSTER_CELL_SIZE,
                        BUSH_CLUSTER_THRESHOLD,
                        BUSH_CLUSTER_BASE,
                        BUSH_CLUSTER_PEAK,
                    );
                }

                let hash = deterministic_hash(world_x, world_z, &def.id);
                if hash > density {
                    continue;
                }
            }

            // Use multi-sample placement for precise positioning
            let hash = deterministic_hash(world_x, world_z, &def.id);
            let offset_x = fract(hash * 17.0) - 0.5;
            let offset_z = fract(hash * 23.0) - 0.5;
            let world_xf = world_x as f32 + 0.5 + offset_x * 0.8;
            let world_zf = world_z as f32 + 0.5 + offset_z * 0.8;

            // Multi-sample terrain analysis
            let footprint = prop_footprint(prop_type, &def.id);
            let Some(sample_result) = analyzer.multi_sample_placement(
                world_xf,
                world_zf,
                footprint.x * placement_config.footprint_scale,
                footprint.y * placement_config.footprint_scale,
            ) else {
                continue;
            };

            // Validate placement
            if sample_result.position.y <= WATER_LEVEL as f32 {
                continue;
            }

            if !can_spawn_on(sample_result.voxel_type, &def.spawn_on) {
                continue;
            }

            let slope = sample_result.normal.y.acos();
            if slope < def.min_slope || slope > def.max_slope {
                continue;
            }

            // Height variance check
            if sample_result.height_variance > placement_config.max_height_variance {
                continue;
            }

            // Calculate transform with proper slope alignment
            let placement_seed = hash_to_seed(world_x, world_z, &def.id);
            let scale = prop_scale(
                def.scale_range[0],
                def.scale_range[1],
                def.scale_jitter,
                &def.id,
                prop_type,
                hash,
                world_x,
                world_z,
            );

            let yaw = fract(hash * 13.0) * std::f32::consts::TAU;
            let tilt_x = (seeded_random(placement_seed, 1) - 0.5)
                * placement_config.max_random_tilt.to_radians();
            let tilt_z = (seeded_random(placement_seed, 2) - 0.5)
                * placement_config.max_random_tilt.to_radians();

            let slope_strength = prop_slope_align_strength(prop_type, &def.id);
            let rotation = calculate_prop_rotation(
                sample_result.normal,
                slope_strength,
                yaw,
                tilt_x,
                tilt_z,
            );

            // Apply ground sink
            let sink = prop_ground_sink(&def.id, prop_type, scale);
            let position = Vec3::new(
                sample_result.position.x,
                (sample_result.position.y + def.y_offset - sink).max(sample_result.position.y - 0.4),
                sample_result.position.z,
            );

            // Create placement data
            let mut placement = PropPlacementData::new(
                def.id.clone(),
                prop_type,
                position,
                quat_to_euler_degrees(rotation),
                Vec3::splat(scale),
                placement_seed,
            );

            placement.ground_contact = GroundContactData::new(
                sample_result.voxel_type,
                sample_result.normal.y.acos().to_degrees(),
                sample_result.normal,
            );
            placement.validated = true;

            props.push(placement);
            *counts.entry(def.id.clone()).or_insert(0) += 1;
        }
    }
}

/// Spawn entities from persisted prop data.
/// Uses instanced rendering when the mesh cache is ready, otherwise falls back to SceneRoot.
fn spawn_props_from_data(
    commands: &mut Commands,
    props: &[PropPlacementData],
    assets: &PropAssets,
    mesh_cache: &PropMeshCache,
    stats: &mut InstancingStats,
    chunk_pos: IVec2,
) -> Vec<Entity> {
    props
        .iter()
        .filter_map(|prop| {
            let transform = prop.to_transform();
            let prop_type: PropType = prop.prop_type.into();

            // Try instanced spawning first (uses cached mesh handles for GPU batching)
            if let Some(entity) = spawn_instanced_prop(
                commands,
                mesh_cache,
                &prop.id,
                transform.clone(),
                prop_type,
            ) {
                // Add common components to the instanced entity
                commands.entity(entity).insert((
                    Prop {
                        id: prop.id.clone(),
                        prop_type,
                    },
                    PersistedProp {
                        chunk_pos,
                        placement_seed: prop.placement_seed,
                    },
                ));

                if should_apply_grass_wind(&prop.id, prop_type) {
                    let hash = (prop.placement_seed as f32) / (u64::MAX as f32);
                    commands.entity(entity).insert(GrassPropWind::new(&transform, hash));
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
                PersistedProp {
                    chunk_pos,
                    placement_seed: prop.placement_seed,
                },
            ));

            if should_apply_grass_wind(&prop.id, prop_type) {
                let hash = (prop.placement_seed as f32) / (u64::MAX as f32);
                entity.insert(GrassPropWind::new(&transform, hash));
            }

            stats.scene_spawns += 1;
            Some(entity.id())
        })
        .collect()
}

/// Get the footprint size for a prop type (for multi-sample placement)
fn prop_footprint(prop_type: PropType, id: &str) -> Vec2 {
    let id_lower = id.to_lowercase();
    match prop_type {
        PropType::Tree => Vec2::new(1.5, 1.5),
        PropType::Rock => {
            if id_lower.contains("boulder") || id_lower.contains("large") {
                Vec2::new(2.0, 2.0)
            } else if id_lower.contains("pebble") {
                Vec2::new(0.3, 0.3)
            } else {
                Vec2::new(1.0, 1.0)
            }
        }
        PropType::Bush => Vec2::new(0.8, 0.8),
        PropType::Flower => Vec2::new(0.4, 0.4),
    }
}

/// Get slope alignment strength for a prop type
fn prop_slope_align_strength(prop_type: PropType, id: &str) -> f32 {
    let id_lower = id.to_lowercase();
    match prop_type {
        PropType::Tree => 0.0,   // Trees stay upright
        PropType::Rock => 0.7,  // Rocks follow terrain somewhat
        PropType::Bush => {
            if id_lower.contains("grass") {
                0.3 // Grass follows terrain slightly
            } else {
                0.5
            }
        }
        PropType::Flower => 0.2, // Flowers mostly upright
    }
}

/// Spawn a small ring of custom props near the player for quick verification.
pub fn spawn_debug_custom_props_near_player(
    mut commands: Commands,
    prop_assets: Res<PropAssets>,
    config: Res<PropConfig>,
    world: Res<VoxelWorld>,
    player_query: Query<&Transform, With<Player>>,
    mut debug_spawned: ResMut<PropsDebugSpawned>,
) {
    if debug_spawned.0 || !prop_assets.loaded {
        return;
    }

    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    let Ok(player_tf) = player_query.single() else {
        return;
    };

    debug_spawned.0 = true;

    let center = player_tf.translation;
    let placements = [
        ("usn_grass_small", PropType::Bush, Vec2::new(6.0, 0.0)),
        ("usn_grass_large", PropType::Bush, Vec2::new(-6.0, 0.0)),
        ("usn_grass_small", PropType::Bush, Vec2::new(0.0, 6.0)),
        ("usn_grass_large", PropType::Bush, Vec2::new(0.0, -6.0)),
        ("custom_celandine", PropType::Flower, Vec2::new(4.0, 4.0)),
        ("custom_celandine", PropType::Flower, Vec2::new(-4.0, 4.0)),
        ("custom_dandelion", PropType::Flower, Vec2::new(4.0, -4.0)),
        ("custom_dandelion", PropType::Flower, Vec2::new(-4.0, -4.0)),
    ];

    let analyzer = TerrainAnalyzer::new(&world);

    for (id, prop_type, offset) in placements {
        let Some(scene_handle) = prop_assets.scenes.get(id) else {
            warn!("Prop asset '{}' not found in registry (debug spawn)", id);
            continue;
        };

        let world_xf = center.x + offset.x;
        let world_zf = center.z + offset.y;

        let analysis = analyzer.analyze(world_xf, world_zf);
        if !analysis.valid {
            continue;
        }

        let (scale_min, scale_max, scale_jitter, y_offset) = if let Some(def) = find_def(config.as_ref(), id) {
            (def.scale_range[0], def.scale_range[1], def.scale_jitter, def.y_offset)
        } else {
            (0.8, 1.2, 0.0, 0.0)
        };

        let world_x = world_xf.round() as i32;
        let world_z = world_zf.round() as i32;
        let hash = deterministic_hash(world_x, world_z, id);
        let scale = prop_scale(scale_min, scale_max, scale_jitter, id, prop_type, hash, world_x, world_z);
        let rotation = fract(hash * 13.0) * std::f32::consts::TAU;

        let position = Vec3::new(world_xf, analysis.height + y_offset, world_zf);

        let transform = Transform::from_translation(position)
            .with_rotation(Quat::from_rotation_y(rotation))
            .with_scale(Vec3::splat(scale));
        let mut entity = commands.spawn((
            SceneRoot(scene_handle.clone()),
            transform.clone(),
            Prop {
                id: id.to_string(),
                prop_type,
            },
        ));

        if should_apply_grass_wind(id, prop_type) {
            entity.insert(GrassPropWind::new(&transform, hash));
        }
    }

    info!("Spawned debug custom props around player");
}

/// Spawn fixed landmark buildings across the world so players can visit them.
pub fn spawn_landmark_buildings(
    mut commands: Commands,
    prop_assets: Res<PropAssets>,
    config: Res<PropConfig>,
    world: Res<VoxelWorld>,
    mut landmarks: ResMut<LandmarkLocations>,
    mut spawned: ResMut<PropsLandmarksSpawned>,
) {
    if spawned.0 || !prop_assets.loaded {
        return;
    }

    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    let world_size = world.world_size_chunks();
    let world_width = (world_size.x * CHUNK_SIZE_I32).max(1) as f32;
    let world_depth = (world_size.z * CHUNK_SIZE_I32).max(1) as f32;

    let mut placements = Vec::new();
    placements.push((
        "building_fantasy_inn",
        Vec2::new(world_width * 0.2, world_depth * 0.25),
        0.0,
    ));
    placements.push((
        "building_fantasy_stable",
        Vec2::new(world_width * 0.45, world_depth * 0.25),
        1.57,
    ));

    let house_ratios = [
        (0.18, 0.2),
        (0.28, 0.22),
        (0.38, 0.2),
        (0.48, 0.23),
        (0.58, 0.2),
        (0.68, 0.24),
        (0.78, 0.22),
        (0.25, 0.35),
        (0.45, 0.38),
        (0.65, 0.36),
    ];
    for (idx, (x_ratio, z_ratio)) in house_ratios.iter().enumerate() {
        placements.push((
            "building_house",
            Vec2::new(world_width * x_ratio, world_depth * z_ratio),
            rotation_from_index(idx),
        ));
    }

    let hut_ratios = [
        (0.2, 0.6),
        (0.3, 0.65),
        (0.4, 0.6),
        (0.5, 0.66),
        (0.6, 0.6),
        (0.7, 0.66),
        (0.8, 0.6),
        (0.25, 0.8),
        (0.5, 0.8),
        (0.75, 0.8),
    ];
    for (idx, (x_ratio, z_ratio)) in hut_ratios.iter().enumerate() {
        placements.push((
            "building_hut",
            Vec2::new(world_width * x_ratio, world_depth * z_ratio),
            rotation_from_index(idx + house_ratios.len()),
        ));
    }

    let analyzer = TerrainAnalyzer::new(&world);
    let mut spawned_count = 0;

    landmarks.positions.clear();

    for (id, target, yaw) in placements {
        let Some(scene_handle) = prop_assets.scenes.get(id) else {
            warn!("Landmark building '{}' not found in registry", id);
            continue;
        };

        let target_x = target.x.round() as i32;
        let target_z = target.y.round() as i32;
        let Some((world_x, world_z, surface_y)) =
            find_surface_near(&world, target_x, target_z, BUILDING_SEARCH_RADIUS, MAX_BUILDING_SLOPE)
        else {
            warn!("No suitable surface found for landmark '{}'", id);
            continue;
        };

        let (scale, y_offset) = if let Some(def) = find_def(config.as_ref(), id) {
            (def.scale_range[0], def.y_offset)
        } else {
            (1.0, 0.0)
        };

        let world_xf = world_x as f32 + 0.5;
        let world_zf = world_z as f32 + 0.5;
        let surface_height = analyzer
            .sample_smooth_height(world_xf, world_zf)
            .unwrap_or(surface_y as f32 + 0.5);
        let position = Vec3::new(world_xf, surface_height + y_offset, world_zf);

        commands.spawn((
            SceneRoot(scene_handle.clone()),
            Transform::from_translation(position)
                .with_rotation(Quat::from_rotation_y(yaw))
                .with_scale(Vec3::splat(scale)),
            Prop {
                id: id.to_string(),
                prop_type: PropType::Rock,
            },
        ));

        landmarks.positions.push(position);
        spawned_count += 1;
    }

    spawned.0 = true;
    info!("Spawned {} landmark buildings", spawned_count);
}

fn rotation_from_index(index: usize) -> f32 {
    (index as f32) * 0.7 % std::f32::consts::TAU
}

fn find_def<'a>(config: &'a PropConfig, id: &str) -> Option<&'a PropDefinition> {
    config
        .props
        .trees
        .iter()
        .chain(config.props.rocks.iter())
        .chain(config.props.bushes.iter())
        .chain(config.props.flowers.iter())
        .find(|def| def.id == id)
}

fn rock_region_modifiers(
    world_x: i32,
    world_z: i32,
    biome: Biome,
    id: &str,
    near_water: bool,
) -> (f32, f32) {
    let cell_x = world_x.div_euclid(ROCK_REGION_CELL_SIZE);
    let cell_z = world_z.div_euclid(ROCK_REGION_CELL_SIZE);
    let region_noise = deterministic_hash(cell_x, cell_z, "rock_region");
    let palette_roll = deterministic_hash(cell_x, cell_z, "rock_palette");
    let id_hash = deterministic_hash(0, 0, id);

    let biome_boost = match biome {
        Biome::Rocky => lerp(1.3, 2.1, region_noise),
        Biome::Sandy => lerp(0.5, 0.9, region_noise),
        Biome::Clay => lerp(0.6, 1.0, region_noise),
        Biome::Grassland => lerp(0.7, 1.1, region_noise),
    };

    let delta = (id_hash - palette_roll).abs().min(1.0);
    let palette_affinity = 1.0 - (delta * 1.2).min(1.0);
    let palette_boost = lerp(0.6, 1.4, palette_affinity);

    let id_lower = id.to_lowercase();
    let is_pebble = id_lower.contains("pebble");
    let pebble_boost = if is_pebble {
        let water_bias = if near_water { 1.6 } else { 1.0 };
        let biome_bias = if biome == Biome::Rocky { 1.4 } else { 0.85 };
        water_bias * biome_bias
    } else {
        1.0
    };

    (biome_boost * pebble_boost, palette_boost)
}

fn cluster_density_multiplier(
    world_x: i32,
    world_z: i32,
    cluster_id: &str,
    cell_size: i32,
    cluster_threshold: f32,
    base: f32,
    peak: f32,
) -> f32 {
    let cell_x = world_x.div_euclid(cell_size);
    let cell_z = world_z.div_euclid(cell_size);
    let cell_hash = deterministic_hash(cell_x, cell_z, cluster_id);

    if cell_hash < cluster_threshold {
        return base;
    }

    let cell_size_f = cell_size as f32;
    let center_x = cell_x as f32 * cell_size_f + fract(cell_hash * 11.0) * cell_size_f;
    let center_z = cell_z as f32 * cell_size_f + fract(cell_hash * 17.0) * cell_size_f;
    let dx = world_x as f32 + 0.5 - center_x;
    let dz = world_z as f32 + 0.5 - center_z;
    let dist_sq = dx * dx + dz * dz;

    let radius = cell_size_f * (0.35 + fract(cell_hash * 23.0) * 0.35);
    let radius_sq = radius * radius;
    if dist_sq >= radius_sq {
        return base;
    }

    let t = 1.0 - (dist_sq.sqrt() / radius);
    base + (peak - base) * t * t
}

/// Find surface voxel and calculate slope
fn find_surface(world: &VoxelWorld, x: i32, z: i32) -> Option<(i32, VoxelType, f32)> {
    for y in (0..MAX_SCAN_HEIGHT).rev() {
        let pos = IVec3::new(x, y, z);
        if let Some(voxel) = world.get_voxel(pos) {
            if voxel.is_solid() && !voxel.is_liquid() {
                let above = IVec3::new(x, y + 1, z);
                if let Some(above_voxel) = world.get_voxel(above) {
                    if above_voxel.is_liquid() {
                        continue;
                    }
                }
                let slope = calculate_slope(world, x, y, z);
                return Some((y, voxel, slope));
            }
        }
    }
    None
}

fn find_surface_near(
    world: &VoxelWorld,
    start_x: i32,
    start_z: i32,
    radius: i32,
    max_slope: f32,
) -> Option<(i32, i32, i32)> {
    for r in 0..=radius {
        for dx in -r..=r {
            for dz in -r..=r {
                if dx.abs() != r && dz.abs() != r {
                    continue;
                }
                let world_x = start_x + dx;
                let world_z = start_z + dz;
                let Some((surface_y, _voxel_type, slope)) = find_surface(world, world_x, world_z) else {
                    continue;
                };
                if slope <= max_slope {
                    return Some((world_x, world_z, surface_y));
                }
            }
        }
    }
    None
}

/// Calculate terrain slope from height differences
fn calculate_slope(world: &VoxelWorld, x: i32, y: i32, z: i32) -> f32 {
    let analyzer = TerrainAnalyzer::new(world);
    let mut max_diff = 0i32;

    for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        if let Some(ny) = analyzer.find_column_height(x + dx, z + dz) {
            max_diff = max_diff.max((y - ny).abs());
        }
    }

    (max_diff as f32 / 4.0).clamp(0.0, 1.0)
}

/// Check if voxel type is in allowed spawn list
fn can_spawn_on(voxel: VoxelType, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true; // No restriction
    }
    let voxel_name = format!("{:?}", voxel);
    allowed.iter().any(|a| a.eq_ignore_ascii_case(&voxel_name))
}

fn prop_ground_sink(id: &str, prop_type: PropType, scale: f32) -> f32 {
    let id_lower = id.to_lowercase();

    // Determine base sink factor based on type and id
    let factor = if prop_type == PropType::Rock {
        if id_lower.contains("pebble") {
            0.18
        } else if id_lower.contains("large") || id_lower.contains("boulder") {
            0.55
        } else if id_lower.contains("medium") {
            0.45
        } else if id_lower.contains("small") {
            0.35
        } else if id_lower.contains("flat") {
            0.25
        } else if id_lower.contains("cluster") {
            0.3
        } else {
            0.4
        }
    } else if prop_type == PropType::Tree {
        0.2 // Trees usually have roots/trunk base to hide
    } else {
        // Bushes, Flowers, Grass
        0.15 // Sink 15% of height to ensure no floating
    };

    scale * factor
}

fn prop_scale(
    scale_min: f32,
    scale_max: f32,
    scale_jitter: f32,
    id: &str,
    _prop_type: PropType,
    hash: f32,
    world_x: i32,
    world_z: i32,
) -> f32 {
    if (scale_max - scale_min).abs() <= f32::EPSILON {
        return scale_min;
    }

    let base = lerp(scale_min, scale_max, fract(hash * 7.0));

    if scale_jitter <= 0.0 {
        return base;
    }

    let jitter_hash = deterministic_hash(world_x, world_z, id);
    let jitter = (jitter_hash * 2.0 - 1.0) * scale_jitter;
    (base * (1.0 + jitter)).clamp(scale_min, scale_max)
}

fn should_apply_grass_wind(id: &str, prop_type: PropType) -> bool {
    if prop_type != PropType::Bush {
        return false;
    }
    let id_lower = id.to_lowercase();
    id_lower.contains("grass")
}

/// Deterministic hash for consistent prop placement
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

/// Convert hash inputs to a u64 seed
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
