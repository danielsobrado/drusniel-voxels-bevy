use super::{
    ChunkMeshResult, Face, LodTransitionSnapStats, MeshData, MeshGenerationTimingStats,
    TerrainMeshSectionStats, WATER_EDGE_SURFACE_SUPPRESSION_MARGIN, WATER_SHORELINE_EXTENSION,
    WaterAirExposureMode, WaterExposureCache, WaterMeshingStats,
};
use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::chunk::Chunk;
use crate::voxel::materials::MaterialId;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::{IVec3, UVec3};
use std::collections::{HashSet, VecDeque};

// =============================================================================
// Greedy Meshing Types and Implementation
// =============================================================================

/// Information about a face for greedy meshing.
/// Faces can only be merged if all fields match.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(super) struct FaceInfo {
    /// The voxel type (for material/texture selection)
    voxel: VoxelType,
    /// The assigned material for this voxel.
    material_id: MaterialId,
    /// Whether this face slot is visible and should be meshed
    visible: bool,
}

/// A merged rectangle from greedy meshing
pub(super) struct GreedyQuad {
    /// Starting position in the 2D slice (u, v coordinates)
    start: (u32, u32),
    /// Size of the quad (width, height in the slice)
    size: (u32, u32),
    /// The voxel type for this quad
    voxel: VoxelType,
    /// The assigned material for this quad
    material_id: MaterialId,
    /// The depth (position along the face normal direction)
    depth: u32,
}

/// Build a 2D mask of visible faces for a given slice.
/// Returns a CHUNK_SIZE x CHUNK_SIZE array of FaceInfo.
pub(super) fn build_face_mask(
    chunk: &Chunk,
    world: &VoxelWorld,
    face: Face,
    depth: u32,
) -> [[FaceInfo; CHUNK_SIZE]; CHUNK_SIZE] {
    let mut mask = [[FaceInfo::default(); CHUNK_SIZE]; CHUNK_SIZE];

    // Map face direction to axis and iteration order
    // For each face, we iterate over the 2D slice perpendicular to the face normal
    for u in 0..CHUNK_SIZE {
        for v in 0..CHUNK_SIZE {
            // Convert (depth, u, v) to local voxel coordinates based on face direction
            let local = match face {
                Face::Top | Face::Bottom => UVec3::new(u as u32, depth, v as u32),
                Face::North | Face::South => UVec3::new(u as u32, v as u32, depth),
                Face::East | Face::West => UVec3::new(depth, v as u32, u as u32),
            };

            let voxel = terrain_meshing_voxel_in_chunk(chunk, world, local);

            // Skip non-solid voxels (air, water handled separately)
            if !voxel.is_solid() {
                continue;
            }

            // Check if this face is visible
            if is_face_visible(chunk, world, local, face) {
                let material_id = terrain_meshing_material_in_chunk(chunk, world, local, voxel);
                mask[u][v] = FaceInfo {
                    voxel,
                    material_id,
                    visible: true,
                };
            }
        }
    }

    mask
}

/// Greedy meshing: find maximal rectangles in a 2D face mask.
/// Appends merged quads into the caller-provided buffer (cleared first).
/// This avoids 96 heap allocations per chunk (6 faces × 16 depths).
pub(super) fn greedy_mesh_slice(
    mask: &mut [[FaceInfo; CHUNK_SIZE]; CHUNK_SIZE],
    depth: u32,
    quads: &mut Vec<GreedyQuad>,
) {
    quads.clear();

    for start_u in 0..CHUNK_SIZE {
        for start_v in 0..CHUNK_SIZE {
            let info = mask[start_u][start_v];

            // Skip empty/already processed cells
            if !info.visible {
                continue;
            }

            // Find the width (extend in u direction)
            let mut width = 1;
            while start_u + width < CHUNK_SIZE {
                let next = mask[start_u + width][start_v];
                if next.visible && next.voxel == info.voxel && next.material_id == info.material_id
                {
                    width += 1;
                } else {
                    break;
                }
            }

            // Find the height (extend in v direction)
            let mut height = 1;
            'height_loop: while start_v + height < CHUNK_SIZE {
                // Check if the entire row matches
                for du in 0..width {
                    let next = mask[start_u + du][start_v + height];
                    if !next.visible
                        || next.voxel != info.voxel
                        || next.material_id != info.material_id
                    {
                        break 'height_loop;
                    }
                }
                height += 1;
            }

            // Mark all cells in this quad as processed
            for du in 0..width {
                for dv in 0..height {
                    mask[start_u + du][start_v + dv].visible = false;
                }
            }

            // Add the quad
            quads.push(GreedyQuad {
                start: (start_u as u32, start_v as u32),
                size: (width as u32, height as u32),
                voxel: info.voxel,
                material_id: info.material_id,
                depth,
            });
        }
    }
}

/// Add a greedy quad to the mesh data with proper AO calculation.
pub(super) fn add_greedy_quad(
    mesh_data: &mut MeshData,
    chunk: &Chunk,
    world: &VoxelWorld,
    quad: &GreedyQuad,
    face: Face,
    ao_config: &BakedAoConfig,
) {
    let s = VOXEL_SIZE;
    let (u_start, v_start) = quad.start;
    let (u_size, v_size) = quad.size;

    // Convert quad coordinates to world-space vertices based on face direction
    // The quad spans from (u_start, v_start) to (u_start + u_size, v_start + v_size)
    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => {
            let y = (quad.depth as f32 + 1.0) * s;
            let x0 = u_start as f32 * s;
            let x1 = (u_start + u_size) as f32 * s;
            let z0 = v_start as f32 * s;
            let z1 = (v_start + v_size) as f32 * s;
            (
                [x0, y, z1],
                [x1, y, z1],
                [x1, y, z0],
                [x0, y, z0],
                [0.0, 1.0, 0.0],
            )
        }
        Face::Bottom => {
            let y = quad.depth as f32 * s;
            let x0 = u_start as f32 * s;
            let x1 = (u_start + u_size) as f32 * s;
            let z0 = v_start as f32 * s;
            let z1 = (v_start + v_size) as f32 * s;
            (
                [x0, y, z0],
                [x1, y, z0],
                [x1, y, z1],
                [x0, y, z1],
                [0.0, -1.0, 0.0],
            )
        }
        Face::North => {
            let z = quad.depth as f32 * s;
            let x0 = u_start as f32 * s;
            let x1 = (u_start + u_size) as f32 * s;
            let y0 = v_start as f32 * s;
            let y1 = (v_start + v_size) as f32 * s;
            (
                [x1, y0, z],
                [x0, y0, z],
                [x0, y1, z],
                [x1, y1, z],
                [0.0, 0.0, -1.0],
            )
        }
        Face::South => {
            let z = (quad.depth as f32 + 1.0) * s;
            let x0 = u_start as f32 * s;
            let x1 = (u_start + u_size) as f32 * s;
            let y0 = v_start as f32 * s;
            let y1 = (v_start + v_size) as f32 * s;
            (
                [x0, y0, z],
                [x1, y0, z],
                [x1, y1, z],
                [x0, y1, z],
                [0.0, 0.0, 1.0],
            )
        }
        Face::East => {
            let x = (quad.depth as f32 + 1.0) * s;
            let z0 = u_start as f32 * s;
            let z1 = (u_start + u_size) as f32 * s;
            let y0 = v_start as f32 * s;
            let y1 = (v_start + v_size) as f32 * s;
            (
                [x, y0, z1],
                [x, y0, z0],
                [x, y1, z0],
                [x, y1, z1],
                [1.0, 0.0, 0.0],
            )
        }
        Face::West => {
            let x = quad.depth as f32 * s;
            let z0 = u_start as f32 * s;
            let z1 = (u_start + u_size) as f32 * s;
            let y0 = v_start as f32 * s;
            let y1 = (v_start + v_size) as f32 * s;
            (
                [x, y0, z0],
                [x, y0, z1],
                [x, y1, z1],
                [x, y1, z0],
                [-1.0, 0.0, 0.0],
            )
        }
    };

    // Calculate AO for each corner of the merged quad
    // We sample AO at the corner voxels of the quad
    let ao = get_greedy_quad_ao(chunk, world, quad, face, ao_config);

    let start_idx = mesh_data.positions.len() as u32;

    mesh_data.positions.push(v0);
    mesh_data.positions.push(v1);
    mesh_data.positions.push(v2);
    mesh_data.positions.push(v3);

    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);
    mesh_data.normals.push(normal);

    let material_index =
        get_blocky_material_index_for_material(quad.material_id, quad.voxel, face) as f32 / 255.0;
    mesh_data.colors.push([ao[0], ao[0], ao[0], material_index]);
    mesh_data.colors.push([ao[1], ao[1], ao[1], material_index]);
    mesh_data.colors.push([ao[2], ao[2], ao[2], material_index]);
    mesh_data.colors.push([ao[3], ao[3], ao[3], material_index]);

    // UVs scaled by quad size for proper texture tiling
    let u_scale = u_size as f32;
    let v_scale = v_size as f32;
    mesh_data.uvs.push([0.0, v_scale]);
    mesh_data.uvs.push([u_scale, v_scale]);
    mesh_data.uvs.push([u_scale, 0.0]);
    mesh_data.uvs.push([0.0, 0.0]);

    // Use flipped winding for proper AO interpolation when needed
    if !ao_config.fix_anisotropy || ao[0] + ao[2] > ao[1] + ao[3] {
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 2);
        mesh_data.indices.push(start_idx + 1);
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 3);
        mesh_data.indices.push(start_idx + 2);
    } else {
        mesh_data.indices.push(start_idx + 1);
        mesh_data.indices.push(start_idx);
        mesh_data.indices.push(start_idx + 3);
        mesh_data.indices.push(start_idx + 1);
        mesh_data.indices.push(start_idx + 3);
        mesh_data.indices.push(start_idx + 2);
    }
}

/// Calculate AO values for the 4 corners of a greedy quad.
/// For each corner, we sample the neighboring voxels to compute occlusion.
pub(super) fn get_greedy_quad_ao(
    chunk: &Chunk,
    world: &VoxelWorld,
    quad: &GreedyQuad,
    face: Face,
    ao_config: &BakedAoConfig,
) -> [f32; 4] {
    if !ao_config.enabled {
        return [1.0; 4];
    }

    let (u_start, v_start) = quad.start;
    let (u_size, v_size) = quad.size;

    // For each corner of the quad, we need to find the voxel that corner belongs to
    // and get the appropriate AO value for that vertex.
    // Corners map to vertices: v0, v1, v2, v3 (see add_greedy_quad)

    let mut ao = [1.0; 4];

    // For greedy quads, we sample AO at the corner voxels and use the vertex index
    // that corresponds to that corner's position within the face.
    //
    // The vertex order for each face (matching add_greedy_quad):
    // Top:    v0(x,y+1,z+1), v1(x+1,y+1,z+1), v2(x+1,y+1,z), v3(x,y+1,z)
    // Bottom: v0(x,y,z), v1(x+1,y,z), v2(x+1,y,z+1), v3(x,y,z+1)
    // North:  v0(x+1,y,z), v1(x,y,z), v2(x,y+1,z), v3(x+1,y+1,z)
    // South:  v0(x,y,z+1), v1(x+1,y,z+1), v2(x+1,y+1,z+1), v3(x,y+1,z+1)
    // East:   v0(x+1,y,z+1), v1(x+1,y,z), v2(x+1,y+1,z), v3(x+1,y+1,z+1)
    // West:   v0(x,y,z), v1(x,y,z+1), v2(x,y+1,z+1), v3(x,y+1,z)

    // For a greedy quad, we need to sample the corner voxel and get the right vertex AO.
    // Corner 0 (v0): top-left in (u,v) space -> maps to specific voxel + vertex
    // Corner 1 (v1): top-right
    // Corner 2 (v2): bottom-right
    // Corner 3 (v3): bottom-left

    // Get AO for each corner by sampling the voxel at that corner
    // We clamp u-1 and v-1 to stay in bounds for corners at the edge
    let corner_voxels: [(u32, u32, usize); 4] = match face {
        Face::Top => [
            // v0 at (u_start, v_start + v_size) -> voxel (u_start, v_start+v_size-1), vertex 0
            (u_start, v_start + v_size - 1, 0),
            // v1 at (u_start + u_size, v_start + v_size) -> voxel (u_start+u_size-1, v_start+v_size-1), vertex 1
            (u_start + u_size - 1, v_start + v_size - 1, 1),
            // v2 at (u_start + u_size, v_start) -> voxel (u_start+u_size-1, v_start), vertex 2
            (u_start + u_size - 1, v_start, 2),
            // v3 at (u_start, v_start) -> voxel (u_start, v_start), vertex 3
            (u_start, v_start, 3),
        ],
        Face::Bottom => [
            (u_start, v_start, 0),
            (u_start + u_size - 1, v_start, 1),
            (u_start + u_size - 1, v_start + v_size - 1, 2),
            (u_start, v_start + v_size - 1, 3),
        ],
        Face::North => [
            (u_start + u_size - 1, v_start, 0),
            (u_start, v_start, 1),
            (u_start, v_start + v_size - 1, 2),
            (u_start + u_size - 1, v_start + v_size - 1, 3),
        ],
        Face::South => [
            (u_start, v_start, 0),
            (u_start + u_size - 1, v_start, 1),
            (u_start + u_size - 1, v_start + v_size - 1, 2),
            (u_start, v_start + v_size - 1, 3),
        ],
        Face::East => [
            (u_start + u_size - 1, v_start, 0),
            (u_start, v_start, 1),
            (u_start, v_start + v_size - 1, 2),
            (u_start + u_size - 1, v_start + v_size - 1, 3),
        ],
        Face::West => [
            (u_start, v_start, 0),
            (u_start + u_size - 1, v_start, 1),
            (u_start + u_size - 1, v_start + v_size - 1, 2),
            (u_start, v_start + v_size - 1, 3),
        ],
    };

    for (corner_idx, (u, v, vertex_idx)) in corner_voxels.iter().enumerate() {
        // Convert (depth, u, v) to local voxel coordinates
        let local = match face {
            Face::Top | Face::Bottom => UVec3::new(*u, quad.depth, *v),
            Face::North | Face::South => UVec3::new(*u, *v, quad.depth),
            Face::East | Face::West => UVec3::new(quad.depth, *v, *u),
        };

        let face_ao = get_face_ao(chunk, world, local, face, ao_config);
        ao[corner_idx] = face_ao[*vertex_idx];
    }

    ao
}

pub(super) fn generate_blocky_chunk_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(1024, 1536);
    let mut water_mesh = MeshData::with_capacity(256, 384);

    // Greedy meshing for solid blocks - process each face direction
    let faces = [
        Face::Top,
        Face::Bottom,
        Face::North,
        Face::South,
        Face::East,
        Face::West,
    ];

    // Reusable buffer for greedy quads — avoids 96 heap allocations per chunk
    let mut quads = Vec::with_capacity(64);

    for face in faces {
        // Process each slice perpendicular to the face direction
        for depth in 0..CHUNK_SIZE as u32 {
            // Build mask of visible faces for this slice
            let mut mask = build_face_mask(chunk, world, face, depth);

            // Find and emit greedy quads
            greedy_mesh_slice(&mut mask, depth, &mut quads);

            for quad in &quads {
                add_greedy_quad(&mut solid_mesh, chunk, world, quad, face, ao_config);
            }
        }
    }

    // Greedy meshing for water faces — merges ocean surfaces into large quads
    let mut water_quads: Vec<GreedyQuad> = Vec::with_capacity(32);
    let mut water_exposure = WaterExposureCache::new(water_exposure_mode);
    let mut water_stats = WaterMeshingStats::default();
    for face in faces {
        for depth in 0..CHUNK_SIZE as u32 {
            let mut mask = build_water_face_mask(
                chunk,
                world,
                face,
                depth,
                &mut water_exposure,
                &mut water_stats,
            );
            greedy_mesh_slice(&mut mask, depth, &mut water_quads);
            for quad in &water_quads {
                add_greedy_water_face(
                    &mut water_mesh,
                    quad,
                    face,
                    VoxelWorld::chunk_to_world(chunk.position()),
                );
            }
        }
    }

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats: LodTransitionSnapStats::default(),
        mesh_section_stats: TerrainMeshSectionStats::default(),
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        generation_timing: MeshGenerationTimingStats::default(),
    }
}

/// Returns the face offset vector for a given face direction.
#[inline]
pub(super) fn face_offset(face: Face) -> IVec3 {
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
pub(super) fn is_in_chunk_bounds(pos: IVec3) -> bool {
    pos.x >= 0
        && pos.x < CHUNK_SIZE_I32
        && pos.y >= 0
        && pos.y < CHUNK_SIZE_I32
        && pos.z >= 0
        && pos.z < CHUNK_SIZE_I32
}

#[inline]
pub(super) fn terrain_meshing_voxel_at(world: &VoxelWorld, world_pos: IVec3) -> VoxelType {
    world
        .sample_voxel_for_terrain_meshing(world_pos)
        .terrain_meshing_voxel()
}

#[inline]
pub(super) fn water_meshing_voxel_at(world: &VoxelWorld, world_pos: IVec3) -> VoxelType {
    world
        .sample_voxel_for_water_meshing(world_pos)
        .water_meshing_voxel()
}

#[inline]
pub(super) fn terrain_meshing_voxel_in_chunk(
    chunk: &Chunk,
    _world: &VoxelWorld,
    local: UVec3,
) -> VoxelType {
    chunk.get(local)
}

#[inline]
pub(super) fn terrain_meshing_material_at(
    world: &VoxelWorld,
    world_pos: IVec3,
    fallback_voxel: VoxelType,
) -> MaterialId {
    if world.get_voxel(world_pos) == Some(fallback_voxel) {
        world
            .get_material_id(world_pos)
            .unwrap_or_else(|| MaterialId::from_voxel(fallback_voxel))
    } else {
        MaterialId::from_voxel(fallback_voxel)
    }
}

#[inline]
pub(super) fn terrain_meshing_material_in_chunk(
    chunk: &Chunk,
    _world: &VoxelWorld,
    local: UVec3,
    fallback_voxel: VoxelType,
) -> MaterialId {
    if chunk.get(local) == fallback_voxel {
        chunk.get_material_id(local)
    } else {
        MaterialId::from_voxel(fallback_voxel)
    }
}

#[inline]
pub(super) fn water_meshing_voxel_in_chunk(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
) -> VoxelType {
    let world_pos = VoxelWorld::chunk_to_world(chunk.position()) + local.as_ivec3();
    water_meshing_voxel_at(world, world_pos)
}

/// Gets the neighboring voxel for a face, checking chunk first then world.
pub(super) fn get_neighbor_voxel(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
) -> VoxelType {
    let offset = face_offset(face);
    let neighbor_local = IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;

    if is_in_chunk_bounds(neighbor_local) {
        terrain_meshing_voxel_in_chunk(
            chunk,
            world,
            UVec3::new(
                neighbor_local.x as u32,
                neighbor_local.y as u32,
                neighbor_local.z as u32,
            ),
        )
    } else {
        // Neighbor is outside chunk - check world
        let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
        let world_pos =
            chunk_origin + IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;
        terrain_meshing_voxel_at(world, world_pos)
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
pub(super) fn is_face_visible_with<F>(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    is_visible: F,
) -> bool
where
    F: Fn(VoxelType) -> bool,
{
    is_visible(get_neighbor_voxel(chunk, world, local, face))
}

/// Solid face is visible when neighbor is transparent (air or water).
pub(super) fn is_face_visible(chunk: &Chunk, world: &VoxelWorld, local: UVec3, face: Face) -> bool {
    is_face_visible_with(chunk, world, local, face, |neighbor| {
        neighbor.is_transparent()
    })
}

pub(super) fn water_face_neighbor_air_pos(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
) -> Option<IVec3> {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let air_pos = chunk_origin + local.as_ivec3() + face_direction(face);
    match world.sample_voxel_for_water_meshing(air_pos) {
        VoxelSample::InBounds(VoxelType::Air) | VoxelSample::OutsideAboveWorld => Some(air_pos),
        _ => None,
    }
}

pub(super) fn face_direction(face: Face) -> IVec3 {
    match face {
        Face::Top => IVec3::Y,
        Face::Bottom => -IVec3::Y,
        Face::North => -IVec3::Z,
        Face::South => IVec3::Z,
        Face::East => IVec3::X,
        Face::West => -IVec3::X,
    }
}

/// Build a 2D mask for water faces on a given slice (analogous to build_face_mask).
/// All water voxels share the same type, so greedy meshing merges them aggressively.
pub(super) fn build_water_face_mask(
    chunk: &Chunk,
    world: &VoxelWorld,
    face: Face,
    depth: u32,
    exposure: &mut WaterExposureCache,
    stats: &mut WaterMeshingStats,
) -> [[FaceInfo; CHUNK_SIZE]; CHUNK_SIZE] {
    let mut mask = [[FaceInfo::default(); CHUNK_SIZE]; CHUNK_SIZE];

    for u in 0..CHUNK_SIZE {
        for v in 0..CHUNK_SIZE {
            let local = match face {
                Face::Top | Face::Bottom => UVec3::new(u as u32, depth, v as u32),
                Face::North | Face::South => UVec3::new(u as u32, v as u32, depth),
                Face::East | Face::West => UVec3::new(depth, v as u32, u as u32),
            };

            let voxel = water_meshing_voxel_in_chunk(chunk, world, local);
            if !voxel.is_liquid() {
                continue;
            }

            if should_render_water_face(chunk, world, local, face, exposure, stats) {
                mask[u][v] = FaceInfo {
                    voxel,
                    material_id: MaterialId::from_voxel(voxel),
                    visible: true,
                };
            }
        }
    }

    mask
}

pub(super) fn should_render_water_face(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    face: Face,
    exposure: &mut WaterExposureCache,
    stats: &mut WaterMeshingStats,
) -> bool {
    if !matches!(face, Face::Top) {
        return false;
    }

    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());
    let world_pos = chunk_origin + local.as_ivec3();
    if world_pos.y < world.bounds().min_world_y {
        stats.invalid_meshes_suppressed += 1;
        return false;
    }
    if water_surface_near_horizontal_world_edge(world, world_pos) {
        stats.edge_water_faces_suppressed += 1;
        return false;
    }

    let Some(air_pos) = water_face_neighbor_air_pos(chunk, world, local, face) else {
        if matches!(
            world.sample_voxel_for_water_meshing(world_pos + face_direction(face)),
            VoxelSample::OutsideBelowWorld
                | VoxelSample::OutsideHorizontalWorld
                | VoxelSample::MissingChunkInsideBounds
        ) {
            stats.invalid_meshes_suppressed += 1;
        }
        return false;
    };

    stats.air_boundaries_total += 1;
    let exposed = matches!(
        world.sample_voxel_for_water_meshing(air_pos),
        VoxelSample::OutsideAboveWorld
    ) || exposure.air_exposed(world, air_pos, stats);
    if exposed {
        stats.air_boundaries_exposed += 1;
        true
    } else {
        stats.air_boundaries_sealed += 1;
        stats.triangles_removed_sealed += 2;
        false
    }
}

pub(super) fn water_surface_near_horizontal_world_edge(
    world: &VoxelWorld,
    world_pos: IVec3,
) -> bool {
    world
        .bounds()
        .inside_horizontal_edge_margin(world_pos, WATER_EDGE_SURFACE_SUPPRESSION_MARGIN)
}

pub(super) fn air_open_to_sky_with_stats(
    world: &VoxelWorld,
    air_pos: IVec3,
    stats: &mut WaterMeshingStats,
) -> bool {
    let sample = world.sample_voxel_for_water_meshing(air_pos);
    if !matches!(
        sample,
        VoxelSample::InBounds(VoxelType::Air) | VoxelSample::OutsideAboveWorld
    ) {
        if sample.is_boundary() || sample.is_missing_chunk_inside_bounds() {
            stats.exposure_outside_world_rejected += 1;
        }
        return false;
    }

    let world_top = world.bounds().max_world_y;
    for y in air_pos.y..=world_top {
        let pos = IVec3::new(air_pos.x, y, air_pos.z);
        match world.sample_voxel_for_water_meshing(pos) {
            VoxelSample::InBounds(voxel) if voxel.is_solid() => return false,
            VoxelSample::InBounds(_) => {}
            VoxelSample::OutsideAboveWorld => return true,
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => {
                stats.exposure_outside_world_rejected += 1;
                return false;
            }
        }
    }
    true
}

pub(super) fn air_connected_to_exterior_with_stats(
    world: &VoxelWorld,
    air_pos: IVec3,
    stats: &mut WaterMeshingStats,
) -> bool {
    if air_open_to_sky_with_stats(world, air_pos, stats) {
        return true;
    }

    const MAX_FLOOD_NODES: usize = 16_384;
    const MAX_FLOOD_RADIUS: i32 = 64;

    let bounds = world.bounds();
    let min_bound = IVec3::new(
        (air_pos.x - MAX_FLOOD_RADIUS).max(bounds.horizontal_min.x),
        (air_pos.y - MAX_FLOOD_RADIUS).max(bounds.min_world_y),
        (air_pos.z - MAX_FLOOD_RADIUS).max(bounds.horizontal_min.y),
    );
    let max_bound = IVec3::new(
        (air_pos.x + MAX_FLOOD_RADIUS).min(bounds.horizontal_max.x),
        (air_pos.y + MAX_FLOOD_RADIUS).min(bounds.max_world_y),
        (air_pos.z + MAX_FLOOD_RADIUS).min(bounds.horizontal_max.y),
    );
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    visited.insert(air_pos);
    queue.push_back(air_pos);

    while let Some(pos) = queue.pop_front() {
        if visited.len() > MAX_FLOOD_NODES {
            return false;
        }
        if pos.y >= bounds.max_world_y || air_open_to_sky_with_stats(world, pos, stats) {
            return true;
        }

        for offset in [
            IVec3::X,
            -IVec3::X,
            IVec3::Y,
            -IVec3::Y,
            IVec3::Z,
            -IVec3::Z,
        ] {
            let next = pos + offset;
            if next.cmplt(min_bound).any() || next.cmpgt(max_bound).any() || visited.contains(&next)
            {
                stats.flood_fill_boundary_hits += 1;
                continue;
            }
            match world.sample_voxel_for_water_meshing(next) {
                VoxelSample::InBounds(VoxelType::Air) => {
                    visited.insert(next);
                    queue.push_back(next);
                }
                VoxelSample::OutsideBelowWorld
                | VoxelSample::OutsideHorizontalWorld
                | VoxelSample::MissingChunkInsideBounds => {
                    stats.flood_fill_boundary_hits += 1;
                    stats.exposure_outside_world_rejected += 1;
                }
                VoxelSample::InBounds(_) | VoxelSample::OutsideAboveWorld => {}
            }
        }
    }

    false
}

/// Emit a greedy-merged water quad, drastically reducing triangle count for oceans.
#[inline]
pub(super) fn water_surface_local_y(chunk_origin: IVec3) -> f32 {
    crate::constants::WATER_LEVEL as f32 + crate::constants::WATER_SURFACE_OFFSET
        - chunk_origin.y as f32
}

pub(super) fn add_greedy_water_face(
    mesh_data: &mut MeshData,
    quad: &GreedyQuad,
    face: Face,
    chunk_origin: IVec3,
) {
    // Reconstruct local-space position and size from quad
    let (x, y, z, sx, sy, sz) = match face {
        Face::Top | Face::Bottom => (
            quad.start.0 as f32 * VOXEL_SIZE,
            quad.depth as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
            VOXEL_SIZE, // single voxel depth in normal dir
            quad.size.1 as f32 * VOXEL_SIZE,
        ),
        Face::North | Face::South => (
            quad.start.0 as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.depth as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
            quad.size.1 as f32 * VOXEL_SIZE,
            VOXEL_SIZE,
        ),
        Face::East | Face::West => (
            quad.depth as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.start.0 as f32 * VOXEL_SIZE,
            VOXEL_SIZE,
            quad.size.1 as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
        ),
    };

    let s = VOXEL_SIZE; // single-voxel edge length
    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => {
            let surface_y = water_surface_local_y(chunk_origin);
            let x0 = x - WATER_SHORELINE_EXTENSION;
            let x1 = x + sx + WATER_SHORELINE_EXTENSION;
            let z0 = z - WATER_SHORELINE_EXTENSION;
            let z1 = z + sz + WATER_SHORELINE_EXTENSION;
            (
                [x0, surface_y, z1],
                [x1, surface_y, z1],
                [x1, surface_y, z0],
                [x0, surface_y, z0],
                [0.0, 1.0, 0.0],
            )
        }
        Face::Bottom => (
            [x, y, z],
            [x + sx, y, z],
            [x + sx, y, z + sz],
            [x, y, z + sz],
            [0.0, -1.0, 0.0],
        ),
        Face::North => (
            [x + sx, y, z],
            [x, y, z],
            [x, y + sy, z],
            [x + sx, y + sy, z],
            [0.0, 0.0, -1.0],
        ),
        Face::South => (
            [x, y, z + s],
            [x + sx, y, z + s],
            [x + sx, y + sy, z + s],
            [x, y + sy, z + s],
            [0.0, 0.0, 1.0],
        ),
        Face::East => (
            [x + s, y, z + sz],
            [x + s, y, z],
            [x + s, y + sy, z],
            [x + s, y + sy, z + sz],
            [1.0, 0.0, 0.0],
        ),
        Face::West => (
            [x, y, z],
            [x, y, z + sz],
            [x, y + sy, z + sz],
            [x, y + sy, z],
            [-1.0, 0.0, 0.0],
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

    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);

    // UVs: use local-space coords (water shader uses coord_offset + uv * coord_scale)
    let (uv0, uv1, uv2, uv3) = match face {
        Face::Top => {
            let x0 = x - WATER_SHORELINE_EXTENSION;
            let x1 = x + sx + WATER_SHORELINE_EXTENSION;
            let z0 = z - WATER_SHORELINE_EXTENSION;
            let z1 = z + sz + WATER_SHORELINE_EXTENSION;
            ([x0, z1], [x1, z1], [x1, z0], [x0, z0])
        }
        Face::Bottom => ([x, z + sz], [x + sx, z + sz], [x + sx, z], [x, z]),
        Face::North | Face::South => ([x, y], [x + sx, y], [x + sx, y + sy], [x, y + sy]),
        Face::East | Face::West => ([z, y], [z + sz, y], [z + sz, y + sy], [z, y + sy]),
    };

    mesh_data.uvs.push(uv0);
    mesh_data.uvs.push(uv1);
    mesh_data.uvs.push(uv2);
    mesh_data.uvs.push(uv3);

    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 2);
    mesh_data.indices.push(start_idx + 1);
    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 3);
    mesh_data.indices.push(start_idx + 2);
}

/// Calculate vertex ambient occlusion (0-1 scale, 0 = fully occluded, 1 = not occluded).
/// Returns a minimum of 0.15 to prevent faces from going completely black.
pub(super) fn calculate_vertex_ao(
    side1: bool,
    side2: bool,
    corner: bool,
    ao_config: &BakedAoConfig,
) -> f32 {
    if !ao_config.enabled {
        return 1.0;
    }

    let ao_value = if side1 && side2 {
        0.0
    } else {
        let count = side1 as u8 + side2 as u8 + corner as u8;
        1.0 - (count as f32 * ao_config.corner_darkness / 3.0)
    };

    let result = ao_value * ao_config.strength + (1.0 - ao_config.strength);

    // Ensure minimum AO to prevent faces from going completely black
    result.max(0.15)
}

/// Check if a world position contains a solid block (for AO calculation)
pub(super) fn is_solid_at_offset(
    chunk: &Chunk,
    world: &VoxelWorld,
    local: UVec3,
    offset: IVec3,
) -> bool {
    let local_pos = IVec3::new(local.x as i32, local.y as i32, local.z as i32) + offset;

    // Check within chunk first
    if local_pos.x >= 0
        && local_pos.x < CHUNK_SIZE_I32
        && local_pos.y >= 0
        && local_pos.y < CHUNK_SIZE_I32
        && local_pos.z >= 0
        && local_pos.z < CHUNK_SIZE_I32
    {
        let v = terrain_meshing_voxel_in_chunk(
            chunk,
            world,
            UVec3::new(local_pos.x as u32, local_pos.y as u32, local_pos.z as u32),
        );
        return v.is_solid();
    }

    // Check world
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let world_pos = chunk_origin + local_pos;

    terrain_meshing_voxel_at(world, world_pos).is_solid()
}

/// Get AO values for the 4 vertices of a face
pub(super) fn get_face_ao(
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
                (
                    IVec3::new(-1, 1, 0),
                    IVec3::new(0, 1, 1),
                    IVec3::new(-1, 1, 1),
                ), // v0
                (
                    IVec3::new(1, 1, 0),
                    IVec3::new(0, 1, 1),
                    IVec3::new(1, 1, 1),
                ), // v1
                (
                    IVec3::new(1, 1, 0),
                    IVec3::new(0, 1, -1),
                    IVec3::new(1, 1, -1),
                ), // v2
                (
                    IVec3::new(-1, 1, 0),
                    IVec3::new(0, 1, -1),
                    IVec3::new(-1, 1, -1),
                ), // v3
            ]
        }
        Face::Bottom => [
            (
                IVec3::new(-1, -1, 0),
                IVec3::new(0, -1, -1),
                IVec3::new(-1, -1, -1),
            ),
            (
                IVec3::new(1, -1, 0),
                IVec3::new(0, -1, -1),
                IVec3::new(1, -1, -1),
            ),
            (
                IVec3::new(1, -1, 0),
                IVec3::new(0, -1, 1),
                IVec3::new(1, -1, 1),
            ),
            (
                IVec3::new(-1, -1, 0),
                IVec3::new(0, -1, 1),
                IVec3::new(-1, -1, 1),
            ),
        ],
        Face::North => [
            (
                IVec3::new(1, 0, -1),
                IVec3::new(0, -1, -1),
                IVec3::new(1, -1, -1),
            ),
            (
                IVec3::new(-1, 0, -1),
                IVec3::new(0, -1, -1),
                IVec3::new(-1, -1, -1),
            ),
            (
                IVec3::new(-1, 0, -1),
                IVec3::new(0, 1, -1),
                IVec3::new(-1, 1, -1),
            ),
            (
                IVec3::new(1, 0, -1),
                IVec3::new(0, 1, -1),
                IVec3::new(1, 1, -1),
            ),
        ],
        Face::South => [
            (
                IVec3::new(-1, 0, 1),
                IVec3::new(0, -1, 1),
                IVec3::new(-1, -1, 1),
            ),
            (
                IVec3::new(1, 0, 1),
                IVec3::new(0, -1, 1),
                IVec3::new(1, -1, 1),
            ),
            (
                IVec3::new(1, 0, 1),
                IVec3::new(0, 1, 1),
                IVec3::new(1, 1, 1),
            ),
            (
                IVec3::new(-1, 0, 1),
                IVec3::new(0, 1, 1),
                IVec3::new(-1, 1, 1),
            ),
        ],
        Face::East => [
            (
                IVec3::new(1, 0, 1),
                IVec3::new(1, -1, 0),
                IVec3::new(1, -1, 1),
            ),
            (
                IVec3::new(1, 0, -1),
                IVec3::new(1, -1, 0),
                IVec3::new(1, -1, -1),
            ),
            (
                IVec3::new(1, 0, -1),
                IVec3::new(1, 1, 0),
                IVec3::new(1, 1, -1),
            ),
            (
                IVec3::new(1, 0, 1),
                IVec3::new(1, 1, 0),
                IVec3::new(1, 1, 1),
            ),
        ],
        Face::West => [
            (
                IVec3::new(-1, 0, -1),
                IVec3::new(-1, -1, 0),
                IVec3::new(-1, -1, -1),
            ),
            (
                IVec3::new(-1, 0, 1),
                IVec3::new(-1, -1, 0),
                IVec3::new(-1, -1, 1),
            ),
            (
                IVec3::new(-1, 0, 1),
                IVec3::new(-1, 1, 0),
                IVec3::new(-1, 1, 1),
            ),
            (
                IVec3::new(-1, 0, -1),
                IVec3::new(-1, 1, 0),
                IVec3::new(-1, 1, -1),
            ),
        ],
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

/// Map voxel/face to blocky texture array layer.
/// Texture array layout (3 layers per material):
///   Grass: 0=Top, 1=Side, 2=Bottom
///   Dirt:  3=Top, 4=Side, 5=Bottom
///   Rock:  6=Top, 7=Side, 8=Bottom
///   Sand:  9=Top, 10=Side, 11=Bottom
pub fn get_blocky_material_index(voxel: VoxelType, face: Face) -> u8 {
    get_blocky_material_index_for_material(MaterialId::from_voxel(voxel), voxel, face)
}

pub(super) fn get_blocky_material_index_for_material(
    material_id: MaterialId,
    fallback_voxel: VoxelType,
    face: Face,
) -> u8 {
    let material_voxel = material_voxel_for_rendering(material_id).unwrap_or(fallback_voxel);
    let base_index = match material_voxel {
        VoxelType::TopSoil | VoxelType::Leaves => 0, // Grass
        VoxelType::SubSoil | VoxelType::Clay | VoxelType::Wood => 3, // Dirt
        VoxelType::Rock | VoxelType::Bedrock | VoxelType::DungeonWall | VoxelType::DungeonFloor => {
            6
        } // Rock
        VoxelType::Sand => 9,                        // Sand
        _ => 0,                                      // Default to grass
    };

    let face_offset = match face {
        Face::Top => 0,
        Face::Bottom => 2,
        _ => 1, // Sides (North, South, East, West)
    };

    base_index + face_offset
}

pub(super) fn material_voxel_for_rendering(material_id: MaterialId) -> Option<VoxelType> {
    match material_id.0 {
        0 => Some(VoxelType::Air),
        1 => Some(VoxelType::TopSoil),
        2 => Some(VoxelType::SubSoil),
        3 => Some(VoxelType::Rock),
        4 => Some(VoxelType::Bedrock),
        5 => Some(VoxelType::Sand),
        6 => Some(VoxelType::Clay),
        7 => Some(VoxelType::Water),
        8 => Some(VoxelType::Wood),
        9 => Some(VoxelType::Leaves),
        10 => Some(VoxelType::DungeonWall),
        11 => Some(VoxelType::DungeonFloor),
        _ => None,
    }
}

pub(super) fn material_weight_index(material_id: MaterialId, fallback_voxel: VoxelType) -> usize {
    match material_voxel_for_rendering(material_id).unwrap_or(fallback_voxel) {
        VoxelType::TopSoil | VoxelType::Leaves => 0,
        VoxelType::Rock | VoxelType::Bedrock | VoxelType::DungeonWall | VoxelType::DungeonFloor => {
            1
        }
        VoxelType::Sand => 2,
        _ => 3,
    }
}

/// Greedy-merged water quad with world-space UVs (for surface nets water path).
pub(super) fn add_greedy_water_face_world(
    mesh_data: &mut MeshData,
    quad: &GreedyQuad,
    face: Face,
    chunk_origin: IVec3,
    world: &VoxelWorld,
) {
    let (x, y, z, sx, sy, sz) = match face {
        Face::Top | Face::Bottom => (
            quad.start.0 as f32 * VOXEL_SIZE,
            quad.depth as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
            VOXEL_SIZE,
            quad.size.1 as f32 * VOXEL_SIZE,
        ),
        Face::North | Face::South => (
            quad.start.0 as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.depth as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
            quad.size.1 as f32 * VOXEL_SIZE,
            VOXEL_SIZE,
        ),
        Face::East | Face::West => (
            quad.depth as f32 * VOXEL_SIZE,
            quad.start.1 as f32 * VOXEL_SIZE,
            quad.start.0 as f32 * VOXEL_SIZE,
            VOXEL_SIZE,
            quad.size.1 as f32 * VOXEL_SIZE,
            quad.size.0 as f32 * VOXEL_SIZE,
        ),
    };

    let s = VOXEL_SIZE;
    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => {
            let surface_y = water_surface_local_y(chunk_origin);
            let x0 = x - WATER_SHORELINE_EXTENSION;
            let x1 = x + sx + WATER_SHORELINE_EXTENSION;
            let z0 = z - WATER_SHORELINE_EXTENSION;
            let z1 = z + sz + WATER_SHORELINE_EXTENSION;
            (
                [x0, surface_y, z1],
                [x1, surface_y, z1],
                [x1, surface_y, z0],
                [x0, surface_y, z0],
                [0.0, 1.0, 0.0],
            )
        }
        Face::Bottom => (
            [x, y, z],
            [x + sx, y, z],
            [x + sx, y, z + sz],
            [x, y, z + sz],
            [0.0, -1.0, 0.0],
        ),
        Face::North => (
            [x + sx, y, z],
            [x, y, z],
            [x, y + sy, z],
            [x + sx, y + sy, z],
            [0.0, 0.0, -1.0],
        ),
        Face::South => (
            [x, y, z + s],
            [x + sx, y, z + s],
            [x + sx, y + sy, z + s],
            [x, y + sy, z + s],
            [0.0, 0.0, 1.0],
        ),
        Face::East => (
            [x + s, y, z + sz],
            [x + s, y, z],
            [x + s, y + sy, z],
            [x + s, y + sy, z + sz],
            [1.0, 0.0, 0.0],
        ),
        Face::West => (
            [x, y, z],
            [x, y, z + sz],
            [x, y + sy, z + sz],
            [x, y + sy, z],
            [-1.0, 0.0, 0.0],
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

    let color = if std::env::var_os("VOXEL_WATER_DEPTH_DEBUG_COLORS").is_some() {
        let surface_y = water_surface_local_y(chunk_origin).floor() as i32;
        water_depth_debug_color(
            world,
            chunk_origin + IVec3::new(x as i32, surface_y, z as i32),
        )
    } else {
        [1.0, 1.0, 1.0, 1.0]
    };
    mesh_data.colors.push(color);
    mesh_data.colors.push(color);
    mesh_data.colors.push(color);
    mesh_data.colors.push(color);

    let world_x = chunk_origin.x as f32 + x;
    let world_z = chunk_origin.z as f32 + z;

    let (uv0, uv1, uv2, uv3) = match face {
        Face::Top => {
            let x0 = world_x - WATER_SHORELINE_EXTENSION;
            let x1 = world_x + sx + WATER_SHORELINE_EXTENSION;
            let z0 = world_z - WATER_SHORELINE_EXTENSION;
            let z1 = world_z + sz + WATER_SHORELINE_EXTENSION;
            ([x0, z1], [x1, z1], [x1, z0], [x0, z0])
        }
        Face::Bottom => (
            [world_x, world_z + sz],
            [world_x + sx, world_z + sz],
            [world_x + sx, world_z],
            [world_x, world_z],
        ),
        Face::North | Face::South => (
            [world_x, y],
            [world_x + sx, y],
            [world_x + sx, y + sy],
            [world_x, y + sy],
        ),
        Face::East | Face::West => (
            [world_z, y],
            [world_z + sz, y],
            [world_z + sz, y + sy],
            [world_z, y + sy],
        ),
    };

    mesh_data.uvs.push(uv0);
    mesh_data.uvs.push(uv1);
    mesh_data.uvs.push(uv2);
    mesh_data.uvs.push(uv3);

    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 2);
    mesh_data.indices.push(start_idx + 1);
    mesh_data.indices.push(start_idx);
    mesh_data.indices.push(start_idx + 3);
    mesh_data.indices.push(start_idx + 2);
}

pub(super) fn water_depth_debug_color(world: &VoxelWorld, surface_pos: IVec3) -> [f32; 4] {
    let mut depth = 0usize;
    loop {
        let sample_pos = surface_pos - IVec3::Y * depth as i32;
        match world.sample_voxel_for_water_meshing(sample_pos) {
            VoxelSample::InBounds(voxel) if voxel.is_liquid() => depth += 1,
            _ => break,
        }
    }

    if depth <= 2 {
        [0.0, 0.95, 1.0, 1.0]
    } else if depth <= 5 {
        [0.0, 0.22, 1.0, 1.0]
    } else {
        [0.0, 0.02, 0.25, 1.0]
    }
}
