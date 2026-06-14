use super::{MeshMode, air_connected_to_exterior_with_stats, air_open_to_sky_with_stats};
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::chunk::LodLevel;
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::types::VoxelType;
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::query::QueryItem;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponent;
use bevy_mesh::{Indices, PrimitiveTopology};
use std::collections::HashMap;

/// UV1.y section scale for wireframe mesh-section colouring (`TERRAIN_DEBUG_WIREFRAME`).
pub const TERRAIN_BARYCENTRIC_SECTION_SCALE: f32 = 4.0;
/// UV1.x LOD slot scale — barycentric U stays in `[0, 1]` within each slot.
pub const TERRAIN_BARYCENTRIC_LOD_U_SCALE: f32 = 2.0;

/// Main Surface Nets mesh triangles.
pub const TERRAIN_MESH_SECTION_MAIN: u8 = 0;
/// Horizontal transition apron / seal geometry from [`crate::voxel::skirt`].
pub const TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT: u8 = 1;
/// Vertical drop curtain geometry from [`crate::voxel::skirt`].
pub const TERRAIN_MESH_SECTION_VERTICAL_SKIRT: u8 = 2;
/// Reserved for future MC+Transvoxel transition aprons.
pub const TERRAIN_MESH_SECTION_TRANSITION_APRON: u8 = 3;

/// Encode barycentric UV1 with LOD (X slots) and mesh-generation section (Y bands).
pub fn encode_barycentric_uv(bary: [f32; 2], section: u8, lod_index: u8) -> [f32; 2] {
    [
        bary[0] + lod_index as f32 * TERRAIN_BARYCENTRIC_LOD_U_SCALE,
        bary[1] + section as f32 * TERRAIN_BARYCENTRIC_SECTION_SCALE,
    ]
}

/// Decode the mesh-generation section tag written by [`encode_barycentric_uv`].
pub fn barycentric_section(uv: [f32; 2]) -> u8 {
    (uv[1] / TERRAIN_BARYCENTRIC_SECTION_SCALE).floor() as u8
}

/// Decode the chunk LOD index written by [`encode_barycentric_uv`].
pub fn barycentric_lod_index(uv: [f32; 2]) -> u8 {
    (uv[0] / TERRAIN_BARYCENTRIC_LOD_U_SCALE).floor().min(3.0) as u8
}

/// Decode the barycentric U coordinate from encoded UV1.
pub fn barycentric_u(uv: [f32; 2]) -> f32 {
    let lod_slots = barycentric_lod_index(uv) as f32;
    uv[0] - lod_slots * TERRAIN_BARYCENTRIC_LOD_U_SCALE
}

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
    pub lod_delta_gt_one_face_mask: u8,
    pub missing_boundary_neighbors_at_mesh: u32,
    pub empty_surface_cap_at_mesh: bool,
    pub generated_frame: u32,
    pub lod_transition_snap_stats: LodTransitionSnapStats,
    pub mesh_section_stats: TerrainMeshSectionStats,
    pub mc_transvoxel_stats: Option<crate::voxel::mc_transvoxel::McTransvoxelStats>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum McTransitionForensicsMode {
    #[default]
    Enabled,
    DisabledKeepBoundaryRows,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MeshForensicsOptions {
    pub enabled: bool,
    pub mc_transitions: McTransitionForensicsMode,
}

#[derive(Component, Clone, Debug, Default)]
pub struct McTriangleSources {
    pub sources: Vec<McTriangleSource>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McTriangleSource {
    Regular {
        chunk_pos: IVec3,
        lod: LodLevel,
        cell: UVec3,
        case_index: u16,
        class_index: u8,
    },
    Transition {
        chunk_pos: IVec3,
        lod: LodLevel,
        face: ChunkFace,
        cell_u: u16,
        cell_v: u16,
        case_index: u16,
        class_index: u8,
        invert: bool,
    },
}

impl McTriangleSources {
    pub fn source_for_triangle_start(
        &self,
        triangle_start_index: usize,
    ) -> Option<&McTriangleSource> {
        self.sources.get(triangle_start_index / 3)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerrainMeshSectionStats {
    pub main_surface_vertex_count: u32,
    pub main_surface_index_count: u32,
    pub transition_apron_index_count: u32,
    pub vertical_skirt_index_count: u32,
}

impl TerrainMeshSectionStats {
    pub(super) fn from_main_surface(mesh: &MeshData) -> Self {
        Self {
            main_surface_vertex_count: mesh.positions.len() as u32,
            main_surface_index_count: mesh.indices.len() as u32,
            ..Default::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LodTransitionSnapStats {
    pub snapped_face_mask: u8,
    pub fallback_face_mask: u8,
    pub boundary_candidate_vertex_count: u32,
    pub morph_target_vertex_count: u32,
    pub morph_missing_target_vertex_count: u32,
    pub snapped_vertex_count: u32,
    pub skipped_vertex_count: u32,
    pub conflicting_vertex_count: u32,
}

impl LodTransitionSnapStats {
    #[inline]
    pub(super) fn face_mask(face: ChunkFace) -> u8 {
        1 << face as u8
    }

    #[inline]
    pub fn face_snapped(self, face: ChunkFace) -> bool {
        self.snapped_face_mask & Self::face_mask(face) != 0
    }

    #[inline]
    pub fn face_fallback(self, face: ChunkFace) -> bool {
        self.fallback_face_mask & Self::face_mask(face) != 0
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MeshGenerationTimingStats {
    pub sdf_us: u64,
    pub surface_nets_us: u64,
    pub emit_surface_us: u64,
    pub lod_seam_us: u64,
    pub boundary_strip_us: u64,
    pub seam_stitch_us: u64,
    pub skirt_us: u64,
    pub water_us: u64,
}

impl MeshGenerationTimingStats {
    pub fn add(&mut self, other: Self) {
        self.sdf_us = self.sdf_us.saturating_add(other.sdf_us);
        self.surface_nets_us = self.surface_nets_us.saturating_add(other.surface_nets_us);
        self.emit_surface_us = self.emit_surface_us.saturating_add(other.emit_surface_us);
        self.lod_seam_us = self.lod_seam_us.saturating_add(other.lod_seam_us);
        self.boundary_strip_us = self
            .boundary_strip_us
            .saturating_add(other.boundary_strip_us);
        self.seam_stitch_us = self.seam_stitch_us.saturating_add(other.seam_stitch_us);
        self.skirt_us = self.skirt_us.saturating_add(other.skirt_us);
        self.water_us = self.water_us.saturating_add(other.water_us);
    }
}

#[derive(Default)]
pub(super) struct WaterExposureCache {
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
    /// Chunk LOD index baked into UV1 for wireframe tinting.
    pub wireframe_lod_index: u8,
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
            wireframe_lod_index: 0,
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
            wireframe_lod_index: 0,
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

    pub(crate) fn push_triangle_barycentrics(&mut self) {
        self.push_triangle_barycentrics_with_section(TERRAIN_MESH_SECTION_MAIN);
    }

    pub(crate) fn push_triangle_barycentrics_with_section(&mut self, section: u8) {
        let lod_index = self.wireframe_lod_index;
        self.barycentric_uvs.extend_from_slice(&[
            encode_barycentric_uv([1.0, 0.0], section, lod_index),
            encode_barycentric_uv([0.0, 1.0], section, lod_index),
            encode_barycentric_uv([0.0, 0.0], section, lod_index),
        ]);
    }
}

impl WaterExposureCache {
    pub(super) fn new(mode: WaterAirExposureMode) -> Self {
        Self {
            mode,
            cache: HashMap::new(),
        }
    }

    pub(super) fn air_exposed(
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
    pub mesh_section_stats: TerrainMeshSectionStats,
    pub mc_transvoxel_stats: Option<crate::voxel::mc_transvoxel::McTransvoxelStats>,
    pub mc_triangle_sources: Option<McTriangleSources>,
    pub generation_timing: MeshGenerationTimingStats,
}
