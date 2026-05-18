//! Mesh generation for voxel chunks.
//!
//! This module provides two meshing modes:
//! - **Blocky**: Greedy meshing that combines adjacent faces of the same material
//! - **Surface Nets**: Smooth terrain meshing using the Surface Nets algorithm
//!
//! Both modes support ambient occlusion and proper chunk boundary handling.

use crate::constants::{
    ATLAS_COLUMNS,
    ATLAS_ROWS,
    CHUNK_BOUNDARY_SCALE,
    CHUNK_SIZE,
    CHUNK_SIZE_I32,
    LOD0_GRID_VOLUME,
    // LOD grid configurations
    LOD0_PADDED_SIZE,
    LOD0_STEP_SIZE,
    LOD1_GRID_VOLUME,
    LOD1_PADDED_SIZE,
    LOD1_STEP_SIZE,
    LOD2_GRID_VOLUME,
    LOD2_PADDED_SIZE,
    LOD2_STEP_SIZE,
    LOD3_GRID_VOLUME,
    LOD3_PADDED_SIZE,
    LOD3_STEP_SIZE,
    PADDED_CHUNK_SIZE_U32,
    UV_PADDING,
    VOXEL_SIZE,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::{
    ChunkFace, NeighborLods, SkirtConfig, compute_boundary_flags, extract_boundary_edges,
    generate_skirts,
};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::query::QueryItem;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponent;
use bevy_mesh::{Indices, PrimitiveTopology};
use std::collections::{HashMap, HashSet, VecDeque};

// Surface nets imports for smooth meshing
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
use ndshape::{ConstShape, ConstShape3u32};

const WATER_SHORELINE_EXTENSION: f32 = VOXEL_SIZE * 0.18;
const WATER_EDGE_SURFACE_SUPPRESSION_MARGIN: i32 = 2;

#[derive(Component, Clone, Copy, Debug)]
pub struct ChunkMesh {
    pub chunk_position: IVec3,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub mesh_mode: MeshMode,
    pub material_quality: TerrainMaterialQuality,
}

#[derive(Component, Clone, Copy, Debug)]
pub struct TerrainMeshDebug {
    pub logical_lod_at_mesh: LodLevel,
    pub effective_lod_at_mesh: LodLevel,
    pub target_mode_at_mesh: MeshMode,
    pub neighbor_lods_at_mesh: NeighborLods,
    pub missing_boundary_neighbors_at_mesh: u32,
    pub empty_surface_cap_at_mesh: bool,
    pub generated_frame: u32,
    pub lod_transition_snap_stats: LodTransitionSnapStats,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LodTransitionSnapStats {
    pub snapped_face_mask: u8,
    pub fallback_face_mask: u8,
    pub snapped_vertex_count: u32,
}

impl LodTransitionSnapStats {
    #[inline]
    fn face_mask(face: ChunkFace) -> u8 {
        1 << face as u8
    }

    #[inline]
    fn mark_snapped(&mut self, face: ChunkFace, vertex_count: usize) {
        self.snapped_face_mask |= Self::face_mask(face);
        self.snapped_vertex_count = self
            .snapped_vertex_count
            .saturating_add(vertex_count as u32);
    }

    #[inline]
    fn mark_fallback(&mut self, face: ChunkFace) {
        self.fallback_face_mask |= Self::face_mask(face);
    }

    #[inline]
    pub fn face_snapped(self, face: ChunkFace) -> bool {
        self.snapped_face_mask & Self::face_mask(face) != 0
    }
}

impl ExtractComponent for ChunkMesh {
    type QueryData = &'static ChunkMesh;
    type QueryFilter = ();
    type Out = ChunkMesh;

    fn extract_component(item: QueryItem<'_, '_, Self::QueryData>) -> Option<Self::Out> {
        Some(*item)
    }
}

#[derive(Component, Clone, Copy, Debug)]
pub struct WaterMesh;

impl ExtractComponent for WaterMesh {
    type QueryData = &'static WaterMesh;
    type QueryFilter = ();
    type Out = WaterMesh;

    fn extract_component(item: QueryItem<'_, '_, Self::QueryData>) -> Option<Self::Out> {
        Some(*item)
    }
}

#[derive(Component, Copy, Clone, Debug)]
pub struct WaterMeshDetail {
    pub triangle_count: usize,
    pub max_depth: usize,
    pub average_depth: f32,
    pub surface_area: f32,
}

impl ExtractComponent for WaterMeshDetail {
    type QueryData = &'static WaterMeshDetail;
    type QueryFilter = ();
    type Out = WaterMeshDetail;

    fn extract_component(item: QueryItem<'_, '_, Self::QueryData>) -> Option<Self::Out> {
        Some(*item)
    }
}

#[derive(Component, Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct WaterBodyId(pub u32);

#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum WaterBodyKind {
    Ocean,
    Lake,
    River,
    Pond,
    ShallowFlood,
    #[default]
    Unknown,
}

impl WaterBodyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ocean => "Ocean",
            Self::Lake => "Lake",
            Self::River => "River",
            Self::Pond => "Pond",
            Self::ShallowFlood => "ShallowFlood",
            Self::Unknown => "Unknown",
        }
    }
}

#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum WaterBodyMaterialMode {
    Fancy,
    Cheap,
    Hidden,
    #[default]
    Unknown,
}

impl WaterBodyMaterialMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Fancy => "Fancy",
            Self::Cheap => "Cheap",
            Self::Hidden => "Hidden",
            Self::Unknown => "Unknown",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WaterAirExposureMode {
    /// Debug mode: any water/air boundary can render, matching the old behavior.
    AllAir,
    /// Production fast path: air must have an open vertical column to sky.
    OpenToSky,
    /// Production conservative path: open-to-sky or connected to exterior air by flood fill.
    #[default]
    ExteriorConnected,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WaterMeshingStats {
    pub air_boundaries_total: u32,
    pub air_boundaries_exposed: u32,
    pub air_boundaries_sealed: u32,
    pub triangles_removed_sealed: u32,
    pub invalid_meshes_suppressed: u32,
    pub edge_water_faces_suppressed: u32,
    pub flood_fill_boundary_hits: u32,
    pub exposure_outside_world_rejected: u32,
}

#[derive(Default)]
struct WaterExposureCache {
    mode: WaterAirExposureMode,
    cache: HashMap<IVec3, bool>,
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
    pub barycentric_uvs: Vec<[f32; 2]>,
    pub colors: Vec<[f32; 4]>, // Vertex colors for AO (blocky) or material weights (surface nets)
    pub indices: Vec<u32>,
}

impl MeshData {
    pub fn new() -> Self {
        Self {
            positions: Vec::new(),
            normals: Vec::new(),
            uvs: Vec::new(),
            barycentric_uvs: Vec::new(),
            colors: Vec::new(),
            indices: Vec::new(),
        }
    }

    /// Pre-allocate with expected capacities to avoid repeated reallocations.
    pub fn with_capacity(vertex_cap: usize, index_cap: usize) -> Self {
        Self {
            positions: Vec::with_capacity(vertex_cap),
            normals: Vec::with_capacity(vertex_cap),
            uvs: Vec::with_capacity(vertex_cap),
            barycentric_uvs: Vec::with_capacity(vertex_cap),
            colors: Vec::with_capacity(vertex_cap),
            indices: Vec::with_capacity(index_cap),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    pub fn into_mesh(self) -> Mesh {
        let vertex_count = self.positions.len();
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, self.positions);
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, self.normals);
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, self.uvs);
        let uv1 = if self.barycentric_uvs.len() == vertex_count {
            self.barycentric_uvs
        } else {
            vec![[0.0, 0.0]; vertex_count]
        };
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_1, uv1);
        mesh.insert_attribute(Mesh::ATTRIBUTE_COLOR, self.colors);
        mesh.insert_indices(Indices::U32(self.indices));
        mesh
    }

    fn push_triangle_barycentrics(&mut self) {
        self.barycentric_uvs
            .extend_from_slice(&[[1.0, 0.0], [0.0, 1.0], [0.0, 0.0]]);
    }
}

impl WaterExposureCache {
    fn new(mode: WaterAirExposureMode) -> Self {
        Self {
            mode,
            cache: HashMap::new(),
        }
    }

    fn air_exposed(
        &mut self,
        world: &VoxelWorld,
        air_pos: IVec3,
        stats: &mut WaterMeshingStats,
    ) -> bool {
        match world.sample_voxel_for_water_meshing(air_pos) {
            VoxelSample::InBounds(VoxelType::Air) | VoxelSample::OutsideAboveWorld => {}
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => {
                stats.exposure_outside_world_rejected += 1;
                return false;
            }
            VoxelSample::InBounds(_) => return false,
        }
        if self.mode == WaterAirExposureMode::AllAir {
            return true;
        }
        if let Some(exposed) = self.cache.get(&air_pos) {
            return *exposed;
        }

        let exposed = match self.mode {
            WaterAirExposureMode::AllAir => true,
            WaterAirExposureMode::OpenToSky => air_open_to_sky_with_stats(world, air_pos, stats),
            WaterAirExposureMode::ExteriorConnected => {
                air_connected_to_exterior_with_stats(world, air_pos, stats)
            }
        };
        self.cache.insert(air_pos, exposed);
        exposed
    }
}

/// Result of chunk meshing containing separate meshes for solid and water blocks
pub struct ChunkMeshResult {
    pub solid: MeshData,
    pub water: MeshData,
    pub water_stats: WaterMeshingStats,
    pub lod_transition_snap_stats: LodTransitionSnapStats,
}

// =============================================================================
// Greedy Meshing Types and Implementation
// =============================================================================

/// Information about a face for greedy meshing.
/// Faces can only be merged if all fields match.
#[derive(Clone, Copy, PartialEq, Eq, Default)]
struct FaceInfo {
    /// The voxel type (for material/texture selection)
    voxel: VoxelType,
    /// Whether this face slot is visible and should be meshed
    visible: bool,
}

/// A merged rectangle from greedy meshing
struct GreedyQuad {
    /// Starting position in the 2D slice (u, v coordinates)
    start: (u32, u32),
    /// Size of the quad (width, height in the slice)
    size: (u32, u32),
    /// The voxel type for this quad
    voxel: VoxelType,
    /// The depth (position along the face normal direction)
    depth: u32,
}

/// Build a 2D mask of visible faces for a given slice.
/// Returns a CHUNK_SIZE x CHUNK_SIZE array of FaceInfo.
fn build_face_mask(
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
                mask[u][v] = FaceInfo {
                    voxel,
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
fn greedy_mesh_slice(
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
                if next.visible && next.voxel == info.voxel {
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
                    if !next.visible || next.voxel != info.voxel {
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
                depth,
            });
        }
    }
}

/// Add a greedy quad to the mesh data with proper AO calculation.
fn add_greedy_quad(
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

    let material_index = get_blocky_material_index(quad.voxel, face) as f32 / 255.0;
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
fn get_greedy_quad_ao(
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
    // The vertex order for each face (matching add_face_with_ao):
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

pub fn generate_chunk_mesh(
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
    }
}

/// Legacy per-voxel face check (replaced by greedy meshing).
#[allow(dead_code)]
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

#[allow(dead_code)]
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
    pos.x >= 0
        && pos.x < CHUNK_SIZE_I32
        && pos.y >= 0
        && pos.y < CHUNK_SIZE_I32
        && pos.z >= 0
        && pos.z < CHUNK_SIZE_I32
}

#[inline]
fn terrain_meshing_voxel_at(world: &VoxelWorld, world_pos: IVec3) -> VoxelType {
    world
        .sample_voxel_for_terrain_meshing(world_pos)
        .terrain_meshing_voxel()
}

#[inline]
fn water_meshing_voxel_at(world: &VoxelWorld, world_pos: IVec3) -> VoxelType {
    world
        .sample_voxel_for_water_meshing(world_pos)
        .water_meshing_voxel()
}

#[inline]
fn terrain_meshing_voxel_in_chunk(chunk: &Chunk, world: &VoxelWorld, local: UVec3) -> VoxelType {
    let world_pos = VoxelWorld::chunk_to_world(chunk.position()) + local.as_ivec3();
    terrain_meshing_voxel_at(world, world_pos)
}

#[inline]
fn water_meshing_voxel_in_chunk(chunk: &Chunk, world: &VoxelWorld, local: UVec3) -> VoxelType {
    let world_pos = VoxelWorld::chunk_to_world(chunk.position()) + local.as_ivec3();
    water_meshing_voxel_at(world, world_pos)
}

/// Gets the neighboring voxel for a face, checking chunk first then world.
fn get_neighbor_voxel(chunk: &Chunk, world: &VoxelWorld, local: UVec3, face: Face) -> VoxelType {
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
fn is_face_visible_with<F>(
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
fn is_face_visible(chunk: &Chunk, world: &VoxelWorld, local: UVec3, face: Face) -> bool {
    is_face_visible_with(chunk, world, local, face, |neighbor| {
        neighbor.is_transparent()
    })
}

/// Water face is visible only when neighbor is air.
#[allow(dead_code)]
fn is_water_face_visible(chunk: &Chunk, world: &VoxelWorld, local: UVec3, face: Face) -> bool {
    is_face_visible_with(chunk, world, local, face, |neighbor| {
        neighbor == VoxelType::Air
    })
}

fn water_face_neighbor_air_pos(
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

fn face_direction(face: Face) -> IVec3 {
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
fn build_water_face_mask(
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
                    visible: true,
                };
            }
        }
    }

    mask
}

fn should_render_water_face(
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

fn water_surface_near_horizontal_world_edge(world: &VoxelWorld, world_pos: IVec3) -> bool {
    world
        .bounds()
        .inside_horizontal_edge_margin(world_pos, WATER_EDGE_SURFACE_SUPPRESSION_MARGIN)
}

fn air_open_to_sky_with_stats(
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

fn air_connected_to_exterior_with_stats(
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

/// Emit a greedy-merged water quad. Produces the same geometry as `add_water_face`
/// but covers `quad.size` voxels, drastically reducing triangle count for oceans.
#[inline]
fn water_surface_local_y(chunk_origin: IVec3) -> f32 {
    crate::constants::WATER_LEVEL as f32 + crate::constants::WATER_SURFACE_OFFSET
        - chunk_origin.y as f32
}

fn add_greedy_water_face(
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

    let result = ao_value * ao_config.strength + (1.0 - ao_config.strength);

    // Ensure minimum AO to prevent faces from going completely black
    result.max(0.15)
}

/// Check if a world position contains a solid block (for AO calculation)
fn is_solid_at_offset(chunk: &Chunk, world: &VoxelWorld, local: UVec3, offset: IVec3) -> bool {
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

/// Get the atlas index for a voxel face (supports face-specific textures).
/// Legacy: kept for reference, replaced by material index approach in greedy meshing.
#[allow(dead_code)]
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

/// Map voxel/face to blocky texture array layer.
/// Texture array layout (3 layers per material):
///   Grass: 0=Top, 1=Side, 2=Bottom
///   Dirt:  3=Top, 4=Side, 5=Bottom
///   Rock:  6=Top, 7=Side, 8=Bottom
///   Sand:  9=Top, 10=Side, 11=Bottom
pub fn get_blocky_material_index(voxel: VoxelType, face: Face) -> u8 {
    let base_index = match voxel {
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

/// Legacy per-voxel face generation with AO (replaced by add_greedy_quad).
#[allow(dead_code)]
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
            [x, y + s, z + s],
            [x + s, y + s, z + s],
            [x + s, y + s, z],
            [x, y + s, z],
            [0.0, 1.0, 0.0],
        ),
        Face::Bottom => (
            [x, y, z],
            [x + s, y, z],
            [x + s, y, z + s],
            [x, y, z + s],
            [0.0, -1.0, 0.0],
        ),
        Face::North => (
            [x + s, y, z],
            [x, y, z],
            [x, y + s, z],
            [x + s, y + s, z],
            [0.0, 0.0, -1.0],
        ),
        Face::South => (
            [x, y, z + s],
            [x + s, y, z + s],
            [x + s, y + s, z + s],
            [x, y + s, z + s],
            [0.0, 0.0, 1.0],
        ),
        Face::East => (
            [x + s, y, z + s],
            [x + s, y, z],
            [x + s, y + s, z],
            [x + s, y + s, z + s],
            [1.0, 0.0, 0.0],
        ),
        Face::West => (
            [x, y, z],
            [x, y, z + s],
            [x, y + s, z + s],
            [x, y + s, z],
            [-1.0, 0.0, 0.0],
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

    // For Texture Arrays, we use full 0..1 UVs as each layer is a complete texture

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

fn add_face_no_ao(mesh_data: &mut MeshData, local: UVec3, face: Face, voxel: VoxelType) {
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
            [x + inset, y + s - inset, z + s - inset],
            [x + s - inset, y + s - inset, z + s - inset],
            [x + s - inset, y + s - inset, z + inset],
            [x + inset, y + s - inset, z + inset],
            [0.0, 1.0, 0.0],
        ),
        Face::Bottom => (
            [x + inset, y + inset, z + inset],
            [x + s - inset, y + inset, z + inset],
            [x + s - inset, y + inset, z + s - inset],
            [x + inset, y + inset, z + s - inset],
            [0.0, -1.0, 0.0],
        ),
        Face::North => (
            [x + s - inset, y + inset, z + inset],
            [x + inset, y + inset, z + inset],
            [x + inset, y + s - inset, z + inset],
            [x + s - inset, y + s - inset, z + inset],
            [0.0, 0.0, -1.0],
        ),
        Face::South => (
            [x + inset, y + inset, z + s - inset],
            [x + s - inset, y + inset, z + s - inset],
            [x + s - inset, y + s - inset, z + s - inset],
            [x + inset, y + s - inset, z + s - inset],
            [0.0, 0.0, 1.0],
        ),
        Face::East => (
            [x + s - inset, y + inset, z + s - inset],
            [x + s - inset, y + inset, z + inset],
            [x + s - inset, y + s - inset, z + inset],
            [x + s - inset, y + s - inset, z + s - inset],
            [1.0, 0.0, 0.0],
        ),
        Face::West => (
            [x + inset, y + inset, z + inset],
            [x + inset, y + inset, z + s - inset],
            [x + inset, y + s - inset, z + s - inset],
            [x + inset, y + s - inset, z + inset],
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

/// Add a water face with world-space UVs for proper wave calculation.
/// Unlike solid terrain which uses atlas UVs, water needs world XZ coordinates
/// so the wave shader can compute spatially-varying wave heights.
#[allow(dead_code)]
fn add_water_face(mesh_data: &mut MeshData, local: UVec3, face: Face, chunk_origin: IVec3) {
    let x = local.x as f32 * VOXEL_SIZE;
    let y = local.y as f32 * VOXEL_SIZE;
    let z = local.z as f32 * VOXEL_SIZE;
    let s = VOXEL_SIZE;

    let (v0, v1, v2, v3, normal) = match face {
        Face::Top => (
            [x, y + s, z + s],
            [x + s, y + s, z + s],
            [x + s, y + s, z],
            [x, y + s, z],
            [0.0, 1.0, 0.0],
        ),
        Face::Bottom => (
            [x, y, z],
            [x + s, y, z],
            [x + s, y, z + s],
            [x, y, z + s],
            [0.0, -1.0, 0.0],
        ),
        Face::North => (
            [x + s, y, z],
            [x, y, z],
            [x, y + s, z],
            [x + s, y + s, z],
            [0.0, 0.0, -1.0],
        ),
        Face::South => (
            [x, y, z + s],
            [x + s, y, z + s],
            [x + s, y + s, z + s],
            [x, y + s, z + s],
            [0.0, 0.0, 1.0],
        ),
        Face::East => (
            [x + s, y, z + s],
            [x + s, y, z],
            [x + s, y + s, z],
            [x + s, y + s, z + s],
            [1.0, 0.0, 0.0],
        ),
        Face::West => (
            [x, y, z],
            [x, y, z + s],
            [x, y + s, z + s],
            [x, y + s, z],
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

    // Full brightness for water (no AO needed)
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);
    mesh_data.colors.push([1.0, 1.0, 1.0, 1.0]);

    // Use world-space XZ coordinates for UVs so wave shader gets proper spatial variation.
    // The wave function uses: coord_offset + (uv * coord_scale) to get wave position.
    // With world coords as UVs and coord_scale ~6.5, we get good wave frequency.
    let world_x = chunk_origin.x as f32 + x;
    let world_z = chunk_origin.z as f32 + z;

    // Generate UVs based on face orientation (use world XZ for horizontal faces)
    let (uv0, uv1, uv2, uv3) = match face {
        Face::Top | Face::Bottom => (
            [world_x, world_z + s],
            [world_x + s, world_z + s],
            [world_x + s, world_z],
            [world_x, world_z],
        ),
        Face::North | Face::South => (
            [world_x, y],
            [world_x + s, y],
            [world_x + s, y + s],
            [world_x, y + s],
        ),
        Face::East | Face::West => (
            [world_z, y],
            [world_z + s, y],
            [world_z + s, y + s],
            [world_z, y + s],
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

/// Greedy-merged water quad with world-space UVs (for surface nets water path).
/// Like `add_water_face` but covers `quad.size` voxels.
fn add_greedy_water_face_world(
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

fn water_depth_debug_color(world: &VoxelWorld, surface_pos: IVec3) -> [f32; 4] {
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

// =============================================================================
// Surface Nets Smooth Meshing
// =============================================================================

/// Padded chunk shape for surface nets.
/// Surface Nets needs +1 padding on each side to sample neighboring voxels,
/// resulting in an 18x18x18 sample grid for a 16x16x16 chunk.
type PaddedChunkShape =
    ConstShape3u32<PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32, PADDED_CHUNK_SIZE_U32>;

// =============================================================================
// LOD Shape Types - Compile-time grid shapes for different detail levels
// =============================================================================

// Note: LOD 0 (High Detail) uses PaddedChunkShape defined above (18x18x18 grid, step size 1)

/// LOD 1 (Low Detail): 10x10x10 grid, step size 2
/// Samples every 2nd voxel, reducing vertex count by ~75%
type LodShape1 = ConstShape3u32<{ LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }, { LOD1_PADDED_SIZE }>;

/// Samples every 4th voxel, reducing vertex count by ~94%
type LodShape2 = ConstShape3u32<{ LOD2_PADDED_SIZE }, { LOD2_PADDED_SIZE }, { LOD2_PADDED_SIZE }>;

/// Samples every 8th voxel, reducing vertex count by ~98%
type LodShape3 = ConstShape3u32<{ LOD3_PADDED_SIZE }, { LOD3_PADDED_SIZE }, { LOD3_PADDED_SIZE }>;

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
    pub const LOD1: Self = Self {
        step_size: LOD1_STEP_SIZE,
        padded_size: LOD1_PADDED_SIZE,
        grid_volume: LOD1_GRID_VOLUME,
    };

    /// Very low detail configuration: quarter resolution (step 4, 6x6x6)
    pub const LOD2: Self = Self {
        step_size: LOD2_STEP_SIZE,
        padded_size: LOD2_PADDED_SIZE,
        grid_volume: LOD2_GRID_VOLUME,
    };

    /// Extreme low detail configuration: eighth resolution (step 8, 4x4x4)
    pub const LOD3: Self = Self {
        step_size: LOD3_STEP_SIZE,
        padded_size: LOD3_PADDED_SIZE,
        grid_volume: LOD3_GRID_VOLUME,
    };

    /// Get the appropriate config for a given LOD level
    pub fn from_lod_level(level: LodLevel) -> Self {
        match level {
            LodLevel::Lod0 => Self::HIGH,
            LodLevel::Lod1 => Self::LOD1,
            LodLevel::Lod2 => Self::LOD2,
            LodLevel::Lod3 => Self::LOD3,
            LodLevel::Culled => Self::LOD3, // Fallback
        }
    }
}

/// Sample voxel from world or chunk, returns true if solid OR water
/// Water is treated as solid for SDF purposes to prevent surface nets from generating
/// surfaces at solid-water boundaries (which would create visible seams with the blocky water mesh)
fn sample_voxel_solid(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
) -> bool {
    let world_pos = chunk_origin + IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);

    let voxel = if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        terrain_meshing_voxel_in_chunk(chunk, world, UVec3::new(px - 1, py - 1, pz - 1))
    } else {
        terrain_meshing_voxel_at(world, world_pos)
    };

    // Treat water as solid for SDF so we don't generate surfaces at solid-water boundaries
    voxel.is_solid() || voxel.is_liquid()
}

/// Surface Nets can assign a vertical chunk-boundary cap to the all-air chunk
/// above or below terrain. Those chunks still need mesh/collider generation even
/// though their own voxel payload is empty.
pub(crate) fn empty_chunk_has_surface_nets_boundary_surface(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> bool {
    let origin = VoxelWorld::chunk_to_world(chunk_pos);

    let below_y = origin.y - 1;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(world, IVec3::new(origin.x + x, below_y, origin.z + z))
                .is_solid()
            {
                return true;
            }
        }
    }

    let above_y = origin.y + CHUNK_SIZE_I32;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if terrain_meshing_voxel_at(world, IVec3::new(origin.x + x, above_y, origin.z + z))
                .is_solid()
            {
                return true;
            }
        }
    }

    false
}

pub(crate) fn count_missing_in_bounds_boundary_neighbors(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> u32 {
    let mut missing = 0;
    let origin = VoxelWorld::chunk_to_world(chunk_pos);
    for z in -1..=CHUNK_SIZE_I32 {
        for y in -1..=CHUNK_SIZE_I32 {
            for x in -1..=CHUNK_SIZE_I32 {
                let on_halo = x == -1
                    || x == CHUNK_SIZE_I32
                    || y == -1
                    || y == CHUNK_SIZE_I32
                    || z == -1
                    || z == CHUNK_SIZE_I32;
                if !on_halo {
                    continue;
                }
                let pos = origin + IVec3::new(x, y, z);
                if world
                    .sample_voxel_for_terrain_meshing(pos)
                    .is_missing_chunk_inside_bounds()
                {
                    missing += 1;
                }
            }
        }
    }
    missing
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

fn neighbor_lod_for_face(neighbor_lods: &NeighborLods, face: ChunkFace) -> Option<LodLevel> {
    match face {
        ChunkFace::NegX => neighbor_lods.neg_x,
        ChunkFace::PosX => neighbor_lods.pos_x,
        ChunkFace::NegY => neighbor_lods.neg_y,
        ChunkFace::PosY => neighbor_lods.pos_y,
        ChunkFace::NegZ => neighbor_lods.neg_z,
        ChunkFace::PosZ => neighbor_lods.pos_z,
    }
}

fn lower_detail_transition_step_for_padded_size(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    px: u32,
    _py: u32,
    pz: u32,
    padded_size: u32,
) -> Option<i32> {
    let mut transition_step = my_lod.step_size();

    // Coarsen the two outermost padded planes on each X/Z face, not just the
    // single outermost one. The Surface-Nets cell that welds this chunk to a
    // lower-detail neighbour straddles the shared boundary and uses *both*
    // outer planes as its corners. Coarsening only the outermost plane leaves
    // that cell's inner corner at fine resolution, so its boundary vertex sits
    // at the fine (true) surface height while the neighbour's coarse vertex
    // sits ~one step lower — and a see-through seam opens between them.
    for (face, on_boundary_band) in [
        (ChunkFace::NegX, px <= 1),
        (ChunkFace::PosX, px >= padded_size - 2),
        (ChunkFace::NegZ, pz <= 1),
        (ChunkFace::PosZ, pz >= padded_size - 2),
    ] {
        if !on_boundary_band {
            continue;
        }

        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        if neighbor_lod.is_lower_detail_than(my_lod) {
            transition_step = transition_step.max(neighbor_lod.step_size());
        }
    }

    (transition_step > my_lod.step_size()).then_some(transition_step as i32)
}

fn lower_detail_transition_step(
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    px: u32,
    py: u32,
    pz: u32,
) -> Option<i32> {
    lower_detail_transition_step_for_padded_size(
        my_lod,
        neighbor_lods,
        px,
        py,
        pz,
        LOD0_PADDED_SIZE,
    )
}

fn generate_low_lod_sdf<const N: usize>(
    chunk: &Chunk,
    world: &VoxelWorld,
    padded_size: u32,
    step: i32,
    linearize: impl Fn([u32; 3]) -> u32,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> [f32; N] {
    let mut sdf = [1.0f32; N];
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    for z in 0..padded_size {
        for y in 0..padded_size {
            for x in 0..padded_size {
                let idx = linearize([x, y, z]) as usize;
                let effective_step = lower_detail_transition_step_for_padded_size(
                    my_lod,
                    neighbor_lods,
                    x,
                    y,
                    z,
                    padded_size,
                )
                .unwrap_or(step);
                let base_world_pos = coarse_aligned_lod_sample_base_with_stride(
                    chunk_origin,
                    x,
                    y,
                    z,
                    step,
                    effective_step,
                );
                sdf[idx] = sample_lod_sdf_at_world_pos(world, base_world_pos);
            }
        }
    }

    smooth_lod_sdf_interior(&sdf, padded_size, linearize, 0.5)
}

fn coarse_aligned_lod_sample_base(
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
    step: i32,
) -> IVec3 {
    coarse_aligned_lod_sample_base_with_stride(chunk_origin, px, py, pz, 1, step)
}

fn coarse_aligned_lod_sample_base_with_stride(
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
    sample_stride: i32,
    step: i32,
) -> IVec3 {
    let local = IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);
    let local = local * sample_stride;
    let aligned = IVec3::new(
        local.x.div_euclid(step) * step,
        local.y.div_euclid(step) * step,
        local.z.div_euclid(step) * step,
    );
    chunk_origin + aligned
}

fn sample_lod_sdf_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> f32 {
    if sample_voxel_at_world_pos(world, world_pos) {
        -1.0
    } else {
        1.0
    }
}

fn sample_lod_sdf_at_world_pos_if_loaded(world: &VoxelWorld, world_pos: IVec3) -> Option<f32> {
    match world.sample_voxel_for_terrain_meshing(world_pos) {
        VoxelSample::InBounds(voxel) => Some(if voxel.is_solid() { -1.0 } else { 1.0 }),
        VoxelSample::OutsideAboveWorld
        | VoxelSample::OutsideBelowWorld
        | VoxelSample::OutsideHorizontalWorld
        | VoxelSample::MissingChunkInsideBounds => None,
    }
}

#[cfg(test)]
fn single_solid_to_air_iso_height(samples: impl IntoIterator<Item = (i32, f32)>) -> Option<f32> {
    let mut samples = samples.into_iter();
    let (mut prev_y, mut prev_sdf) = samples.next()?;
    let mut crossing = None;
    let mut sign_change_count = 0;

    for (y, sdf) in samples {
        if (prev_sdf > 0.0) != (sdf > 0.0) {
            sign_change_count += 1;
            if sign_change_count > 1 || !(prev_sdf < 0.0 && sdf > 0.0) {
                return None;
            }
            let t = prev_sdf / (prev_sdf - sdf);
            crossing = Some(prev_y as f32 + (y - prev_y) as f32 * t);
        }
        prev_y = y;
        prev_sdf = sdf;
    }

    crossing
}

fn coarse_lod_iso_height_for_column(
    world: &VoxelWorld,
    world_x: i32,
    world_z: i32,
    coarse_lod: LodLevel,
) -> Option<f32> {
    let step = coarse_lod.step_size() as i32;
    if step <= 1 {
        return None;
    }

    let bounds = world.bounds();
    if world_x < bounds.horizontal_min.x
        || world_x > bounds.horizontal_max.x
        || world_z < bounds.horizontal_min.y
        || world_z > bounds.horizontal_max.y
    {
        return None;
    }

    let sample_x = world_x.div_euclid(step) * step;
    let sample_z = world_z.div_euclid(step) * step;
    let first_y = bounds.min_world_y.div_euclid(step) * step;
    let mut prev: Option<(i32, f32)> = None;
    let mut crossing = None;
    let mut sign_change_count = 0;
    let mut y = first_y;
    while y <= bounds.max_world_y {
        let sample_pos = IVec3::new(sample_x, y, sample_z);
        let sdf = sample_lod_sdf_at_world_pos_if_loaded(world, sample_pos)?;
        if let Some((prev_y, prev_sdf)) = prev {
            if (prev_sdf > 0.0) != (sdf > 0.0) {
                sign_change_count += 1;
                if sign_change_count > 1 || !(prev_sdf < 0.0 && sdf > 0.0) {
                    return None;
                }
                let t = prev_sdf / (prev_sdf - sdf);
                crossing = Some(prev_y as f32 + (y - prev_y) as f32 * t);
            }
        }
        prev = Some((y, sdf));
        y += step;
    }

    crossing
}

fn smooth_lod_sdf_interior<const N: usize>(
    sdf: &[f32; N],
    padded_size: u32,
    linearize: impl Fn([u32; 3]) -> u32,
    current_weight: f32,
) -> [f32; N] {
    if padded_size < 5 {
        return *sdf;
    }

    let neighbor_weight = 1.0 - current_weight;
    let mut smoothed = *sdf;
    let last_interior = padded_size - 3;

    for z in 2..=last_interior {
        for y in 2..=last_interior {
            for x in 2..=last_interior {
                let idx = linearize([x, y, z]) as usize;
                let current = sdf[idx];
                let neighbors = [
                    sdf[linearize([x - 1, y, z]) as usize],
                    sdf[linearize([x + 1, y, z]) as usize],
                    sdf[linearize([x, y - 1, z]) as usize],
                    sdf[linearize([x, y + 1, z]) as usize],
                    sdf[linearize([x, y, z - 1]) as usize],
                    sdf[linearize([x, y, z + 1]) as usize],
                ];

                if neighbors
                    .iter()
                    .any(|&neighbor| (neighbor > 0.0) != (current > 0.0))
                {
                    let neighbor_avg = neighbors.iter().sum::<f32>() / neighbors.len() as f32;
                    smoothed[idx] = current * current_weight + neighbor_avg * neighbor_weight;
                }
            }
        }
    }

    smoothed
}

/// Generate an SDF array from voxel data with 1-voxel padding for neighbor sampling.
/// Uses distance-based SDF for smoother surfaces at chunk boundaries.
/// This is the LOD0 (high detail) version - samples every voxel.
fn generate_sdf(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> [f32; 5832] {
    // 18^3 = 5832
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);

    // First pass: set binary solid/air values
    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        if let Some(step) = lower_detail_transition_step(my_lod, neighbor_lods, px, py, pz) {
            let base_world_pos = coarse_aligned_lod_sample_base(chunk_origin, px, py, pz, step);
            sdf[i] = sample_lod_sdf_at_world_pos(world, base_world_pos);
        } else {
            let is_solid = sample_voxel_solid(chunk, world, chunk_origin, px, py, pz);
            // SDF: negative inside solid, positive in air
            sdf[i] = if is_solid { -1.0 } else { 1.0 };
        }
    }

    // Skip smoothing - it causes boundary vertices to differ between chunks, creating seams.
    // The raw binary SDF produces consistent boundary vertices across chunks.
    sdf
}

/// Sample voxel at a world position, returns true if solid.
/// Used for LOD sampling where coordinates may be outside the chunk.
fn sample_voxel_at_world_pos(world: &VoxelWorld, world_pos: IVec3) -> bool {
    terrain_meshing_voxel_at(world, world_pos).is_solid()
}

/// Generate an SDF array at LOD1 (half resolution).
/// Returns a 10x10x10 grid (1000 elements) instead of 18x18x18 (5832).
/// Vertex positions must be scaled by step_size (2) after mesh generation.
///
/// Low-LOD samples use the same lattice-voxel convention as LOD0 to avoid
/// phase-shifting terrain downward, then smooth only interior SDF values to
/// reduce stair-stepping without moving boundary samples.
fn generate_sdf_lod1(
    chunk: &Chunk,
    world: &VoxelWorld,
    neighbor_lods: &NeighborLods,
) -> [f32; LOD1_GRID_VOLUME] {
    generate_low_lod_sdf::<LOD1_GRID_VOLUME>(
        chunk,
        world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        neighbor_lods,
    )
}

/// Generate an SDF array at LOD2 (quarter resolution).
/// Returns a 6x6x6 grid (216 elements).
/// Vertex positions must be scaled by step_size (4) after mesh generation.
fn generate_sdf_lod2(
    chunk: &Chunk,
    world: &VoxelWorld,
    neighbor_lods: &NeighborLods,
) -> [f32; LOD2_GRID_VOLUME] {
    generate_low_lod_sdf::<LOD2_GRID_VOLUME>(
        chunk,
        world,
        LOD2_PADDED_SIZE,
        LOD2_STEP_SIZE as i32,
        LodShape2::linearize,
        LodLevel::Lod2,
        neighbor_lods,
    )
}

/// Generate an SDF array at LOD3 (eighth resolution).
/// Returns a 4x4x4 grid (64 elements).
/// Vertex positions must be scaled by step_size (8) after mesh generation.
fn generate_sdf_lod3(
    chunk: &Chunk,
    world: &VoxelWorld,
    neighbor_lods: &NeighborLods,
) -> [f32; LOD3_GRID_VOLUME] {
    generate_low_lod_sdf::<LOD3_GRID_VOLUME>(
        chunk,
        world,
        LOD3_PADDED_SIZE,
        LOD3_STEP_SIZE as i32,
        LodShape3::linearize,
        LodLevel::Lod3,
        neighbor_lods,
    )
}

fn skirt_depth_for_lod(lod: LodLevel) -> f32 {
    (match lod {
        LodLevel::Lod0 => 1.5,
        LodLevel::Lod1 => 3.0,
        LodLevel::Lod2 => 8.0,
        LodLevel::Lod3 => 16.0,
        LodLevel::Culled => 1.5,
    }) * VOXEL_SIZE
}

/// Get voxel type at padded coordinates for water SDF generation.
fn get_voxel_for_water_sdf(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    px: i32,
    py: i32,
    pz: i32,
) -> VoxelType {
    let world_pos = chunk_origin + IVec3::new(px - 1, py - 1, pz - 1);

    if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        water_meshing_voxel_in_chunk(
            chunk,
            world,
            UVec3::new((px - 1) as u32, (py - 1) as u32, (pz - 1) as u32),
        )
    } else {
        water_meshing_voxel_at(world, world_pos)
    }
}

fn water_sdf_value_for_voxel(
    voxel: VoxelType,
    world: &VoxelWorld,
    world_pos: IVec3,
    exposure: &mut WaterExposureCache,
    stats: &mut WaterMeshingStats,
) -> f32 {
    if voxel.is_liquid() || voxel.is_solid() {
        return -1.0;
    }
    if voxel != VoxelType::Air {
        return -1.0;
    }

    if exposure.air_exposed(world, world_pos, stats) {
        1.0
    } else {
        -1.0
    }
}

/// Generate an SDF array for water surfaces.
/// Only generates surfaces at water/air boundaries.
/// Solid voxels and sealed air are treated as inside so hidden water surfaces are not generated.
fn generate_water_sdf(
    chunk: &Chunk,
    world: &VoxelWorld,
    water_exposure_mode: WaterAirExposureMode,
) -> [f32; 5832] {
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut exposure = WaterExposureCache::new(water_exposure_mode);
    let mut stats = WaterMeshingStats::default();

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let px = px as i32;
        let py = py as i32;
        let pz = pz as i32;

        let voxel = get_voxel_for_water_sdf(chunk, world, chunk_origin, px, py, pz);
        let world_pos = chunk_origin + IVec3::new(px - 1, py - 1, pz - 1);

        sdf[i] = water_sdf_value_for_voxel(voxel, world, world_pos, &mut exposure, &mut stats);
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
    let pos = Vec3::new(
        local.x * VOXEL_SIZE,
        local.y * VOXEL_SIZE,
        local.z * VOXEL_SIZE,
    );
    let scaled = chunk_center + (pos - chunk_center) * CHUNK_BOUNDARY_SCALE;
    [scaled.x, scaled.y, scaled.z]
}

fn snap_column_for_face(chunk_origin: IVec3, local: Vec3, face: ChunkFace) -> Option<IVec2> {
    match face {
        ChunkFace::NegX => Some(IVec2::new(
            chunk_origin.x,
            chunk_origin.z + local.z.floor() as i32,
        )),
        ChunkFace::PosX => Some(IVec2::new(
            chunk_origin.x + CHUNK_SIZE_I32,
            chunk_origin.z + local.z.floor() as i32,
        )),
        ChunkFace::NegZ => Some(IVec2::new(
            chunk_origin.x + local.x.floor() as i32,
            chunk_origin.z,
        )),
        ChunkFace::PosZ => Some(IVec2::new(
            chunk_origin.x + local.x.floor() as i32,
            chunk_origin.z + CHUNK_SIZE_I32,
        )),
        ChunkFace::NegY | ChunkFace::PosY => None,
    }
}

fn snap_lod0_boundary_vertices_to_lod1_neighbor(
    solid_mesh: &mut MeshData,
    local_positions: &mut [Vec3],
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> LodTransitionSnapStats {
    let mut stats = LodTransitionSnapStats::default();
    if my_lod != LodLevel::Lod0 || solid_mesh.positions.len() != local_positions.len() {
        return stats;
    }

    let mut face_targets: Vec<(ChunkFace, Vec<(usize, f32)>)> = Vec::new();
    for face in [
        ChunkFace::NegX,
        ChunkFace::PosX,
        ChunkFace::NegZ,
        ChunkFace::PosZ,
    ] {
        if neighbor_lod_for_face(neighbor_lods, face) != Some(LodLevel::Lod1) {
            continue;
        }

        let mut targets = Vec::new();
        let mut failed = false;
        for (index, local) in local_positions.iter().copied().enumerate() {
            if !compute_boundary_flags(local, CHUNK_SIZE as f32).on_face(face) {
                continue;
            }

            let Some(column) = snap_column_for_face(chunk_origin, local, face) else {
                continue;
            };
            let Some(world_y) =
                coarse_lod_iso_height_for_column(world, column.x, column.y, LodLevel::Lod1)
            else {
                failed = true;
                break;
            };
            targets.push((index, world_y - chunk_origin.y as f32));
        }

        if failed {
            stats.mark_fallback(face);
            continue;
        }
        if targets.is_empty() {
            continue;
        }
        face_targets.push((face, targets));
    }

    let mut vertex_targets: HashMap<usize, (f32, ChunkFace)> = HashMap::new();
    for (face, targets) in &face_targets {
        for (index, local_y) in targets.iter().copied() {
            if let Some((existing_y, existing_face)) = vertex_targets.get(&index).copied() {
                if (existing_y - local_y).abs() > VOXEL_SIZE * 0.05 {
                    stats.mark_fallback(existing_face);
                    stats.mark_fallback(*face);
                }
            } else {
                vertex_targets.insert(index, (local_y, *face));
            }
        }
    }

    for (face, targets) in face_targets {
        if stats.fallback_face_mask & LodTransitionSnapStats::face_mask(face) != 0 {
            continue;
        }

        for (index, local_y) in targets.iter().copied() {
            let mut local = local_positions[index];
            local.y = local_y;
            local_positions[index] = local;
            solid_mesh.positions[index] = scale_vertex_from_center(local, chunk_center);
            if let Some(weights) = solid_mesh.colors.get_mut(index) {
                *weights = compute_vertex_material_weights(local, chunk, world, chunk_origin);
            }
        }
        stats.mark_snapped(face, targets.len());
    }

    stats
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
                    terrain_meshing_voxel_in_chunk(
                        chunk,
                        world,
                        UVec3::new(lx as u32, ly as u32, lz as u32),
                    )
                } else {
                    let wx = chunk_origin.x + lx;
                    let wy = chunk_origin.y + ly;
                    let wz = chunk_origin.z + lz;
                    terrain_meshing_voxel_at(world, IVec3::new(wx, wy, wz))
                };

                if voxel != VoxelType::Air && voxel != VoxelType::Water {
                    let mat_idx = match voxel {
                        VoxelType::TopSoil | VoxelType::Leaves => 0,
                        VoxelType::Rock
                        | VoxelType::Bedrock
                        | VoxelType::DungeonWall
                        | VoxelType::DungeonFloor => 1,
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
                    terrain_meshing_voxel_in_chunk(
                        chunk,
                        world,
                        UVec3::new(lx as u32, ly as u32, lz as u32),
                    )
                } else {
                    let wx = chunk_origin.x + lx;
                    let wy = chunk_origin.y + ly;
                    let wz = chunk_origin.z + lz;
                    terrain_meshing_voxel_at(world, IVec3::new(wx, wy, wz))
                };

                if voxel != VoxelType::Air && voxel != VoxelType::Water {
                    let mat_idx = match voxel {
                        VoxelType::TopSoil | VoxelType::Leaves => 0,
                        VoxelType::Rock
                        | VoxelType::Bedrock
                        | VoxelType::DungeonWall
                        | VoxelType::DungeonFloor => 1,
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
    chunk_origin: IVec3,
    water_exposure_mode: WaterAirExposureMode,
) -> (MeshData, WaterMeshingStats) {
    let mut water_mesh = MeshData::with_capacity(256, 384);
    let faces = [
        Face::Top,
        Face::Bottom,
        Face::North,
        Face::South,
        Face::East,
        Face::West,
    ];

    // Greedy meshing for water — merges ocean surfaces into large quads
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
                add_greedy_water_face_world(&mut water_mesh, quad, face, chunk_origin, world);
            }
        }
    }

    (water_mesh, water_stats)
}

/// Old Surface Nets water mesh generation (kept for reference).
#[allow(dead_code)]
fn generate_water_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_center: Vec3,
    chunk_origin: IVec3,
) -> MeshData {
    let mut water_mesh = MeshData::with_capacity(256, 384);

    let water_sdf = generate_water_sdf(chunk, world, WaterAirExposureMode::default());
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
        water_mesh
            .positions
            .push(scale_vertex_from_center(local0 + offset, chunk_center));
        water_mesh
            .positions
            .push(scale_vertex_from_center(local1 + offset, chunk_center));
        water_mesh
            .positions
            .push(scale_vertex_from_center(local2 + offset, chunk_center));

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
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(2048, 3072);
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
        match world.sample_voxel_for_terrain_meshing(voxel_pos) {
            VoxelSample::InBounds(voxel) if voxel.is_solid() => -1.0,
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => -1.0,
            VoxelSample::InBounds(_) | VoxelSample::OutsideAboveWorld => 1.0,
        }
    };

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate SDF from voxel data
    let sdf = generate_sdf(chunk, world, my_lod, &neighbor_lods);

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
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao0, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao1, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao2, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
        }
    }

    let lod_transition_snap_stats = snap_lod0_boundary_vertices_to_lod1_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        chunk,
        world,
        chunk_origin,
        chunk_center,
        my_lod,
        &neighbor_lods,
    );

    if !solid_mesh.indices.is_empty() {
        let mut boundary_edges = extract_boundary_edges(
            &local_positions,
            &solid_mesh.positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            &solid_mesh.colors,
            CHUNK_SIZE as f32,
        );
        if lod_transition_snap_stats.snapped_face_mask != 0 {
            boundary_edges.retain(|edge| !lod_transition_snap_stats.face_snapped(edge.face));
        }

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh using the extracted helper
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats,
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
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(512, 768);
    let mut local_positions: Vec<Vec3> = Vec::new();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD1 - each grid cell covers 2 voxels
    let step = LOD1_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (10x10x10 grid)
    let sdf = generate_sdf_lod1(chunk, world, &neighbor_lods);

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
            let weights0 = compute_vertex_material_weights_lod(
                local0,
                chunk,
                world,
                chunk_origin,
                LOD1_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod(
                local1,
                chunk,
                world,
                chunk_origin,
                LOD1_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod(
                local2,
                chunk,
                world,
                chunk_origin,
                LOD1_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
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

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats: LodTransitionSnapStats::default(),
    }
}

/// Generate mesh using Surface Nets at LOD2 (quarter resolution).
/// This function samples every 4th voxel, reducing vertex count by ~94%.
/// Vertices are scaled by step_size (4) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod2(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(256, 384);
    let mut local_positions: Vec<Vec3> = Vec::new();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD2 - each grid cell covers 4 voxels
    let step = LOD2_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (6x6x6 grid)
    let sdf = generate_sdf_lod2(chunk, world, &neighbor_lods);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &sdf,
        &LodShape2 {},
        [0; 3],
        [(LOD2_PADDED_SIZE - 1) as u32; 3],
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

            // Calculate material weights with larger sampling radius for LOD2
            let weights0 = compute_vertex_material_weights_lod(
                local0,
                chunk,
                world,
                chunk_origin,
                LOD2_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod(
                local1,
                chunk,
                world,
                chunk_origin,
                LOD2_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod(
                local2,
                chunk,
                world,
                chunk_origin,
                LOD2_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
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

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats: LodTransitionSnapStats::default(),
    }
}

/// Generate mesh using Surface Nets at LOD3 (eighth resolution).
/// This function samples every 8th voxel, reducing vertex count by ~98%.
/// Vertices are scaled by step_size (8) to match chunk dimensions.
pub fn generate_chunk_mesh_surface_nets_lod3(
    chunk: &Chunk,
    world: &VoxelWorld,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    _ao_config: &BakedAoConfig, // AO disabled for low LOD
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    let mut solid_mesh = MeshData::with_capacity(128, 192);
    let mut local_positions: Vec<Vec3> = Vec::new();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    // Step size for LOD3 - each grid cell covers 8 voxels
    let step = LOD3_STEP_SIZE as f32;

    // Chunk center for scaling calculations
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;

    // Generate downsampled SDF (4x4x4 grid)
    let sdf = generate_sdf_lod3(chunk, world, &neighbor_lods);

    // Run surface nets on the smaller SDF grid
    let mut buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &sdf,
        &LodShape3 {},
        [0; 3],
        [(LOD3_PADDED_SIZE - 1) as u32; 3],
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

            // Calculate material weights with larger sampling radius for LOD3
            let weights0 = compute_vertex_material_weights_lod(
                local0,
                chunk,
                world,
                chunk_origin,
                LOD3_STEP_SIZE,
            );
            let weights1 = compute_vertex_material_weights_lod(
                local1,
                chunk,
                world,
                chunk_origin,
                LOD3_STEP_SIZE,
            );
            let weights2 = compute_vertex_material_weights_lod(
                local2,
                chunk,
                world,
                chunk_origin,
                LOD3_STEP_SIZE,
            );

            // Skip AO for low LOD - distance makes it imperceptible
            // Use full brightness (1.0)
            let ao = 1.0;

            // Add all 3 vertices for this triangle (not shared)
            let base_idx = solid_mesh.positions.len() as u32;

            // Vertex 0
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local0, chunk_center));
            solid_mesh.normals.push(normal0);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights0);
            local_positions.push(local0);

            // Vertex 1
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local1, chunk_center));
            solid_mesh.normals.push(normal1);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights1);
            local_positions.push(local1);

            // Vertex 2
            solid_mesh
                .positions
                .push(scale_vertex_from_center(local2, chunk_center));
            solid_mesh.normals.push(normal2);
            solid_mesh.uvs.push([ao, 0.0]);
            solid_mesh.colors.push(weights2);
            local_positions.push(local2);

            // Add triangle indices
            solid_mesh.indices.push(base_idx);
            solid_mesh.indices.push(base_idx + 1);
            solid_mesh.indices.push(base_idx + 2);
            solid_mesh.push_triangle_barycentrics();
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

        let mut local_skirt_config = skirt_config.clone();
        local_skirt_config.depth = skirt_depth_for_lod(my_lod);

        generate_skirts(
            &mut solid_mesh.positions,
            &mut solid_mesh.normals,
            &mut solid_mesh.uvs,
            &mut solid_mesh.barycentric_uvs,
            &mut solid_mesh.colors,
            &mut solid_mesh.indices,
            &boundary_edges,
            &local_skirt_config,
            my_lod,
            &neighbor_lods,
        );
    }

    // Generate water mesh at full resolution (water is usually flat, so LOD doesn't help much)
    // For consistency, we could also LOD water, but it's typically minimal geometry
    let (water_mesh, water_stats) = generate_water_mesh(
        chunk,
        world,
        chunk_center,
        chunk_origin,
        water_exposure_mode,
    );

    ChunkMeshResult {
        solid: solid_mesh,
        water: water_mesh,
        water_stats,
        lod_transition_snap_stats: LodTransitionSnapStats::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{CHUNK_VOLUME, WATER_LEVEL};
    use crate::rendering::ao_config::BakedAoConfig;

    fn ao_config() -> BakedAoConfig {
        BakedAoConfig {
            enabled: false,
            strength: 0.0,
            corner_darkness: 0.0,
            fix_anisotropy: false,
        }
    }

    fn world_with_test_chunks(size: IVec3) -> VoxelWorld {
        let mut world = VoxelWorld::new(size);
        for x in 0..size.x {
            for y in 0..size.y {
                for z in 0..size.z {
                    world.insert_chunk(Chunk::new(IVec3::new(x, y, z)));
                }
            }
        }
        world
    }

    fn world_with_vertical_chunks() -> VoxelWorld {
        world_with_test_chunks(IVec3::new(1, 3, 1))
    }

    fn seal_air_cell(world: &mut VoxelWorld, air_pos: IVec3) {
        for offset in [IVec3::X, -IVec3::X, IVec3::Y, IVec3::Z, -IVec3::Z] {
            world.set_voxel(air_pos + offset, VoxelType::Rock);
        }
    }

    fn meshed_water(world: &VoxelWorld) -> ChunkMeshResult {
        let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();
        generate_chunk_mesh(
            chunk,
            world,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        )
    }

    fn meshed_chunk(world: &VoxelWorld, chunk_pos: IVec3) -> ChunkMeshResult {
        let chunk = world.get_chunk(chunk_pos).unwrap();
        generate_chunk_mesh(
            chunk,
            world,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        )
    }

    fn surface_nets_mesh(chunk_pos: IVec3, world: &VoxelWorld) -> ChunkMeshResult {
        let chunk = world.get_chunk(chunk_pos).unwrap();
        generate_chunk_mesh_surface_nets(
            chunk,
            world,
            LodLevel::Lod0,
            NeighborLods {
                neg_x: None,
                pos_x: None,
                neg_y: None,
                pos_y: None,
                neg_z: None,
                pos_z: None,
            },
            &SkirtConfig::default(),
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        )
    }

    #[test]
    fn lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample() {
        let chunk_pos = IVec3::new(1, 0, 2);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
        world.set_voxel(chunk_origin + IVec3::new(16, 4, 4), VoxelType::Rock);

        let chunk = world.get_chunk(chunk_pos).unwrap();
        let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
        let no_transition_lods = NeighborLods {
            neg_x: None,
            pos_x: None,
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };
        let transition_lods = NeighborLods {
            neg_x: None,
            pos_x: Some(LodLevel::Lod1),
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        };

        let boundary_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 1, 5, 5]) as usize;
        let neighbor_boundary_idx = LodShape1::linearize([1, 3, 3]) as usize;

        let raw_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &no_transition_lods);
        let transition_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &transition_lods);
        let neighbor_lod1_sdf = generate_sdf_lod1(neighbor, &world, &NeighborLods::default());

        assert_eq!(
            transition_sdf[boundary_idx],
            neighbor_lod1_sdf[neighbor_boundary_idx]
        );
        assert_eq!(transition_sdf[boundary_idx], -1.0);
        assert_eq!(raw_sdf[boundary_idx], transition_sdf[boundary_idx]);
    }

    #[test]
    fn lod0_transition_coarsens_full_boundary_band_not_just_outer_plane() {
        // The Surface-Nets cell that welds a Lod0 chunk to a lower-detail
        // neighbour straddles the boundary and uses the two outermost padded
        // planes as corners. Both must be coarsened; coarsening only the
        // outermost plane leaves the weld cell's inner corner at fine
        // resolution and a seam opens. This guards the inner plane
        // (px == LOD0_PADDED_SIZE - 2), which the original one-plane
        // transition left untouched.
        let chunk_pos = IVec3::new(1, 0, 2);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
        // Solid voxel one aligned coarse step in from the PosX boundary. The
        // fine sample at the inner plane (local x = 15) misses it; the
        // lower-detail-aligned sample at local x = 14 picks it up.
        world.set_voxel(chunk_origin + IVec3::new(14, 4, 4), VoxelType::Rock);

        let chunk = world.get_chunk(chunk_pos).unwrap();
        let no_transition_lods = NeighborLods::default();
        let transition_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        };

        let inner_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 2, 5, 5]) as usize;

        let raw_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &no_transition_lods);
        let transition_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &transition_lods);

        // Fine sampling at the inner plane misses the voxel.
        assert_eq!(raw_sdf[inner_idx], 1.0);
        // The transition must coarsen the inner plane too.
        assert_eq!(transition_sdf[inner_idx], -1.0);
    }

    #[test]
    fn lod0_vertical_transition_boundary_ignores_lower_lod_neighbor_sample() {
        let chunk_pos = IVec3::new(0, 1, 0);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let mut world = world_with_test_chunks(IVec3::new(1, 3, 1));
        world.set_voxel(chunk_origin + IVec3::new(5, 0, 4), VoxelType::Rock);

        let chunk = world.get_chunk(chunk_pos).unwrap();
        let no_transition_lods = NeighborLods::default();
        let transition_lods = NeighborLods {
            neg_y: Some(LodLevel::Lod1),
            ..Default::default()
        };

        let boundary_idx = PaddedChunkShape::linearize([5, 1, 5]) as usize;

        let raw_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &no_transition_lods);
        let transition_sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &transition_lods);

        assert_eq!(raw_sdf[boundary_idx], 1.0);
        assert_eq!(transition_sdf[boundary_idx], raw_sdf[boundary_idx]);
    }

    #[test]
    fn low_lod_sdf_samples_lattice_voxel_not_forward_box() {
        let mut world = world_with_test_chunks(IVec3::ONE);
        let sample_pos = IVec3::new(8, 8, 8);

        world.set_voxel(sample_pos + IVec3::ONE, VoxelType::Rock);
        assert_eq!(sample_lod_sdf_at_world_pos(&world, sample_pos), 1.0);

        world.set_voxel(sample_pos, VoxelType::Rock);
        assert_eq!(sample_lod_sdf_at_world_pos(&world, sample_pos), -1.0);
    }

    #[test]
    fn lod1_flat_surface_stays_within_half_voxel_of_lod0() {
        let chunk_pos = IVec3::ZERO;
        let mut world = world_with_test_chunks(IVec3::ONE);
        for x in 0..CHUNK_SIZE_I32 {
            for y in 0..8 {
                for z in 0..CHUNK_SIZE_I32 {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }

        let chunk = world.get_chunk(chunk_pos).unwrap();
        let lod0_mesh = generate_chunk_mesh_surface_nets(
            chunk,
            &world,
            LodLevel::Lod0,
            NeighborLods::default(),
            &SkirtConfig::default(),
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );
        let lod1_mesh = generate_chunk_mesh_surface_nets_lod1(
            chunk,
            &world,
            LodLevel::Lod1,
            NeighborLods::default(),
            &SkirtConfig::default(),
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );

        let max_lod0_y = lod0_mesh
            .solid
            .positions
            .iter()
            .map(|pos| pos[1])
            .fold(f32::NEG_INFINITY, f32::max);
        let max_lod1_y = lod1_mesh
            .solid
            .positions
            .iter()
            .map(|pos| pos[1])
            .fold(f32::NEG_INFINITY, f32::max);

        assert!(
            max_lod1_y <= max_lod0_y + VOXEL_SIZE * 0.05,
            "LOD1 flat surface should not overshoot LOD0: LOD1 y={max_lod1_y}, LOD0 y={max_lod0_y}"
        );
        assert!(
            max_lod0_y - max_lod1_y <= VOXEL_SIZE * 0.55,
            "LOD1 flat surface should stay within half a voxel of LOD0: LOD1 y={max_lod1_y}, LOD0 y={max_lod0_y}"
        );
    }

    #[test]
    fn steep_lod0_lod1_x_seam_transition_stays_near_reference_surface() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 1));
        fill_steep_x_slope(&mut world);

        let lod0_chunk_pos = IVec3::new(1, 1, 0);
        let lod1_chunk_pos = IVec3::new(2, 1, 0);
        let lod0_chunk = world.get_chunk(lod0_chunk_pos).unwrap();
        let lod1_chunk = world.get_chunk(lod1_chunk_pos).unwrap();
        let lod0_origin = VoxelWorld::chunk_to_world(lod0_chunk_pos);
        let lod1_origin = VoxelWorld::chunk_to_world(lod1_chunk_pos);
        let skirt_config = SkirtConfig::default();
        let samples = [
            Vec3::new(31.5, 0.0, 8.5),
            Vec3::new(32.25, 0.0, 8.5),
            Vec3::new(32.75, 0.0, 8.5),
            Vec3::new(33.5, 0.0, 8.5),
        ];

        let reference_left = generate_chunk_mesh_surface_nets(
            lod0_chunk,
            &world,
            LodLevel::Lod0,
            NeighborLods {
                pos_x: Some(LodLevel::Lod0),
                ..Default::default()
            },
            &skirt_config,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );
        let reference_right = generate_chunk_mesh_surface_nets(
            lod1_chunk,
            &world,
            LodLevel::Lod0,
            NeighborLods {
                neg_x: Some(LodLevel::Lod0),
                ..Default::default()
            },
            &skirt_config,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );
        let reference_meshes = [
            (&reference_left.solid, lod0_origin),
            (&reference_right.solid, lod1_origin),
        ];
        let reference_max_abs_error = samples
            .iter()
            .map(|sample| {
                let hit_y =
                    highest_vertical_hit_y_for_meshes(&reference_meshes, sample.x, sample.z)
                        .expect("all-Lod0 reference seam should have a vertical hit");
                let expected_y = expected_surface_face_y_at(
                    &world,
                    sample.x.floor() as i32,
                    sample.z.floor() as i32,
                )
                .expect("synthetic slope should have a voxel surface");
                (hit_y - expected_y).abs()
            })
            .fold(0.0_f32, f32::max);

        let transition_left = generate_chunk_mesh_surface_nets(
            lod0_chunk,
            &world,
            LodLevel::Lod0,
            NeighborLods {
                pos_x: Some(LodLevel::Lod1),
                ..Default::default()
            },
            &skirt_config,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );
        let transition_right = generate_chunk_mesh_surface_nets_lod1(
            lod1_chunk,
            &world,
            LodLevel::Lod1,
            NeighborLods {
                neg_x: Some(LodLevel::Lod0),
                ..Default::default()
            },
            &skirt_config,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );
        let transition_meshes = [
            (&transition_left.solid, lod0_origin),
            (&transition_right.solid, lod1_origin),
        ];
        let tolerance = reference_max_abs_error + VOXEL_SIZE * 0.5;

        for sample in samples {
            let hit_y = highest_vertical_hit_y_for_meshes(&transition_meshes, sample.x, sample.z)
                .unwrap_or_else(|| {
                    panic!(
                        "Lod0/Lod1 transition seam should have a vertical hit at x={}, z={}",
                        sample.x, sample.z
                    )
                });
            let expected_y = expected_surface_face_y_at(
                &world,
                sample.x.floor() as i32,
                sample.z.floor() as i32,
            )
            .expect("synthetic slope should have a voxel surface");
            let signed_error = hit_y - expected_y;
            assert!(
                signed_error.abs() <= tolerance,
                "Lod0/Lod1 transition seam signed error {signed_error:.2} exceeded reference-derived tolerance {tolerance:.2} at x={}, z={} (hit_y={hit_y:.2}, expected_y={expected_y:.2}, reference_max_abs_error={reference_max_abs_error:.2})",
                sample.x,
                sample.z,
            );
        }
    }

    #[test]
    fn low_lod_transition_boundary_sdf_matches_coarser_neighbor_sample() {
        let chunk_pos = IVec3::new(1, 0, 0);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let mut world = world_with_test_chunks(IVec3::new(4, 1, 1));
        for x in 32..40 {
            for y in 8..16 {
                for z in 0..8 {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Air);
                }
            }
        }
        world.set_voxel(chunk_origin + IVec3::new(16, 8, 0), VoxelType::Rock);

        let chunk = world.get_chunk(chunk_pos).unwrap();
        let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
        let no_transition_lods = NeighborLods::default();
        let transition_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod3),
            ..Default::default()
        };

        let boundary_idx = LodShape1::linearize([LOD1_PADDED_SIZE - 1, 5, 3]) as usize;
        let neighbor_boundary_idx = LodShape3::linearize([1, 2, 1]) as usize;

        let raw_sdf = generate_sdf_lod1(chunk, &world, &no_transition_lods);
        let transition_sdf = generate_sdf_lod1(chunk, &world, &transition_lods);
        let neighbor_lod3_sdf = generate_sdf_lod3(neighbor, &world, &NeighborLods::default());

        assert_eq!(raw_sdf[boundary_idx], 1.0);
        assert_eq!(
            transition_sdf[boundary_idx],
            neighbor_lod3_sdf[neighbor_boundary_idx]
        );
        assert_eq!(transition_sdf[boundary_idx], -1.0);
    }

    fn set_column(
        world: &mut VoxelWorld,
        x: i32,
        z: i32,
        y_min: i32,
        y_max: i32,
        voxel: VoxelType,
    ) {
        for y in y_min..=y_max {
            world.set_voxel(IVec3::new(x, y, z), voxel);
        }
    }

    fn fill_chunk(world: &mut VoxelWorld, chunk_pos: IVec3, voxel: VoxelType) {
        world.insert_chunk(Chunk::with_voxels(chunk_pos, [voxel; CHUNK_VOLUME]));
    }

    fn mesh_has_vertical_hit(
        mesh: &MeshData,
        chunk_origin: IVec3,
        world_x: f32,
        world_z: f32,
    ) -> bool {
        let origin_y = chunk_origin.y as f32 + 32.0;
        for tri in mesh.indices.chunks_exact(3) {
            let p0 = Vec3::from_array(mesh.positions[tri[0] as usize]) + chunk_origin.as_vec3();
            let p1 = Vec3::from_array(mesh.positions[tri[1] as usize]) + chunk_origin.as_vec3();
            let p2 = Vec3::from_array(mesh.positions[tri[2] as usize]) + chunk_origin.as_vec3();
            if vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2).is_some() {
                return true;
            }
        }
        false
    }

    fn highest_vertical_hit_y_for_meshes(
        meshes: &[(&MeshData, IVec3)],
        world_x: f32,
        world_z: f32,
    ) -> Option<f32> {
        let origin_y = meshes
            .iter()
            .map(|(_, chunk_origin)| chunk_origin.y as f32 + 48.0)
            .fold(f32::NEG_INFINITY, f32::max);
        let mut best_hit = None;
        for (mesh, chunk_origin) in meshes {
            for tri in mesh.indices.chunks_exact(3) {
                let p0 = Vec3::from_array(mesh.positions[tri[0] as usize]) + chunk_origin.as_vec3();
                let p1 = Vec3::from_array(mesh.positions[tri[1] as usize]) + chunk_origin.as_vec3();
                let p2 = Vec3::from_array(mesh.positions[tri[2] as usize]) + chunk_origin.as_vec3();
                if let Some(hit_y) =
                    vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2)
                {
                    if best_hit.map_or(true, |best| hit_y > best) {
                        best_hit = Some(hit_y);
                    }
                }
            }
        }
        best_hit
    }

    fn expected_surface_face_y_at(world: &VoxelWorld, x: i32, z: i32) -> Option<f32> {
        let bounds = world.bounds();
        for y in (bounds.min_world_y..=bounds.max_world_y).rev() {
            if matches!(
                world.sample_voxel_for_collision(IVec3::new(x, y, z)),
                VoxelSample::InBounds(voxel) if voxel.is_solid()
            ) {
                return Some(y as f32 + VOXEL_SIZE);
            }
        }
        None
    }

    fn fill_steep_x_slope(world: &mut VoxelWorld) {
        let bounds = world.bounds();
        for x in bounds.horizontal_min.x..=bounds.horizontal_max.x {
            let surface_y = 44 - x / 2;
            for z in bounds.horizontal_min.y..=bounds.horizontal_max.y {
                for y in bounds.min_world_y..surface_y {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
    }

    fn assert_snapped_local_vertices_match_coarse_surface(
        stats: LodTransitionSnapStats,
        local_positions: &[Vec3],
        world: &VoxelWorld,
        chunk_pos: IVec3,
        face: ChunkFace,
    ) {
        assert!(
            stats.face_snapped(face),
            "{face:?} should be snap-welded, stats={:?}",
            stats
        );
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let chunk_size = CHUNK_SIZE as f32;
        let mut checked = 0;
        for local in local_positions.iter().copied() {
            let on_face = match face {
                ChunkFace::NegX => local.x.abs() <= 0.02,
                ChunkFace::PosX => (local.x - chunk_size).abs() <= 0.02,
                ChunkFace::NegZ => local.z.abs() <= 0.02,
                ChunkFace::PosZ => (local.z - chunk_size).abs() <= 0.02,
                ChunkFace::NegY | ChunkFace::PosY => false,
            };
            if !on_face {
                continue;
            }

            let column = snap_column_for_face(chunk_origin, local, face)
                .expect("X/Z face should have a snap column");
            let expected_y =
                coarse_lod_iso_height_for_column(world, column.x, column.y, LodLevel::Lod1)
                    .expect("synthetic slope should have a single coarse crossing");
            let world_y = chunk_origin.y as f32 + local.y;
            let error = world_y - expected_y;
            assert!(
                error.abs() <= 0.02,
                "snapped {face:?} boundary vertex should sit on coarse iso-surface: local={local:?}, world_y={world_y:.2}, expected_y={expected_y:.2}, error={error:.2}"
            );
            assert!(
                error <= 0.05,
                "snapped {face:?} boundary vertex should not form a proud flap: local={local:?}, error={error:.2}"
            );
            checked += 1;
        }
        assert!(checked > 0, "{face:?} should expose boundary vertices");
    }

    fn mesh_data_for_local_positions(local_positions: &[Vec3], chunk_center: Vec3) -> MeshData {
        let mut mesh = MeshData::new();
        for local in local_positions {
            mesh.positions
                .push(scale_vertex_from_center(*local, chunk_center));
            mesh.colors.push([0.0; 4]);
        }
        mesh
    }

    #[test]
    fn coarse_iso_height_helper_interpolates_single_crossing_column() {
        let height = single_solid_to_air_iso_height([(0, -1.0), (2, -1.0), (4, 1.0), (6, 1.0)])
            .expect("single solid-to-air crossing should interpolate");

        assert!((height - 3.0).abs() <= f32::EPSILON);
    }

    #[test]
    fn coarse_iso_height_helper_rejects_no_and_multi_crossing_columns() {
        assert_eq!(
            single_solid_to_air_iso_height([(0, -1.0), (2, -1.0), (4, -1.0)]),
            None
        );
        assert_eq!(
            single_solid_to_air_iso_height([(0, 1.0), (2, -1.0), (4, 1.0)]),
            None
        );
        assert_eq!(
            single_solid_to_air_iso_height([(0, -1.0), (2, 1.0), (4, -1.0), (6, 1.0)]),
            None
        );
    }

    #[test]
    fn lod0_lod1_x_boundary_snap_welds_to_coarse_iso_surface() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);

        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
        let mut local_positions = vec![
            Vec3::new(CHUNK_SIZE as f32, 2.0, 2.0),
            Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0),
            Vec3::new(CHUNK_SIZE as f32, 9.0, 14.0),
        ];
        let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

        let stats = snap_lod0_boundary_vertices_to_lod1_neighbor(
            &mut solid_mesh,
            &mut local_positions,
            world.get_chunk(chunk_pos).unwrap(),
            &world,
            chunk_origin,
            chunk_center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod1),
                ..Default::default()
            },
        );

        assert_eq!(stats.fallback_face_mask, 0);
        assert_eq!(stats.snapped_vertex_count, local_positions.len() as u32);
        assert!(
            solid_mesh.colors.iter().all(|weights| *weights != [0.0; 4]),
            "snapped vertices should refresh material weights at the new height"
        );
        assert_snapped_local_vertices_match_coarse_surface(
            stats,
            &local_positions,
            &world,
            chunk_pos,
            ChunkFace::PosX,
        );
    }

    #[test]
    fn lod0_lod1_z_boundary_snap_welds_to_coarse_iso_surface() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
        fill_steep_x_slope(&mut world);

        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
        let mut local_positions = vec![
            Vec3::new(2.0, 5.0, CHUNK_SIZE as f32),
            Vec3::new(8.0, 9.0, CHUNK_SIZE as f32),
            Vec3::new(14.0, 12.0, CHUNK_SIZE as f32),
        ];
        let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

        let stats = snap_lod0_boundary_vertices_to_lod1_neighbor(
            &mut solid_mesh,
            &mut local_positions,
            world.get_chunk(chunk_pos).unwrap(),
            &world,
            chunk_origin,
            chunk_center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_z: Some(LodLevel::Lod1),
                ..Default::default()
            },
        );

        assert_eq!(stats.fallback_face_mask, 0);
        assert_eq!(stats.snapped_vertex_count, local_positions.len() as u32);
        assert_snapped_local_vertices_match_coarse_surface(
            stats,
            &local_positions,
            &world,
            chunk_pos,
            ChunkFace::PosZ,
        );
    }

    #[test]
    fn ambiguous_snap_column_falls_back_without_moving_vertices() {
        let mut world = world_with_test_chunks(IVec3::new(2, 2, 1));
        for y in 0..=2 {
            world.set_voxel(IVec3::new(CHUNK_SIZE_I32, y, 8), VoxelType::Rock);
        }
        for y in 8..=10 {
            world.set_voxel(IVec3::new(CHUNK_SIZE_I32, y, 8), VoxelType::Rock);
        }

        let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
        let original_local = Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0);
        let mut local_positions = vec![original_local];
        let mut solid_mesh = MeshData::new();
        solid_mesh
            .positions
            .push(scale_vertex_from_center(original_local, chunk_center));

        let stats = snap_lod0_boundary_vertices_to_lod1_neighbor(
            &mut solid_mesh,
            &mut local_positions,
            world.get_chunk(IVec3::ZERO).unwrap(),
            &world,
            IVec3::ZERO,
            chunk_center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod1),
                ..Default::default()
            },
        );

        assert_eq!(stats.snapped_vertex_count, 0);
        assert!(stats.fallback_face_mask & LodTransitionSnapStats::face_mask(ChunkFace::PosX) != 0);
        assert_eq!(local_positions[0], original_local);
        assert_eq!(
            solid_mesh.positions[0],
            scale_vertex_from_center(original_local, chunk_center)
        );
    }

    fn vertical_ray_triangle_hit_y(
        x: f32,
        z: f32,
        origin_y: f32,
        p0: Vec3,
        p1: Vec3,
        p2: Vec3,
    ) -> Option<f32> {
        let x0 = p0.x;
        let z0 = p0.z;
        let x1 = p1.x;
        let z1 = p1.z;
        let x2 = p2.x;
        let z2 = p2.z;
        let denom = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
        if denom.abs() < 1e-5 {
            return None;
        }
        let a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / denom;
        let b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / denom;
        let c = 1.0 - a - b;
        if a >= -1e-4 && b >= -1e-4 && c >= -1e-4 {
            let y = a * p0.y + b * p1.y + c * p2.y;
            (y <= origin_y).then_some(y)
        } else {
            None
        }
    }

    #[test]
    fn sealed_below_sea_water_surface_is_not_meshed() {
        let mut world = world_with_vertical_chunks();
        world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);
        seal_air_cell(&mut world, IVec3::new(8, WATER_LEVEL + 1, 8));

        let mesh = meshed_water(&world);

        assert!(mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.air_boundaries_total, 1);
        assert_eq!(mesh.water_stats.air_boundaries_exposed, 0);
        assert_eq!(mesh.water_stats.air_boundaries_sealed, 1);
        assert_eq!(mesh.water_stats.triangles_removed_sealed, 2);
    }

    #[test]
    fn open_water_surface_is_still_meshed() {
        let mut world = world_with_vertical_chunks();
        world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);

        let mesh = meshed_water(&world);

        assert!(!mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.air_boundaries_total, 1);
        assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
        assert_eq!(mesh.water_stats.air_boundaries_sealed, 0);
    }

    #[test]
    fn water_surface_below_sea_level_is_clamped_to_water_level() {
        let mut world = world_with_vertical_chunks();
        let water_pos = IVec3::new(8, WATER_LEVEL - 2, 8);
        world.set_voxel(water_pos, VoxelType::Water);

        let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));
        let chunk_origin = VoxelWorld::chunk_to_world(VoxelWorld::world_to_chunk(water_pos));

        assert!(!mesh.water.indices.is_empty());
        assert!(mesh.water.positions.iter().all(|position| {
            let world_y = chunk_origin.y as f32 + position[1];
            (world_y - crate::constants::WATER_LEVEL as f32).abs() < 0.001
        }));
    }

    #[test]
    fn water_surface_uses_narrow_overlap_for_shoreline_fade() {
        let mut world = world_with_vertical_chunks();
        let water_pos = IVec3::new(8, WATER_LEVEL - 2, 8);
        world.set_voxel(water_pos, VoxelType::Water);

        let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));
        let chunk_origin = VoxelWorld::chunk_to_world(VoxelWorld::world_to_chunk(water_pos));
        let min_x = mesh
            .water
            .positions
            .iter()
            .map(|position| chunk_origin.x as f32 + position[0])
            .fold(f32::INFINITY, f32::min);
        let max_x = mesh
            .water
            .positions
            .iter()
            .map(|position| chunk_origin.x as f32 + position[0])
            .fold(f32::NEG_INFINITY, f32::max);
        let min_z = mesh
            .water
            .positions
            .iter()
            .map(|position| chunk_origin.z as f32 + position[2])
            .fold(f32::INFINITY, f32::min);
        let max_z = mesh
            .water
            .positions
            .iter()
            .map(|position| chunk_origin.z as f32 + position[2])
            .fold(f32::NEG_INFINITY, f32::max);

        assert!(!mesh.water.indices.is_empty());
        assert!((min_x - (water_pos.x as f32 - WATER_SHORELINE_EXTENSION)).abs() < 0.001);
        assert!(
            (max_x - (water_pos.x as f32 + VOXEL_SIZE + WATER_SHORELINE_EXTENSION)).abs() < 0.001
        );
        assert!((min_z - (water_pos.z as f32 - WATER_SHORELINE_EXTENSION)).abs() < 0.001);
        assert!(
            (max_z - (water_pos.z as f32 + VOXEL_SIZE + WATER_SHORELINE_EXTENSION)).abs() < 0.001
        );
    }

    #[test]
    fn map_edge_water_surface_is_not_meshed() {
        let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
        let water_pos = IVec3::new(0, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
        world.set_voxel(water_pos, VoxelType::Water);

        let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

        assert!(mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 1);
        assert_eq!(mesh.water_stats.air_boundaries_total, 0);
    }

    #[test]
    fn interior_water_surface_outside_edge_margin_is_still_meshed() {
        let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
        let water_pos = IVec3::new(CHUNK_SIZE_I32 + 8, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
        world.set_voxel(water_pos, VoxelType::Water);

        let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

        assert!(!mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 0);
        assert_eq!(mesh.water_stats.air_boundaries_total, 1);
        assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
    }

    #[test]
    fn shore_water_inside_gameplay_edge_guard_is_still_meshed() {
        let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
        let water_pos = IVec3::new(CHUNK_SIZE_I32 / 2, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
        world.set_voxel(water_pos, VoxelType::Water);

        let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

        assert!(!mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 0);
        assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
    }

    #[test]
    fn valid_surface_lake_above_floor_creates_water_mesh() {
        let mut world = world_with_vertical_chunks();
        let lake_y = WATER_LEVEL + 4;
        world.set_voxel(IVec3::new(8, lake_y, 8), VoxelType::Water);

        let mesh = meshed_water(&world);

        assert!(!mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
    }

    #[test]
    fn invalid_below_floor_water_creates_no_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
        {
            let mut chunk = world.get_chunk_mut(IVec3::ZERO).unwrap();
            chunk.set(UVec3::new(8, 0, 8), VoxelType::Water);
        }

        let mesh = meshed_chunk(&world, IVec3::ZERO);

        assert!(mesh.water.indices.is_empty());
    }

    #[test]
    fn water_exposure_does_not_leak_below_world_floor() {
        let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
        let air_pos = IVec3::new(8, 1, 8);
        for offset in [IVec3::X, -IVec3::X, IVec3::Y, IVec3::Z, -IVec3::Z] {
            world.set_voxel(air_pos + offset, VoxelType::Rock);
        }

        let mut stats = WaterMeshingStats::default();
        let exposed = air_connected_to_exterior_with_stats(&world, air_pos, &mut stats);

        assert!(!exposed);

        let mut stats = WaterMeshingStats::default();
        let exposed = air_connected_to_exterior_with_stats(
            &world,
            IVec3::new(air_pos.x, -1, air_pos.z),
            &mut stats,
        );
        assert!(!exposed);
        assert!(stats.exposure_outside_world_rejected > 0);
    }

    #[test]
    fn sealed_air_is_inside_water_sdf() {
        let mut world = world_with_vertical_chunks();
        world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);
        seal_air_cell(&mut world, IVec3::new(8, WATER_LEVEL + 1, 8));
        let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();

        let sdf = generate_water_sdf(chunk, &world, WaterAirExposureMode::ExteriorConnected);
        let air_above_water_index = PaddedChunkShape::linearize([9, 4, 9]) as usize;

        assert_eq!(sdf[air_above_water_index], -1.0);
    }

    #[test]
    fn sealed_air_across_chunk_boundary_does_not_create_seam() {
        let mut world = world_with_test_chunks(IVec3::new(2, 3, 1));
        let water_pos = IVec3::new(15, WATER_LEVEL, 8);
        let air_pos = water_pos + IVec3::Y;
        world.set_voxel(water_pos, VoxelType::Water);
        seal_air_cell(&mut world, air_pos);

        let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();
        let mesh = generate_chunk_mesh(
            chunk,
            &world,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );

        assert!(mesh.water.indices.is_empty());
        assert_eq!(mesh.water_stats.air_boundaries_sealed, 1);
    }

    #[test]
    fn surface_nets_chunk_top_boundary_sand_surface_generates_geometry() {
        let mut world = world_with_test_chunks(IVec3::new(2, 3, 2));
        for x in 14..=18 {
            for z in 15..=19 {
                set_column(&mut world, x, z, 0, 27, VoxelType::Rock);
                set_column(&mut world, x, z, 28, 30, VoxelType::SubSoil);
                world.set_voxel(IVec3::new(x, 31, z), VoxelType::Sand);
            }
        }

        let lower_mesh = surface_nets_mesh(IVec3::new(1, 1, 1), &world);
        let upper_mesh = surface_nets_mesh(IVec3::new(1, 2, 1), &world);

        assert!(
            !lower_mesh.solid.indices.is_empty() || !upper_mesh.solid.indices.is_empty(),
            "Surface Nets must produce geometry for a solid surface exactly at a vertical chunk boundary"
        );
        assert!(
            lower_mesh
                .solid
                .positions
                .iter()
                .chain(upper_mesh.solid.positions.iter())
                .any(|position| position[1] >= -0.1 && position[1] <= 16.1),
            "expected boundary surface vertices in one of the two chunks"
        );
        assert!(
            mesh_has_vertical_hit(&lower_mesh.solid, IVec3::new(16, 16, 16), 16.5, 17.5)
                || mesh_has_vertical_hit(&upper_mesh.solid, IVec3::new(16, 32, 16), 16.5, 17.5),
            "expected a downward physics/render ray to hit the chunk-boundary sand surface"
        );
        assert!(
            empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 2, 1)),
            "empty upper chunk must stay dirty when it may own a vertical boundary cap"
        );
    }

    #[test]
    fn surface_nets_empty_chunk_above_fully_solid_neighbor_needs_terrain_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
        fill_chunk(&mut world, IVec3::ZERO, VoxelType::Rock);

        assert!(
            empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::Y),
            "empty chunk above a fully solid skipped chunk must own the exposed top cap"
        );
    }

    #[test]
    fn surface_nets_empty_chunk_above_water_only_does_not_need_terrain_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(3, 3, 3));
        world.set_voxel(IVec3::new(24, 31, 24), VoxelType::Water);

        assert!(
            !empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 2, 1)),
            "water-only boundaries should remain water mesh responsibility, not terrain mesh"
        );
    }

    #[test]
    fn surface_nets_empty_side_neighbor_does_not_need_terrain_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(2, 2, 2));
        for z in 15..=18 {
            for y in 20..=26 {
                world.set_voxel(IVec3::new(15, y, z), VoxelType::Sand);
            }
        }

        assert!(
            !empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 1, 1)),
            "all-air side neighbors should not spawn standalone terrain slabs"
        );
    }

    #[test]
    fn surface_nets_empty_chunk_below_mixed_overhang_needs_terrain_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
        world.set_voxel(IVec3::new(8, 16, 8), VoxelType::Sand);

        assert!(
            empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::ZERO),
            "empty lower chunk must stay dirty when it may own an overhang boundary cap"
        );
    }

    #[test]
    fn surface_nets_empty_chunk_below_fully_solid_neighbor_needs_terrain_mesh() {
        let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
        fill_chunk(&mut world, IVec3::Y, VoxelType::Rock);

        assert!(
            empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::ZERO),
            "empty chunk below a fully solid skipped chunk may own the exposed ceiling cap"
        );
    }

    #[test]
    fn surface_nets_side_boundary_sand_surface_generates_geometry() {
        let mut world = world_with_test_chunks(IVec3::new(2, 2, 2));
        for z in 15..=18 {
            for y in 0..=3 {
                world.set_voxel(IVec3::new(15, y, z), VoxelType::Sand);
            }
        }

        let left_mesh = surface_nets_mesh(IVec3::new(0, 0, 1), &world);
        let right_mesh = surface_nets_mesh(IVec3::new(1, 0, 1), &world);

        assert!(
            !left_mesh.solid.indices.is_empty() || !right_mesh.solid.indices.is_empty(),
            "Surface Nets must produce side-boundary terrain geometry"
        );
    }

    #[test]
    fn surface_nets_bottom_boundary_air_over_solid_generates_geometry() {
        let mut world = world_with_test_chunks(IVec3::new(1, 3, 1));
        for x in 6..=10 {
            for z in 6..=10 {
                world.set_voxel(IVec3::new(x, 15, z), VoxelType::Sand);
            }
        }

        let upper_mesh = surface_nets_mesh(IVec3::new(0, 1, 0), &world);

        assert!(
            mesh_has_vertical_hit(&upper_mesh.solid, IVec3::new(0, 16, 0), 8.5, 8.5),
            "air chunk above a solid top boundary must generate the owned boundary surface"
        );
    }

    #[test]
    fn voxel_water_sdf_treats_outside_below_world_as_solid_boundary() {
        let world = world_with_test_chunks(IVec3::new(1, 1, 1));
        let chunk = world.get_chunk(IVec3::ZERO).unwrap();
        let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

        assert_eq!(
            get_voxel_for_water_sdf(chunk, &world, chunk_origin, 8, 0, 8),
            VoxelType::Bedrock
        );
    }

    #[test]
    fn voxel_terrain_meshing_does_not_open_bottom_face_against_world_floor() {
        let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
        world.set_voxel(IVec3::new(8, 1, 8), VoxelType::Rock);
        let mesh = generate_chunk_mesh(
            world.get_chunk(IVec3::ZERO).unwrap(),
            &world,
            &ao_config(),
            WaterAirExposureMode::ExteriorConnected,
        );

        assert!(
            !mesh.solid.normals.iter().any(|normal| normal[1] < -0.9),
            "terrain should not render a downward face into the world floor boundary"
        );
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

impl MeshMode {
    /// Toggle between Blocky and SurfaceNets modes.
    pub fn toggle(&mut self) {
        *self = match self {
            MeshMode::Blocky => MeshMode::SurfaceNets,
            MeshMode::SurfaceNets => MeshMode::Blocky,
        };
    }
}

/// Resource to control mesh generation mode globally
#[derive(Resource, Clone, Copy, Debug)]
pub struct MeshSettings {
    pub mode: MeshMode,
    pub water_air_exposure_mode: WaterAirExposureMode,
}

impl Default for MeshSettings {
    fn default() -> Self {
        Self {
            mode: MeshMode::Blocky,
            water_air_exposure_mode: WaterAirExposureMode::default(),
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
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    match mode {
        MeshMode::Blocky => generate_chunk_mesh(chunk, world, ao_config, water_exposure_mode),
        MeshMode::SurfaceNets => {
            // Select LOD-appropriate mesh generation
            match my_lod {
                LodLevel::Lod0 => {
                    // Full detail Surface Nets (18x18x18 grid, step 1)
                    generate_chunk_mesh_surface_nets(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                        water_exposure_mode,
                    )
                }
                LodLevel::Lod1 => {
                    // Half detail Surface Nets (10x10x10 grid, step 2)
                    // ~75% vertex reduction for distant chunks
                    generate_chunk_mesh_surface_nets_lod1(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                        water_exposure_mode,
                    )
                }
                LodLevel::Lod2 => {
                    // Quarter detail Surface Nets (6x6x6 grid, step 4)
                    // ~94% vertex reduction for very distant chunks
                    generate_chunk_mesh_surface_nets_lod2(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                        water_exposure_mode,
                    )
                }
                LodLevel::Lod3 => {
                    // Eighth detail Surface Nets (4x4x4 grid, step 8)
                    // ~98% vertex reduction for extreme distance chunks
                    generate_chunk_mesh_surface_nets_lod3(
                        chunk,
                        world,
                        my_lod,
                        neighbor_lods,
                        skirt_config,
                        ao_config,
                        water_exposure_mode,
                    )
                }
                LodLevel::Culled => {
                    // Shouldn't reach here - culled chunks skip meshing entirely
                    // But if we do, return empty mesh
                    ChunkMeshResult {
                        solid: MeshData::new(),
                        water: MeshData::new(),
                        water_stats: WaterMeshingStats::default(),
                        lod_transition_snap_stats: LodTransitionSnapStats::default(),
                    }
                }
            }
        }
    }
}
