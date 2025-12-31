use bevy::prelude::*;
use bevy_mesh::VertexAttributeValues;

use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;

use super::{simple_hash, EntitySpawnConfig, EntitySpawnState, Health};

// ============================================================================
// Components
// ============================================================================

/// Component for rabbit entities
#[derive(Component)]
pub struct Rabbit {
    pub hop_timer: f32,
    pub hop_direction: Vec3,
    pub is_hopping: bool,
    pub hop_progress: f32,
}

impl Default for Rabbit {
    fn default() -> Self {
        Self {
            hop_timer: 1.0,
            hop_direction: Vec3::ZERO,
            is_hopping: false,
            hop_progress: 0.0,
        }
    }
}

/// Marker component to track rabbits that have had their textures fixed
#[derive(Component)]
pub struct RabbitTextureFixed;

// ============================================================================
// Asset Loading
// ============================================================================

#[derive(Resource)]
pub struct RabbitHandles {
    pub scene: Handle<Scene>,
    pub texture: Handle<Image>,
}

pub fn setup_rabbit_assets(mut commands: Commands, asset_server: Res<AssetServer>) {
    let scene = asset_server.load("models/white_rabbit/scene.gltf#Scene0");
    let texture = asset_server.load("models/white_rabbit/textures/Material_0_BaseColor.jpeg");
    commands.insert_resource(RabbitHandles { scene, texture });
}

// ============================================================================
// Texture Fixing System
// ============================================================================

pub fn fix_rabbit_textures(
    mut commands: Commands,
    rabbit_query: Query<(Entity, Option<&Children>), (With<Rabbit>, Without<RabbitTextureFixed>)>,
    children_query: Query<&Children>,
    material_query: Query<&MeshMaterial3d<StandardMaterial>>,
    mesh_query: Query<&Mesh3d>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut meshes: ResMut<Assets<Mesh>>,
    images: Res<Assets<Image>>,
    handles: Option<Res<RabbitHandles>>,
) {
    let Some(handles) = handles else { return };

    for (rabbit_entity, maybe_children) in rabbit_query.iter() {
        let Some(children) = maybe_children else {
            continue;
        };

        let fixed = process_rabbit_hierarchy(
            &mut commands,
            &children_query,
            &material_query,
            &mesh_query,
            &mut materials,
            &mut meshes,
            &images,
            &handles,
            children,
        );

        if fixed {
            commands.entity(rabbit_entity).insert(RabbitTextureFixed);
            info!("Fixed texture for rabbit {:?}", rabbit_entity);
        }
    }
}

fn process_rabbit_hierarchy(
    commands: &mut Commands,
    children_query: &Query<&Children>,
    material_query: &Query<&MeshMaterial3d<StandardMaterial>>,
    mesh_query: &Query<&Mesh3d>,
    materials: &mut Assets<StandardMaterial>,
    meshes: &mut Assets<Mesh>,
    images: &Assets<Image>,
    handles: &RabbitHandles,
    initial_children: &Children,
) -> bool {
    let mut stack: Vec<Entity> = initial_children.iter().collect();
    let mut fixed_any = false;

    while let Some(curr) = stack.pop() {
        fix_mesh_uvs_if_missing(mesh_query, meshes, curr);

        if material_query.get(curr).is_ok() {
            let new_material = create_rabbit_material(handles);
            let new_handle = materials.add(new_material);

            if !fixed_any {
                info!("Replacing material for rabbit entity {:?}.", curr);
                fix_mesh_uvs_if_degenerate(mesh_query, meshes, images, handles, curr);
            }

            commands.entity(curr).insert(MeshMaterial3d(new_handle));
            fixed_any = true;
        }

        if let Ok(kids) = children_query.get(curr) {
            stack.extend(kids.iter());
        }
    }

    fixed_any
}

fn fix_mesh_uvs_if_missing(mesh_query: &Query<&Mesh3d>, meshes: &mut Assets<Mesh>, entity: Entity) {
    let Ok(mesh_handle) = mesh_query.get(entity) else {
        return;
    };

    let Some(mesh) = meshes.get_mut(mesh_handle) else {
        return;
    };

    if mesh.contains_attribute(Mesh::ATTRIBUTE_UV_0) {
        return;
    }

    info!(
        "Mesh {:?} missing UVs. Generating procedural UVs...",
        mesh_handle.id()
    );

    if let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION).cloned()
    {
        let uvs: Vec<[f32; 2]> = positions.iter().map(|pos| [pos[0], pos[2]]).collect();
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
        info!("Inserted generated UVs into mesh.");
    }
}

fn fix_mesh_uvs_if_degenerate(
    mesh_query: &Query<&Mesh3d>,
    meshes: &mut Assets<Mesh>,
    images: &Assets<Image>,
    handles: &RabbitHandles,
    entity: Entity,
) {
    let Ok(mesh_handle) = mesh_query.get(entity) else {
        return;
    };

    let Some(mesh) = meshes.get_mut(mesh_handle) else {
        return;
    };

    let needs_fix = check_uvs_degenerate(mesh);
    if !needs_fix {
        return;
    }

    generate_spherical_uvs(mesh, images, handles, mesh_handle.id());
}

fn check_uvs_degenerate(mesh: &Mesh) -> bool {
    const MIN_VALID_UV_COUNT: usize = 10;

    if let Some(VertexAttributeValues::Float32x2(uvs)) = mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
        let non_zero_count = uvs
            .iter()
            .filter(|uv| uv[0] != 0.0 || uv[1] != 0.0)
            .count();
        info!(
            "Mesh UV check: {} total, {} non-zero.",
            uvs.len(),
            non_zero_count
        );

        if non_zero_count < MIN_VALID_UV_COUNT {
            info!("Detected degenerate/zero UVs. Forcing regeneration.");
            return true;
        }
        false
    } else {
        info!("Missing UV attribute. Forcing regeneration.");
        true
    }
}

fn generate_spherical_uvs(
    mesh: &mut Mesh,
    images: &Assets<Image>,
    handles: &RabbitHandles,
    mesh_id: AssetId<Mesh>,
) {
    let Some(VertexAttributeValues::Float32x3(positions)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return;
    };

    let bounds = compute_mesh_bounds(positions);

    if let Some(img) = images.get(&handles.texture) {
        info!(
            "Rabbit Texture Info: {:?} (Size: {:?})",
            handles.texture.id(),
            img.size()
        );
    }

    let uvs: Vec<[f32; 2]> = positions
        .iter()
        .map(|pos| compute_spherical_uv(pos, &bounds))
        .collect();

    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, VertexAttributeValues::Float32x2(uvs));
    info!(
        "Inserted generated Spherical UVs into mesh {:?} (Bounds Center).",
        mesh_id
    );

    if let Err(e) = mesh.generate_tangents() {
        warn!("Failed to generate tangents: {:?}", e);
    }
}

struct MeshBounds {
    center: Vec3,
}

fn compute_mesh_bounds(positions: &[[f32; 3]]) -> MeshBounds {
    let mut min = Vec3::splat(f32::MAX);
    let mut max = Vec3::splat(f32::MIN);

    for pos in positions {
        min.x = min.x.min(pos[0]);
        max.x = max.x.max(pos[0]);
        min.y = min.y.min(pos[1]);
        max.y = max.y.max(pos[1]);
        min.z = min.z.min(pos[2]);
        max.z = max.z.max(pos[2]);
    }

    MeshBounds {
        center: (min + max) / 2.0,
    }
}

fn compute_spherical_uv(pos: &[f32; 3], bounds: &MeshBounds) -> [f32; 2] {
    let dx = pos[0] - bounds.center.x;
    let dy = pos[1] - bounds.center.y;
    let dz = pos[2] - bounds.center.z;

    let r = (dx * dx + dy * dy + dz * dz).sqrt();

    // Longitude (angle around Y) -> U
    let angle = dz.atan2(dx);
    let u = (angle / (std::f32::consts::PI * 2.0)) + 0.5;

    // Latitude (angle from north pole) -> V
    let lat = (dy / r).acos();
    let v = lat / std::f32::consts::PI;

    [u, v]
}

fn create_rabbit_material(handles: &RabbitHandles) -> StandardMaterial {
    StandardMaterial {
        base_color_texture: Some(handles.texture.clone()),
        base_color: Color::WHITE,
        perceptual_roughness: 0.9,
        metallic: 0.0,
        alpha_mode: AlphaMode::Opaque,
        ..default()
    }
}

// ============================================================================
// Spawning System
// ============================================================================

/// Spawn rabbits on the terrain
pub fn spawn_rabbits(
    mut commands: Commands,
    world: Res<VoxelWorld>,
    config: Res<EntitySpawnConfig>,
    mut state: ResMut<EntitySpawnState>,
    handles: Option<Res<RabbitHandles>>,
) {
    let Some(handles) = handles else { return };

    // Wait for chunks to be fully generated (rabbits need longer delay)
    state.rabbits_frame_counter += 1;
    if state.rabbits_frame_counter < config.spawn_delay_frames * 2 {
        return;
    }

    if world.get_chunk(IVec3::ZERO).is_none() {
        info!("Waiting for world chunks to load for rabbits...");
        return;
    }

    state.rabbits_spawned = true;
    info!(
        "Starting rabbit spawn process (after {} frames)...",
        state.rabbits_frame_counter
    );

    let stats = spawn_rabbits_on_terrain(&mut commands, &world, &config, &handles);

    log_rabbit_statistics(&stats);
}

struct RabbitSpawnStats {
    positions_checked: usize,
    surfaces_found: usize,
    spawned_count: usize,
}

fn spawn_rabbits_on_terrain(
    commands: &mut Commands,
    world: &VoxelWorld,
    config: &EntitySpawnConfig,
    handles: &RabbitHandles,
) -> RabbitSpawnStats {
    let mut stats = RabbitSpawnStats {
        positions_checked: 0,
        surfaces_found: 0,
        spawned_count: 0,
    };

    let step = config.rabbit_spawn_step as usize;
    let margin = 10;
    let world_max = config.world_size as usize - margin;

    for x in (margin..world_max).step_by(step) {
        for z in (margin..world_max).step_by(step) {
            if stats.spawned_count >= config.rabbit_max_count {
                return stats;
            }

            let world_x = x as i32;
            let world_z = z as i32;
            stats.positions_checked += 1;

            if let Some(surface_y) =
                find_rabbit_surface(world, world_x, world_z, config.max_search_height)
            {
                stats.surfaces_found += 1;

                spawn_rabbit_at(
                    commands,
                    handles,
                    config,
                    world_x,
                    surface_y,
                    world_z,
                    stats.spawned_count,
                );
                stats.spawned_count += 1;
            }
        }
    }

    stats
}

fn find_rabbit_surface(world: &VoxelWorld, x: i32, z: i32, max_height: i32) -> Option<i32> {
    for y in (1..max_height).rev() {
        let pos = IVec3::new(x, y, z);
        let above_pos = IVec3::new(x, y + 1, z);

        if let (Some(current), Some(above)) = (world.get_voxel(pos), world.get_voxel(above_pos)) {
            if current.is_solid() && !current.is_liquid() && above == VoxelType::Air {
                return Some(y);
            }
        }
    }
    None
}

fn spawn_rabbit_at(
    commands: &mut Commands,
    handles: &RabbitHandles,
    config: &EntitySpawnConfig,
    x: i32,
    y: i32,
    z: i32,
    index: usize,
) {
    let hash = simple_hash(x * 73, z * 67);
    let rotation = hash * std::f32::consts::TAU;
    let spawn_pos = Vec3::new(x as f32 + 0.5, y as f32 + 1.0, z as f32 + 0.5);

    info!("  Spawning rabbit #{} at {:?}", index + 1, spawn_pos);

    commands.spawn((
        SceneRoot(handles.scene.clone()),
        Transform::from_translation(spawn_pos)
            .with_rotation(Quat::from_rotation_y(rotation))
            .with_scale(Vec3::splat(config.rabbit_scale)),
        GlobalTransform::default(),
        Visibility::Visible,
        InheritedVisibility::VISIBLE,
        ViewVisibility::default(),
        Rabbit::default(),
        Health::new(config.rabbit_health),
    ));
}

fn log_rabbit_statistics(stats: &RabbitSpawnStats) {
    info!("=== RABBIT SPAWN STATISTICS ===");
    info!("Positions checked: {}", stats.positions_checked);
    info!("Surfaces found: {}", stats.surfaces_found);
    info!("✓ Spawned {} rabbits in the world", stats.spawned_count);

    if stats.spawned_count == 0 {
        warn!("⚠ NO RABBITS SPAWNED! Check terrain generation.");
    }
}

// ============================================================================
// Animation System
// ============================================================================

/// Animate rabbits with hopping behavior
pub fn animate_rabbits(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    config: Res<EntitySpawnConfig>,
    mut rabbits: Query<(&mut Rabbit, &mut Transform), Without<super::Dead>>,
) {
    let dt = time.delta_secs();

    for (mut rabbit, mut transform) in rabbits.iter_mut() {
        update_hop_state(&mut rabbit, &mut transform, &time, &config, dt);
        apply_gravity(&mut transform, &world, &rabbit, &config);
    }
}

fn update_hop_state(
    rabbit: &mut Rabbit,
    transform: &mut Transform,
    time: &Time,
    config: &EntitySpawnConfig,
    dt: f32,
) {
    rabbit.hop_timer -= dt;

    if rabbit.is_hopping {
        rabbit.hop_progress += dt * config.rabbit_hop_speed;

        if rabbit.hop_progress >= 1.0 {
            rabbit.is_hopping = false;
            rabbit.hop_progress = 0.0;
            rabbit.hop_timer = config.rabbit_hop_time_min
                + simple_hash(
                    (transform.translation.x * 100.0) as i32,
                    (transform.translation.z * 100.0) as i32,
                ) * config.rabbit_hop_time_variance;
        } else {
            let forward_motion = rabbit.hop_direction * dt * 2.0;
            transform.translation.x += forward_motion.x;
            transform.translation.z += forward_motion.z;
        }
    } else if rabbit.hop_timer <= 0.0 {
        start_new_hop(rabbit, transform, time);
    }
}

fn start_new_hop(rabbit: &mut Rabbit, transform: &mut Transform, time: &Time) {
    rabbit.is_hopping = true;
    rabbit.hop_progress = 0.0;

    let angle = simple_hash(
        (time.elapsed_secs() * 100.0) as i32,
        (transform.translation.x * 50.0) as i32,
    ) * std::f32::consts::TAU;

    rabbit.hop_direction = Vec3::new(angle.cos(), 0.0, angle.sin());

    if rabbit.hop_direction.length() > 0.01 {
        let target_rotation = Quat::from_rotation_y(
            rabbit.hop_direction.z.atan2(rabbit.hop_direction.x) - std::f32::consts::FRAC_PI_2,
        );
        transform.rotation = target_rotation;
    }
}

fn apply_gravity(
    transform: &mut Transform,
    world: &VoxelWorld,
    rabbit: &Rabbit,
    config: &EntitySpawnConfig,
) {
    let x = transform.translation.x.floor() as i32;
    let z = transform.translation.z.floor() as i32;
    let start_y = (transform.translation.y + 1.0).floor() as i32;

    let ground_y = find_ground_height(world, x, z, start_y);
    let hop_height = calculate_hop_height(rabbit, config);

    transform.translation.y = ground_y + hop_height;
}

fn find_ground_height(world: &VoxelWorld, x: i32, z: i32, start_y: i32) -> f32 {
    for y in (0..=start_y).rev() {
        if let Some(voxel) = world.get_voxel(IVec3::new(x, y, z)) {
            if voxel.is_solid() {
                return y as f32 + 1.0;
            }
        }
    }
    0.0
}

fn calculate_hop_height(rabbit: &Rabbit, config: &EntitySpawnConfig) -> f32 {
    if rabbit.is_hopping {
        (rabbit.hop_progress * std::f32::consts::PI).sin() * config.rabbit_hop_height
    } else {
        0.0
    }
}
