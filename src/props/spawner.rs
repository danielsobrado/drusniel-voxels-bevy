use super::{Prop, PropAssets, PropConfig, PropDefinition, PropType};
use crate::constants::WATER_LEVEL;
use crate::player::Player;
use crate::voxel::terrain::{Biome, TerrainGenerator, ValueNoise};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

const DEFAULT_MAX_PER_TYPE: u32 = 500;
const WORLD_SCAN_SIZE: i32 = 512;
const MAX_SCAN_HEIGHT: i32 = 64;
const TREE_CELL_SIZE: i32 = 10;
const ROCK_REGION_CELL_SIZE: i32 = 48;

#[derive(Resource, Default)]
pub struct PropsSpawned(pub bool);

#[derive(Resource, Default)]
pub struct PropsDebugSpawned(pub bool);

/// Spawn props on terrain based on configuration
pub fn spawn_props_on_terrain(
    mut commands: Commands,
    prop_assets: Res<PropAssets>,
    config: Res<PropConfig>,
    world: Res<VoxelWorld>,
    mut spawned: ResMut<PropsSpawned>,
) {
    if spawned.0 || !prop_assets.loaded {
        return;
    }

    // Wait for world to be populated
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    spawned.0 = true;
    let generator = TerrainGenerator::<ValueNoise>::default();

    let mut total = 0u32;

    // Spawn each category
    for def in &config.props.trees {
        total += spawn_category(&mut commands, &prop_assets, &world, &generator, def, PropType::Tree);
    }
    for def in &config.props.rocks {
        total += spawn_category(&mut commands, &prop_assets, &world, &generator, def, PropType::Rock);
    }
    for def in &config.props.bushes {
        total += spawn_category(&mut commands, &prop_assets, &world, &generator, def, PropType::Bush);
    }
    for def in &config.props.flowers {
        total += spawn_category(&mut commands, &prop_assets, &world, &generator, def, PropType::Flower);
    }

    info!("Spawned {} total props", total);
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

    for (id, prop_type, offset) in placements {
        let Some(scene_handle) = prop_assets.scenes.get(id) else {
            warn!("Prop asset '{}' not found in registry (debug spawn)", id);
            continue;
        };

        let world_x = (center.x + offset.x).round() as i32;
        let world_z = (center.z + offset.y).round() as i32;
        let Some((surface_y, _voxel_type, _slope)) = find_surface(&world, world_x, world_z) else {
            continue;
        };

        let (scale_min, scale_max, scale_jitter, y_offset) = if let Some(def) = find_def(config.as_ref(), id) {
            (def.scale_range[0], def.scale_range[1], def.scale_jitter, def.y_offset)
        } else {
            (0.8, 1.2, 0.0, 0.0)
        };

        let hash = deterministic_hash(world_x, world_z, id);
        let scale = prop_scale(scale_min, scale_max, scale_jitter, id, prop_type, hash, world_x, world_z);
        let rotation = fract(hash * 13.0) * std::f32::consts::TAU;

        let world_xf = world_x as f32 + 0.5;
        let world_zf = world_z as f32 + 0.5;
        let surface_height = sample_smooth_surface_height(&world, world_xf, world_zf)
            .unwrap_or(surface_y as f32 + 0.5);

        let position = Vec3::new(
            world_xf,
            surface_height + y_offset,
            world_zf,
        );

        commands.spawn((
            SceneRoot(scene_handle.clone()),
            Transform::from_translation(position)
                .with_rotation(Quat::from_rotation_y(rotation))
                .with_scale(Vec3::splat(scale)),
            Prop {
                id: id.to_string(),
                prop_type,
            },
        ));
    }

    info!("Spawned debug custom props around player");
}

fn spawn_category(
    commands: &mut Commands,
    assets: &PropAssets,
    world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    def: &PropDefinition,
    prop_type: PropType,
) -> u32 {
    let Some(scene_handle) = assets.scenes.get(&def.id) else {
        warn!("Prop asset '{}' not found in registry", def.id);
        return 0;
    };

    let max_count = def.max_count.unwrap_or(DEFAULT_MAX_PER_TYPE);
    let mut count = 0u32;

    let is_tree = prop_type == PropType::Tree;
    let cell_size = if is_tree { TREE_CELL_SIZE } else { 1 };

    for x in 0..WORLD_SCAN_SIZE {
        for z in 0..WORLD_SCAN_SIZE {
            if count >= max_count {
                break;
            }

            let world_x = x;
            let world_z = z;

            if is_tree {
                // One candidate per grid cell with jitter, to keep trees separated.
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
                    let surface_hint = find_column_height(world, world_x, world_z);
                    let near_water = surface_hint.map(|y| y <= WATER_LEVEL + 2).unwrap_or(false);
                    let (region_boost, palette_boost) =
                        rock_region_modifiers(world_x, world_z, biome, &def.id, near_water);
                    density *= region_boost * palette_boost;
                }

                // Density check with deterministic hash
                let hash = deterministic_hash(world_x, world_z, &def.id);
                if hash > density {
                    continue;
                }
            }

            // Find surface and validate spawn conditions
            let Some((surface_y, voxel_type, slope)) = find_surface(world, world_x, world_z) else {
                continue;
            };

            if !can_spawn_on(voxel_type, &def.spawn_on) {
                continue;
            }

            if slope < def.min_slope || slope > def.max_slope {
                continue;
            }

            // Calculate transform with variation
            let hash = deterministic_hash(world_x, world_z, &def.id);
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
            let rotation = fract(hash * 13.0) * std::f32::consts::TAU;
            let offset_x = fract(hash * 17.0) - 0.5;
            let offset_z = fract(hash * 23.0) - 0.5;

            let world_xf = world_x as f32 + 0.5 + offset_x * 0.8;
            let world_zf = world_z as f32 + 0.5 + offset_z * 0.8;
            let surface_height = sample_smooth_surface_height(world, world_xf, world_zf)
                .unwrap_or(surface_y as f32 + 0.5);

            let base_y = surface_height + def.y_offset;
            let sink = prop_ground_sink(&def.id, prop_type, scale);
            let grounded_y = (base_y - sink).max(surface_height - 0.4);
            let position = Vec3::new(world_xf, grounded_y, world_zf);

            commands.spawn((
                SceneRoot(scene_handle.clone()),
                Transform::from_translation(position)
                    .with_rotation(Quat::from_rotation_y(rotation))
                    .with_scale(Vec3::splat(scale)),
                Prop {
                    id: def.id.clone(),
                    prop_type,
                },
            ));

            count += 1;
        }
    }

    if count > 0 {
        info!("Spawned {} x {}", count, def.id);
    }
    count
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

/// Calculate terrain slope from height differences
fn calculate_slope(world: &VoxelWorld, x: i32, y: i32, z: i32) -> f32 {
    let mut max_diff = 0i32;

    for (dx, dz) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
        if let Some(ny) = find_column_height(world, x + dx, z + dz) {
            max_diff = max_diff.max((y - ny).abs());
        }
    }

    (max_diff as f32 / 4.0).clamp(0.0, 1.0)
}

fn find_column_height(world: &VoxelWorld, x: i32, z: i32) -> Option<i32> {
    for y in (0..MAX_SCAN_HEIGHT).rev() {
        if let Some(v) = world.get_voxel(IVec3::new(x, y, z)) {
            if v.is_solid() && !v.is_liquid() {
                return Some(y);
            }
        }
    }
    None
}

fn sample_smooth_surface_height(world: &VoxelWorld, world_x: f32, world_z: f32) -> Option<f32> {
    let x0 = world_x.floor() as i32;
    let z0 = world_z.floor() as i32;
    let x1 = x0 + 1;
    let z1 = z0 + 1;

    let fx = world_x - x0 as f32;
    let fz = world_z - z0 as f32;

    let h00 = find_column_height(world, x0, z0)? as f32 + 0.5;
    let h10 = find_column_height(world, x1, z0)? as f32 + 0.5;
    let h01 = find_column_height(world, x0, z1)? as f32 + 0.5;
    let h11 = find_column_height(world, x1, z1)? as f32 + 0.5;

    let h0 = lerp(h00, h10, fx);
    let h1 = lerp(h01, h11, fx);
    Some(lerp(h0, h1, fz))
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
    if prop_type != PropType::Rock {
        return 0.0;
    }

    let id_lower = id.to_lowercase();
    let factor = if id_lower.contains("pebble") {
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
    };

    scale * factor
}

fn prop_scale(
    scale_min: f32,
    scale_max: f32,
    scale_jitter: f32,
    id: &str,
    prop_type: PropType,
    hash: f32,
    world_x: i32,
    world_z: i32,
) -> f32 {
    if (scale_max - scale_min).abs() <= f32::EPSILON {
        return scale_min;
    }

    let base = if prop_type == PropType::Rock {
        let id_hash = deterministic_hash(0, 0, id);
        lerp(scale_min, scale_max, fract(id_hash * 7.0))
    } else {
        lerp(scale_min, scale_max, fract(hash * 7.0))
    };

    if scale_jitter <= 0.0 {
        return base;
    }

    let jitter_hash = deterministic_hash(world_x, world_z, id);
    let jitter = (jitter_hash * 2.0 - 1.0) * scale_jitter;
    (base * (1.0 + jitter)).clamp(scale_min, scale_max)
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

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn fract(x: f32) -> f32 {
    x - x.floor()
}
