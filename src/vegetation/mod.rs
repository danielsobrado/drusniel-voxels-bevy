pub mod grass_material;

use crate::camera::controller::PlayerCamera;
use crate::constants::WATER_LEVEL;
use crate::rendering::materials::WaterMaterial;
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::asset::RenderAssetUsages;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology, VertexAttributeValues};

pub use grass_material::{GrassMaterial, GrassMaterialHandles, GrassMaterialPlugin};

// ============================================================================
// Configuration
// ============================================================================

/// Centralized configuration for all vegetation parameters
#[derive(Resource)]
pub struct VegetationConfig {
    // Grass settings
    pub grass_density: u32,
    pub grass_max_per_chunk: usize,
    pub grass_blade_height: f32,
    pub grass_blade_width: f32,
    pub grass_spawn_threshold: f32,
    pub grass_blades_per_block_min: i32,
    pub grass_blades_per_block_variance: f32,
    pub max_individual_grass_blades: usize,

    // Rock settings
    pub rock_spawn_threshold: f32,
    pub rock_max_count: usize,
    pub rock_scale_min: f32,
    pub rock_scale_variance: f32,

    // Tree settings
    pub tree_target_count: usize,
    pub tree_max_attempts: usize,
    pub tree_min_distance: f32,
    pub tree_spawn_min_radius: f32,
    pub tree_spawn_max_radius: f32,
    pub tree_spawn_delay_secs: f32,
    pub tree_scale_min: f32,
    pub tree_scale_variance: f32,

    // Particle settings
    pub particle_count: usize,
    pub particle_radius_min: f32,
    pub particle_radius_max: f32,
    pub particle_height_variance: f32,
    pub particle_wrap_distance: f32,
    pub particle_bob_amplitude: f32,

    // World bounds for spawning
    pub world_chunks_x: i32,
    pub world_chunks_z: i32,
    pub world_chunks_y: i32,
    pub world_blocks_x: i32,
    pub world_blocks_z: i32,
    pub surface_search_max_y: i32,
    pub chunk_size: i32,
}

impl Default for VegetationConfig {
    fn default() -> Self {
        Self {
            // Grass
            grass_density: 20,
            grass_max_per_chunk: 2000,
            grass_blade_height: 1.4,
            grass_blade_width: 0.18,
            grass_spawn_threshold: 0.4,
            grass_blades_per_block_min: 3,
            grass_blades_per_block_variance: 4.0,
            max_individual_grass_blades: 15000,

            // Rocks
            rock_spawn_threshold: 0.995,
            rock_max_count: 200,
            rock_scale_min: 0.5,
            rock_scale_variance: 1.5,

            // Trees
            tree_target_count: 15,
            tree_max_attempts: 600,
            tree_min_distance: 12.0,
            tree_spawn_min_radius: 24.0,
            tree_spawn_max_radius: 96.0,
            tree_spawn_delay_secs: 10.0,
            tree_scale_min: 0.8,
            tree_scale_variance: 0.4,

            // Particles
            particle_count: 20,
            particle_radius_min: 5.0,
            particle_radius_max: 14.0,
            particle_height_variance: 6.0,
            particle_wrap_distance: 15.0,
            particle_bob_amplitude: 0.2,

            // World bounds
            world_chunks_x: 32,
            world_chunks_z: 32,
            world_chunks_y: 4,
            world_blocks_x: 512,
            world_blocks_z: 512,
            surface_search_max_y: 64,
            chunk_size: 16,
        }
    }
}

// ============================================================================
// State Management
// ============================================================================

/// Consolidated spawn state for all vegetation types
#[derive(Resource, Default)]
pub struct VegetationState {
    pub grass_spawned: bool,
    pub rocks_spawned: bool,
    pub particles_spawned: bool,
    pub trees_spawned: bool,
}

/// Run condition: grass not yet spawned
fn should_spawn_grass(state: Res<VegetationState>) -> bool {
    !state.grass_spawned
}

/// Run condition: rocks not yet spawned
fn should_spawn_rocks(state: Res<VegetationState>) -> bool {
    !state.rocks_spawned
}

/// Run condition: particles not yet spawned
fn should_spawn_particles(state: Res<VegetationState>) -> bool {
    !state.particles_spawned
}

/// Run condition: trees not yet spawned
fn should_spawn_trees(state: Res<VegetationState>) -> bool {
    !state.trees_spawned
}

// ============================================================================
// Components
// ============================================================================

/// Minimal info for a single grass blade instance
struct GrassInstance {
    position: Vec3,
    normal: Vec3,
}

/// Component for grass blade entities
#[derive(Component)]
pub struct GrassBlade;

/// Component for rock prop entities
#[derive(Component)]
pub struct RockProp;

/// Marker that a voxel chunk mesh already has procedural grass attached
#[derive(Component)]
pub struct ChunkGrassAttached;

/// Component for floating particles (pollen, dust, etc)
#[derive(Component)]
pub struct FloatingParticle {
    pub base_y: f32,
    pub phase: f32,
    pub speed: f32,
    pub drift: Vec3,
}

// ============================================================================
// Shared Assets
// ============================================================================

/// Cached grass assets for procedural patches
#[derive(Resource, Default)]
pub struct GrassPatchAssets {
    pub blade_mesh: Handle<Mesh>,
    pub materials: Vec<Handle<GrassMaterial>>,
}

// ============================================================================
// Material Presets
// ============================================================================

/// Creates grass material configurations for procedural chunk grass (vivid greens)
fn create_procedural_grass_materials() -> Vec<GrassMaterial> {
    vec![
        GrassMaterial::new(
            LinearRgba::new(0.16, 0.28, 0.05, 1.0),
            LinearRgba::new(0.60, 0.85, 0.35, 1.0),
            0.35,
            1.8,
            0.08,
        ),
        GrassMaterial::new(
            LinearRgba::new(0.18, 0.32, 0.07, 1.0),
            LinearRgba::new(0.70, 0.90, 0.38, 1.0),
            0.30,
            1.5,
            0.10,
        ),
        GrassMaterial::new(
            LinearRgba::new(0.12, 0.26, 0.06, 1.0),
            LinearRgba::new(0.55, 0.78, 0.32, 1.0),
            0.40,
            2.0,
            0.07,
        ),
    ]
}

/// Creates grass material configurations for individual blades (golden/Valheim style)
fn create_individual_grass_materials() -> Vec<GrassMaterial> {
    vec![
        // Golden/yellow grass (dominant in Valheim meadows)
        GrassMaterial::new(
            LinearRgba::new(0.25, 0.20, 0.08, 1.0),
            LinearRgba::new(0.95, 0.85, 0.45, 1.0),
            0.35,
            1.8,
            0.08,
        ),
        // Warm tan grass
        GrassMaterial::new(
            LinearRgba::new(0.30, 0.22, 0.10, 1.0),
            LinearRgba::new(0.85, 0.75, 0.50, 1.0),
            0.30,
            1.5,
            0.10,
        ),
        // Light green-gold mix
        GrassMaterial::new(
            LinearRgba::new(0.15, 0.20, 0.08, 1.0),
            LinearRgba::new(0.70, 0.80, 0.40, 1.0),
            0.40,
            2.0,
            0.07,
        ),
        // Pale straw color
        GrassMaterial::new(
            LinearRgba::new(0.35, 0.30, 0.15, 1.0),
            LinearRgba::new(0.95, 0.90, 0.60, 1.0),
            0.32,
            1.6,
            0.09,
        ),
    ]
}

// ============================================================================
// Hash Functions
// ============================================================================

/// Simple deterministic hash function returning a value in [0, 1]
fn simple_hash(x: i32, z: i32) -> f32 {
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    let n = n ^ (n >> 16);
    (n as u32 as f32) / (u32::MAX as f32)
}

/// SplitMix32-style bit mixer for decorrelating nearby integer seeds
fn mix_bits32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

// ============================================================================
// Mesh Creation
// ============================================================================

/// Create a grass blade mesh (crossed quads for billboard effect)
fn create_grass_blade_mesh(config: &VegetationConfig) -> Mesh {
    let height = config.grass_blade_height;
    let width = config.grass_blade_width;

    // Two crossed quads for X shape when viewed from above
    // UV.y goes from 1 (bottom) to 0 (top) for shader compatibility
    let positions = vec![
        // Quad 1 (aligned with X axis)
        [-width, 0.0, 0.0],
        [width, 0.0, 0.0],
        [width * 0.2, height, 0.0],
        [-width * 0.2, height, 0.0],
        // Quad 2 (aligned with Z axis)
        [0.0, 0.0, -width],
        [0.0, 0.0, width],
        [0.0, height, width * 0.2],
        [0.0, height, -width * 0.2],
    ];

    let normals = vec![
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
    ];

    // UVs: y=1 at bottom (no movement), y=0 at top (max movement)
    let uvs = vec![
        [0.0, 1.0],
        [1.0, 1.0],
        [1.0, 0.0],
        [0.0, 0.0],
        [0.0, 1.0],
        [1.0, 1.0],
        [1.0, 0.0],
        [0.0, 0.0],
    ];

    // Vertex colors for shader blending (base to tip gradient)
    let colors: Vec<[f32; 4]> = vec![
        [0.35, 0.30, 0.15, 1.0],
        [0.35, 0.30, 0.15, 1.0],
        [0.95, 0.85, 0.45, 1.0],
        [0.95, 0.85, 0.45, 1.0],
        [0.35, 0.30, 0.15, 1.0],
        [0.35, 0.30, 0.15, 1.0],
        [0.95, 0.85, 0.45, 1.0],
        [0.95, 0.85, 0.45, 1.0],
    ];

    let indices = vec![
        0, 1, 2, 0, 2, 3, // Quad 1 front
        0, 2, 1, 0, 3, 2, // Quad 1 back
        4, 5, 6, 4, 6, 7, // Quad 2 front
        4, 6, 5, 4, 7, 6, // Quad 2 back
    ];

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Create a simple rock mesh (deformed sphere)
fn create_rock_mesh(size: f32) -> Mesh {
    Sphere::new(size * 0.5).mesh().build()
}

// ============================================================================
// Grass Patch Systems
// ============================================================================

/// Build shared grass blade mesh and materials that all patches reuse
pub fn setup_grass_patch_assets(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut grass_materials: ResMut<Assets<GrassMaterial>>,
    mut material_handles: ResMut<GrassMaterialHandles>,
    config: Res<VegetationConfig>,
) {
    let blade = meshes.add(create_grass_blade_mesh(&config));
    info!("Created grass blade template mesh");

    let material_configs = create_procedural_grass_materials();
    let material_handles_vec: Vec<Handle<GrassMaterial>> = material_configs
        .into_iter()
        .map(|mat| grass_materials.add(mat))
        .collect();

    material_handles.handles = material_handles_vec.clone();
    info!(
        "Created {} grass material variations",
        material_handles_vec.len()
    );

    commands.insert_resource(GrassPatchAssets {
        blade_mesh: blade,
        materials: material_handles_vec,
    });
    info!("GrassPatchAssets resource initialized");
}

/// Spawn procedural grass patches for solid voxel chunk meshes
pub fn attach_procedural_grass_to_chunks(
    mut commands: Commands,
    assets: Res<GrassPatchAssets>,
    config: Res<VegetationConfig>,
    water_material: Res<WaterMaterial>,
    mut meshes: ResMut<Assets<Mesh>>,
    blocky_chunk_query: Query<
        (
            Entity,
            &ChunkMesh,
            &Mesh3d,
            &MeshMaterial3d<StandardMaterial>,
            &Transform,
        ),
        Without<ChunkGrassAttached>,
    >,
    triplanar_chunk_query: Query<
        (
            Entity,
            &ChunkMesh,
            &Mesh3d,
            &MeshMaterial3d<crate::rendering::triplanar_material::TriplanarMaterial>,
            &Transform,
        ),
        Without<ChunkGrassAttached>,
    >,
) {
    // Process blocky chunks
    for (entity, chunk, chunk_mesh, material, transform) in blocky_chunk_query.iter() {
        if material.0 == water_material.handle {
            continue;
        }
        process_chunk_for_grass(
            &mut commands,
            &assets,
            &mut meshes,
            entity,
            chunk,
            chunk_mesh,
            transform,
            &config,
        );
    }

    // Process triplanar chunks (surface nets mode)
    for (entity, chunk, chunk_mesh, _material, transform) in triplanar_chunk_query.iter() {
        process_chunk_for_grass(
            &mut commands,
            &assets,
            &mut meshes,
            entity,
            chunk,
            chunk_mesh,
            transform,
            &config,
        );
    }
}

/// Helper to spawn grass on a single chunk
fn process_chunk_for_grass(
    commands: &mut Commands,
    assets: &GrassPatchAssets,
    meshes: &mut Assets<Mesh>,
    entity: Entity,
    chunk: &ChunkMesh,
    chunk_mesh: &Mesh3d,
    transform: &Transform,
    config: &VegetationConfig,
) {
    let Some(chunk_source_mesh) = meshes.get(&chunk_mesh.0) else {
        trace!("Chunk mesh not yet loaded for grass attachment");
        return;
    };

    let instances = collect_grass_instances(
        chunk_source_mesh,
        transform,
        config.grass_density,
        config.grass_max_per_chunk,
    );
    if instances.is_empty() {
        return;
    }

    let Some(template_mesh) = meshes.get(&assets.blade_mesh) else {
        trace!("Grass blade template mesh not yet loaded");
        return;
    };

    let Some(grass_mesh) = build_grass_patch_mesh(template_mesh, &instances) else {
        trace!("Failed to build grass patch mesh from {} instances", instances.len());
        return;
    };

    let mesh_handle = meshes.add(grass_mesh);

    // Pick material based on chunk position for deterministic variation
    let material_idx = ((chunk.chunk_position.x.abs() + chunk.chunk_position.z.abs()) as usize)
        % assets.materials.len();
    let material_handle = assets.materials[material_idx].clone();

    commands.entity(entity).insert(ChunkGrassAttached);

    commands.spawn((
        Mesh3d(mesh_handle),
        MeshMaterial3d(material_handle),
        Transform::IDENTITY,
        GlobalTransform::IDENTITY,
        Visibility::Visible,
        InheritedVisibility::VISIBLE,
        ViewVisibility::default(),
    ));
}

/// Extract mesh vertex attributes safely
fn extract_mesh_positions(mesh: &Mesh) -> Option<&Vec<[f32; 3]>> {
    match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(values)) => Some(values),
        _ => None,
    }
}

fn extract_mesh_normals(mesh: &Mesh) -> Option<&Vec<[f32; 3]>> {
    match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(values)) => Some(values),
        _ => None,
    }
}

fn extract_mesh_uvs(mesh: &Mesh) -> Option<&Vec<[f32; 2]>> {
    match mesh.attribute(Mesh::ATTRIBUTE_UV_0) {
        Some(VertexAttributeValues::Float32x2(values)) => Some(values),
        _ => None,
    }
}

fn extract_mesh_indices(mesh: &Mesh) -> Option<Vec<u32>> {
    match mesh.indices() {
        Some(Indices::U32(idx)) => Some(idx.clone()),
        Some(Indices::U16(idx)) => Some(idx.iter().map(|i| *i as u32).collect()),
        _ => None,
    }
}

/// Extract grass instances from a mesh by sampling upward-facing triangles
fn collect_grass_instances(
    mesh: &Mesh,
    transform: &Transform,
    density: u32,
    max_count: usize,
) -> Vec<GrassInstance> {
    let Some(positions) = extract_mesh_positions(mesh) else {
        warn!("Mesh has no POSITION attribute");
        return Vec::new();
    };

    let Some(normals) = extract_mesh_normals(mesh) else {
        warn!("Mesh has no NORMAL attribute");
        return Vec::new();
    };

    let Some(indices) = extract_mesh_indices(mesh) else {
        warn!("Mesh has no indices");
        return Vec::new();
    };

    let mut instances = Vec::new();

    // Per-chunk salt to avoid alignment between adjacent chunks
    let chunk_seed = compute_chunk_seed(transform);

    for (tri_idx, tri) in indices.chunks(3).enumerate() {
        if tri.len() < 3 {
            continue;
        }

        let (v0, v1, v2) = transform_triangle_vertices(positions, tri, transform);
        let normal_world = compute_world_normal(normals, tri, transform);

        let edge1 = v1 - v0;
        let edge2 = v2 - v0;
        let area = edge1.cross(edge2).length() * 0.5;

        if area <= 0.0001 {
            continue;
        }

        let normal_dir = normal_world.normalize();
        if normal_dir.y <= 0.25 {
            continue;
        }

        let blade_count = (density as f32 * area).ceil() as u32;
        let seed_base = compute_triangle_seed(v0, v1, v2, tri_idx, chunk_seed);

        for i in 0..blade_count {
            let position = sample_point_on_triangle(v0, v1, v2, seed_base, i);

            instances.push(GrassInstance {
                position,
                normal: normal_dir,
            });

            if instances.len() >= max_count {
                return instances;
            }
        }
    }

    instances
}

fn compute_chunk_seed(transform: &Transform) -> u32 {
    let cx = transform.translation.x.floor() as i32;
    let cz = transform.translation.z.floor() as i32;
    mix_bits32(cx as u32 ^ (cz as u32).wrapping_mul(0x9e37_79b9) ^ 0x85eb_ca6b)
}

fn transform_triangle_vertices(
    positions: &[[f32; 3]],
    tri: &[u32],
    transform: &Transform,
) -> (Vec3, Vec3, Vec3) {
    let v0 = transform.transform_point(Vec3::from(positions[tri[0] as usize]));
    let v1 = transform.transform_point(Vec3::from(positions[tri[1] as usize]));
    let v2 = transform.transform_point(Vec3::from(positions[tri[2] as usize]));
    (v0, v1, v2)
}

fn compute_world_normal(normals: &[[f32; 3]], tri: &[u32], transform: &Transform) -> Vec3 {
    let normal_local = Vec3::from(normals[tri[0] as usize]);
    transform.rotation * normal_local
}

fn compute_triangle_seed(v0: Vec3, v1: Vec3, v2: Vec3, tri_idx: usize, chunk_seed: u32) -> u32 {
    let centroid = (v0 + v1 + v2) / 3.0;
    let qx = (centroid.x * 4096.0).round() as i32;
    let qy = (centroid.y * 4096.0).round() as i32;
    let qz = (centroid.z * 4096.0).round() as i32;

    let seed_bits = (qx as u32).rotate_left(3)
        ^ (qz as u32).rotate_left(17)
        ^ (qy as u32).rotate_left(29)
        ^ (tri_idx as u32).wrapping_mul(0x9e37_79b9)
        ^ chunk_seed;

    mix_bits32(seed_bits)
}

fn sample_point_on_triangle(v0: Vec3, v1: Vec3, v2: Vec3, seed_base: u32, index: u32) -> Vec3 {
    let h1 = mix_bits32(seed_base ^ (index).wrapping_mul(0x85eb_ca6b));
    let h2 = mix_bits32(seed_base ^ (index).wrapping_mul(0xc2b2_ae35) ^ 0x27d4_eb2d);

    let u1 = (h1 as f32) / (u32::MAX as f32);
    let u2 = (h2 as f32) / (u32::MAX as f32);

    // Area-corrected barycentric sampling
    let r1 = u1.sqrt();
    let r2 = u2;

    let bary = Vec3::new(1.0 - r1, r1 * (1.0 - r2), r1 * r2);
    v0 * bary.x + v1 * bary.y + v2 * bary.z
}

/// Build a combined grass mesh for all instances using the blade template
fn build_grass_patch_mesh(template: &Mesh, instances: &[GrassInstance]) -> Option<Mesh> {
    if instances.is_empty() {
        return None;
    }

    let positions = extract_mesh_positions(template)?;
    let normals = extract_mesh_normals(template).cloned();
    let uvs = extract_mesh_uvs(template).cloned();
    let indices = extract_mesh_indices(template)?;

    let base_len = positions.len() as u32;
    let mut out_positions = Vec::with_capacity(positions.len() * instances.len());
    let mut out_normals =
        Vec::with_capacity(normals.as_ref().map(|n| n.len()).unwrap_or(0) * instances.len());
    let mut out_uvs: Vec<[f32; 2]> =
        Vec::with_capacity(uvs.as_ref().map(|u| u.len()).unwrap_or(0) * instances.len());
    let mut out_indices = Vec::with_capacity(indices.len() * instances.len());

    for (i, instance) in instances.iter().enumerate() {
        let (rotation, scale) = compute_blade_transform(instance, i);
        let base_pos = instance.position + instance.normal * 0.05;
        let transform =
            Mat4::from_scale_rotation_translation(Vec3::splat(scale), rotation, base_pos);
        let normal_matrix = Mat3::from_quat(rotation);

        let index_offset = (i as u32) * base_len;
        out_indices.extend(indices.iter().map(|idx| idx + index_offset));

        for pos in positions {
            let world_pos = transform.transform_point3(Vec3::from(*pos));
            out_positions.push(world_pos.to_array());
        }

        if let Some(ref src_normals) = normals {
            for n in src_normals {
                let world_normal = normal_matrix * Vec3::from(*n);
                out_normals.push(world_normal.to_array());
            }
        }

        if let Some(ref src_uvs) = uvs {
            out_uvs.extend(src_uvs.iter());
        }
    }

    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::default(),
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, out_positions);

    if !out_normals.is_empty() {
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, out_normals);
    }
    if !out_uvs.is_empty() {
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, out_uvs);
    }

    mesh.insert_indices(Indices::U32(out_indices));
    Some(mesh)
}

fn compute_blade_transform(instance: &GrassInstance, index: usize) -> (Quat, f32) {
    let hash = simple_hash(
        (instance.position.x as i32).wrapping_add(index as i32 * 13),
        (instance.position.z as i32).wrapping_sub(index as i32 * 7),
    );
    let yaw = hash * std::f32::consts::TAU;
    let scale = 0.8 + simple_hash(index as i32 * 17, index as i32 * 29) * 0.6;

    let align = Quat::from_rotation_arc(Vec3::Y, instance.normal);
    let rotation = align * Quat::from_rotation_y(yaw);

    (rotation, scale)
}

// ============================================================================
// Individual Grass Blade System
// ============================================================================

/// Spawn individual grass blades on grass block surfaces with wind shader
pub fn spawn_grass_blades(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut grass_materials: ResMut<Assets<GrassMaterial>>,
    mut material_handles: ResMut<GrassMaterialHandles>,
    world: Res<VoxelWorld>,
    config: Res<VegetationConfig>,
    mut state: ResMut<VegetationState>,
) {
    // Wait until world has at least one chunk loaded
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    state.grass_spawned = true;

    let grass_mesh = meshes.add(create_grass_blade_mesh(&config));
    let grass_handles = create_and_register_grass_materials(
        &mut grass_materials,
        &mut material_handles,
        create_individual_grass_materials(),
    );

    let grass_count = spawn_grass_on_terrain(
        &mut commands,
        &world,
        &config,
        &grass_mesh,
        &grass_handles,
    );

    info!("Spawned {} grass blades with wind animation", grass_count);
}

fn create_and_register_grass_materials(
    grass_materials: &mut Assets<GrassMaterial>,
    material_handles: &mut GrassMaterialHandles,
    configs: Vec<GrassMaterial>,
) -> Vec<Handle<GrassMaterial>> {
    let handles: Vec<Handle<GrassMaterial>> = configs
        .into_iter()
        .map(|mat| grass_materials.add(mat))
        .collect();
    material_handles.handles = handles.clone();
    handles
}

fn spawn_grass_on_terrain(
    commands: &mut Commands,
    world: &VoxelWorld,
    config: &VegetationConfig,
    grass_mesh: &Handle<Mesh>,
    grass_handles: &[Handle<GrassMaterial>],
) -> usize {
    let mut grass_count = 0;

    for chunk_x in 0..config.world_chunks_x {
        for chunk_z in 0..config.world_chunks_z {
            for chunk_y in 0..config.world_chunks_y {
                let chunk_pos = IVec3::new(chunk_x, chunk_y, chunk_z);
                if let Some(chunk) = world.get_chunk(chunk_pos) {
                    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

                    grass_count += spawn_grass_in_chunk(
                        commands,
                        world,
                        chunk,
                        chunk_origin,
                        config,
                        grass_mesh,
                        grass_handles,
                        config.max_individual_grass_blades - grass_count,
                    );

                    if grass_count >= config.max_individual_grass_blades {
                        return grass_count;
                    }
                }
            }
        }
    }

    grass_count
}

fn spawn_grass_in_chunk(
    commands: &mut Commands,
    world: &VoxelWorld,
    chunk: &crate::voxel::chunk::Chunk,
    chunk_origin: IVec3,
    config: &VegetationConfig,
    grass_mesh: &Handle<Mesh>,
    grass_handles: &[Handle<GrassMaterial>],
    remaining_budget: usize,
) -> usize {
    let mut spawned = 0;

    for x in 0..16 {
        for z in 0..16 {
            for y in 0..16 {
                if spawned >= remaining_budget {
                    return spawned;
                }

                let local = UVec3::new(x, y, z);
                let voxel = chunk.get(local);

                if voxel != VoxelType::TopSoil {
                    continue;
                }

                let world_pos = chunk_origin + IVec3::new(x as i32, y as i32, z as i32);

                // Skip underwater grass
                if world_pos.y <= WATER_LEVEL + 1 {
                    continue;
                }

                let above = world_pos + IVec3::Y;
                let Some(above_voxel) = world.get_voxel(above) else {
                    continue;
                };

                if above_voxel != VoxelType::Air {
                    continue;
                }

                let hash = simple_hash(world_pos.x, world_pos.z);
                if hash <= config.grass_spawn_threshold {
                    continue;
                }

                let blade_count =
                    config.grass_blades_per_block_min + (hash * config.grass_blades_per_block_variance) as i32;

                for i in 0..blade_count {
                    spawn_single_grass_blade(
                        commands,
                        world_pos,
                        i,
                        grass_mesh,
                        grass_handles,
                    );
                    spawned += 1;
                }
            }
        }
    }

    spawned
}

fn spawn_single_grass_blade(
    commands: &mut Commands,
    world_pos: IVec3,
    blade_index: i32,
    grass_mesh: &Handle<Mesh>,
    grass_handles: &[Handle<GrassMaterial>],
) {
    let offset_x = (simple_hash(world_pos.x + blade_index * 17, world_pos.z) - 0.5) * 0.9;
    let offset_z = (simple_hash(world_pos.x, world_pos.z + blade_index * 23) - 0.5) * 0.9;
    let rotation =
        simple_hash(world_pos.x * 7 + blade_index, world_pos.z * 11) * std::f32::consts::TAU;
    let scale = 0.6 + simple_hash(world_pos.x + blade_index, world_pos.z + blade_index * 5) * 0.8;

    let material_idx = ((simple_hash(world_pos.x + blade_index * 3, world_pos.z + blade_index * 7)
        * grass_handles.len() as f32) as usize)
        % grass_handles.len();

    commands.spawn((
        Mesh3d(grass_mesh.clone()),
        MeshMaterial3d(grass_handles[material_idx].clone()),
        Transform::from_xyz(
            world_pos.x as f32 + 0.5 + offset_x,
            world_pos.y as f32 + 1.0,
            world_pos.z as f32 + 0.5 + offset_z,
        )
        .with_rotation(Quat::from_rotation_y(rotation))
        .with_scale(Vec3::splat(scale)),
        GrassBlade,
    ));
}

// ============================================================================
// Rock System
// ============================================================================

/// Spawn rock props on the terrain
pub fn spawn_rock_props(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    world: Res<VoxelWorld>,
    config: Res<VegetationConfig>,
    mut state: ResMut<VegetationState>,
) {
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    state.rocks_spawned = true;

    let rock_material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.45, 0.43, 0.4),
        perceptual_roughness: 0.9,
        ..default()
    });

    let rock_meshes = vec![
        meshes.add(create_rock_mesh(1.0)),
        meshes.add(create_rock_mesh(0.7)),
        meshes.add(create_rock_mesh(1.3)),
    ];

    let rock_count = spawn_rocks_on_terrain(&mut commands, &world, &config, &rock_material, &rock_meshes);
    info!("Spawned {} rock props", rock_count);
}

fn spawn_rocks_on_terrain(
    commands: &mut Commands,
    world: &VoxelWorld,
    config: &VegetationConfig,
    rock_material: &Handle<StandardMaterial>,
    rock_meshes: &[Handle<Mesh>],
) -> usize {
    let mut rock_count = 0;

    for x in 0..config.world_blocks_x {
        for z in 0..config.world_blocks_z {
            if rock_count >= config.rock_max_count {
                return rock_count;
            }

            let world_x = x as i32;
            let world_z = z as i32;

            let hash = simple_hash(world_x * 31, world_z * 37);
            if hash <= config.rock_spawn_threshold {
                continue;
            }

            if let Some(surface_y) = find_surface_height(world, world_x, world_z, config.surface_search_max_y) {
                let rock_mesh = &rock_meshes[(hash * 3.0) as usize % rock_meshes.len()];
                let scale = config.rock_scale_min + hash * config.rock_scale_variance;
                let rotation = hash * std::f32::consts::TAU;

                commands.spawn((
                    Mesh3d(rock_mesh.clone()),
                    MeshMaterial3d(rock_material.clone()),
                    Transform::from_xyz(
                        world_x as f32 + 0.5,
                        surface_y as f32 + 1.0 + scale * 0.3,
                        world_z as f32 + 0.5,
                    )
                    .with_rotation(Quat::from_rotation_y(rotation))
                    .with_scale(Vec3::new(scale, scale * 0.6, scale)),
                    RockProp,
                ));
                rock_count += 1;
            }
        }
    }

    rock_count
}

fn find_surface_height(world: &VoxelWorld, x: i32, z: i32, max_y: i32) -> Option<i32> {
    for y in (0..max_y).rev() {
        let pos = IVec3::new(x, y, z);
        if let Some(voxel) = world.get_voxel(pos) {
            if voxel.is_solid() && voxel != VoxelType::Water {
                return Some(y);
            }
        }
    }
    None
}

// ============================================================================
// Particle System
// ============================================================================

/// Spawn floating particles around the player for atmospheric effect
pub fn spawn_floating_particles(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    config: Res<VegetationConfig>,
    mut state: ResMut<VegetationState>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    state.particles_spawned = true;

    let camera_pos = camera_transform.translation;
    let particle_mesh = meshes.add(Sphere::new(0.08).mesh().build());

    let pollen_material = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.9, 0.4, 0.3),
        emissive: LinearRgba::new(2.0, 1.8, 0.5, 1.0),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });

    let dust_material = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 1.0, 1.0, 0.2),
        emissive: LinearRgba::new(2.0, 2.0, 2.5, 1.0),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });

    for i in 0..config.particle_count {
        spawn_single_particle(
            &mut commands,
            i,
            camera_pos,
            &config,
            &particle_mesh,
            &pollen_material,
            &dust_material,
        );
    }

    info!("Spawned {} floating particles", config.particle_count);
}

fn spawn_single_particle(
    commands: &mut Commands,
    index: usize,
    camera_pos: Vec3,
    config: &VegetationConfig,
    particle_mesh: &Handle<Mesh>,
    pollen_material: &Handle<StandardMaterial>,
    dust_material: &Handle<StandardMaterial>,
) {
    let i = index as i32;
    let hash1 = simple_hash(i * 17, i * 31);
    let hash2 = simple_hash(i * 23, i * 47);
    let hash3 = simple_hash(i * 13, i * 53);

    let radius = config.particle_radius_min + hash1 * (config.particle_radius_max - config.particle_radius_min);
    let angle = hash2 * std::f32::consts::TAU;
    let height = (hash3 - 0.5) * config.particle_height_variance;

    let x = camera_pos.x + angle.cos() * radius;
    let z = camera_pos.z + angle.sin() * radius;
    let y = camera_pos.y + height;

    let material = if hash1 > 0.6 {
        pollen_material.clone()
    } else {
        dust_material.clone()
    };

    let scale = 0.5 + hash2 * 0.8;

    commands.spawn((
        Mesh3d(particle_mesh.clone()),
        MeshMaterial3d(material),
        Transform::from_xyz(x, y, z).with_scale(Vec3::splat(scale)),
        NotShadowCaster,
        FloatingParticle {
            base_y: y,
            phase: hash3 * std::f32::consts::TAU,
            speed: 0.05 + hash1 * 0.05,
            drift: Vec3::new((hash1 - 0.5) * 0.1, 0.0, (hash2 - 0.5) * 0.1),
        },
    ));
}

/// Animate floating particles with gentle bobbing and drift
pub fn animate_particles(
    time: Res<Time>,
    config: Res<VegetationConfig>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut particles: Query<(&mut Transform, &FloatingParticle), Without<PlayerCamera>>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let camera_pos = camera_transform.translation;
    let t = time.elapsed_secs();
    let wrap_dist_sq = config.particle_wrap_distance * config.particle_wrap_distance;

    for (mut transform, particle) in particles.iter_mut() {
        let bob = (t * particle.speed + particle.phase).sin() * config.particle_bob_amplitude;
        let dist_sq = transform.translation.distance_squared(camera_pos);

        if dist_sq > wrap_dist_sq {
            wrap_particle_position(&mut transform, camera_transform);
        } else {
            update_particle_position(&mut transform, particle, bob, camera_pos, time.delta_secs());
        }
    }
}

fn wrap_particle_position(transform: &mut Transform, camera_transform: &Transform) {
    let camera_pos = camera_transform.translation;
    let forward = camera_transform.forward();
    let right = camera_transform.right();
    let up = camera_transform.up();

    let r1 = (transform.translation.x * 7.0).sin();
    let r2 = (transform.translation.z * 13.0).cos();

    transform.translation = camera_pos
        + forward * (8.0 + r1 * 4.0)
        + right * (r2 * 6.0)
        + up * (r1 * 4.0);
}

fn update_particle_position(
    transform: &mut Transform,
    particle: &FloatingParticle,
    bob: f32,
    camera_pos: Vec3,
    delta: f32,
) {
    transform.translation.y =
        particle.base_y + bob + (camera_pos.y - transform.translation.y) * 0.01;
    transform.translation.x += particle.drift.x * delta * 0.3;
    transform.translation.z += particle.drift.z * delta * 0.3;
}

// ============================================================================
// Tree System
// ============================================================================

/// Spawn trees on the terrain
pub fn spawn_trees(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    world: Res<VoxelWorld>,
    config: Res<VegetationConfig>,
    mut state: ResMut<VegetationState>,
    player_query: Query<&Transform, With<PlayerCamera>>,
    time: Res<Time>,
) {
    // Delay spawning to ensure world is fully loaded
    if time.elapsed_secs() < config.tree_spawn_delay_secs {
        return;
    }

    let Ok(player_transform) = player_query.single() else {
        return;
    };

    let player_pos = player_transform.translation;
    let player_chunk = VoxelWorld::world_to_chunk(player_pos.as_ivec3());

    if world.get_chunk(player_chunk).is_none() {
        return;
    }

    state.trees_spawned = true;
    info!(
        "Starting tree generation. Target: {}. Player at {}",
        config.tree_target_count, player_pos
    );

    // DEBUG PROBE
    let test_pos = IVec3::new(24, 20, 24);
    if let Some(voxel) = world.get_voxel(test_pos) {
        info!("TREE PROBE at {:?}: {:?}", test_pos, voxel);
    } else {
        warn!("TREE PROBE at {:?}: NONE (Chunk missing?)", test_pos);
    }

    let tree_scene: Handle<Scene> =
        asset_server.load("models/SM_Southern_Oak/SM_Southern_Oak_NN_01b.gltf#Scene0");

    let (tree_count, attempts) = spawn_trees_with_spacing(
        &mut commands,
        &world,
        &config,
        &tree_scene,
        player_pos,
        time.elapsed_secs(),
    );

    if tree_count < config.tree_target_count {
        warn!(
            "Finished tree placement with spacing. Spawned {}/{} trees after {} attempts.",
            tree_count, config.tree_target_count, attempts
        );
    } else {
        info!(
            "Successfully spawned all {} trees with minimum spacing after {} attempts.",
            tree_count, attempts
        );
    }
}

fn spawn_trees_with_spacing(
    commands: &mut Commands,
    world: &VoxelWorld,
    config: &VegetationConfig,
    tree_scene: &Handle<Scene>,
    player_pos: Vec3,
    elapsed_secs: f32,
) -> (usize, usize) {
    let seed_base = player_pos.x as i32 ^ player_pos.z as i32 ^ (elapsed_secs * 1000.0) as i32;

    let mut tree_count = 0;
    let mut attempts = 0;
    let mut placed_positions: Vec<Vec3> = Vec::new();
    let min_dist_sq = config.tree_min_distance * config.tree_min_distance;

    while tree_count < config.tree_target_count && attempts < config.tree_max_attempts {
        let rand_radius = simple_hash(seed_base + attempts as i32 * 17, seed_base + attempts as i32 * 31);
        let rand_angle = simple_hash(seed_base + attempts as i32 * 13, seed_base + attempts as i32 * 47);

        let radius = config.tree_spawn_min_radius
            + rand_radius * (config.tree_spawn_max_radius - config.tree_spawn_min_radius);
        let angle = rand_angle * std::f32::consts::TAU;

        let world_x = (player_pos.x + angle.cos() * radius).round() as i32;
        let world_z = (player_pos.z + angle.sin() * radius).round() as i32;

        if let Some(spawn_info) = find_tree_spawn_position(world, world_x, world_z, player_pos.y as i32) {
            let spawn_pos = spawn_info.position;

            if placed_positions
                .iter()
                .all(|p| p.distance_squared(spawn_pos) >= min_dist_sq)
            {
                spawn_tree(commands, tree_scene, config, spawn_info, seed_base, attempts);
                placed_positions.push(spawn_pos);
                tree_count += 1;
                info!("Spawned tree {} at {:?}", tree_count, spawn_pos);
            }
        }

        attempts += 1;
    }

    (tree_count, attempts)
}

struct TreeSpawnInfo {
    position: Vec3,
}

fn find_tree_spawn_position(
    world: &VoxelWorld,
    world_x: i32,
    world_z: i32,
    player_y: i32,
) -> Option<TreeSpawnInfo> {
    let column_pos = IVec3::new(world_x, player_y, world_z);
    let chunk_pos = VoxelWorld::world_to_chunk(column_pos);

    if world.get_chunk(chunk_pos).is_none() {
        return None;
    }

    let chunk_world_origin = VoxelWorld::chunk_to_world(chunk_pos);

    for y in (0..16).rev() {
        let world_y = chunk_world_origin.y + y;
        let world_pos = IVec3::new(world_x, world_y, world_z);

        let Some(voxel) = world.get_voxel(world_pos) else {
            continue;
        };

        if !voxel.is_solid() || voxel == VoxelType::Water {
            continue;
        }

        // Check for air above (trunk + canopy space)
        let above = world_pos + IVec3::Y;
        let above_voxel = world.get_voxel(above).unwrap_or(VoxelType::Air);
        let above2 = world_pos + IVec3::new(0, 2, 0);
        let above2_voxel = world.get_voxel(above2).unwrap_or(VoxelType::Air);

        if above_voxel.is_solid() || above2_voxel.is_solid() {
            continue;
        }

        return Some(TreeSpawnInfo {
            position: Vec3::new(world_x as f32 + 0.5, world_y as f32 + 1.0, world_z as f32 + 0.5),
        });
    }

    None
}

fn spawn_tree(
    commands: &mut Commands,
    tree_scene: &Handle<Scene>,
    config: &VegetationConfig,
    spawn_info: TreeSpawnInfo,
    seed_base: i32,
    attempts: usize,
) {
    let scale_rand = simple_hash(seed_base + attempts as i32 * 3, seed_base + attempts as i32 * 5);
    let rotation_rand = simple_hash(seed_base + attempts as i32 * 11, seed_base + attempts as i32 * 19);

    let scale = config.tree_scale_min + scale_rand * config.tree_scale_variance;
    let rotation = rotation_rand * std::f32::consts::TAU;

    commands.spawn((
        SceneRoot(tree_scene.clone()),
        Transform::from_translation(spawn_info.position)
            .with_rotation(Quat::from_rotation_y(rotation))
            .with_scale(Vec3::splat(scale)),
    ));
}

// ============================================================================
// Plugin
// ============================================================================

/// Plugin for vegetation and props
pub struct VegetationPlugin;

impl Plugin for VegetationPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(GrassMaterialPlugin)
            .init_resource::<VegetationState>()
            .init_resource::<VegetationConfig>()
            .add_systems(Startup, setup_grass_patch_assets)
            .add_systems(
                Update,
                (
                    attach_procedural_grass_to_chunks,
                    spawn_grass_blades.run_if(should_spawn_grass),
                    spawn_rock_props.run_if(should_spawn_rocks),
                    spawn_trees.run_if(should_spawn_trees),
                    spawn_floating_particles.run_if(should_spawn_particles),
                    animate_particles,
                ),
            );
    }
}
