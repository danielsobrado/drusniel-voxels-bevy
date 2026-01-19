//! Mesh generation for voxel chunks.
//!
//! This module provides two meshing modes:
//! - **Blocky**: Traditional Minecraft-style meshing with cube faces
//! - **Surface Nets**: Smooth terrain meshing using the Surface Nets algorithm
//!
//! Both modes support ambient occlusion and proper chunk boundary handling.

use bevy::asset::RenderAssetUsages;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology};
use std::sync::atomic::{AtomicUsize, Ordering};
use crate::constants::{
    CHUNK_SIZE, CHUNK_SIZE_I32, VOXEL_SIZE,
    PADDED_CHUNK_SIZE_U32, UV_PADDING, CHUNK_BOUNDARY_SCALE,
    ATLAS_COLUMNS, ATLAS_ROWS,
    // LOD grid configurations
    LOD0_PADDED_SIZE, LOD0_STEP_SIZE, LOD0_GRID_VOLUME,
    LOD1_PADDED_SIZE, LOD1_STEP_SIZE, LOD1_GRID_VOLUME,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::skirt::{extract_boundary_edges, generate_skirts, NeighborLods, SkirtConfig};
use crate::voxel::types::{VoxelType, Voxel};
use crate::voxel::world::VoxelWorld;

// Surface nets imports for smooth meshing
use fast_surface_nets::{surface_nets, SurfaceNetsBuffer};
use ndshape::{ConstShape, ConstShape3u32};

// Debug helper: log if a solid face ends up using the water atlas tile
const DEBUG_LOG_WATER_TILE_ON_SOLIDS: bool = true;
const DEBUG_MAX_LOGS: usize = 64;
static DEBUG_WATER_SOLID_LOGS: AtomicUsize = AtomicUsize::new(0);

#[derive(Component)]
pub struct ChunkMesh {
    pub chunk_position: IVec3,
}

#[derive(Component)]
pub struct WaterMesh;

#[derive(Component, Copy, Clone, Debug)]
pub struct WaterMeshDetail {
    pub triangle_count: usize,
    pub max_depth: usize,
}

#[derive(Copy, Clone, Debug)]
pub enum Face {
    Top,
    Bottom,
    North,
    South,
    East,
    West,
}

pub struct MeshData {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub colors: Vec<[f32; 4]>, // Vertex colors for AO (blocky) or material weights (surface nets)
    pub indices: Vec<u32>,
}

impl MeshData {
    pub fn new() -> Self {
        Self {
            positions: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            colors: Vec::new(),
            indices: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    pub fn into_mesh(self) -> Mesh {
        let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default());
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uvs);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.colors);
        mesh.insert_indices(Indices::U32(self.indices));
        mesh
    }
}

/// Result of chunk meshing containing separate meshes for solid and water blocks
pub struct ChunkMeshResult {
    pub solid: MeshData,
    pub water: MeshData,
}

pub fn generate_chunk_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    ao_config: &BakedAoConfig,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::new();
    let mut water_mesh = MeshData::new();
    
    for x in 0..16 {
        for y in 0..16 {
            for z in 0..16 {
                let local = UVec3::new(x, y, z);
                let voxel = chunk.get(local);
                
                if voxel == VoxelType::Air {
                    continue;
                }

                if voxel.is_liquid() {
                    // Generate water mesh faces (only visible against air)
                    check_water_face(chunk, world, local, Face::Top, &mut water_mesh, voxel);
                    check_water_face(chunk, world, local, Face::Bottom, &mut water_mesh, voxel);
                    check_water_face(chunk, world, local, Face::North, &mut water_mesh, voxel);
                    check_water_face(chunk, world, local, Face::South, &mut water_mesh, voxel);
                    check_water_face(chunk, world, local, Face::East, &mut water_mesh, voxel);
                    check_water_face(chunk, world, local, Face::West, &mut water_mesh, voxel);
                } else if voxel.is_solid() {
                    // Solid blocks - render faces adjacent to air or water (transparent)
                    check_face(chunk, world, local, Face::Top, &mut solid_mesh, voxel, ao_config);
                    check_face(chunk, world, local, Face::Bottom, &mut solid_mesh, voxel, ao_config);
                    check_face(chunk, world, local, Face::North, &mut solid_mesh, voxel, ao_config);
                    check_face(chunk, world, local, Face::South, &mut solid_mesh, voxel, ao_config);
                    check_face(chunk, world, local, Face::East, &mut solid_mesh, voxel, ao_config);
                    check_face(chunk, world, local, Face::West, &mut solid_mesh, voxel, ao_config);
                }
            }
        }
    }

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
    }
}

fn check_face(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    mesh_data: &mut MeshData,
    voxel: VoxelType,
    ao_config: &BakedAoConfig,
) {
    if is_face_visible(chunk, world, local, face) {
        add_face_with_ao(mesh_data, chunk, world, local, face, voxel, ao_config);
    }
}

fn check_water_face(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    mesh_data: &mut MeshData,
    voxel: VoxelType,
) {
    if is_water_face_visible(chunk, world, local, face) {
        // Water doesn't need AO - use full brightness
        add_face_no_ao(mesh_data, local, face, voxel);
    }
}

/// Returns the face offset vector for a given face direction.
#[inline]
fn face_offset(face: Face) -> IVec3 {
    match face {
        Face::Top => IVec3::Y,
        Face::Bottom => IVec3::NEG_Y,
        Face::North => IVec3::NEG_Z,
        Face::South => IVec3::Z,
        Face::East => IVec3::X,
        Face::West => IVec3::NEG_X,
    }
}

/// Checks if a neighbor position is within chunk bounds.
#[inline]
fn is_in_chunk_bounds(pos: IVec3) -> bool {
    pos.x >= 0 && pos.x < CHUNK_SIZE_I32 &&
    pos.y >= 0 && pos.y < CHUNK_SIZE_I32 &&
    pos.z >= 0 && pos.z < CHUNK_SIZE_I32
}

/// Gets the neighboring voxel for a face, checking chunk first then world.
fn get_neighbor_voxel(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
) -> Option<VoxelType> {
    let offset = face_offset(face);
    let neighbor_local = IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;

    if is_in_chunk_bounds(neighbor_local) {
        Some(chunk.get(UVec3::new(
            neighbor_local.x as u32,
            neighbor_local.y as u32,
            neighbor_local.z as u32,
        )))
    } else {
        // Neighbor is outside chunk - check world
        let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
        let world_pos = chunk_origin + IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;
        world.get_voxel(world_pos)
    }
}

/// Generic face visibility check with a custom predicate.
///
/// # Arguments
/// * `chunk` - The chunk containing the voxel
/// * `world` - The voxel world for cross-chunk lookups
/// * `local` - Local coordinates within the chunk
/// * `face` - The face direction to check
/// * `is_visible` - Predicate to determine visibility based on neighbor voxel
/// * `default_if_outside` - Value to return if neighbor is outside world bounds
fn is_face_visible_with<F>(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    is_visible: F,
    default_if_outside: bool,
) -> bool
where
    F: Fn(VoxelType) -> bool,
{
    match get_neighbor_voxel(chunk, world, local, face) {
        Some(neighbor) => is_visible(neighbor),
        None => default_if_outside,
    }
}

/// Solid face is visible when neighbor is transparent (air or water).
fn is_face_visible(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
) -> bool {
    is_face_visible_with(
        chunk,
        world,
        local,
        face,
        |neighbor| neighbor.is_transparent(),
        false, // Don't render faces into the void
    )
}

/// Water face is visible only when neighbor is air.
fn is_water_face_visible(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
) -> bool {
    is_face_visible_with(
        chunk,
        world,
        local,
        face,
        |neighbor| neighbor == VoxelType::Air,
        true, // Show water at world edges
    )
}

/// Calculate vertex ambient occlusion (0-3 scale, 0 = fully occluded, 3 = not occluded).
fn calculate_vertex_ao(side1: bool, side2: bool, corner: bool, ao_config: &BakedAoConfig) -> f32 {
    if !ao_config.enabled {
        return 1.0;
    }

    let ao_value = if side1 && side2 {
        0.0
    } else {
        let count = side1 as u8 + side2 as u8 + corner as u8;
        1.0 - (count as f32 * ao_config.corner_darkness / 3.0)
    };

    ao_value * ao_config.strength + (1.0 - ao_config.strength)
}

/// Check if a world position contains a solid block (for AO calculation)
fn is_solid_at_offset(chunk: &Chunk, world: &VoxelWorld, local: UVec3, offset: IVec3) -> bool {
    let local_pos = IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;
    
    // Check within chunk first
    if local_pos.x >= 0 && local_pos.x < CHUNK_SIZE_I32 &&
       local_pos.y >= 0 && local_pos.y < CHUNK_SIZE_I32 &&
       local_pos.z >= 0 && local_pos.z < CHUNK_SIZE_I32 {
        let v = chunk.get(UVec3::new(local_pos.x as u32, local_pos.y as u32, local_pos.z as u32));
        return v.is_solid();
    }
    
    // Check world
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let world_pos = chunk_origin + local_pos;
    
    if let Some(v) = world.get_voxel(world_pos) {
        v.is_solid()
    } else {
        false
    }
}

/// Get AO values for the 4 vertices of a face
fn get_face_ao(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    ao_config: &BakedAoConfig,
) -> [f32; 4] {
    // For each face, we need to check the 8 neighbors in the plane of the face
    // and calculate AO for each of the 4 vertices
    
    let offsets = match face {
        Face::Top => {
            // Vertices: v0(0,1,1), v1(1,1,1), v2(1,1,0), v3(0,1,0)
            [
                (IVec3::new(-1, 1, 0), IVec3::new(0, 1, 1), IVec3::new(-1, 1, 1)),   // v0
                (IVec3::new(1, 1, 0), IVec3::new(0, 1, 1), IVec3::new(1, 1, 1)),     // v1
                (IVec3::new(1, 1, 0), IVec3::new(0, 1, -1), IVec3::new(1, 1, -1)),   // v2
                (IVec3::new(-1, 1, 0), IVec3::new(0, 1, -1), IVec3::new(-1, 1, -1)), // v3
            ]
        }
        Face::Bottom => {
            [
                (IVec3::new(-1, -1, 0), IVec3::new(0, -1, -1), IVec3::new(-1, -1, -1)),
                (IVec3::new(1, -1, 0), IVec3::new(0, -1, -1), IVec3::new(1, -1, -1)),
                (IVec3::new(1, -1, 0), IVec3::new(0, -1, 1), IVec3::new(1, -1, 1)),
                (IVec3::new(-1, -1, 0), IVec3::new(0, -1, 1), IVec3::new(-1, -1, 1)),
            ]
        }
        Face::North => {
            [
                (IVec3::new(1, 0, -1), IVec3::new(0, -1, -1), IVec3::new(1, -1, -1)),
                (IVec3::new(-1, 0, -1), IVec3::new(0, -1, -1), IVec3::new(-1, -1, -1)),
                (IVec3::new(-1, 0, -1), IVec3::new(0, 1, -1), IVec3::new(-1, 1, -1)),
                (IVec3::new(1, 0, -1), IVec3::new(0, 1, -1), IVec3::new(1, 1, -1)),
            ]
        }
        Face::South => {
            [
                (IVec3::new(-1, 0, 1), IVec3::new(0, -1, 1), IVec3::new(-1, -1, 1)),
                (IVec3::new(1, 0, 1), IVec3::new(0, -1, 1), IVec3::new(1, -1, 1)),
                (IVec3::new(1, 0, 1), IVec3::new(0, 1, 1), IVec3::new(1, 1, 1)),
                (IVec3::new(-1, 0, 1), IVec3::new(0, 1, 1), IVec3::new(-1, 1, 1)),
            ]
        }
        Face::East => {
            [
                (IVec3::new(1, 0, 1), IVec3::new(1, -1, 0), IVec3::new(1, -1, 1)),
                (IVec3::new(1, 0, -1), IVec3::new(1, -1, 0), IVec3::new(1, -1, -1)),
                (IVec3::new(1, 0, -1), IVec3::new(1, 1, 0), IVec3::new(1, 1, -1)),
                (IVec3::new(1, 0, 1), IVec3::new(1, 1, 0), IVec3::new(1, 1, 1)),
            ]
        }
        Face::West => {
            [
                (IVec3::new(-1, 0, -1), IVec3::new(-1, -1, 0), IVec3::new(-1, -1, -1)),
                (IVec3::new(-1, 0, 1), IVec3::new(-1, -1, 0), IVec3::new(-1, -1, 1)),
                (IVec3::new(-1, 0, 1), IVec3::new(-1, 1, 0), IVec3::new(-1, 1, 1)),
                (IVec3::new(-1, 0, -1), IVec3::new(-1, 1, 0), IVec3::new(-1, 1, -1)),
            ]
        }
    };
    
    let mut ao = [1.0; 4];
    for (i, (side1_off, side2_off, corner_off)) in offsets.iter().enumerate() {
        let side1 = is_solid_at_offset(chunk, world, local, *side1_off);
        let side2 = is_solid_at_offset(chunk, world, local, *side2_off);
        let corner = is_solid_at_offset(chunk, world, local, *corner_off);
        ao[i] = calculate_vertex_ao(side1, side2, corner, ao_config);
    }
    ao
}

/// Get the atlas index for a voxel face (supports face-specific textures)
fn get_face_atlas_index(voxel: VoxelType, face: Face) -> u8 {
    match voxel {
        VoxelType::TopSoil => {
            match face {
                Face::Top => 0,    // Grass top texture
                Face::Bottom => 1, // Dirt texture
                _ => 7,            // Grass side texture (uses slot 7)
            }
        }
        _ => voxel.atlas_index(),
    }
}

/// Map voxel/face to blocky texture array layer (grass, dirt, rock, sand).
fn get_blocky_material_index(voxel: VoxelType, face: Face) -> u8 {
    match voxel {
        VoxelType::TopSoil | VoxelType::Leaves => match face {
            Face::Bottom => 1, // Dirt
            _ => 0,            // Grass
        },
        VoxelType::SubSoil | VoxelType::Clay | VoxelType::Wood => 1, // Dirt
        VoxelType::Rock | VoxelType::Bedrock | VoxelType::DungeonWall | VoxelType::DungeonFloor => 2, // Rock
        VoxelType::Sand => 3, // Sand
        _ => 0, // Default to grass for unsupported/air/water
    }
}

fn add_face_with_ao(
    mesh_data: &mut MeshData,
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    voxel: VoxelType,
    ao_config: &BakedAoConfig,
) {
    let x = local.x as f32 * VOXEL_SIZE;
    let y = local.y as f32 * VOXEL_SIZE;
    let z = local.z as f32 * VOXEL_SIZE;
    let s = VOXEL_SIZE;

    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => (
            [x, y + s, z + s], [x + s, y + s, z + s], [x + s, y + s, z], [x, y + s, z],
            [0.0, 1.0, 0.0]
        ),
        Face::Bottom => (
            [x, y, z], [x + s, y, z], [x + s, y, z + s], [x, y, z + s],
            [0.0, -1.0, 0.0]
        ),
        Face::North => (
            [x + s, y, z], [x, y, z], [x, y + s, z], [x + s, y + s, z],
            [0.0, 0.0, -1.0]
        ),
        Face::South => (
            [x, y, z + s], [x + s, y, z + s], [x + s, y + s, z + s], [x, y + s, z + s],
            [0.0, 0.0, 1.0]
        ),
        Face::East => (
            [x + s, y, z + s], [x + s, y, z], [x + s, y + s, z], [x + s, y + s, z + s],
            [1.0, 0.0, 0.0]
        ),
        Face::West => (
            [x, y, z], [x, y, z + s], [x, y + s, z + s], [x, y + s, z],
            [-1.0, 0.0, 0.0]
        ),
    };

    // Calculate AO for each vertex
    let ao = get_face_ao(chunk, world, local, face, ao_config);

    let start_idx = mesh_data.positions.len() as u32;
    
    mesh_data.positions.push(v0);
    mesh_data.positions.push(v1);
    mesh_data.positions.push(v2);
    mesh_data.positions.push(v3);
    
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    
    let material_index = get_blocky_material_index(voxel, face) as f32 / 255.0;
    // Add vertex colors for AO (grayscale) + material index in alpha
    mesh_data.colors.push([ao[0], ao[0], ao[0], material_index]);
    mesh_data.colors.push([ao[1], ao[1], ao[1], material_index]);
    mesh_data.colors.push([ao[2], ao[2], ao[2], material_index]);
    mesh_data.colors.push([ao[3], ao[3], ao[3], material_index]);
    
    // Face-specific texture
    let atlas_idx = get_face_atlas_index(voxel, face);

    if DEBUG_LOG_WATER_TILE_ON_SOLIDS && atlas_idx == VoxelType::Water.atlas_index() {
        let count = DEBUG_WATER_SOLID_LOGS.fetch_add(1, Ordering::Relaxed);
        if count < DEBUG_MAX_LOGS {
            let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
            let world_pos = chunk_origin + IVec3::new(local.x as i32, local.y as i32, local.z as i32);
            info!(
                "Solid face using water tile at {:?}, voxel {:?}, face {:?}",
                world_pos, voxel, face
            );
        }
    }

    // For Texture Arrays, we use full 0..1 UVs as each layer is a complete texture
    // Atlas logic removed as it causes incorrect sampling (zoomed in patches)
    
    let u_min = 0.0;
    let u_max = 1.0;
    let v_min = 0.0;
    let v_max = 1.0;
    
    mesh_data.uvs.push([u_min, v_max]);
    mesh_data.uvs.push([u_max, v_max]);
    mesh_data.uvs.push([u_max, v_min]);
    mesh_data.uvs.push([u_min, v_min]);
    
    // Use flipped winding for proper AO interpolation when needed
    // Check if we should flip the quad diagonal based on AO values
    if !ao_config.fix_anisotropy || ao[0] + ao[2] > ao[1] + ao[3] {
        // Normal winding
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 2);
        mesh_data.indices.push(start_idx + 1);
        
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 3);
        mesh_data.indices.push(start_idx + 2);
    } else {
        // Flipped diagonal for better AO interpolation
        // Triangle 1: v1, v0, v3 (CCW)
        mesh_data.indices.push(start_idx + 1);
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 3);
        
        // Triangle 2: v1, v3, v2 (CCW)
        mesh_data.indices.push(start_idx + 1);
        mesh_data.indices.push(start_idx + 3);
        mesh_data.indices.push(start_idx + 2);
    }
}

fn add_face_no_ao(
    mesh_data: &mut MeshData,
    local: UVec3,
    face: Face,
    voxel: VoxelType,
) {
    let x = local.x as f32 * VOXEL_SIZE;
    let y = local.y as f32 * VOXEL_SIZE;
    let z = local.z as f32 * VOXEL_SIZE;
    let s = VOXEL_SIZE;

    // Inset water faces slightly to prevent them showing through terrain gaps
    // The smooth terrain mesh may not perfectly align with blocky water mesh
    // Inset removed to prevent gaps between water blocks
    let inset = 0.0;

    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => (
            [x + inset, y + s - inset, z + s - inset], [x + s - inset, y + s - inset, z + s - inset],
            [x + s - inset, y + s - inset, z + inset], [x + inset, y + s - inset, z + inset],
            [0.0, 1.0, 0.0]
        ),
        Face::Bottom => (
            [x + inset, y + inset, z + inset], [x + s - inset, y + inset, z + inset],
            [x + s - inset, y + inset, z + s - inset], [x + inset, y + inset, z + s - inset],
            [0.0, -1.0, 0.0]
        ),
        Face::North => (
            [x + s - inset, y + inset, z + inset], [x + inset, y + inset, z + inset],
            [x + inset, y + s - inset, z + inset], [x + s - inset, y + s - inset, z + inset],
            [0.0, 0.0, -1.0]
        ),
        Face::South => (
            [x + inset, y + inset, z + s - inset], [x + s - inset, y + inset, z + s - inset],
            [x + s - inset, y + s - inset, z + s - inset], [x + inset, y + s - inset, z + s - inset],
            [0.0, 0.0, 1.0]
        ),
        Face::East => (
            [x + s - inset, y + inset, z + s - inset], [x + s - inset, y + inset, z + inset],
            [x + s - inset, y + s - inset, z + inset], [x + s - inset, y + s - inset, z + s - inset],
            [1.0, 0.0, 0.0]
        ),
        Face::West => (
            [x + inset, y + inset, z + inset], [x + inset, y + inset, z + s - inset],
            [x + inset, y + s - inset, z + s - inset], [x + inset, y + s - inset, z + inset],
            [-1.0, 0.0, 0.0]
        ),
    };

    let start_idx = mesh_data.positions.len() as u32;
    
    mesh_data.positions.push(v0);
    mesh_data.positions.push(v1);
    mesh_data.positions.push(v2);
    mesh_data.positions.push(v3);
    
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    
    let material_index = get_blocky_material_index(voxel, face) as f32 / 255.0;
    // Full brightness for water; keep material index in alpha for blocky shader safety.
    mesh_data.colors.push([1.0, 1.0, 1.0, material_index]);
    mesh_data.colors.push([1.0, 1.0, 1.0, material_index]);
    mesh_data.colors.push([1.0, 1.0, 1.0, material_index]);
    mesh_data.colors.push([1.0, 1.0, 1.0, material_index]);
    
    // Calculate UV coordinates from atlas position
    let atlas_idx = voxel.atlas_index();
    let cols = ATLAS_COLUMNS as f32;
    let rows = ATLAS_ROWS as f32;
    let col = (atlas_idx % ATLAS_COLUMNS as u8) as f32;
    let row = (atlas_idx / ATLAS_COLUMNS as u8) as f32;

    let u_min = col / cols + UV_PADDING;
    let u_max = (col + 1.0) / cols - UV_PADDING;
    let v_min = row / rows + UV_PADDING;
    let v_max = (row + 1.0) / rows - UV_PADDING;
    
    mesh_data.uvs.push([u_min, v_max]);
    mesh_data.uvs.push([u_max, v_max]);
    mesh_data.uvs.push([u_max, v_min]);
    mesh_data.uvs.push([u_min, v_min]);
    
    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 2);
    mesh_data.indices.push(start_idx + 1);

    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 3);
    mesh_data.indices.push(start_idx + 2);
}

// =============================================================================
// Surface Nets Smooth Meshing
// =============================================================================

/// Padded chunk shape for surface nets.
/// Surface Nets needs +1 padding on each side to sample neighboring voxels,
/// resulting in an 18x18x18 sample grid for a 16x16x16 chunk.
type PaddedChunkShape = ConstShape3u32<PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32>;

// =============================================================================
// LOD Shape Types - Compile-time grid shapes for different detail levels
// =============================================================================

// Note: LOD 0 (High Detail) uses PaddedChunkShape defined above (18x18x18 grid, step size 1)

/// LOD 1 (Low Detail): 10x10x10 grid, step size 2
/// Samples every 2nd voxel, reducing vertex count by ~75%
type LodShape1 = ConstShape3u32<{ LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }>;

/// Configuration for LOD mesh generation
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LodMeshConfig {
    /// Voxel sampling interval (1 = every voxel, 2 = every other, etc.)
    pub step_size: u32,
    /// Size of the padded SDF grid
    pub padded_size: u32,
    /// Total volume of the SDF grid (padded_size^3)
    pub grid_volume: usize,
}

impl LodMeshConfig {
    /// High detail configuration: full resolution (step 1, 18x18x18)
    pub const HIGH: Self = Self {
        step_size: LOD0_STEP_SIZE,
        padded_size: LOD0_PADDED_SIZE,
        grid_volume: LOD0_GRID_VOLUME,
    };

    /// Low detail configuration: half resolution (step 2, 10x10x10)
    pub const LOW: Self = Self {
        step_size: LOD1_STEP_SIZE,
        padded_size: LOD1_PADDED_SIZE,
        grid_volume: LOD1_GRID_VOLUME,
    };

    /// Get the appropriate config for a given LOD level
    pub fn from_lod_level(level: LodLevel) -> Self {
        match level {
            LodLevel::High => Self::HIGH,
            LodLevel::Low => Self::LOW,
            LodLevel::Culled => Self::LOW, // Shouldn't be called for culled, but fallback
        }
    }
}

/// Sample voxel from world or chunk, returns true if solid OR water
/// Water is treated as solid for SDF purposes to prevent surface nets from generating
/// surfaces at solid-water boundaries (which would create visible seams with the blocky water mesh)
fn sample_voxel_solid(chunk: &Chunk, world: &VoxelWorld, chunk_origin: IVec3, px: u32, py: u32, pz: u32) -> bool {
    let world_pos = chunk_origin + IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);

    let voxel = if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        chunk.get(UVec3::new(px - 1, py - 1, pz - 1))
    } else {
        world.get_voxel(world_pos).unwrap_or(VoxelType::Air)
    };

    // Treat water as solid for SDF so we don't generate surfaces at solid-water boundaries
    voxel.is_solid() || voxel.is_liquid()
}

/// Smooths an SDF array at interior cells by averaging with neighbors.
///
/// IMPORTANT: Only smooths cells that are fully interior to the chunk (positions 2-15).
/// Boundary cells (positions 1 and 16) are left unchanged to ensure consistent
/// vertex positions between adjacent chunks - this prevents seams/cracks.
///
/// # Arguments
/// * `sdf` - The raw SDF array to smooth
/// * `current_weight` - Weight for the current cell value (0.0-1.0)
///
/// The neighbor weight is `1.0 - current_weight`.
#[allow(dead_code)]
fn smooth_sdf_boundaries(sdf: &[f32; 5832], current_weight: f32) -> [f32; 5832] {
    let neighbor_weight = 1.0 - current_weight;
    let mut smoothed = *sdf;

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);

        // Only smooth truly interior cells (2-15), NOT boundary cells (1 and 16).
        // This ensures adjacent chunks calculate identical SDF values at their shared boundary,
        // which produces identical vertex positions and eliminates seams.
        if px >= 2 && px <= 15 && py >= 2 && py <= 15 && pz >= 2 && pz <= 15 {
            let current = sdf[i];

            let neighbors = [
                sdf[PaddedChunkShape::linearize([px - 1, py, pz]) as usize],
                sdf[PaddedChunkShape::linearize([px + 1, py, pz]) as usize],
                sdf[PaddedChunkShape::linearize([px, py - 1, pz]) as usize],
                sdf[PaddedChunkShape::linearize([px, py + 1, pz]) as usize],
                sdf[PaddedChunkShape::linearize([px, py, pz - 1]) as usize],
                sdf[PaddedChunkShape::linearize([px, py, pz + 1]) as usize],
            ];

            let has_sign_change = neighbors.iter().any(|&n| (n > 0.0) != (current > 0.0));

            if has_sign_change {
                let neighbor_avg: f32 = neighbors.iter().sum::<f32>() / 6.0;
                smoothed[i] = current * current_weight + neighbor_avg * neighbor_weight;
            }
        }
    }

    smoothed
}

/// Generate an SDF array from voxel data with 1-voxel padding for neighbor sampling.
/// Uses distance-based SDF for smoother surfaces at chunk boundaries.
/// This is the LOD0 (high detail) version - samples every voxel.
fn generate_sdf(chunk: &Chunk, world: &VoxelWorld) -> [f32; 5832] { // 18^3 = 5832
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

    // First pass: set binary solid/air values
    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let is_solid = sample_voxel_solid(chunk, world, chunk_origin, px, py, pz);
        // SDF: negative inside solid, positive in air
        sdf[i] = if is_solid { -1.0 } else { 1.0 };
    }

    // Skip smoothing - it causes boundary vertices to differ between chunks, creating seams.
    // The raw binary SDF produces consistent boundary vertices across chunks.
    sdf
}

/// Sample voxel at a world position, returns true if solid or liquid.
/// Used for LOD sampling where coordinates may be outside the chunk.
fn sample_voxel_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> bool {
    match world.get_voxel(world_pos) {
        Some(voxel) => voxel.is_solid() || voxel.is_liquid(),
        None => false, // Outside world bounds = air
    }
}

/// Generate an SDF array at LOD1 (half resolution) with multi-sample averaging.
/// Returns a 10x10x10 grid (1000 elements) instead of 18x18x18 (5832).
/// Vertex positions must be scaled by step_size (2) after mesh generation.
///
/// Instead of sampling a single voxel per cell, this samples all voxels in the
/// 2x2x2 region covered by each LOD cell and computes a weighted density.
/// This creates smoother SDF gradients that reduce stair-stepping on slopes.
fn generate_sdf_lod1(chunk: &Chunk, world: &VoxelWorld) -> [f32; 1000] { // 10^3 = 1000
    let mut sdf = [1.0f32; LodShape1::USIZE];
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let step = LOD1_STEP_SIZE as i32;

    for z in 0..LOD1_PADDED_SIZE {
        for y in 0..LOD1_PADDED_SIZE {
            for x in 0..LOD1_PADDED_SIZE {
                let idx = LodShape1::linearize([x, y, z]) as usize;

                // Base world position for this LOD cell
                let base_x = chunk_origin.x + (x as i32 - 1) * step;
                let base_y = chunk_origin.y + (y as i32 - 1) * step;
                let base_z = chunk_origin.z + (z as i32 - 1) * step;

                // Sample all voxels in the 2x2x2 region and count solids
                let mut solid_count = 0;
                let sample_count = step * step * step; // 8 for step=2

                for dz in 0..step {
                    for dy in 0..step {
                        for dx in 0..step {
                            let world_pos = IVec3::new(
                                base_x + dx,
                                base_y + dy,
                                base_z + dz,
                            );
                            if sample_voxel_at_world_pos(world, world_pos) {
                                solid_count += 1;
                            }
                        }
                    }
                }

                // Convert count to SDF value:
                // 0 solids = +1.0 (fully air)
                // 8 solids = -1.0 (fully solid)
                // 4 solids = 0.0 (surface)
                // This creates smooth gradients instead of hard -1/+1 edges
                let density = solid_count as f32 / sample_count as f32;
                sdf[idx] = 1.0 - 2.0 * density; // Maps 0->1, 0.5->0, 1->-1
            }
        }
    }

    sdf
}

/// Get voxel type at padded coordinates for water SDF generation.
fn get_voxel_for_water_sdf(chunk: &Chunk, world: &VoxelWorld, chunk_origin: IVec3, px: i32, py: i32, pz: i32) -> VoxelType {
    let world_pos = chunk_origin + IVec3::new(px - 1, py - 1, pz - 1);

    if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        chunk.get(UVec3::new((px - 1) as u32, (py - 1) as u32, (pz - 1) as u32))
    } else {
        world.get_voxel(world_pos).unwrap_or(VoxelType::Air)
    }
}

/// Generate an SDF array for water surfaces.
/// Only generates surfaces at water/air boundaries.
/// Solid voxels are treated as "outside" to prevent water from appearing on terrain.
fn generate_water_sdf(chunk: &Chunk, world: &VoxelWorld) -> [f32; 5832] {
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let px = px as i32;
        let py = py as i32;
        let pz = pz as i32;

        let voxel = get_voxel_for_water_sdf(chunk, world, chunk_origin, px, py, pz);

        sdf[i] = if voxel.is_liquid() {
            // Water is "inside" - surface generated at water/air boundary
            -1.0
        } else {
            // Both solid and air are "outside"
            // This ensures water surface only appears at water/air boundaries,
            // not at solid/air boundaries above water (which caused striping)
            1.0
        };
    }

    sdf
}

/// Sanitizes a position array, replacing NaN/infinite values with 0.0.
#[inline]
fn sanitize_position(pos: [f32; 3]) -> [f32; 3] {
    [
        if pos[0].is_finite() { pos[0] } else { 0.0 },
        if pos[1].is_finite() { pos[1] } else { 0.0 },
        if pos[2].is_finite() { pos[2] } else { 0.0 },
    ]
}

/// Extracts and normalizes a normal from the buffer, with fallback.
fn get_normalized_normal(normals: &[[f32; 3]], index: usize) -> [f32; 3] {
    let n = normals.get(index).copied().unwrap_or([0.0, 1.0, 0.0]);
    if n[0].is_finite() && n[1].is_finite() && n[2].is_finite() {
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if len > 0.001 {
            [n[0] / len, n[1] / len, n[2] / len]
        } else {
            [0.0, 1.0, 0.0]
        }
    } else {
        [0.0, 1.0, 0.0]
    }
}

/// Scales a vertex position outward from chunk center to close seams.
#[inline]
fn scale_vertex_from_center(local: Vec3, chunk_center: Vec3) -> [f32; 3] {
    let pos = Vec3::new(local.x * VOXEL_SIZE, local.y * VOXEL_SIZE, local.z * VOXEL_SIZE);
    let scaled = chunk_center + (pos - chunk_center) * CHUNK_BOUNDARY_SCALE;
    [scaled.x, scaled.y, scaled.z]
}

/// Computes material weights for a vertex based on neighboring voxels.
fn compute_vertex_material_weights(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
) -> [f32; 4] {
    let mut weights = [0.0f32; 4];
    let mut total_weight = 0.0;

    let base_x = local_pos.x.floor() as i32;
    let base_y = local_pos.y.floor() as i32;
    let base_z = local_pos.z.floor() as i32;

    for dz in 0..2 {
        for dy in 0..2 {
            for dx in 0..2 {
                let lx = base_x + dx;
                let ly = base_y + dy;
                let lz = base_z + dz;

                let voxel = if lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16 {
                    chunk.get(UVec3::new(lx as u32, ly as u32, lz as u32))
                } else {
                    let wx = chunk_origin.x + lx;
                    let wy = chunk_origin.y + ly;
                    let wz = chunk_origin.z + lz;
                    world.get_voxel(IVec3::new(wx, wy, wz)).unwrap_or(VoxelType::Air)
                };

                if voxel != VoxelType::Air && voxel != VoxelType::Water {
                    let mat_idx = match voxel {
                        VoxelType::TopSoil | VoxelType::Leaves => 0,
                        VoxelType::Rock | VoxelType::Bedrock |
                        VoxelType::DungeonWall | VoxelType::DungeonFloor => 1,
                        VoxelType::Sand => 2,
                        _ => 3,
                    };
                    weights[mat_idx] += 1.0;
                    total_weight += 1.0;
                }
            }
        }
    }

    if total_weight > 0.0 {
        [
            weights[0] / total_weight,
            weights[1] / total_weight,
            weights[2] / total_weight,
            weights[3] / total_weight,
        ]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

/// Computes material weights for a vertex with LOD-aware sampling.
/// Samples a larger area based on step_size to capture dominant materials.
fn compute_vertex_material_weights_lod(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    step_size: u32,
) -> [f32; 4] {
    let mut weights = [0.0f32; 4];
    let mut total_weight = 0.0;

    let base_x = local_pos.x.floor() as i32;
    let base_y = local_pos.y.floor() as i32;
    let base_z = local_pos.z.floor() as i32;

    // Sample a larger area based on step_size
    let range = step_size as i32;

    for dz in 0..range {
        for dy in 0..range {
            for dx in 0..range {
                let lx = base_x + dx;
                let ly = base_y + dy;
                let lz = base_z + dz;

                let voxel = if lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16 {
                    chunk.get(UVec3::new(lx as u32, ly as u32, lz as u32))
                } else {
                    let wx = chunk_origin.x + lx;
                    let wy = chunk_origin.y + ly;
                    let wz = chunk_origin.z + lz;
                    world.get_voxel(IVec3::new(wx, wy, wz)).unwrap_or(VoxelType::Air)
                };

                if voxel != VoxelType::Air && voxel != VoxelType::Water {
                    let mat_idx = match voxel {
                        VoxelType::TopSoil | VoxelType::Leaves => 0,
                        VoxelType::Rock | VoxelType::Bedrock |
                        VoxelType::DungeonWall | VoxelType::DungeonFloor => 1,
                        VoxelType::Sand => 2,
                        _ => 3,
                    };
                    weights[mat_idx] += 1.0;
                    total_weight += 1.0;
                }
            }
        }
    }

    if total_weight > 0.0 {
        [
            weights[0] / total_weight,
            weights[1] / total_weight,
            weights[2] / total_weight,
            weights[3] / total_weight,
        ]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

/// Generates water mesh using blocky faces for clean edges.
/// Uses exact voxel boundaries to prevent interpolation artifacts.
fn generate_water_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    _chunk_center: Vec3,
    _chunk_origin: IVec3,
) -> MeshData {
    let mut water_mesh = MeshData::new();

    // Use blocky face generation for clean water edges
    for x in 0..16u32 {
        for y in 0..16u32 {
            for z in 0..16u32 {
                let local = UVec3::new(x, y, z);
                let voxel = chunk.get(local);

                if voxel.is_liquid() {
                    // Generate water mesh faces (only visible against air)
                    if is_water_face_visible(chunk, world, local, Face::Top) {
                        add_face_no_ao(&mut water_mesh, local, Face::Top, voxel);
                    }
                    if is_water_face_visible(chunk, world, local, Face::Bottom) {
                        add_face_no_ao(&mut water_mesh, local, Face::Bottom, voxel);
                    }
                    if is_water_face_visible(chunk, world, local, Face::North) {
                        add_face_no_ao(&mut water_mesh, local, Face::North, voxel);
                    }
                    if is_water_face_visible(chunk, world, local, Face::South) {
                        add_face_no_ao(&mut water_mesh, local, Face::South, voxel);
                    }
                    if is_water_face_visible(chunk, world, local, Face::East) {
                        add_face_no_ao(&mut water_mesh, local, Face::East, voxel);
                    }
                    if is_water_face_visible(chunk, world, local, Face::West) {
                        add_face_no_ao(&mut water_mesh, local, Face::West, voxel);
                    }
                }
            }
        }
    }

    water_mesh
}

/// Old Surface Nets water mesh generation (kept for reference).
#[allow(dead_code)]
fn generate_water_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_center: Vec3,
    chunk_origin: IVec3,
) -> MeshData {
    let mut water_mesh = MeshData::new();

    let water_sdf = generate_water_sdf(chunk, world);
    let mut water_buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &water_sdf,
        &PaddedChunkShape {},
        [0; 3],
        [17; 3],
        &mut water_buffer,
    );

    if water_buffer.positions.is_empty() || water_buffer.indices.is_empty() {
        return water_mesh;
    }

    for tri_idx in (0..water_buffer.indices.len()).step_by(3) {
        let i0 = water_buffer.indices[tri_idx] as usize;
        let i1 = water_buffer.indices[tri_idx + 1] as usize;
        let i2 = water_buffer.indices[tri_idx + 2] as usize;

        let p0 = sanitize_position(water_buffer.positions.get(i0).copied().unwrap_or([0.0; 3]));
        let p1 = sanitize_position(water_buffer.positions.get(i1).copied().unwrap_or([0.0; 3]));
        let p2 = sanitize_position(water_buffer.positions.get(i2).copied().unwrap_or([0.0; 3]));

        let local0 = Vec3::new(p0[0] - 1.0, p0[1] - 1.0, p0[2] - 1.0);
        let local1 = Vec3::new(p1[0] - 1.0, p1[1] - 1.0, p1[2] - 1.0);
        let local2 = Vec3::new(p2[0] - 1.0, p2[1] - 1.0, p2[2] - 1.0);

        // Calculate averaged normal for the triangle
        let n0 = get_normalized_normal(&water_buffer.normals, i0);
        let n1 = get_normalized_normal(&water_buffer.normals, i1);
        let n2 = get_normalized_normal(&water_buffer.normals, i2);
        let avg = [
            (n0[0] + n1[0] + n2[0]) / 3.0,
            (n0[1] + n1[1] + n2[1]) / 3.0,
            (n0[2] + n1[2] + n2[2]) / 3.0,
        ];
        let len = (avg[0].powi(2) + avg[1].powi(2) + avg[2].powi(2)).sqrt();
        let final_normal = if len > 0.001 {
            [avg[0] / len, avg[1] / len, avg[2] / len]
        } else {
            [0.0, 1.0, 0.0]
        };

        let start_idx = water_mesh.positions.len() as u32;

        let offset = Vec3::Y * crate::constants::WATER_SURFACE_OFFSET;
        water_mesh.positions.push(scale_vertex_from_center(local0 + offset, chunk_center));
        water_mesh.positions.push(scale_vertex_from_center(local1 + offset, chunk_center));
        water_mesh.positions.push(scale_vertex_from_center(local2 + offset, chunk_center));

        water_mesh.normals.push(final_normal);
        water_mesh.normals.push(final_normal);
        water_mesh.normals.push(final_normal);

        // World-space UVs for water to keep waves continuous across chunks.
        let get_uv = |p: Vec3| -> [f32; 2] {
            let world_pos = chunk_origin.as_vec3() + p * VOXEL_SIZE;
            [world_pos.x, world_pos.z]
        };
        water_mesh.uvs.push(get_uv(local0));
        water_mesh.uvs.push(get_uv(local1));
        water_mesh.uvs.push(get_uv(local2));

        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);
        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);
        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);

        water_mesh.indices.push(start_idx);
        water_mesh.indices.push(start_idx + 1);
        water_mesh.indices.push(start_idx + 2);
    }

    water_mesh
}

/// Generate mesh using Surface Nets algorithm for smooth terrain.
pub fn generate_chunk_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    ao_config: &BakedAoConfig,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::new();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let chunk_origin_vec = chunk_origin.as_vec3();

    let density_sampler = |sample_pos: Vec3| -> f32 {
        let world_pos = chunk_origin_vec + sample_pos;
        let voxel_pos = IVec3::new(
            world_pos.x.floor() as i32,
            world_pos.y.floor() as i32,
            world_pos.z.floor() as i32,
        );
        match world.get_voxel(voxel_pos) {
            Some(voxel) if voxel.is_solid() => -1.0,
            _ => 1.0,
        }
    };

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate SDF from voxel data
    let sdf = generate_sdf(chunk, world);

    // Run surface nets on the SDF
    // Extract the full padded region [0,0,0] to [17,17,17)
    // Including the padding lets the mesh extend half a voxel past each edge,
    // so neighboring chunks meet without leaving a one-voxel gap.
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &sdf,
        &PaddedChunkShape {},
        [0; 3],  // Start at 0 (include negative padding)
        [17; 3], // End at 17 (include positive padding)
        &mut buffer,
    );

    // Convert surface nets output to MeshData
    // Use per-triangle vertices to ensure consistent material indices (no interpolation artifacts)
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let i0 = buffer.indices[tri_idx] as usize;
            let i1 = buffer.indices[tri_idx + 1] as usize;
            let i2 = buffer.indices[tri_idx + 2] as usize;

            // Get sanitized positions for this triangle
            let p0 = sanitize_position(buffer.positions.get(i0).copied().unwrap_or([0.0; 3]));
            let p1 = sanitize_position(buffer.positions.get(i1).copied().unwrap_or([0.0; 3]));
            let p2 = sanitize_position(buffer.positions.get(i2).copied().unwrap_or([0.0; 3]));

            // Calculate local positions (offset for padding)
            let local0 = Vec3::new(p0[0] - 1.0, p0[1] - 1.0, p0[2] - 1.0);
            let local1 = Vec3::new(p1[0] - 1.0, p1[1] - 1.0, p1[2] - 1.0);
            let local2 = Vec3::new(p2[0] - 1.0, p2[1] - 1.0, p2[2] - 1.0);

            // Get normals for this triangle
            let normal0 = get_normalized_normal(&buffer.normals, i0);
            let normal1 = get_normalized_normal(&buffer.normals, i1);
            let normal2 = get_normalized_normal(&buffer.normals, i2);

            // Calculate material weights for each vertex
            let weights0 = compute_vertex_material_weights(local0, chunk, world, chunk_origin);
            let weights1 = compute_vertex_material_weights(local1, chunk, world, chunk_origin);
            let weights2 = compute_vertex_material_weights(local2, chunk, world, chunk_origin);

            // Compute AO for each vertex
            let compute_ao = |local: Vec3, normal: [f32; 3]| -> f32 {
                if !ao_config.enabled {
                    return 1.0;
                }
                let normal = Vec3::from_array(normal).normalize_or_zero();
                compute_surface_nets_ao(local, normal, 0.5, &density_sampler, ao_config)
            };

            let ao0 = compute_ao(local0, normal0);
            let ao1 = compute_ao(local1, normal1);
            let ao2 = compute_ao(local2, normal2);

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh.positions.push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao0, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh.positions.push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao1, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh.positions.push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao2, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
        }
    }

    if !solid_mesh.indices.is_empty() {
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
        );

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh using the extracted helper
    let water_mesh = generate_water_mesh(chunk, world, chunk_center, chunk_origin);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
    }
}

/// Generate mesh using Surface Nets at LOD1 (half resolution).
/// This function samples every 2nd voxel, reducing vertex count by ~75%.
/// Vertices are scaled by step_size (2) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod1(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::new();
    let mut local_positions: Vec<Vec3> = Vec::new();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD1 - each grid cell covers 2 voxels
    let step = LOD1_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (10x10x10 grid)
    let sdf = generate_sdf_lod1(chunk, world);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &sdf,
        &LodShape1 {},
        [0; 3],
        [(LOD1_PADDED_SIZE - 1) as u32; 3], // [9, 9, 9]
        &mut buffer,
    );

    // Convert surface nets output to MeshData with vertex scaling
    if !buffer.positions.is_empty() && !buffer.indices.is_empty() {
        for tri_idx in (0..buffer.indices.len()).step_by(3) {
            let i0 = buffer.indices[tri_idx] as usize;
            let i1 = buffer.indices[tri_idx + 1] as usize;
            let i2 = buffer.indices[tri_idx + 2] as usize;

            // Get sanitized positions for this triangle
            let p0 = sanitize_position(buffer.positions.get(i0).copied().unwrap_or([0.0; 3]));
            let p1 = sanitize_position(buffer.positions.get(i1).copied().unwrap_or([0.0; 3]));
            let p2 = sanitize_position(buffer.positions.get(i2).copied().unwrap_or([0.0; 3]));

            // Calculate local positions with step scaling:
            // - Subtract 1.0 to remove padding offset (grid pos 1 = chunk start)
            // - Multiply by step to scale to actual voxel coordinates
            let local0 = Vec3::new(
                (p0[0] - 1.0) * step,
                (p0[1] - 1.0) * step,
                (p0[2] - 1.0) * step,
            );
            let local1 = Vec3::new(
                (p1[0] - 1.0) * step,
                (p1[1] - 1.0) * step,
                (p1[2] - 1.0) * step,
            );
            let local2 = Vec3::new(
                (p2[0] - 1.0) * step,
                (p2[1] - 1.0) * step,
                (p2[2] - 1.0) * step,
            );

            // Get normals for this triangle
            let normal0 = get_normalized_normal(&buffer.normals, i0);
            let normal1 = get_normalized_normal(&buffer.normals, i1);
            let normal2 = get_normalized_normal(&buffer.normals, i2);

            // Calculate material weights with larger sampling radius for LOD1
            let weights0 = compute_vertex_material_weights_lod(local0, chunk, world, chunk_origin, LOD1_STEP_SIZE);
            let weights1 = compute_vertex_material_weights_lod(local1, chunk, world, chunk_origin, LOD1_STEP_SIZE);
            let weights2 = compute_vertex_material_weights_lod(local2, chunk, world, chunk_origin, LOD1_STEP_SIZE);

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh.positions.push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh.positions.push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh.positions.push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
        }
    }

    // Generate skirts for LOD boundaries
    if !solid_mesh.indices.is_empty() {
        let boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
        );

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    let water_mesh = generate_water_mesh(chunk, world, chunk_center, chunk_origin);

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
    }
}

/// Mesh generation mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MeshMode {
    /// Traditional blocky voxel meshing (Minecraft-style)
    #[default]
    Blocky,
    /// Smooth meshing using Surface Nets algorithm
    SurfaceNets,
}

/// Resource to control mesh generation mode globally
#[derive(Resource, Clone, Copy, Debug)]
pub struct MeshSettings {
    pub mode: MeshMode,
}

impl Default for MeshSettings {
    fn default() -> Self {
        Self {
            mode: MeshMode::Blocky,
        }
    }
}

/// Generate chunk mesh using the specified mode.
/// For SurfaceNets, automatically selects LOD0 (high detail) or LOD1 (low detail)
/// based on the chunk's LOD level.
pub fn generate_chunk_mesh_with_mode(
    chunk: &Chunk,
    world: &VoxelWorld,
    mode: MeshMode,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    ao_config: &BakedAoConfig,
) -> ChunkMeshResult {
    match mode {
        MeshMode::Blocky => generate_chunk_mesh(chunk, world, ao_config),
        MeshMode::SurfaceNets => {
            // Select LOD-appropriate mesh generation
            match my_lod {
                LodLevel::High => {
                    // Full detail Surface Nets (18x18x18 grid, step 1)
                    generate_chunk_mesh_surface_nets(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                    )
                }
                LodLevel::Low => {
                    // Half detail Surface Nets (10x10x10 grid, step 2)
                    // ~75% vertex reduction for distant chunks
                    generate_chunk_mesh_surface_nets_lod1(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                    )
                }
                LodLevel::Culled => {
                    // Shouldn't reach here - culled chunks skip meshing entirely
                    // But if we do, return empty mesh
                    ChunkMeshResult {
                        solid: MeshData::new(),
                        water: MeshData::new(),
                    }
                }
            }
        }
    }
}

