use super::{
    ChunkMeshResult, LodTransitionSnapStats, MeshData, MeshForensicsOptions, TerrainMeshSectionStats,
    WaterAirExposureMode, WaterMeshingStats, generate_blocky_chunk_mesh,
    generate_chunk_mesh_surface_nets, generate_chunk_mesh_surface_nets_lod1,
    generate_chunk_mesh_surface_nets_lod2, generate_chunk_mesh_surface_nets_lod3,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::Resource;

/// Mesh generation mode
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MeshMode {
    /// Traditional blocky voxel meshing (Minecraft-style)
    #[default]
    Blocky,
    /// Smooth meshing using Surface Nets algorithm
    SurfaceNets,
    /// MC + Transvoxel spike (requires `mc_transvoxel` feature + config enabled)
    McTransvoxel,
}

impl MeshMode {
    /// Toggle between Blocky and SurfaceNets modes.
    pub fn toggle(&mut self) {
        *self = match self {
            MeshMode::Blocky => MeshMode::SurfaceNets,
            MeshMode::SurfaceNets => MeshMode::Blocky,
            MeshMode::McTransvoxel => MeshMode::SurfaceNets,
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

pub struct MeshRequest<'a> {
    pub chunk: &'a Chunk,
    pub world: &'a VoxelWorld,
    pub mode: MeshMode,
    pub logical_lod: LodLevel,
    pub mesh_lod: LodLevel,
    pub neighbor_lods: NeighborLods,
    pub skirt_config: &'a SkirtConfig,
    pub ao_config: &'a BakedAoConfig,
    pub water_exposure_mode: WaterAirExposureMode,
    pub forensics: MeshForensicsOptions,
    pub neighbor_strips: Option<&'a crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    pub mc_settings: Option<&'a crate::voxel::mc_transvoxel::McTransvoxelSettings>,
}

pub trait TerrainMesher {
    fn generate(request: &MeshRequest<'_>) -> ChunkMeshResult;
}

pub struct BlockyMesher;
pub struct SurfaceNetsMesher;
pub struct McTransvoxelMesher;

impl TerrainMesher for BlockyMesher {
    fn generate(request: &MeshRequest<'_>) -> ChunkMeshResult {
        generate_blocky_chunk_mesh(
            request.chunk,
            request.world,
            request.ao_config,
            request.water_exposure_mode,
        )
    }
}

impl TerrainMesher for SurfaceNetsMesher {
    fn generate(request: &MeshRequest<'_>) -> ChunkMeshResult {
        generate_surface_nets_for_lod(request)
    }
}

impl TerrainMesher for McTransvoxelMesher {
    fn generate(request: &MeshRequest<'_>) -> ChunkMeshResult {
        generate_chunk_mesh_mc_transvoxel(request)
    }
}

pub fn generate_chunk_mesh_for_request(request: MeshRequest<'_>) -> ChunkMeshResult {
    match request.mode {
        MeshMode::Blocky => BlockyMesher::generate(&request),
        MeshMode::SurfaceNets => SurfaceNetsMesher::generate(&request),
        MeshMode::McTransvoxel => McTransvoxelMesher::generate(&request),
    }
}

/// Compatibility wrapper for the old blocky-only entry point.
pub fn generate_chunk_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
) -> ChunkMeshResult {
    generate_blocky_chunk_mesh(chunk, world, ao_config, water_exposure_mode)
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
    generate_chunk_mesh_with_mode_and_forensics(
        chunk,
        world,
        mode,
        my_lod,
        neighbor_lods,
        skirt_config,
        ao_config,
        water_exposure_mode,
        MeshForensicsOptions::default(),
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn generate_chunk_mesh_with_mode_and_forensics(
    chunk: &Chunk,
    world: &VoxelWorld,
    mode: MeshMode,
    my_lod: LodLevel,
    neighbor_lods: NeighborLods,
    skirt_config: &SkirtConfig,
    ao_config: &BakedAoConfig,
    water_exposure_mode: WaterAirExposureMode,
    forensics: MeshForensicsOptions,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
) -> ChunkMeshResult {
    #[cfg(feature = "mc_transvoxel")]
    let loaded_mc_settings = if mode == MeshMode::McTransvoxel {
        Some(crate::voxel::mc_transvoxel::McTransvoxelSettings::load_or_default())
    } else {
        None
    };
    #[cfg(not(feature = "mc_transvoxel"))]
    let loaded_mc_settings: Option<crate::voxel::mc_transvoxel::McTransvoxelSettings> = None;

    generate_chunk_mesh_for_request(MeshRequest {
        chunk,
        world,
        mode,
        logical_lod: my_lod,
        mesh_lod: my_lod,
        neighbor_lods,
        skirt_config,
        ao_config,
        water_exposure_mode,
        forensics,
        neighbor_strips,
        mc_settings: loaded_mc_settings.as_ref(),
    })
}

fn generate_surface_nets_for_lod(request: &MeshRequest<'_>) -> ChunkMeshResult {
    match request.mesh_lod {
        LodLevel::Lod0 => generate_chunk_mesh_surface_nets(
            request.chunk,
            request.world,
            request.mesh_lod,
            request.neighbor_lods,
            request.skirt_config,
            request.ao_config,
            request.water_exposure_mode,
            request.neighbor_strips,
        ),
        LodLevel::Lod1 => generate_chunk_mesh_surface_nets_lod1(
            request.chunk,
            request.world,
            request.mesh_lod,
            request.neighbor_lods,
            request.skirt_config,
            request.ao_config,
            request.water_exposure_mode,
            request.neighbor_strips,
        ),
        LodLevel::Lod2 => generate_chunk_mesh_surface_nets_lod2(
            request.chunk,
            request.world,
            request.mesh_lod,
            request.neighbor_lods,
            request.skirt_config,
            request.ao_config,
            request.water_exposure_mode,
            request.neighbor_strips,
        ),
        LodLevel::Lod3 => generate_chunk_mesh_surface_nets_lod3(
            request.chunk,
            request.world,
            request.mesh_lod,
            request.neighbor_lods,
            request.skirt_config,
            request.ao_config,
            request.water_exposure_mode,
            request.neighbor_strips,
        ),
        LodLevel::Culled => empty_mesh_result(),
    }
}

fn empty_mesh_result() -> ChunkMeshResult {
    ChunkMeshResult {
        solid: MeshData::new(),
        water: MeshData::new(),
        water_stats: WaterMeshingStats::default(),
        lod_transition_snap_stats: LodTransitionSnapStats::default(),
        mesh_section_stats: TerrainMeshSectionStats::default(),
        mc_transvoxel_stats: None,
        mc_triangle_sources: None,
        boundary_strips: Vec::new(),
    }
}

#[cfg(feature = "mc_transvoxel")]
fn generate_chunk_mesh_mc_transvoxel(request: &MeshRequest<'_>) -> ChunkMeshResult {
    use crate::voxel::mc_transvoxel::{McMeshInput, generate_mc_chunk_mesh};

    let Some(settings) = request.mc_settings else {
        return SurfaceNetsMesher::generate(request);
    };
    if !settings.enabled {
        return SurfaceNetsMesher::generate(request);
    }

    let output = generate_mc_chunk_mesh(McMeshInput {
        world: request.world,
        chunk: request.chunk,
        chunk_pos: request.chunk.position(),
        lod: request.mesh_lod,
        neighbor_lods: request.neighbor_lods,
        settings,
        water_exposure_mode: request.water_exposure_mode,
        forensics: request.forensics,
    });
    output.result
}

#[cfg(not(feature = "mc_transvoxel"))]
fn generate_chunk_mesh_mc_transvoxel(request: &MeshRequest<'_>) -> ChunkMeshResult {
    SurfaceNetsMesher::generate(request)
}
