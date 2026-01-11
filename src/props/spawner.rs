use super::{Prop, PropAssets, PropConfig, PropDefinition, PropType};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

const DEFAULT_MAX_PER_TYPE: u32 = 500;
const WORLD_SCAN_SIZE: i32 = 512;
const MAX_SCAN_HEIGHT: i32 = 64;
const TREE_CELL_SIZE: i32 = 10;

#[derive(Resource, Default)]
pub struct PropsSpawned(pub bool);

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

    let mut total = 0u32;

    // Spawn each category
    for def in &config.props.trees {
        total += spawn_category(&mut commands, &prop_assets, &world, def, PropType::Tree);
    }
    for def in &config.props.rocks {
        total += spawn_category(&mut commands, &prop_assets, &world, def, PropType::Rock);
    }
    for def in &config.props.bushes {
        total += spawn_category(&mut commands, &prop_assets, &world, def, PropType::Bush);
    }
    for def in &config.props.flowers {
        total += spawn_category(&mut commands, &prop_assets, &world, def, PropType::Flower);
    }

    info!("Spawned {} total props", total);
}

fn spawn_category(
    commands: &mut Commands,
    assets: &PropAssets,
    world: &VoxelWorld,
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
                // Density check with deterministic hash
                let hash = deterministic_hash(world_x, world_z, &def.id);
                if hash > def.density {
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
            let scale = lerp(def.scale_range[0], def.scale_range[1], fract(hash * 7.0));
            let rotation = fract(hash * 13.0) * std::f32::consts::TAU;
            let offset_x = fract(hash * 17.0) - 0.5;
            let offset_z = fract(hash * 23.0) - 0.5;

            let position = Vec3::new(
                world_x as f32 + 0.5 + offset_x * 0.8,
                surface_y as f32 + 1.0 + def.y_offset,
                world_z as f32 + 0.5 + offset_z * 0.8,
            );

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

/// Find surface voxel and calculate slope
fn find_surface(world: &VoxelWorld, x: i32, z: i32) -> Option<(i32, VoxelType, f32)> {
    for y in (0..MAX_SCAN_HEIGHT).rev() {
        let pos = IVec3::new(x, y, z);
        if let Some(voxel) = world.get_voxel(pos) {
            if voxel.is_solid() && !voxel.is_liquid() {
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

/// Check if voxel type is in allowed spawn list
fn can_spawn_on(voxel: VoxelType, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true; // No restriction
    }
    let voxel_name = format!("{:?}", voxel);
    allowed.iter().any(|a| a.eq_ignore_ascii_case(&voxel_name))
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
