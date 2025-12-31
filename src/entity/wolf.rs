use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology};

use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;

use super::{simple_hash, EntitySpawnConfig, EntitySpawnState, Health};

// ============================================================================
// Components
// ============================================================================

/// Component for wolf entities
#[derive(Component)]
pub struct Wolf {
    pub wander_timer: f32,
    pub wander_direction: Vec3,
}

impl Default for Wolf {
    fn default() -> Self {
        Self {
            wander_timer: 0.0,
            wander_direction: Vec3::ZERO,
        }
    }
}

// ============================================================================
// Spawning System
// ============================================================================

/// Spawn wolves on the terrain
pub fn spawn_wolves(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    world: Res<VoxelWorld>,
    config: Res<EntitySpawnConfig>,
    mut state: ResMut<EntitySpawnState>,
) {
    // Wait for chunks to be fully generated
    state.wolves_frame_counter += 1;
    if state.wolves_frame_counter < config.spawn_delay_frames {
        return;
    }

    // Wait until world has at least one chunk loaded
    if world.get_chunk(IVec3::ZERO).is_none() {
        info!("Waiting for world chunks to load...");
        return;
    }

    state.wolves_spawned = true;
    info!(
        "Starting wolf spawn process (after {} frames)...",
        state.wolves_frame_counter
    );

    let wolf_mesh = meshes.add(create_wolf_mesh());
    let wolf_material = materials.add(create_wolf_material());

    let stats = spawn_wolves_on_terrain(&mut commands, &world, &config, &wolf_mesh, &wolf_material);

    log_spawn_statistics("Wolf", &stats);
}

struct SpawnStatistics {
    positions_checked: usize,
    valid_locations: usize,
    spawned_count: usize,
    topsoil_found: usize,
    sand_found: usize,
}

fn spawn_wolves_on_terrain(
    commands: &mut Commands,
    world: &VoxelWorld,
    config: &EntitySpawnConfig,
    wolf_mesh: &Handle<Mesh>,
    wolf_material: &Handle<StandardMaterial>,
) -> SpawnStatistics {
    let mut stats = SpawnStatistics {
        positions_checked: 0,
        valid_locations: 0,
        spawned_count: 0,
        topsoil_found: 0,
        sand_found: 0,
    };

    let step = config.world_scan_step as usize;

    for x in (0..config.world_size as usize).step_by(step) {
        for z in (0..config.world_size as usize).step_by(step) {
            if stats.spawned_count >= config.wolf_max_count {
                return stats;
            }

            let world_x = x as i32;
            let world_z = z as i32;
            stats.positions_checked += 1;

            let hash = simple_hash(world_x * 41, world_z * 43);
            if hash > config.wolf_spawn_chance {
                continue;
            }

            if let Some((surface_y, voxel_type)) =
                find_surface(world, world_x, world_z, config.max_search_height)
            {
                update_terrain_stats(&mut stats, voxel_type);
                stats.valid_locations += 1;

                spawn_wolf_at(
                    commands,
                    wolf_mesh,
                    wolf_material,
                    world_x,
                    surface_y,
                    world_z,
                    hash,
                    config.wolf_health,
                );
                stats.spawned_count += 1;
            }
        }
    }

    stats
}

fn find_surface(world: &VoxelWorld, x: i32, z: i32, max_height: i32) -> Option<(i32, VoxelType)> {
    let mut result = None;

    for y in 1..max_height {
        let pos = IVec3::new(x, y, z);
        let above_pos = IVec3::new(x, y + 1, z);

        if let (Some(current), Some(above)) = (world.get_voxel(pos), world.get_voxel(above_pos)) {
            if is_spawnable_surface(current) && above == VoxelType::Air {
                result = Some((y, current));
            }
        }
    }

    result
}

fn is_spawnable_surface(voxel: VoxelType) -> bool {
    matches!(
        voxel,
        VoxelType::Sand | VoxelType::TopSoil | VoxelType::SubSoil | VoxelType::Rock
    )
}

fn update_terrain_stats(stats: &mut SpawnStatistics, voxel: VoxelType) {
    match voxel {
        VoxelType::TopSoil => stats.topsoil_found += 1,
        VoxelType::Sand => stats.sand_found += 1,
        _ => {}
    }
}

fn spawn_wolf_at(
    commands: &mut Commands,
    mesh: &Handle<Mesh>,
    material: &Handle<StandardMaterial>,
    x: i32,
    y: i32,
    z: i32,
    hash: f32,
    health: f32,
) {
    let rotation = hash * std::f32::consts::TAU;
    let spawn_pos = Vec3::new(x as f32 + 0.5, y as f32 + 1.5, z as f32 + 0.5);

    commands.spawn((
        Mesh3d(mesh.clone()),
        MeshMaterial3d(material.clone()),
        Transform::from_translation(spawn_pos).with_rotation(Quat::from_rotation_y(rotation)),
        GlobalTransform::default(),
        Visibility::Visible,
        InheritedVisibility::VISIBLE,
        ViewVisibility::default(),
        Wolf::default(),
        Health::new(health),
    ));
}

fn log_spawn_statistics(entity_type: &str, stats: &SpawnStatistics) {
    info!("=== {} SPAWN STATISTICS ===", entity_type.to_uppercase());
    info!("Positions checked: {}", stats.positions_checked);
    info!("Sand blocks found: {}", stats.sand_found);
    info!("TopSoil blocks found: {}", stats.topsoil_found);
    info!("Valid spawn locations: {}", stats.valid_locations);
    info!("✓ Spawned {} {}s in the world", stats.spawned_count, entity_type.to_lowercase());

    if stats.spawned_count == 0 {
        warn!(
            "⚠ NO {}S SPAWNED! Check terrain generation.",
            entity_type.to_uppercase()
        );
    }
}

// ============================================================================
// Materials & Meshes
// ============================================================================

fn create_wolf_material() -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgb(0.45, 0.40, 0.35),
        perceptual_roughness: 0.9,
        metallic: 0.0,
        ..default()
    }
}

/// Create a simple wolf mesh (box-based model)
fn create_wolf_mesh() -> Mesh {
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    // Body (main torso)
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(0.0, 0.5, 0.0),
        Vec3::new(1.2, 0.8, 0.6),
    );

    // Head
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(0.7, 0.6, 0.0),
        Vec3::new(0.6, 0.6, 0.6),
    );

    // Legs (4 legs)
    let leg_size = Vec3::new(0.2, 0.5, 0.2);
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(0.4, 0.0, 0.2),
        leg_size,
    );
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(0.4, 0.0, -0.2),
        leg_size,
    );
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(-0.4, 0.0, 0.2),
        leg_size,
    );
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(-0.4, 0.0, -0.2),
        leg_size,
    );

    // Tail
    add_box(
        &mut positions,
        &mut normals,
        &mut indices,
        Vec3::new(-0.7, 0.7, 0.0),
        Vec3::new(0.6, 0.2, 0.2),
    );

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Helper to add a box to the mesh
fn add_box(
    positions: &mut Vec<[f32; 3]>,
    normals: &mut Vec<[f32; 3]>,
    indices: &mut Vec<u32>,
    center: Vec3,
    size: Vec3,
) {
    let half = size / 2.0;

    let verts = [
        center + Vec3::new(-half.x, -half.y, -half.z),
        center + Vec3::new(half.x, -half.y, -half.z),
        center + Vec3::new(half.x, half.y, -half.z),
        center + Vec3::new(-half.x, half.y, -half.z),
        center + Vec3::new(-half.x, -half.y, half.z),
        center + Vec3::new(half.x, -half.y, half.z),
        center + Vec3::new(half.x, half.y, half.z),
        center + Vec3::new(-half.x, half.y, half.z),
    ];

    let faces = [
        ([verts[0], verts[1], verts[2], verts[3]], [0.0, 0.0, -1.0]), // Front
        ([verts[5], verts[4], verts[7], verts[6]], [0.0, 0.0, 1.0]),  // Back
        ([verts[4], verts[0], verts[3], verts[7]], [-1.0, 0.0, 0.0]), // Left
        ([verts[1], verts[5], verts[6], verts[2]], [1.0, 0.0, 0.0]),  // Right
        ([verts[4], verts[5], verts[1], verts[0]], [0.0, -1.0, 0.0]), // Bottom
        ([verts[3], verts[2], verts[6], verts[7]], [0.0, 1.0, 0.0]),  // Top
    ];

    for (face_verts, normal) in faces.iter() {
        let start_idx = positions.len() as u32;

        for vert in face_verts.iter() {
            positions.push(vert.to_array());
            normals.push(*normal);
        }

        indices.extend_from_slice(&[
            start_idx,
            start_idx + 1,
            start_idx + 2,
            start_idx,
            start_idx + 2,
            start_idx + 3,
        ]);
    }
}

// ============================================================================
// Animation System
// ============================================================================

/// Animate wolves with simple idle behavior
pub fn animate_wolves(
    time: Res<Time>,
    config: Res<EntitySpawnConfig>,
    mut wolves: Query<(&mut Wolf, &mut Transform), Without<super::Dead>>,
) {
    let dt = time.delta_secs();

    for (mut wolf, mut transform) in wolves.iter_mut() {
        wolf.wander_timer -= dt;

        if wolf.wander_timer <= 0.0 {
            wolf.wander_timer = config.wolf_wander_time_min
                + simple_hash(
                    (transform.translation.x * 100.0) as i32,
                    (transform.translation.z * 100.0) as i32,
                ) * config.wolf_wander_time_variance;

            let angle = simple_hash(
                (time.elapsed_secs() * 100.0) as i32,
                (transform.translation.x * 50.0) as i32,
            ) * std::f32::consts::TAU;

            wolf.wander_direction = Vec3::new(angle.cos(), 0.0, angle.sin());
        }

        transform.translation += wolf.wander_direction * dt * config.wolf_move_speed;

        if wolf.wander_direction.length() > 0.01 {
            let target_rotation = Quat::from_rotation_y(
                wolf.wander_direction.z.atan2(wolf.wander_direction.x) - std::f32::consts::FRAC_PI_2,
            );
            transform.rotation = transform.rotation.slerp(target_rotation, dt * 2.0);
        }
    }
}
