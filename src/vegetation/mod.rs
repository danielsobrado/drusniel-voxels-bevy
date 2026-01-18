pub mod grass_material;
pub mod wind;

use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy::light::NotShadowCaster;
use bevy_mesh::{Indices, PrimitiveTopology, VertexAttributeValues};
use crate::voxel::world::VoxelWorld;
use crate::voxel::types::{VoxelType, Voxel};
use crate::voxel::meshing::ChunkMesh;
use crate::rendering::materials::WaterMaterial;
use crate::camera::controller::PlayerCamera;

pub use grass_material::{GrassMaterial, GrassMaterialPlugin, GrassMaterialHandles};
pub use wind::{WindPlugin, WindConfig, WindState, WindAffected, WindAnimationType};

/// Minimal info for a single grass blade instance
struct GrassInstance {
    position: Vec3,
    normal: Vec3,
}

/// Component for grass blade instances
#[derive(Component)]
pub struct GrassBlade;

/// Component for rock props
#[derive(Component)]
pub struct RockProp;

/// Resource to track if grass has been spawned
#[derive(Resource, Default)]
pub struct GrassSpawned(pub bool);

/// Resource to track if rocks have been spawned
#[derive(Resource, Default)]
pub struct RocksSpawned(pub bool);

/// Resource to track if particles have been spawned
#[derive(Resource, Default)]
pub struct ParticlesSpawned(pub bool);

/// Marker that a voxel chunk mesh already has a procedural grass instance attached
#[derive(Component)]
pub struct ChunkGrassAttached;

/// Component for procedural grass patch entities (for debug UI compatibility)
#[derive(Component)]
pub struct ProceduralGrassPatch;

/// Configuration resource for vegetation
#[derive(Resource)]
pub struct VegetationConfig {
    pub grass_density: u32,
    pub max_blades_per_chunk: usize,
    pub wind_strength: f32,
    pub wind_speed: f32,
}

impl Default for VegetationConfig {
    fn default() -> Self {
        Self {
            grass_density: 2,
            max_blades_per_chunk: 200,
            wind_strength: 0.35,
            wind_speed: 1.8,
        }
    }
}

/// Cached grass assets for the procedural patches
#[derive(Resource, Default)]
pub struct GrassPatchAssets {
    pub blade_mesh: Handle<Mesh>,
    pub materials: Vec<Handle<GrassMaterial>>,
}

/// Build shared grass blade mesh and materials that all patches reuse
pub fn setup_grass_patch_assets(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut grass_materials: ResMut<Assets<GrassMaterial>>,
    mut material_handles: ResMut<GrassMaterialHandles>,
) {
    let blade = meshes.add(create_grass_blade_mesh());
    info!("Created grass blade template mesh");

    // Create grass materials with different color variations (kept vivid to ensure visibility)
    let grass_material_configs = vec![
        GrassMaterial::new(
            LinearRgba::new(0.16, 0.28, 0.05, 1.0), // Deep green base
            LinearRgba::new(0.60, 0.85, 0.35, 1.0), // Bright green tip
            0.35, 1.8, 0.08,
        ),
    ];

    let material_handles_vec: Vec<Handle<GrassMaterial>> = grass_material_configs
        .into_iter()
        .map(|mat| grass_materials.add(mat))
        .collect();

    material_handles.handles = material_handles_vec.clone();
    info!("Created {} grass material variations", material_handles_vec.len());

    commands.insert_resource(GrassPatchAssets {
        blade_mesh: blade,
        materials: material_handles_vec,
    });
    info!("GrassPatchAssets resource initialized");
}

/// Spawn a procedural grass patch for each solid voxel chunk mesh
pub fn attach_procedural_grass_to_chunks(
    mut commands: Commands,
    assets: Res<GrassPatchAssets>,
    water_material: Res<WaterMaterial>,
    veg_config: Res<VegetationConfig>,
    mut meshes: ResMut<Assets<Mesh>>,
    // Query chunks with StandardMaterial (blocky mode)
    blocky_chunk_query: Query<(
        Entity,
        &ChunkMesh,
        &Mesh3d,
        &MeshMaterial3d<StandardMaterial>,
        &Transform,
    ), Without<ChunkGrassAttached>>,
    // Query chunks with TriplanarMaterial (surface nets mode)
    triplanar_chunk_query: Query<(
        Entity,
        &ChunkMesh,
        &Mesh3d,
        &MeshMaterial3d<crate::rendering::triplanar_material::TriplanarMaterial>,
        &Transform,
    ), Without<ChunkGrassAttached>>,
) {
    let density = veg_config.grass_density;
    let max_count = veg_config.max_blades_per_chunk;

    // Process blocky chunks
    for (entity, chunk, chunk_mesh, material, transform) in blocky_chunk_query.iter() {
        // Skip water surfaces
        if material.0 == water_material.handle {
            continue;
        }

        process_chunk_for_grass(&mut commands, &assets, &mut meshes, entity, chunk, chunk_mesh, transform, density, max_count);
    }

    // Process triplanar chunks (surface nets mode)
    for (entity, chunk, chunk_mesh, _material, transform) in triplanar_chunk_query.iter() {
        process_chunk_for_grass(&mut commands, &assets, &mut meshes, entity, chunk, chunk_mesh, transform, density, max_count);
    }
}

/// Helper function to spawn grass on a chunk
fn process_chunk_for_grass(
    commands: &mut Commands,
    assets: &Res<GrassPatchAssets>,
    meshes: &mut ResMut<Assets<Mesh>>,
    entity: Entity,
    chunk: &ChunkMesh,
    chunk_mesh: &Mesh3d,
    transform: &Transform,
    density: u32,
    max_count: usize,
) {
    let Some(chunk_source_mesh) = meshes.get(&chunk_mesh.0) else {
        return;
    };

    let instances = collect_grass_instances(chunk_source_mesh, transform, density, max_count);
    if instances.is_empty() {
        return;
    }

    let template_mesh = match meshes.get(&assets.blade_mesh) {
        Some(mesh) => mesh,
        None => return,
    };

    // Pass chunk origin so grass positions are relative to chunk (since we parent to chunk)
    let chunk_origin = transform.translation;
    let Some(grass_mesh) = build_grass_patch_mesh(template_mesh, &instances, chunk_origin) else {
        return;
    };

    let mesh_handle = meshes.add(grass_mesh);

    // Pick a material handle based on chunk position for deterministic variation
    let material_idx = ((chunk.chunk_position.x.abs() + chunk.chunk_position.z.abs()) as usize)
        % assets.materials.len();
    let material_handle = assets.materials[material_idx].clone();

    commands.entity(entity).try_insert(ChunkGrassAttached);

    // Parent grass to chunk entity so it despawns when chunk is culled
    commands.spawn((
        ProceduralGrassPatch,
        Mesh3d(mesh_handle),
        MeshMaterial3d(material_handle),
        Transform::IDENTITY,
        GlobalTransform::IDENTITY,
        Visibility::Visible,
        InheritedVisibility::VISIBLE,
        ViewVisibility::default(),
        NotShadowCaster,
        ChildOf(entity),
    ));
}

/// Extract grass instances from a mesh by sampling upward-facing triangles
fn collect_grass_instances(
    mesh: &Mesh,
    transform: &Transform,
    density: u32,
    max_count: usize,
) -> Vec<GrassInstance> {
    let positions = match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(values)) => values,
        _ => {
            warn!("Mesh has no POSITION attribute");
            return Vec::new();
        }
    };

    let normals = match mesh.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(values)) => values,
        _ => {
            warn!("Mesh has no NORMAL attribute");
            return Vec::new();
        }
    };

    let indices: Vec<u32> = match mesh.indices() {
        Some(Indices::U32(idx)) => idx.clone(),
        Some(Indices::U16(idx)) => idx.iter().map(|i| *i as u32).collect(),
        _ => {
            warn!("Mesh has no indices");
            return Vec::new();
        }
    };

    let mut instances = Vec::new();
    let mut _rejected_area = 0;
    let mut _rejected_normal = 0;
    let mut _accepted = 0;

    // Per-chunk salt so adjacent chunks don't align
    let chunk_seed = {
        let cx = transform.translation.x.floor() as i32;
        let cz = transform.translation.z.floor() as i32;
        mix_bits32(cx as u32 ^ (cz as u32).wrapping_mul(0x9e37_79b9) ^ 0x85eb_ca6b) as i32
    };

    let water_cutoff = (crate::constants::WATER_LEVEL + 1) as f32;

    for (tri_idx, tri) in indices.chunks(3).enumerate() {
        if tri.len() < 3 {
            continue;
        }

        let v0 = transform.transform_point(Vec3::from(positions[tri[0] as usize]));
        let v1 = transform.transform_point(Vec3::from(positions[tri[1] as usize]));
        let v2 = transform.transform_point(Vec3::from(positions[tri[2] as usize]));

        if v0.is_nan() || v1.is_nan() || v2.is_nan() {
            continue;
        }

        // Use the stored normal from the first vertex of the triangle (all 3 should be the same for flat faces)
        let normal_local = Vec3::from(normals[tri[0] as usize]);
        let normal_world = transform.rotation * normal_local; // Transform rotation only, not translation

        let normal = (v1 - v0).cross(v2 - v0);
        let area = normal.length() * 0.5;

        if area <= 0.0001 {
            _rejected_area += 1;
            continue;
        }

        // Skip fully submerged triangles; water surface (and waves) sits at WATER_LEVEL.
        let max_y = v0.y.max(v1.y.max(v2.y));
        if max_y <= water_cutoff {
            continue;
        }

        let normal_dir = normal_world.normalize();
        
        if normal_dir.y <= 0.25 {
            _rejected_normal += 1;
            continue;
        }
        
        _accepted += 1;

        let blade_count = (density as f32 * area).ceil() as u32;

        // Use centroid with high precision to create unique seeds per triangle
        // Quantize to high-resolution world space and mix triangle + chunk seed to avoid aligned repeats.
        let centroid = (v0 + v1 + v2) / 3.0;
        let qx = (centroid.x * 4096.0).round() as i32;
        let qy = (centroid.y * 4096.0).round() as i32;
        let qz = (centroid.z * 4096.0).round() as i32;

        // Strongly mix hashed components to decorrelate adjacent triangles
        let mut seed_base_bits = (qx as u32).rotate_left(3)
            ^ (qz as u32).rotate_left(17)
            ^ (qy as u32).rotate_left(29)
            ^ (tri_idx as u32).wrapping_mul(0x9e37_79b9)
            ^ chunk_seed as u32;
        seed_base_bits = mix_bits32(seed_base_bits);
        let _seed_base = seed_base_bits as i32;

        for i in 0..blade_count {
            // Two independent hashes for barycentric sampling (u1/u2)
            let h1 = mix_bits32(seed_base_bits ^ (i as u32).wrapping_mul(0x85eb_ca6b));
            let h2 = mix_bits32(seed_base_bits ^ (i as u32).wrapping_mul(0xc2b2_ae35) ^ 0x27d4_eb2d);
            let u1 = (h1 as f32) / (u32::MAX as f32);
            let u2 = (h2 as f32) / (u32::MAX as f32);
            let r1 = u1.sqrt(); // area-corrected radial factor
            let r2 = u2;        // angle factor

            let bary = Vec3::new(1.0 - r1, r1 * (1.0 - r2), r1 * r2);
            let position = v0 * bary.x + v1 * bary.y + v2 * bary.z;
            if position.y <= water_cutoff {
                continue;
            }

            instances.push(GrassInstance { position, normal: normal_dir });
            if instances.len() >= max_count {
                return instances;
            }
        }
    }

    instances
}

/// Build a combined grass mesh for all instances using the blade template
/// chunk_origin: positions are made relative to this so parenting works correctly
fn build_grass_patch_mesh(template: &Mesh, instances: &[GrassInstance], chunk_origin: Vec3) -> Option<Mesh> {
    if instances.is_empty() {
        return None;
    }

    let positions = match template.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(values)) => values,
        _ => return None,
    };
    let normals = match template.attribute(Mesh::ATTRIBUTE_NORMAL) {
        Some(VertexAttributeValues::Float32x3(values)) => Some(values.clone()),
        _ => None,
    };
    let uvs = match template.attribute(Mesh::ATTRIBUTE_UV_0) {
        Some(VertexAttributeValues::Float32x2(values)) => Some(values.clone()),
        _ => None,
    };
    let indices: Vec<u32> = match template.indices() {
        Some(Indices::U32(idx)) => idx.clone(),
        Some(Indices::U16(idx)) => idx.iter().map(|i| *i as u32).collect(),
        _ => return None,
    };

    let base_len = positions.len() as u32;
    let mut out_positions = Vec::with_capacity(positions.len() * instances.len());
    let mut out_normals = Vec::with_capacity(normals.as_ref().map(|n| n.len()).unwrap_or(0) * instances.len());
    let mut out_uvs: Vec<[f32; 2]> = Vec::with_capacity(uvs.as_ref().map(|u| u.len()).unwrap_or(0) * instances.len());
    let mut out_indices = Vec::with_capacity(indices.len() * instances.len());

    for (i, instance) in instances.iter().enumerate() {
        let hash = simple_hash(
            (instance.position.x as i32).wrapping_add(i as i32 * 13),
            (instance.position.z as i32).wrapping_sub(i as i32 * 7),
        );
        let yaw = hash * std::f32::consts::TAU;

        // Independent height and width scaling for variety
        let height_scale = 0.7 + simple_hash(i as i32 * 17, i as i32 * 29) * 0.8;
        let width_scale = 0.75 + simple_hash(i as i32 * 19, i as i32 * 31) * 0.5;
        let scale = Vec3::new(width_scale, height_scale, width_scale);

        // Random lean angle (up to ~12 degrees) for natural variation
        let lean_amount = (simple_hash(i as i32 * 23, i as i32 * 37) - 0.5) * 0.21;
        let lean_direction = simple_hash(i as i32 * 41, i as i32 * 43) * std::f32::consts::TAU;
        let lean_axis = Vec3::new(lean_direction.cos(), 0.0, lean_direction.sin());
        let lean_rotation = Quat::from_axis_angle(lean_axis, lean_amount);

        let align = Quat::from_rotation_arc(Vec3::Y, instance.normal);
        let rotation = align * lean_rotation * Quat::from_rotation_y(yaw);
        // Lift slightly along the normal to avoid z-fighting with the ground
        // Make position relative to chunk origin since grass is parented to chunk
        let base_pos = instance.position + instance.normal * 0.05 - chunk_origin;
        let transform = Mat4::from_scale_rotation_translation(scale, rotation, base_pos);
        let normal_matrix = Mat3::from_quat(rotation);

        let index_offset = (i as u32) * base_len;

        for idx in &indices {
            out_indices.push(idx + index_offset);
        }

        for pos in positions {
            let world_pos = transform.transform_point3(Vec3::from(*pos));
            out_positions.push(world_pos.to_array());
        }

        if let Some(src_normals) = &normals {
            for n in src_normals {
                let world_normal = normal_matrix * Vec3::from(*n);
                out_normals.push(world_normal.to_array());
            }
        }

        if let Some(src_uvs) = &uvs {
            out_uvs.extend(src_uvs.iter());
        }
    }

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
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

/// Component for floating particles (pollen, dust, etc)
#[derive(Component)]
pub struct FloatingParticle {
    pub base_y: f32,
    pub phase: f32,
    pub speed: f32,
    pub drift: Vec3,
}

/// Spawn grass blades on grass block surfaces with wind shader
pub fn spawn_grass_blades_unused(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut grass_materials: ResMut<Assets<GrassMaterial>>,
    mut material_handles: ResMut<GrassMaterialHandles>,
    world: Res<VoxelWorld>,
    mut spawned: ResMut<GrassSpawned>,
) {
    if spawned.0 {
        return;
    }

    // Wait until world has at least one chunk loaded
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    spawned.0 = true;

    // Create grass blade mesh (thin vertical quad)
    let grass_mesh = meshes.add(create_grass_blade_mesh());

    // Create grass materials with different color variations
    let grass_material_configs = vec![
        // Golden/yellow grass (dominant in Valheim meadows)
        GrassMaterial::new(
            LinearRgba::new(0.25, 0.20, 0.08, 1.0),
            LinearRgba::new(0.95, 0.85, 0.45, 1.0),
            0.35, 1.8, 0.08,
        ),
        // Warm tan grass
        GrassMaterial::new(
            LinearRgba::new(0.30, 0.22, 0.10, 1.0),
            LinearRgba::new(0.85, 0.75, 0.50, 1.0),
            0.30, 1.5, 0.10,
        ),
        // Light green-gold mix
        GrassMaterial::new(
            LinearRgba::new(0.15, 0.20, 0.08, 1.0),
            LinearRgba::new(0.70, 0.80, 0.40, 1.0),
            0.40, 2.0, 0.07,
        ),
        // Pale straw color
        GrassMaterial::new(
            LinearRgba::new(0.35, 0.30, 0.15, 1.0),
            LinearRgba::new(0.95, 0.90, 0.60, 1.0),
            0.32, 1.6, 0.09,
        ),
    ];

    // Create handles and store them for time updates
    let grass_handles: Vec<Handle<GrassMaterial>> = grass_material_configs
        .into_iter()
        .map(|mat| grass_materials.add(mat))
        .collect();

    material_handles.handles = grass_handles.clone();

    let mut grass_count = 0;
    let max_grass = 15000; // Higher limit for denser grass

    // Iterate through world and find grass block tops
    for chunk_x in 0..32 {
        for chunk_z in 0..32 {
            for chunk_y in 0..4 {
                let chunk_pos = IVec3::new(chunk_x, chunk_y, chunk_z);
                if let Some(chunk) = world.get_chunk(chunk_pos) {
                    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

                    for x in 0..16 {
                        for z in 0..16 {
                            for y in 0..16 {
                                if grass_count >= max_grass {
                                    break;
                                }

                                let local = bevy::math::UVec3::new(x, y, z);
                                let voxel = chunk.get(local);

                                // Check if this is a grass block with air above
                                if voxel == VoxelType::TopSoil {
                                    let world_pos = chunk_origin + IVec3::new(x as i32, y as i32, z as i32);
                                    let above = world_pos + IVec3::Y;

                                    if let Some(above_voxel) = world.get_voxel(above) {
                                        if above_voxel == VoxelType::Air {
                                            // Spawn grass blades with some randomness
                                            let hash = simple_hash(world_pos.x, world_pos.z);

                                            // Spawn on ~60% of grass blocks for denser coverage
                                            if hash > 0.4 {
                                                let blade_count = 3 + (hash * 4.0) as i32;

                                                for i in 0..blade_count {
                                                    let offset_x = (simple_hash(world_pos.x + i * 17, world_pos.z) - 0.5) * 0.9;
                                                    let offset_z = (simple_hash(world_pos.x, world_pos.z + i * 23) - 0.5) * 0.9;
                                                    let rotation = simple_hash(world_pos.x * 7 + i, world_pos.z * 11) * std::f32::consts::TAU;
                                                    let scale = 0.6 + simple_hash(world_pos.x + i, world_pos.z + i * 5) * 0.8;

                                                    // Pick material based on hash for color variation
                                                    let material_idx = ((simple_hash(world_pos.x + i * 3, world_pos.z + i * 7) * 4.0) as usize) % grass_handles.len();

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
                                                    grass_count += 1;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    info!("Spawned {} grass blades with wind animation", grass_count);
}

/// Create a grass blade mesh (crossed quads) - taller for Valheim look
fn create_grass_blade_mesh() -> Mesh {
    let height = 1.4; // Taller grass like Valheim
    let width = 0.18;

    // Three crossed quads (star shape) for a fuller "tuft" look
    // Angles: 0, 60, 120 degrees
    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut uvs = Vec::new();
    let mut colors = Vec::new();
    let mut indices = Vec::new();
    
    let angles = [0.0, 60.0f32.to_radians(), 120.0f32.to_radians()];
    
    for (i, &angle) in angles.iter().enumerate() {
        let (sin, cos) = angle.sin_cos();
        let dx = cos * width;
        let dz = sin * width;
        let dx_top = cos * (width * 0.2);
        let dz_top = sin * (width * 0.2);
        
        // Push 4 vertices for this quad
        // Bottom-Left, Bottom-Right, Top-Right, Top-Left
        positions.push([-dx, 0.0, -dz]);
        positions.push([dx, 0.0, dz]);
        positions.push([dx_top, height, dz_top]);
        positions.push([-dx_top, height, -dz_top]);
        
        // Normal points roughly perpendicular to blade surface
        // (Approximation: keeping it simple with Up or angled)
        // For grass shader, "Normal" often encodes data or just needs to be non-zero.
        // Let's use Up (0,1,0) generic or the face normal?
        // Original code used [0,0,1] and [1,0,0] which are face normals.
        let nx = -sin;
        let nz = cos;
        for _ in 0..4 {
            normals.push([nx, 0.0, nz]);
        }
        
        uvs.push([0.0, 1.0]);
        uvs.push([1.0, 1.0]);
        uvs.push([1.0, 0.0]);
        uvs.push([0.0, 0.0]);
        
        // Vertex colors (base to tip gradient)
        colors.push([0.35, 0.30, 0.15, 1.0]); // Bottom
        colors.push([0.35, 0.30, 0.15, 1.0]); // Bottom
        colors.push([0.95, 0.85, 0.45, 1.0]); // Top
        colors.push([0.95, 0.85, 0.45, 1.0]); // Top
        
        // Indices for this quad
        let base = (i * 4) as u32;
        indices.push(base);
        indices.push(base + 1);
        indices.push(base + 2);
        indices.push(base);
        indices.push(base + 2);
        indices.push(base + 3);
        
        // Double-sided? Original code only had front faces. 
        // "crossed quads ensure visibility from any angle"
        // Let's stick to single sided per quad, but 3 quads cover more angles.
    }

    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uvs);
    mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, colors);
    mesh.insert_indices(Indices::U32(indices));
    mesh
}

/// Spawn rock props on the terrain
pub fn spawn_rock_props(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    world: Res<VoxelWorld>,
    mut spawned: ResMut<RocksSpawned>,
) {
    if spawned.0 {
        return;
    }

    // Wait until world has at least one chunk loaded
    if world.get_chunk(IVec3::ZERO).is_none() {
        return;
    }

    spawned.0 = true;

    // Create rock material
    let rock_material = materials.add(StandardMaterial {
        base_color: Color::srgb(0.45, 0.43, 0.4),
        perceptual_roughness: 0.9,
        ..default()
    });

    // Create a few rock mesh variations
    let rock_meshes = vec![
        meshes.add(create_rock_mesh(1.0, 0)),
        meshes.add(create_rock_mesh(0.7, 1)),
        meshes.add(create_rock_mesh(1.3, 2)),
    ];

    let mut rock_count = 0;
    let max_rocks = 200;

    // Scan world for places to put rocks
    for x in 0..512 {
        for z in 0..512 {
            if rock_count >= max_rocks {
                break;
            }

            let world_x = x as i32;
            let world_z = z as i32;

            // Use hash to determine if rock spawns here
            let hash = simple_hash(world_x * 31, world_z * 37);
            if hash > 0.995 { // Very sparse rocks
                // Find surface height
                for y in (0..64).rev() {
                    let pos = IVec3::new(world_x, y, world_z);
                    if let Some(voxel) = world.get_voxel(pos) {
                        if voxel.is_solid() && voxel != VoxelType::Water {
                            // Found surface - spawn rock
                            let rock_mesh = &rock_meshes[(hash * 3.0) as usize % 3];
                            let scale = 0.5 + hash * 1.5;
                            let rotation = hash * std::f32::consts::TAU;

                            commands.spawn((
                                Mesh3d(rock_mesh.clone()),
                                MeshMaterial3d(rock_material.clone()),
                                Transform::from_xyz(
                                    world_x as f32 + 0.5,
                                    y as f32 + 1.0 + scale * 0.3,
                                    world_z as f32 + 0.5,
                                )
                                .with_rotation(Quat::from_rotation_y(rotation))
                                .with_scale(Vec3::new(scale, scale * 0.6, scale)),
                                RockProp,
                            ));
                            rock_count += 1;
                            break;
                        }
                    }
                }
            }
        }
    }

    info!("Spawned {} rock props", rock_count);
}

/// Create a simple rock mesh (deformed sphere)
fn create_rock_mesh(size: f32, _seed: i32) -> Mesh {
    // Use Bevy's built-in sphere and we'll deform it via scale
    Sphere::new(size * 0.5).mesh().build()
}

/// Simple hash function for deterministic randomness
fn simple_hash(x: i32, z: i32) -> f32 {
    let n = x.wrapping_mul(374761393).wrapping_add(z.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    let n = n ^ (n >> 16);
    (n as u32 as f32) / (u32::MAX as f32)
}

// Mix function to decorrelate nearby integer seeds (SplitMix32-style)
fn mix_bits32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

/// Spawn floating particles around the player for that Valheim atmosphere
pub fn spawn_floating_particles(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut spawned: ResMut<ParticlesSpawned>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
) {
    if spawned.0 {
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    spawned.0 = true;

    let camera_pos = camera_transform.translation;

    // Small particle mesh for pollen/dust specks
    let particle_mesh = meshes.add(Sphere::new(0.06).mesh().build());

    // Subtle golden pollen material
    let pollen_material = materials.add(StandardMaterial {
        base_color: Color::srgba(0.95, 0.86, 0.55, 0.85),
        emissive: LinearRgba::new(0.5, 0.45, 0.18, 1.0),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });

    // Soft dust material
    let dust_material = materials.add(StandardMaterial {
        base_color: Color::srgba(0.82, 0.78, 0.68, 0.7),
        emissive: LinearRgba::new(0.22, 0.22, 0.22, 1.0),
        alpha_mode: AlphaMode::Blend,
        unlit: true,
        ..default()
    });

    let particle_count = 200;

    for i in 0..particle_count {
        let hash1 = simple_hash(i * 17, i * 31);
        let hash2 = simple_hash(i * 23, i * 47);
        let hash3 = simple_hash(i * 13, i * 53);

        // Spawn in a sphere around camera start position - closer to camera
        let radius = 15.0 + hash1 * 50.0;
        let angle = hash2 * std::f32::consts::TAU;
        let height = hash3 * 30.0 - 5.0; // -5 to +25 relative to camera

        let x = camera_pos.x + angle.cos() * radius;
        let z = camera_pos.z + angle.sin() * radius;
        let y = camera_pos.y + height;

        let material = if hash1 > 0.6 {
            pollen_material.clone()
        } else {
            dust_material.clone()
        };

        // Small particle size with light variation
        let scale = 0.7 + hash2 * 0.9;

        commands.spawn((
            Mesh3d(particle_mesh.clone()),
            MeshMaterial3d(material),
            Transform::from_xyz(x, y, z).with_scale(Vec3::splat(scale)),
            NotShadowCaster,
            FloatingParticle {
                base_y: y,
                phase: hash3 * std::f32::consts::TAU,
                speed: 0.15 + hash1 * 0.9,
                drift: Vec3::new(
                    (hash1 - 0.5) * 2.0,
                    0.0,
                    (hash2 - 0.5) * 2.0,
                ),
            },
        ));
    }

    info!("Spawned {} floating particles", particle_count);
}

/// Animate floating particles with gentle bobbing and drift
pub fn animate_particles(
    time: Res<Time>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut particles: Query<(&mut Transform, &FloatingParticle), Without<PlayerCamera>>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let camera_pos = camera_transform.translation;
    let t = time.elapsed_secs();

    for (mut transform, particle) in particles.iter_mut() {
        // Gentle bobbing motion
        let bob = (t * particle.speed + particle.phase).sin() * 0.12;
        transform.translation.y = particle.base_y + bob;

        // Slow drift
        let drift_scale = 0.12 + particle.speed * 0.2;
        transform.translation.x += particle.drift.x * time.delta_secs() * drift_scale;
        transform.translation.z += particle.drift.z * time.delta_secs() * drift_scale;

        // Wrap particles around player (keep them in view)
        let dist_to_camera = Vec2::new(
            transform.translation.x - camera_pos.x,
            transform.translation.z - camera_pos.z,
        ).length();

        if dist_to_camera > 100.0 {
            // Teleport to other side of player
            let angle = simple_hash(
                (transform.translation.x * 100.0) as i32,
                (transform.translation.z * 100.0) as i32,
            ) * std::f32::consts::TAU;
            let new_radius = 30.0 + simple_hash(
                (transform.translation.x * 50.0) as i32,
                (transform.translation.z * 50.0) as i32,
            ) * 40.0;
            transform.translation.x = camera_pos.x + angle.cos() * new_radius;
            transform.translation.z = camera_pos.z + angle.sin() * new_radius;
        }
    }
}


/// Sync wind parameters from VegetationConfig to grass materials
pub fn sync_grass_wind_config(
    veg_config: Res<VegetationConfig>,
    mut materials: ResMut<Assets<GrassMaterial>>,
    handles: Res<GrassMaterialHandles>,
) {
    if !veg_config.is_changed() {
        return;
    }
    for handle in &handles.handles {
        if let Some(material) = materials.get_mut(handle) {
            material.uniform_data.wind_strength = veg_config.wind_strength;
            material.uniform_data.wind_speed = veg_config.wind_speed;
        }
    }
}

/// Plugin for vegetation and props
pub struct VegetationPlugin;

impl Plugin for VegetationPlugin {
    fn build(&self, app: &mut App) {
        app
            // Add the grass material plugin first
            .add_plugins(GrassMaterialPlugin)
            .init_resource::<GrassSpawned>()
            .init_resource::<RocksSpawned>()
            .init_resource::<ParticlesSpawned>()
            .init_resource::<VegetationConfig>()
            .add_systems(Startup, setup_grass_patch_assets)
            // Run in Update to ensure world is populated
            .add_systems(
                Update,
                (
                    attach_procedural_grass_to_chunks, // Mixed with assets
                    sync_grass_wind_config,
                    // spawn_rock_props, // Disabled in favor of asset props
                    spawn_floating_particles,
                    animate_particles,
                ),
            );
    }
}
